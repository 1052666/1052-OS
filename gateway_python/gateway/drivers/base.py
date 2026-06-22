"""Driver Protocol + DriverContext for protocol-agnostic data collection.

A Driver owns everything that's specific to one industrial protocol
(Modbus / OPC UA / MQTT / ...): the polling loop, value decoding, column
type, dashboard widget topic, and (where applicable) write-command dispatch.

The collector and the Node-RED flow builder only ever talk to the Driver
Protocol — they don't know about Modbus function codes, OPC UA node ids,
or MQTT topic conventions. Adding a new protocol is one Python file plus
one line in `drivers/registry.DRIVERS`.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable, Iterable, Protocol, runtime_checkable

if TYPE_CHECKING:
    from pydantic import BaseModel

    from gateway.collector import CollectTask
    from gateway.tdengine_client import TdClient
    from gateway.mqtt_publisher import MqttPublisher


# ── Shared runtime context passed to every driver ──────────────────


@dataclass
class DriverContext:
    """Per-process state shared by all drivers while a task runs.

    The collector owns the lifecycle (running flag, point count, last value);
    each driver mutates these fields via ctx methods so the collector's
    `status()` and `/api/collector/status` response stay authoritative.
    """

    td: "TdClient"
    mqtt_publisher: "MqttPublisher | None" = None
    # task_id → bool. Drivers read `ctx.running[task_id]` in their poll loop.
    running: dict[str, bool] = field(default_factory=dict)
    # task_id → point count
    points_collected: dict[str, int] = field(default_factory=dict)
    # task_id → {"value": ..., "type": ..., "ts": float, "err"?: str}
    last_values: dict[str, dict] = field(default_factory=dict)

    # ── helpers drivers call from their poll loops ────────────────

    def publish_value(self, task: "CollectTask", value, ts: float | None = None,
                      q: int = 192) -> None:
        if self.mqtt_publisher is None:
            return
        self.mqtt_publisher.publish(
            site=task.site,
            device=task.device or task.table,
            tag=task.id,
            value=value,
            ts=ts if ts is not None else time.time(),
            q=q,
        )

    def record_value(self, task: "CollectTask", value, type_label: str,
                     err: str | None = None) -> None:
        entry = {"value": value, "type": type_label, "ts": time.time()}
        if err:
            entry["err"] = err
        self.last_values[task.id] = entry

    def record_error(self, task: "CollectTask", type_label: str, err: str) -> None:
        self.last_values[task.id] = {
            "value": None, "type": type_label, "ts": time.time(), "err": err,
        }

    def insert_row(self, table: str, row: dict) -> None:
        self.td.insert(table, datetime.now(timezone.utc), row)


# ── Driver Protocol (PEP 544) ──────────────────────────────────────


@runtime_checkable
class Driver(Protocol):
    """Every protocol-specific driver implements this shape.

    Methods are split into lifecycle, value extraction, dashboard rendering,
    and write command dispatch. A driver may return None / [] for capabilities
    it doesn't implement (e.g. MQTT-source has no write path).
    """

    # ── identity ──────────────────────────────────────────────────
    name: str
    label: str
    config_cls: "type[BaseModel]"

    # ── collection lifecycle ──────────────────────────────────────
    def start(self, task: "CollectTask", ctx: DriverContext) -> None: ...
    def stop(self, task: "CollectTask") -> None: ...

    # ── TDengine schema ──────────────────────────────────────────
    def col_type(self, task: "CollectTask") -> str: ...

    # ── status serialization ──────────────────────────────────────
    def status_fields(self, task: "CollectTask") -> dict[str, Any]: ...

    # ── config ↔ CollectTask mapping (driven by config_cls) ──────
    def to_task_fields(self, cfg: "BaseModel") -> dict[str, Any]: ...

    # ── Node-RED Dashboard rendering ─────────────────────────────
    def widget_group_id(self) -> str: ...
    def widget_group_name(self) -> str: ...
    def widget_group_order(self) -> int: ...
    def widget_y_offset(self) -> int: ...
    def tag_topic(self, task: "CollectTask", topic_prefix: str) -> str: ...

    # ── control widget (write path) ──────────────────────────────
    def supports_control_widget(self, task: "CollectTask") -> bool: ...
    def control_topic(self, task: "CollectTask", topic_prefix: str) -> str | None: ...
    def control_function_body(self, task: "CollectTask") -> str | None: ...

    # ── schema for the frontend form (drives §A/§B/§C) ──────────
    def describe(self) -> dict: ...


# ── Small utilities used by drivers and the collector ───────────────


def get_driver_for(task: "CollectTask", registry: dict[str, Driver]) -> Driver:
    """Resolve the driver for a task, falling back to "modbus" for legacy tasks."""
    name = getattr(task, "protocol", None) or "modbus"
    if name not in registry:
        # Old persisted tasks or unknown protocol — fall back to modbus.
        name = "modbus"
    return registry[name]


__all__ = [
    "DriverContext",
    "Driver",
    "get_driver_for",
]
