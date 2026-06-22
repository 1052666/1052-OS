"""Modbus driver.

Reads Modbus TCP registers on a poll interval and writes decoded values
to TDengine. Supports all dtypes from `modbus_decoder.DTYPES` and provides
the write-command payload schema consumed by `command_handler._on_modbus_paho_msg`.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from gateway.modbus_client import ModbusClient, ModbusConfig
from gateway.modbus_decoder import (
    DTYPES,
    ENDIANS,
    DEFAULT_ENDIAN,
    DecoderError,
    decode_value,
)


class ModbusConfig(BaseModel):
    """Schema for a Modbus collector task. Drives the frontend form."""

    host: str = Field(default="127.0.0.1", description="Modbus TCP host")
    port: int = Field(default=502, description="Modbus TCP port")
    unit_id: int = Field(default=1, ge=0, le=255, description="Modbus unit / slave id")
    address: int = Field(default=0, ge=0, description="Register address")
    count: int = Field(default=1, ge=1, description="Number of registers to read")
    register_kind: str = Field(default="holding", description="holding | input | coils")
    dtype: str = Field(default="u16", description="Decode dtype (DTYPES)")
    endian: str = Field(default=DEFAULT_ENDIAN, description=f"One of {ENDIANS}")
    bit_index: int = Field(default=0, ge=0, le=15, description="Bit index for dtype='bit'")
    string_len: int = Field(default=1, ge=1, description="Char/byte count for ascii/utf8")


# Per-dtype mapping for write payloads sent to CommandHandler.
# The JS side (`dashboard_flows._build_function_body_modbus`) uses the same
# table — keep in sync if you add dtypes.
MODBUS_WRITE_CMD_BY_DTYPE = {
    "bit":  ("write_coil",      "msg.payload === '1' || msg.payload === 1 || msg.payload === true"),
    "u16":  ("write_register",  "parseInt(msg.payload, 10)"),
    "i16":  ("write_register",  "parseInt(msg.payload, 10)"),
    "u32":  ("write_float32",   "parseFloat(msg.payload)"),
    "i32":  ("write_float32",   "parseFloat(msg.payload)"),
    "f32":  ("write_float32",   "parseFloat(msg.payload)"),
    "u64":  ("write_registers", "parseFloat(msg.payload)"),  # TODO v0.2: split 2 regs
    "i64":  ("write_registers", "parseFloat(msg.payload)"),  # TODO v0.2: split 2 regs
}

WRITABLE_DTYPES = set(MODBUS_WRITE_CMD_BY_DTYPE.keys())

SUPPORTED_WRITE_CMDS = {
    "write_coil",
    "write_register",
    "write_coils",
    "write_registers",
    "write_float32",
}


class ModbusDriver:
    """Implements the Driver Protocol for Modbus TCP collection."""

    name = "modbus"
    label = "Modbus TCP"
    config_cls = ModbusConfig

    def __init__(self) -> None:
        self._threads: dict[str, threading.Thread] = {}

    # ── lifecycle ──────────────────────────────────────────────────

    def start(self, task, ctx) -> None:
        from gateway.drivers.base import DriverContext  # local to avoid cycles
        assert isinstance(ctx, DriverContext)
        if task.id in self._threads and self._threads[task.id].is_alive():
            return
        ctx.running[task.id] = True
        ctx.points_collected[task.id] = 0
        col_type = self.col_type(task)
        t = threading.Thread(
            target=self._run, args=(task, ctx, col_type), daemon=True,
        )
        self._threads[task.id] = t
        t.start()

    def stop(self, task) -> None:
        t = self._threads.pop(task.id, None)
        if t is not None:
            t.join(timeout=5)

    # ── TDengine schema ──────────────────────────────────────────

    @staticmethod
    def col_type(task) -> str:
        if task.dtype in ("ascii", "utf8"):
            return "NCHAR(255)"
        if task.dtype in (
            "u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64",
            "bcd16", "bcd32", "bit", "time",
        ):
            return "BIGINT"
        return "DOUBLE"

    # ── status serialization ──────────────────────────────────────

    @staticmethod
    def status_fields(task) -> dict[str, Any]:
        return {
            "mb_host": task.mb_host,
            "mb_port": task.mb_port,
            "mb_unit": task.mb_unit,
            "mb_address": task.mb_address,
            "mb_count": task.mb_count,
            "mb_register": task.mb_register,
            "dtype": task.dtype,
            "endian": task.endian,
            "bit_index": task.bit_index,
            "string_len": task.string_len,
        }

    # ── config ↔ CollectTask mapping ──────────────────────────────

    @staticmethod
    def to_task_fields(cfg: "ModbusConfig") -> dict[str, Any]:
        return {
            "mb_host": cfg.host,
            "mb_port": cfg.port,
            "mb_unit": cfg.unit_id,
            "mb_address": cfg.address,
            "mb_count": cfg.count,
            "mb_register": cfg.register_kind,
            "dtype": cfg.dtype,
            "endian": cfg.endian,
            "bit_index": cfg.bit_index,
            "string_len": cfg.string_len,
        }

    # ── dashboard widget rendering ─────────────────────────────────

    WIDGET_GROUP_ID = "grp_modbus_tags"
    WIDGET_GROUP_NAME = "Modbus Tags"
    WIDGET_GROUP_ORDER = 2
    WIDGET_Y_OFFSET = 0

    @classmethod
    def widget_group_id(cls) -> str:
        return cls.WIDGET_GROUP_ID

    @classmethod
    def widget_group_name(cls) -> str:
        return cls.WIDGET_GROUP_NAME

    @classmethod
    def widget_group_order(cls) -> int:
        return cls.WIDGET_GROUP_ORDER

    @classmethod
    def widget_y_offset(cls) -> int:
        return cls.WIDGET_Y_OFFSET

    @staticmethod
    def tag_topic(task, topic_prefix: str) -> str:
        device = getattr(task, "device", "") or getattr(task, "table", "raw_data")
        site = getattr(task, "site", "default")
        return f"{topic_prefix}/{site}/{device}/{task.id}/value"

    # ── control widget (write path) ──────────────────────────────

    @staticmethod
    def supports_control_widget(task) -> bool:
        return task.dtype in WRITABLE_DTYPES

    @staticmethod
    def control_topic(task, topic_prefix: str) -> str | None:
        if task.dtype not in WRITABLE_DTYPES:
            return None
        return f"{topic_prefix}/cmd/write/modbus"

    @staticmethod
    def control_function_body(task) -> str | None:
        if task.dtype not in WRITABLE_DTYPES:
            return None
        cmd, value_expr = MODBUS_WRITE_CMD_BY_DTYPE[task.dtype]
        note = ""
        if task.dtype in ("u64", "i64"):
            note = "// TODO v0.2: split 64-bit into 2 Modbus registers\n"
        return (
            f"// 1052-OS: wrap raw value into CommandHandler write payload for {task.id}\n"
            f"{note}"
            f"msg.payload = JSON.stringify({{\n"
            f"    request_id: '{task.id}-' + Date.now(),\n"
            f"    cmd: '{cmd}',\n"
            f"    host: '{task.mb_host}', port: {task.mb_port}, unit_id: {task.mb_unit},\n"
            f"    address: {task.mb_address},\n"
            f"    value: {value_expr}\n"
            f"}});\n"
            f"return msg;\n"
        )

    # ── schema for the frontend form ──────────────────────────────

    @classmethod
    def describe(cls) -> dict:
        return {
            "name": cls.name,
            "label": cls.label,
            "config_cls": cls.config_cls.__name__,
            "fields": [
                {"key": "host", "label": "Host", "type": "text", "default": "127.0.0.1"},
                {"key": "port", "label": "Port", "type": "number", "default": 502},
                {"key": "unit_id", "label": "Unit ID", "type": "number", "default": 1},
                {"key": "address", "label": "Address", "type": "number", "default": 0},
                {"key": "count", "label": "Count", "type": "number", "default": 1},
                {"key": "register_kind", "label": "Register", "type": "select",
                 "options": ["holding", "input", "coils"], "default": "holding"},
                {"key": "dtype", "label": "Dtype", "type": "select",
                 "options": list(DTYPES), "default": "u16"},
                {"key": "endian", "label": "Endian", "type": "select",
                 "options": list(ENDIANS), "default": DEFAULT_ENDIAN},
                {"key": "bit_index", "label": "Bit Index", "type": "number", "default": 0},
                {"key": "string_len", "label": "String Len", "type": "number", "default": 1},
            ],
            "readonly": False,
        }

    # ── decode helpers ───────────────────────────────────────────

    @staticmethod
    def decode_row(task, raw: list[int], col_type: str) -> dict:
        """Decode raw 16-bit words into the stable TDengine value column."""
        try:
            val = decode_value(
                raw, task.dtype, task.endian,
                bit_index=task.bit_index, string_len=task.string_len,
            )
        except DecoderError:
            return {"v": None}
        if col_type == "BIGINT":
            if isinstance(val, bool):
                return {"v": int(val)}
            if isinstance(val, (int, float)):
                return {"v": int(val)}
            return {"v": None}
        if col_type == "DOUBLE":
            if isinstance(val, (int, float)):
                return {"v": float(val)}
            return {"v": None}
        if col_type.startswith("NCHAR"):
            return {"v": str(val) if val is not None else ""}
        return {"v": val}

    @staticmethod
    def handle_write(host: str, port: int, unit_id: int, cmd: str, payload: dict) -> None:
        """Execute a Modbus write command. Called by CommandHandler."""
        if cmd not in SUPPORTED_WRITE_CMDS:
            raise ValueError(f"unknown modbus cmd {cmd!r}")
        mc = ModbusClient(ModbusConfig(host=host, port=port, unit_id=unit_id))
        with mc as client:
            if cmd == "write_coil":
                client.write_coil(payload["address"], payload["value"])
            elif cmd == "write_register":
                client.write_register(payload["address"], payload["value"])
            elif cmd == "write_coils":
                client.write_coils(payload["address"], payload["values"])
            elif cmd == "write_registers":
                client.write_registers(payload["address"], payload["values"])
            elif cmd == "write_float32":
                client.write_float32(payload["address"], payload["value"])

    # ── internal run loop ────────────────────────────────────────

    def _run(self, task, ctx, col_type: str) -> None:
        mb = ModbusClient(ModbusConfig(
            host=task.mb_host, port=task.mb_port, unit_id=task.mb_unit,
        ))
        try:
            mb.connect()
            while ctx.running.get(task.id, False):
                try:
                    if task.mb_register == "coils":
                        raw = mb.read_coils(task.mb_address, task.mb_count)
                        if task.dtype == "bit":
                            row = {"v": raw[0] if raw else False}
                            decoded = raw[0] if raw else False
                        else:
                            word = 0
                            for i, v in enumerate(raw[:16]):
                                if v:
                                    word |= (1 << i)
                            row = {"v": word}
                            decoded = word
                    elif task.mb_register == "input":
                        raw = mb.read_input_registers(task.mb_address, task.mb_count)
                        row = self.decode_row(task, raw, col_type)
                        decoded = row.get("v")
                    else:
                        raw = mb.read_holding_registers(task.mb_address, task.mb_count)
                        row = self.decode_row(task, raw, col_type)
                        decoded = row.get("v")

                    ctx.insert_row(self._table_for(task), row)
                    ctx.points_collected[task.id] = ctx.points_collected.get(task.id, 0) + 1
                    ctx.record_value(task, decoded, task.dtype)
                    ctx.publish_value(task, decoded, time.time())
                except Exception as e:
                    ctx.record_error(task, task.dtype, str(e))
                    try:
                        ctx.insert_row(self._table_for(task), {"v": None})
                    except Exception:
                        pass
                time.sleep(task.interval)
        finally:
            mb.disconnect()

    @staticmethod
    def _table_for(task) -> str:
        return f"{task.table}_{task.id}"


# Auto-register at import time.
from gateway.drivers.registry import register as _register
_register(ModbusDriver())
