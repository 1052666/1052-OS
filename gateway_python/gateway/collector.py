"""
1052-OS Industrial Gateway — Data Collector

Owns the per-task runtime state (running flag, point count, last value,
TDengine schema) and delegates all protocol-specific polling to a
registered Driver in `gateway/drivers/`. Adding a new protocol is one file
under `gateway/drivers/<name>.py` + one auto-registration at module load.
"""

from dataclasses import dataclass, field

from gateway.drivers import DriverContext, try_driver
from gateway.tdengine_client import TdClient, TdConfig
from gateway.mqtt_publisher import MqttPublisher
from gateway.modbus_decoder import DEFAULT_ENDIAN


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
    # MQTT source (read from broker as a third collection protocol)
    mq_broker_host: str = "127.0.0.1"
    mq_broker_port: int = 1883
    mq_username: str | None = None
    mq_password: str | None = None
    mq_topic: str = ""              # absolute topic, e.g. "device/temperature"
    mq_qos: int = 0
    mq_payload: str = "raw"         # raw | json
    mq_field: str = "v"             # json path (top-level key) when mq_payload=="json"
    mq_client_id: str = ""          # optional; auto if empty
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
            "mq_broker_host": self.mq_broker_host,
            "mq_broker_port": self.mq_broker_port,
            "mq_username": self.mq_username,
            "mq_password": self.mq_password,
            "mq_topic": self.mq_topic,
            "mq_qos": self.mq_qos,
            "mq_payload": self.mq_payload,
            "mq_field": self.mq_field,
            "mq_client_id": self.mq_client_id,
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
            mq_broker_host=d.get("mq_broker_host", "127.0.0.1"),
            mq_broker_port=d.get("mq_broker_port", 1883),
            mq_username=d.get("mq_username"),
            mq_password=d.get("mq_password"),
            mq_topic=d.get("mq_topic", ""),
            mq_qos=d.get("mq_qos", 0),
            mq_payload=d.get("mq_payload", "raw"),
            mq_field=d.get("mq_field", "v"),
            mq_client_id=d.get("mq_client_id", ""),
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
        # DriverContext mirrors the legacy dicts above so each driver can
        # mutate the same in-process state. Drivers for protocols that have
        # already been migrated (mqtt) read/write here directly; modbus /
        # opcua still go through the legacy self._poll_* methods below and
        # will be migrated in subsequent commits.
        self._ctx = DriverContext(
            td=self.td,
            mqtt_publisher=self.mqtt_publisher,
            running=self._running,
            points_collected=self._points_collected,
            last_values=self._last_values,
        )

    def add_task(self, task: CollectTask):
        self.tasks[task.id] = task

    def remove_task(self, task_id: str):
        self.stop_task(task_id)
        self.tasks.pop(task_id, None)

    @staticmethod
    def _col_type_for_task(task: "CollectTask") -> str:
        """Decide TDengine column type from task protocol + dtype.

        Centralized so start_task() and the per-protocol pollers agree.
        """
        driver = try_driver(task.protocol)
        if driver is not None:
            return driver.col_type(task)
        # Legacy fallback for protocols that have no driver yet.
        if task.protocol == "modbus":
            if task.dtype in ("ascii", "utf8"):
                return "NCHAR(255)"
            if task.dtype in ("u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64",
                              "bcd16", "bcd32", "bit", "time"):
                return "BIGINT"
            return "DOUBLE"
        # OPC UA and unknown: server-side typed → DOUBLE.
        return "DOUBLE"

    def start_task(self, task_id: str):
        task = self.tasks.get(task_id)
        if not task or self._running.get(task_id):
            return

        # Lazily create the driver context if the collector was instantiated
        # via __new__ (test paths). In production this is a no-op.
        if not hasattr(self, "_ctx"):
            self._ctx = DriverContext(
                td=self.td,
                mqtt_publisher=self.mqtt_publisher,
                running=self._running,
                points_collected=self._points_collected,
                last_values=self._last_values,
            )

        self._running[task_id] = True
        self._points_collected[task_id] = 0

        # Ensure table exists — 1 column per task (the decoded value under TAG)
        col_type = self._col_type_for_task(task)
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
                    "mq_topic": task.mq_topic,
                    "mq_payload": task.mq_payload,
                    "mq_field": task.mq_field,
                },
                retain=True,
            )

        # If a driver is registered for this protocol, delegate. Drivers
        # own their own thread lifecycle (so MqttDriver.start() spawns the
        # paho loop thread, etc.).
        driver = try_driver(task.protocol)
        if driver is not None:
            driver.start(task, self._ctx)
            return

        # Legacy fallback for protocols that have no driver yet.
        if task.protocol == "modbus":
            t = threading.Thread(target=self._poll_modbus, args=(task, child_table), daemon=True)
        elif task.protocol == "opcua":
            t = threading.Thread(target=self._poll_opcua, args=(task, child_table), daemon=True)
        else:
            return

        self._threads[task_id] = t
        t.start()

    def stop_task(self, task_id: str):
        task = self.tasks.get(task_id)
        driver = try_driver(task.protocol) if task else None

        if driver is not None:
            driver.stop(task)
        else:
            # Legacy: collector-owned thread.
            self._running[task_id] = False
            t = self._threads.pop(task_id, None)
            if t:
                t.join(timeout=5)

        self._last_values.pop(task_id, None)
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
                # Modbus decode config (kept for the legacy frontend table;
                # other protocols' fields come from their driver below).
                "dtype": task.dtype,
                "endian": task.endian,
                "bit_index": task.bit_index,
                "string_len": task.string_len,
                # OPC UA node id (server returns typed values)
                "ua_url": task.ua_url,
                "ua_node_id": task.ua_node_id,
            }
            # Per-protocol fields from the registered driver (mqtt, ...).
            driver = try_driver(task.protocol)
            if driver is not None:
                entry.update(driver.status_fields(task))
            else:
                # Legacy fallback so old OPC UA / modbus rows still expose
                # the right fields until those drivers land.
                if task.protocol == "modbus":
                    pass  # already covered above
                elif task.protocol == "opcua":
                    pass  # already covered above
                else:
                    # Unknown protocol — fall back to MQTT-shaped fields.
                    entry.update({
                        "mq_broker_host": task.mq_broker_host,
                        "mq_broker_port": task.mq_broker_port,
                        "mq_topic": task.mq_topic,
                        "mq_qos": task.mq_qos,
                        "mq_payload": task.mq_payload,
                        "mq_field": task.mq_field,
                    })
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
    # Per-protocol polling is now in `gateway/drivers/<proto>.py`. The
    # collector only knows how to set up the TDengine schema and to delegate
    # to the registered driver via `try_driver(task.protocol)`.

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stop_all()
