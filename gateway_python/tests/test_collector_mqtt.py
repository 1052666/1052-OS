"""Tests for the MQTT-source driver.

After the driver refactor, MQTT polling lives in `gateway/drivers/mqtt.py`.
This file tests the driver in isolation, plus the wiring between
`DataCollector` and `MqttDriver` via `try_driver`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from gateway.collector import CollectTask, DataCollector
from gateway.drivers import DriverContext, try_driver
from gateway.drivers.mqtt import MqttDriver


# ── helpers ─────────────────────────────────────────────


class _FakeTd:
    """Drop-in for TdClient that records inserts without hitting TDengine."""

    def __init__(self):
        self.tables: list[tuple[str, dict, dict]] = []
        self.subtables: list[tuple[str, str, dict]] = []
        self.inserts: list[tuple[str, str, dict]] = []

    def connect(self):
        pass

    def close(self):
        pass

    def ensure_supertable(self, name, columns, tags):
        self.tables.append((name, columns, tags))

    def ensure_table(self, name, super_name, tags):
        self.subtables.append((name, super_name, tags))

    def insert(self, table, ts, row):
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        self.inserts.append((table, ts_str, row))


def _collector() -> tuple[DataCollector, _FakeTd]:
    td = _FakeTd()
    # Bypass DataCollector.__init__'s TDengine connect by stubbing it.
    dc = DataCollector.__new__(DataCollector)
    dc.td = td
    dc.mqtt_publisher = None
    dc.tasks = {}
    dc._running = {}
    dc._threads = {}
    dc._points_collected = {}
    dc._last_values = {}
    return dc, td


# ── payload decoding (now on MqttDriver) ────────────────


def test_decode_raw_payload_numeric_dtype_returns_float():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32", mq_payload="raw")
    assert MqttDriver.decode_payload(t, "42.5") == 42.5


def test_decode_raw_payload_integer_string_returns_int_float():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32", mq_payload="raw")
    val = MqttDriver.decode_payload(t, "100")
    assert val == 100.0
    assert isinstance(val, float)


def test_decode_raw_payload_text_dtype_returns_string():
    t = CollectTask(id="T", protocol="mqtt", dtype="ascii", mq_payload="raw")
    assert MqttDriver.decode_payload(t, "online") == "online"


def test_decode_raw_payload_garbage_returns_none():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32", mq_payload="raw")
    assert MqttDriver.decode_payload(t, "not-a-number") is None


def test_decode_json_payload_extracts_field():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32",
                    mq_payload="json", mq_field="v")
    assert MqttDriver.decode_payload(t, '{"v": 23.5, "unit": "C"}') == 23.5


def test_decode_json_payload_missing_field_returns_none():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32",
                    mq_payload="json", mq_field="missing")
    assert MqttDriver.decode_payload(t, '{"v": 23.5}') is None


def test_decode_json_payload_non_object_returns_root():
    """Non-object JSON (e.g. bare number) → root value."""
    t = CollectTask(id="T", protocol="mqtt", dtype="f32",
                    mq_payload="json", mq_field="v")
    assert MqttDriver.decode_payload(t, "23.5") == 23.5


def test_decode_json_payload_malformed_returns_none():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32",
                    mq_payload="json", mq_field="v")
    assert MqttDriver.decode_payload(t, "{not json") is None


# ── TDengine column coercion (now on MqttDriver) ────────


def test_coerce_double_column_accepts_int_and_float():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32")
    assert MqttDriver.coerce_row(t, 1, "DOUBLE") == {"v": 1.0}
    assert MqttDriver.coerce_row(t, 1.5, "DOUBLE") == {"v": 1.5}


def test_coerce_double_column_rejects_string():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32")
    assert MqttDriver.coerce_row(t, "abc", "DOUBLE") == {"v": None}


def test_coerce_double_column_casts_bool_to_float():
    t = CollectTask(id="T", protocol="mqtt", dtype="bit")
    assert MqttDriver.coerce_row(t, True, "DOUBLE") == {"v": 1.0}


def test_coerce_nchar_column_stringifies():
    t = CollectTask(id="T", protocol="mqtt", dtype="ascii")
    assert MqttDriver.coerce_row(t, "online", "NCHAR(255)") == {"v": "online"}


def test_coerce_nchar_column_handles_none_as_empty():
    t = CollectTask(id="T", protocol="mqtt", dtype="ascii")
    assert MqttDriver.coerce_row(t, None, "NCHAR(255)") == {"v": ""}


# ── col_type selection (now on MqttDriver) ───────────────


def test_col_type_for_mqtt_numeric_is_double():
    t = CollectTask(id="T", protocol="mqtt", dtype="f32")
    assert MqttDriver.col_type(t) == "DOUBLE"


def test_col_type_for_mqtt_text_is_nchar():
    t = CollectTask(id="T", protocol="mqtt", dtype="ascii")
    assert MqttDriver.col_type(t) == "NCHAR(255)"


def test_col_type_for_mqtt_bit_is_double():
    t = CollectTask(id="T", protocol="mqtt", dtype="bit")
    assert MqttDriver.col_type(t) == "DOUBLE"


# ── DataCollector wires the driver in via try_driver ─────


def test_data_collector_col_type_uses_driver():
    """DataCollector._col_type_for_task delegates to the registered driver."""
    dc, _ = _collector()
    t = CollectTask(id="T", protocol="mqtt", dtype="f32")
    assert dc._col_type_for_task(t) == "DOUBLE"


def test_data_collector_dispatches_mqtt_to_driver():
    """DataCollector.start_task routes mqtt tasks to MqttDriver."""
    driver = try_driver("mqtt")
    assert driver is not None
    assert driver.name == "mqtt"
    assert isinstance(driver, MqttDriver)


def test_start_task_mqtt_creates_double_column():
    """start_task() with a numeric mqtt task → DOUBLE column."""
    dc, td = _collector()
    t = CollectTask(id="TEMP", protocol="mqtt", dtype="f32",
                    table="raw_data", mq_topic="device/temperature")
    dc.add_task(t)
    dc.start_task("TEMP")
    dc.stop_task("TEMP")
    # supertable declared with stable value column "v" of type DOUBLE.
    assert any(
        name == "raw_data" and cols == {"v": "DOUBLE"}
        for name, cols, _tags in td.tables
    )
    assert any(
        name == "raw_data_TEMP" and super_name == "raw_data"
        for name, super_name, _tags in td.subtables
    )


def test_start_task_mqtt_creates_nchar_column_for_text():
    """start_task() with a text mqtt task → NCHAR column."""
    dc, td = _collector()
    t = CollectTask(id="STATUS", protocol="mqtt", dtype="ascii",
                    table="raw_data", mq_topic="device/status")
    dc.add_task(t)
    dc.start_task("STATUS")
    dc.stop_task("STATUS")
    assert any(
        name == "raw_data" and cols == {"v": "NCHAR(255)"}
        for name, cols, _tags in td.tables
    )


# ── DriverContext integration (decoded value → TDengine) ─


def test_driver_context_inserts_decoded_value_into_td():
    """Direct call into DriverContext: insert + record_value mirror on_message."""
    td = _FakeTd()
    ctx = DriverContext(td=td, mqtt_publisher=None)
    task = CollectTask(id="TEMP", protocol="mqtt", dtype="f32",
                       mq_payload="raw", mq_topic="device/temperature")
    col_type = MqttDriver.col_type(task)
    decoded = MqttDriver.decode_payload(task, "23.5")
    row = MqttDriver.coerce_row(task, decoded, col_type)
    ctx.insert_row("raw_data_TEMP", row)
    ctx.points_collected["TEMP"] = ctx.points_collected.get("TEMP", 0) + 1
    ctx.record_value(task, row["v"], task.dtype)
    assert td.inserts[-1][2] == {"v": 23.5}
    assert ctx.points_collected["TEMP"] == 1
    assert ctx.last_values["TEMP"]["value"] == 23.5


def test_driver_context_records_decode_error():
    """Garbage payload → row of {None} and last_values records the error."""
    td = _FakeTd()
    ctx = DriverContext(td=td, mqtt_publisher=None)
    task = CollectTask(id="TEMP", protocol="mqtt", dtype="f32",
                       mq_payload="raw", mq_topic="device/temperature")
    col_type = MqttDriver.col_type(task)
    decoded = MqttDriver.decode_payload(task, "garbage")
    row = MqttDriver.coerce_row(task, decoded, col_type)
    ctx.insert_row("raw_data_TEMP", row)
    ctx.record_error(task, task.dtype, "decode failed")
    # No insert happened with a value, only the None row.
    assert td.inserts[0][2] == {"v": None}
    assert ctx.last_values["TEMP"]["err"] == "decode failed"


# ── to_task_fields mapping (config → CollectTask) ────────


def test_mqtt_to_task_fields_round_trip():
    """MqttConfig → to_task_fields produces values that match task.mq_*."""
    from gateway.drivers.mqtt import MqttConfig
    cfg = MqttConfig(
        broker_host="10.0.0.5", broker_port=1884,
        username="u", password="p", topic="device/x",
        qos=1, payload="json", field="value", client_id="c1",
    )
    fields = MqttDriver.to_task_fields(cfg)
    assert fields["mq_broker_host"] == "10.0.0.5"
    assert fields["mq_broker_port"] == 1884
    assert fields["mq_topic"] == "device/x"
    assert fields["mq_qos"] == 1
    assert fields["mq_payload"] == "json"
    assert fields["mq_field"] == "value"
    assert fields["mq_client_id"] == "c1"
    # And CollectTask.from_dict accepts the merged dict.
    task = CollectTask.from_dict({"id": "X", "protocol": "mqtt", **fields})
    assert task.mq_topic == "device/x"
    assert task.mq_payload == "json"
