"""OPC UA driver.

Reads a single OPC UA node on a poll interval and writes typed values to
TDengine. Supports the write path via `command_handler._on_opcua_paho_msg`.
"""
from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from gateway.opcua_client import OpcuaClientWrapper, OpcuaConfig


class OpcuaConfig(BaseModel):
    """Schema for an OPC UA collector task. Drives the frontend form."""

    url: str = Field(default="opc.tcp://127.0.0.1:4840",
                     description="OPC UA server endpoint URL")
    node_id: str = Field(default="", description="NodeId string, e.g. ns=2;s=Temperature")


class OpcuaDriver:
    """Implements the Driver Protocol for OPC UA collection."""

    name = "opcua"
    label = "OPC UA"
    config_cls = OpcuaConfig

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
        t = threading.Thread(target=self._run, args=(task, ctx), daemon=True)
        self._threads[task.id] = t
        t.start()

    def stop(self, task) -> None:
        t = self._threads.pop(task.id, None)
        if t is not None:
            t.join(timeout=5)

    # ── TDengine schema ──────────────────────────────────────────

    @staticmethod
    def col_type(task) -> str:
        # Server-typed values — coerce to DOUBLE.
        return "DOUBLE"

    # ── status serialization ──────────────────────────────────────

    @staticmethod
    def status_fields(task) -> dict[str, Any]:
        return {
            "ua_url": task.ua_url,
            "ua_node_id": task.ua_node_id,
        }

    # ── config ↔ CollectTask mapping ──────────────────────────────

    @staticmethod
    def to_task_fields(cfg: "OpcuaConfig") -> dict[str, Any]:
        return {
            "ua_url": cfg.url,
            "ua_node_id": cfg.node_id,
        }

    # ── dashboard widget rendering ─────────────────────────────────

    WIDGET_GROUP_ID = "grp_opc_ua_tags"
    WIDGET_GROUP_NAME = "OPC UA Tags"
    WIDGET_GROUP_ORDER = 3
    WIDGET_Y_OFFSET = 400

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
        # OPC UA is server-typed; writes are allowed for any task with a node_id.
        return bool(getattr(task, "ua_node_id", ""))

    @staticmethod
    def control_topic(task, topic_prefix: str) -> str | None:
        if not getattr(task, "ua_node_id", ""):
            return None
        return f"{topic_prefix}/cmd/write/opcua"

    @staticmethod
    def control_function_body(task) -> str | None:
        if not getattr(task, "ua_node_id", ""):
            return None
        return (
            f"// 1052-OS: wrap raw value into CommandHandler write payload for {task.id}\n"
            f"msg.payload = JSON.stringify({{\n"
            f"    request_id: '{task.id}-' + Date.now(),\n"
            f"    cmd: 'write_node',\n"
            f"    url: '{task.ua_url}',\n"
            f"    node_id: '{task.ua_node_id}',\n"
            f"    value: msg.payload\n"
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
                {"key": "url", "label": "Server URL", "type": "text",
                 "default": "opc.tcp://127.0.0.1:4840"},
                {"key": "node_id", "label": "Node ID", "type": "text",
                 "default": ""},
            ],
            "readonly": False,
        }

    # ── write path (called by CommandHandler) ─────────────────────

    @staticmethod
    async def handle_write(url: str, node_id: str, value) -> None:
        """Execute an OPC UA write command."""
        oc = OpcuaClientWrapper(OpcuaConfig(url=url))
        await oc.connect()
        try:
            await oc.write_node(node_id, value)
        finally:
            try:
                await oc.disconnect()
            except Exception:
                pass

    # ── internal run loop ────────────────────────────────────────

    def _run(self, task, ctx) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def _runner():
            ua = OpcuaClientWrapper(OpcuaConfig(url=task.ua_url))
            try:
                await ua.connect()
                while ctx.running.get(task.id, False):
                    try:
                        if task.ua_node_id:
                            node = await ua.read_node(task.ua_node_id)
                            col = "v"
                            row = {col: float(node["value"]) if isinstance(node["value"], (int, float)) else 0}
                            ctx.insert_row(self._table_for(task), row)
                            ctx.points_collected[task.id] = ctx.points_collected.get(task.id, 0) + 1
                            ctx.record_value(task, node["value"], node.get("data_type", "Unknown"))
                            ctx.publish_value(task, node["value"], time.time())
                    except Exception as e:
                        ctx.record_error(task, None, str(e))
                    await asyncio.sleep(task.interval)
            finally:
                await ua.disconnect()

        loop.run_until_complete(_runner())

    @staticmethod
    def _table_for(task) -> str:
        return f"{task.table}_{task.id}"


# Auto-register at import time.
from gateway.drivers.registry import register as _register
_register(OpcuaDriver())
