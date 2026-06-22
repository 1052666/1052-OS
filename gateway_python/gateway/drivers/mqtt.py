"""MQTT-source driver.

Subscribes to an MQTT broker and persists every inbound message to TDengine.
Acts as the third `protocol` value for `CollectTask` (alongside modbus and
opcua). Source-only: there is no outbound write path because the gateway
is a subscriber, not a controller.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
from pydantic import BaseModel, Field


class MqttConfig(BaseModel):
    """Schema for the MQTT-source task configuration. Drives the frontend form."""

    broker_host: str = Field(default="127.0.0.1", description="MQTT broker host")
    broker_port: int = Field(default=1883, description="MQTT broker port")
    username: str | None = Field(default=None, description="Broker username (optional)")
    password: str | None = Field(default=None, description="Broker password (optional)")
    topic: str = Field(default="", description="Absolute topic to subscribe to")
    qos: int = Field(default=0, ge=0, le=2, description="MQTT QoS (0/1/2)")
    payload: str = Field(
        default="raw",
        description="Payload encoding: 'raw' (string body) or 'json' (extract field)",
    )
    field: str = Field(
        default="v",
        description="JSON top-level key to extract when payload='json'",
    )
    client_id: str = Field(default="", description="Optional paho client_id (auto if empty)")


class MqttDriver:
    """Implements the Driver Protocol for the MQTT-source collection path."""

    name = "mqtt"
    label = "MQTT Source"
    config_cls = MqttConfig

    # Per-task worker threads. Cleared on stop.
    _threads: dict[str, threading.Thread]

    def __init__(self) -> None:
        self._threads = {}

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
        """MQTT payload is dynamic; size to text and let storage coerce.
        f32/f64/u*/i*/bit → DOUBLE; ascii/utf8 → NCHAR.
        """
        if task.dtype in ("ascii", "utf8"):
            return "NCHAR(255)"
        return "DOUBLE"

    # ── status serialization ──────────────────────────────────────

    @staticmethod
    def status_fields(task) -> dict[str, Any]:
        return {
            "mq_broker_host": task.mq_broker_host,
            "mq_broker_port": task.mq_broker_port,
            "mq_topic": task.mq_topic,
            "mq_qos": task.mq_qos,
            "mq_payload": task.mq_payload,
            "mq_field": task.mq_field,
        }

    # ── config ↔ CollectTask mapping ──────────────────────────────

    @staticmethod
    def to_task_fields(cfg: "MqttConfig") -> dict[str, Any]:
        return {
            "mq_broker_host": cfg.broker_host,
            "mq_broker_port": cfg.broker_port,
            "mq_username": cfg.username,
            "mq_password": cfg.password,
            "mq_topic": cfg.topic,
            "mq_qos": cfg.qos,
            "mq_payload": cfg.payload,
            "mq_field": cfg.field,
            "mq_client_id": cfg.client_id,
        }

    # ── dashboard widget rendering ─────────────────────────────────

    WIDGET_GROUP_ID = "grp_mqtt_tags"
    WIDGET_GROUP_NAME = "MQTT Tags"
    WIDGET_GROUP_ORDER = 4
    WIDGET_Y_OFFSET = 800

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
        """MQTT-source tasks subscribe to their absolute topic — the gateway
        does not republish values; downstream widgets listen to the broker
        directly.
        """
        return getattr(task, "mq_topic", "") or ""

    # ── control widget (write path) ──────────────────────────────

    @staticmethod
    def supports_control_widget(task) -> bool:
        return False

    @staticmethod
    def control_topic(task, topic_prefix: str) -> str | None:
        return None

    @staticmethod
    def control_function_body(task) -> str | None:
        return None

    # ── schema for the frontend form ──────────────────────────────

    @classmethod
    def describe(cls) -> dict:
        return {
            "name": cls.name,
            "label": cls.label,
            "config_cls": cls.config_cls.__name__,
            "fields": [
                {"key": "broker_host", "label": "Broker Host", "type": "text",
                 "default": "127.0.0.1"},
                {"key": "broker_port", "label": "Broker Port", "type": "number",
                 "default": 1883},
                {"key": "username", "label": "Username", "type": "text",
                 "default": ""},
                {"key": "password", "label": "Password", "type": "password",
                 "default": ""},
                {"key": "topic", "label": "Topic (absolute)", "type": "text",
                 "default": ""},
                {"key": "qos", "label": "QoS", "type": "select",
                 "options": [0, 1, 2], "default": 0},
                {"key": "payload", "label": "Payload", "type": "select",
                 "options": ["raw", "json"], "default": "raw"},
                {"key": "field", "label": "JSON Field", "type": "text",
                 "default": "v"},
                {"key": "client_id", "label": "Client ID (optional)", "type": "text",
                 "default": ""},
            ],
            "readonly": True,
        }

    # ── internal helpers (also used by tests) ─────────────────────

    @staticmethod
    def decode_payload(task, payload: str) -> object:
        """Decode an inbound MQTT message body to the value stored in TDengine.

        * payload=="raw" + dtype ascii/utf8 → keep string
        * payload=="raw" + numeric dtype    → float(payload)
        * payload=="json"                   → payload[field] (top-level key)
        """
        if task.mq_payload == "json":
            try:
                obj = json.loads(payload)
            except (ValueError, TypeError):
                return None
            if isinstance(obj, dict):
                return obj.get(task.mq_field, None)
            return obj
        # raw
        if task.dtype in ("ascii", "utf8"):
            return payload
        try:
            return float(payload)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def coerce_row(task, value, col_type: str) -> dict:
        """Match a decoded MQTT value to the TDengine column type."""
        if col_type.startswith("NCHAR"):
            return {"v": str(value) if value is not None else ""}
        if col_type == "DOUBLE":
            if isinstance(value, bool):
                return {"v": float(value)}
            if isinstance(value, (int, float)):
                return {"v": float(value)}
            # Some simulators publish numbers as JSON strings ("42.5").
            if isinstance(value, str):
                try:
                    return {"v": float(value)}
                except (ValueError, TypeError):
                    return {"v": None}
            return {"v": None}
        if col_type == "BIGINT":
            if isinstance(value, bool):
                return {"v": int(value)}
            if isinstance(value, (int, float)):
                return {"v": int(value)}
            if isinstance(value, str):
                try:
                    return {"v": int(value)}
                except (ValueError, TypeError):
                    return {"v": None}
            return {"v": None}
        return {"v": value}

    def _run(self, task, ctx, col_type: str) -> None:
        """One paho-mqtt V2 client per task; survives transient broker outages."""
        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=task.mq_client_id or None,
        )
        if task.mq_username:
            client.username_pw_set(task.mq_username, task.mq_password)
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        # Capture errors so /api/collector/status can surface them.
        last_err: dict = {}

        def _on_connect(c, userdata, flags, rc, props=None):
            if rc == 0 and task.mq_topic:
                c.subscribe(task.mq_topic, qos=task.mq_qos)

        def _on_message(c, userdata, msg):
            try:
                payload = msg.payload.decode(errors="replace")
                decoded = self.decode_payload(task, payload)
                row = self.coerce_row(task, decoded, col_type)
                ctx.insert_row(self._table_for(task), row)
                ctx.points_collected[task.id] = ctx.points_collected.get(task.id, 0) + 1
                ctx.record_value(task, row["v"], task.dtype)
                ctx.publish_value(task, row["v"], time.time())
                last_err.pop("err", None)
            except Exception as e:
                last_err["err"] = str(e)
                ctx.record_error(task, task.dtype, str(e))

        def _on_disconnect(c, userdata, flags, rc, props=None):
            if rc != 0:
                last_err["err"] = f"disconnect rc={rc}"

        client.on_connect = _on_connect
        client.on_message = _on_message
        client.on_disconnect = _on_disconnect

        try:
            client.connect_async(task.mq_broker_host, task.mq_broker_port, keepalive=60)
            client.loop_start()
            # Heartbeat loop: surfaces stale/error state between messages.
            while ctx.running.get(task.id, False):
                if last_err.get("err") and task.id not in ctx.last_values:
                    ctx.record_error(task, task.dtype, last_err["err"])
                time.sleep(task.interval)
        finally:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception:
                pass

    @staticmethod
    def _table_for(task) -> str:
        """Child table name; mirrored from DataCollector.start_task()."""
        return f"{task.table}_{task.id}"


# Auto-register at import time.
from gateway.drivers.registry import register as _register
_register(MqttDriver())
