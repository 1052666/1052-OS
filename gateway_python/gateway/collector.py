"""
1052-OS Industrial Gateway — Data Collector
Polls industrial protocols and writes to TDengine time-series database.
"""

import asyncio
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from gateway.tdengine_client import TdClient, TdConfig
from gateway.modbus_client import ModbusClient, ModbusConfig
from gateway.opcua_client import OpcuaClientWrapper, OpcuaConfig
from gateway.mqtt_publisher import MqttPublisher
from gateway.modbus_decoder import (
    DTYPES, ENDIANS, DEFAULT_ENDIAN, DecoderError, decode_value, register_count,
)


@dataclass
class CollectTask:
    """Defines what to collect: protocol + address + target table/column."""
    id: str
    protocol: str  # "modbus" | "opcua"
    # Modbus
    mb_host: str = "127.0.0.1"
    mb_port: int = 502
    mb_unit: int = 1
    mb_address: int = 0
    mb_count: int = 1
    mb_register: str = "holding"  # holding | input | coils
    # Decoding (Modbus only; OPC UA uses server-side types)
    dtype: str = "u16"            # one of DTYPES (modbus_decoder)
    endian: str = DEFAULT_ENDIAN  # one of ENDIANS
    bit_index: int = 0            # for dtype="bit"
    string_len: int = 1           # for dtype="ascii" / "utf8" (chars or bytes)
    # OPC UA
    ua_url: str = "opc.tcp://127.0.0.1:4840"
    ua_node_id: str = ""
    # Target
    table: str = "raw_data"
    col_map: dict[str, str] = field(default_factory=dict)  # register_index → column_name
    interval: float = 1.0  # seconds between polls
    # MQTT topic metadata
    site: str = "default"
    device: str = ""  # defaults to `table` if empty

    def to_dict(self) -> dict:
        return {
            "id": self.id, "protocol": self.protocol,
            "mb_host": self.mb_host, "mb_port": self.mb_port, "mb_unit": self.mb_unit,
            "mb_address": self.mb_address, "mb_count": self.mb_count, "mb_register": self.mb_register,
            "dtype": self.dtype, "endian": self.endian,
            "bit_index": self.bit_index, "string_len": self.string_len,
            "ua_url": self.ua_url, "ua_node_id": self.ua_node_id,
            "table": self.table, "col_map": self.col_map, "interval": self.interval,
            "site": self.site, "device": self.device or self.table,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CollectTask":
        return cls(
            id=d["id"], protocol=d.get("protocol", "modbus"),
            mb_host=d.get("mb_host", "127.0.0.1"), mb_port=d.get("mb_port", 502),
            mb_unit=d.get("mb_unit", 1), mb_address=d.get("mb_address", 0),
            mb_count=d.get("mb_count", 1), mb_register=d.get("mb_register", "holding"),
            dtype=d.get("dtype", "u16"), endian=d.get("endian", DEFAULT_ENDIAN),
            bit_index=d.get("bit_index", 0), string_len=d.get("string_len", 1),
            ua_url=d.get("ua_url", "opc.tcp://127.0.0.1:4840"),
            ua_node_id=d.get("ua_node_id", ""),
            table=d.get("table", "raw_data"), col_map=d.get("col_map", {}),
            interval=d.get("interval", 1.0),
            site=d.get("site", "default"),
            device=d.get("device", d.get("table", "raw_data")),
        )


class DataCollector:
    """Background collector that polls protocols and writes to TDengine."""

    def __init__(self, td_config: TdConfig | None = None, mqtt_publisher: MqttPublisher | None = None):
        self.td = TdClient(td_config)
        self.mqtt_publisher = mqtt_publisher
        self.tasks: dict[str, CollectTask] = {}
        self._running: dict[str, bool] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._points_collected: dict[str, int] = {}
        # Per-task most-recent values + type label + error — exposed via /api/collector/status
        # so the UI can show live data without an extra one-shot read roundtrip.
        self._last_values: dict[str, dict] = {}
        self.td.connect()

    def add_task(self, task: CollectTask):
        self.tasks[task.id] = task

    def remove_task(self, task_id: str):
        self.stop_task(task_id)
        self.tasks.pop(task_id, None)

    def start_task(self, task_id: str):
        task = self.tasks.get(task_id)
        if not task or self._running.get(task_id):
            return

        self._running[task_id] = True
        self._points_collected[task_id] = 0

        # Ensure table exists — 1 column per task (the decoded value under TAG)
        if task.protocol == "modbus":
            if task.dtype in ("ascii", "utf8"):
                col_type = "NCHAR(255)"
            elif task.dtype in ("u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64",
                                "bcd16", "bcd32", "bit", "time"):
                col_type = "BIGINT"
            else:
                col_type = "DOUBLE"
        else:
            # OPC UA: store as DOUBLE (server already returns typed)
            col_type = "DOUBLE"
        columns = {task.id: col_type}
        self.td.ensure_supertable(task.table, columns, {"task_id": "NCHAR(64)"})
        child_table = f"{task.table}_{task.id}"
        self.td.ensure_table(child_table, task.table, {"task_id": task.id})

        # Publish retained meta so NR can discover this tag
        if self.mqtt_publisher:
            self.mqtt_publisher.publish_meta(
                site=task.site,
                device=task.device or task.table,
                tag=task.id,
                meta={
                    "tag": task.id,
                    "device": task.device or task.table,
                    "site": task.site,
                    "protocol": task.protocol,
                    "table": task.table,
                    "dtype": task.dtype,
                    "endian": task.endian,
                    "interval": task.interval,
                    "ua_node_id": task.ua_node_id,
                    "ua_data_type": task.col_map.get("ua_dtype", ""),
                },
                retain=True,
            )

        if task.protocol == "modbus":
            t = threading.Thread(target=self._poll_modbus, args=(task, child_table), daemon=True)
        elif task.protocol == "opcua":
            t = threading.Thread(target=self._poll_opcua, args=(task, child_table), daemon=True)
        else:
            return

        self._threads[task_id] = t
        t.start()

    def stop_task(self, task_id: str):
        self._running[task_id] = False
        t = self._threads.pop(task_id, None)
        if t:
            t.join(timeout=5)
        self._last_values.pop(task_id, None)
        task = self.tasks.get(task_id)
        if self.mqtt_publisher and task:
            self.mqtt_publisher.publish_meta(
                site=task.site,
                device=task.device or task.table,
                tag=task.id,
                meta={},
                retain=True,
            )

    def stop_all(self):
        for tid in list(self._running.keys()):
            self.stop_task(tid)
        self.td.close()

    def status(self) -> list[dict]:
        out = []
        for tid, task in self.tasks.items():
            entry = {
                "id": tid,
                "protocol": task.protocol,
                "running": self._running.get(tid, False),
                "points": self._points_collected.get(tid, 0),
                "interval": task.interval,
                "table": task.table,
                # Modbus decode config
                "dtype": task.dtype,
                "endian": task.endian,
                "bit_index": task.bit_index,
                "string_len": task.string_len,
                # OPC UA node id (server returns typed values)
                "ua_url": task.ua_url,
                "ua_node_id": task.ua_node_id,
            }
            # Most recent value (if collector has polled at least once)
            last = self._last_values.get(tid)
            if last:
                entry["last_value"] = last.get("value")
                entry["last_type"] = last.get("type")   # server Variant name for OPC UA,
                                                       # Modbus dtype for modbus
                entry["last_ts"] = last.get("ts")
                if last.get("err"):
                    entry["last_error"] = last["err"]
            out.append(entry)
        return out

    # ── Internal pollers ──────────────────────────────

    def _publish_value(self, task: CollectTask, value, ts: float, q: int = 192) -> None:
        if not self.mqtt_publisher:
            return
        self.mqtt_publisher.publish(
            site=task.site,
            device=task.device or task.table,
            tag=task.id,
            value=value,
            ts=ts,
            q=q,
        )

    def _poll_modbus(self, task: CollectTask, table: str):
        mb = ModbusClient(ModbusConfig(host=task.mb_host, port=task.mb_port, unit_id=task.mb_unit))
        # Decide storage column type from dtype
        if task.dtype in ("u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64",
                          "bcd16", "bcd32", "bit", "time"):
            col_type = "BIGINT"
        elif task.dtype in ("f32", "f64", "duration"):
            col_type = "DOUBLE"
        elif task.dtype in ("ascii", "utf8"):
            col_type = "NCHAR(255)"
        else:
            col_type = "DOUBLE"

        try:
            mb.connect()
            while self._running.get(task.id, False):
                try:
                    # 1. read raw words from server
                    if task.mb_register == "coils":
                        raw = mb.read_coils(task.mb_address, task.mb_count)
                        # Coils are bit-valued: each is a bool; only dtype=bit/u16 makes sense
                        if task.dtype == "bit":
                            row = {task.id: raw[0] if raw else False}
                            decoded = raw[0] if raw else False
                        else:
                            # legacy: write first 16 coils as u16
                            word = 0
                            for i, v in enumerate(raw[:16]):
                                if v:
                                    word |= (1 << i)
                            row = {task.id: word}
                            decoded = word
                    elif task.mb_register == "input":
                        raw = mb.read_input_registers(task.mb_address, task.mb_count)
                        row = self._decode_modbus_row(task, raw, col_type)
                        decoded = row.get(task.id)
                    else:
                        raw = mb.read_holding_registers(task.mb_address, task.mb_count)
                        row = self._decode_modbus_row(task, raw, col_type)
                        decoded = row.get(task.id)

                    self.td.insert(table, datetime.now(timezone.utc), row)
                    self._points_collected[task.id] += 1
                    self._last_values[task.id] = {
                        "value": decoded,
                        "type": task.dtype,
                        "ts": time.time(),
                    }
                    self._publish_value(task, decoded, time.time())
                except Exception as e:
                    self._last_values[task.id] = {
                        "value": None,
                        "type": task.dtype,
                        "ts": time.time(),
                        "err": str(e),
                    }
                    # On decode/transport error, write NULL to surface staleness
                    try:
                        self.td.insert(table, datetime.now(timezone.utc), {task.id: None})
                    except Exception:
                        pass
                time.sleep(task.interval)
        finally:
            mb.disconnect()

    def _decode_modbus_row(self, task: CollectTask, raw: list[int], col_type: str) -> dict:
        """Decode raw 16-bit words into a single typed value under the task TAG."""
        try:
            val = decode_value(
                raw, task.dtype, task.endian,
                bit_index=task.bit_index, string_len=task.string_len,
            )
        except DecoderError:
            return {task.id: None}
        # Coerce to a TDengine-friendly type
        if col_type == "BIGINT":
            if isinstance(val, bool):
                return {task.id: int(val)}
            if isinstance(val, (int, float)):
                return {task.id: int(val)}
            return {task.id: None}
        if col_type == "DOUBLE":
            if isinstance(val, (int, float)):
                return {task.id: float(val)}
            return {task.id: None}
        if col_type.startswith("NCHAR"):
            return {task.id: str(val) if val is not None else ""}
        return {task.id: val}

    def _poll_opcua(self, task: CollectTask, table: str):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def _run():
            ua = OpcuaClientWrapper(OpcuaConfig(url=task.ua_url))
            try:
                await ua.connect()
                while self._running.get(task.id, False):
                    try:
                        if task.ua_node_id:
                            node = await ua.read_node(task.ua_node_id)
                            col = task.col_map.get("value", "value")
                            row = {col: float(node["value"]) if isinstance(node["value"], (int, float)) else 0}
                            self.td.insert(table, datetime.now(timezone.utc), row)
                            self._points_collected[task.id] += 1
                            self._last_values[task.id] = {
                                "value": node["value"],
                                "type": node.get("data_type", "Unknown"),
                                "ts": time.time(),
                            }
                            self._publish_value(task, node["value"], time.time())
                    except Exception as e:
                        self._last_values[task.id] = {
                            "value": None,
                            "type": None,
                            "ts": time.time(),
                            "err": str(e),
                        }
                    await asyncio.sleep(task.interval)
            finally:
                await ua.disconnect()

        loop.run_until_complete(_run())

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stop_all()
