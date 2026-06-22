"""Driver framework contract tests.

Verifies the registry is populated correctly and that every registered
driver satisfies the Driver Protocol (isinstance check).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.collector import CollectTask
from gateway.drivers import (
    DRIVERS,
    Driver,
    DriverContext,
    config_cls_for,
    get_driver,
    iter_drivers,
    register,
    reset_for_tests,
    try_driver,
)


# ── Registry surface ──────────────────────────────────────────────


def test_drivers_registry_has_mqtt_after_import():
    """The mqtt driver should auto-register on import of gateway.drivers."""
    assert "mqtt" in DRIVERS


def test_drivers_registry_iteration_is_stable():
    seen = [d.name for d in iter_drivers()]
    assert seen  # at least one
    # No duplicates by name
    assert len(seen) == len(set(seen))


def test_get_driver_returns_registered_driver():
    mqtt = get_driver("mqtt")
    assert isinstance(mqtt, Driver)


def test_try_driver_returns_none_for_unknown_protocol():
    assert try_driver("not-a-protocol") is None


def test_config_cls_for_returns_pydantic_model():
    cls = config_cls_for("mqtt")
    assert cls.__name__ == "MqttConfig"


# ── MqttDriver behavior ──────────────────────────────────────────


def test_mqtt_driver_col_type_numeric_is_double():
    from gateway.drivers.mqtt import MqttDriver
    t = CollectTask(id="T", protocol="mqtt", dtype="f32")
    assert MqttDriver.col_type(t) == "DOUBLE"


def test_mqtt_driver_col_type_text_is_nchar():
    from gateway.drivers.mqtt import MqttDriver
    t = CollectTask(id="T", protocol="mqtt", dtype="ascii")
    assert MqttDriver.col_type(t) == "NCHAR(255)"


def test_mqtt_driver_status_fields_returns_subset():
    from gateway.drivers.mqtt import MqttDriver
    t = CollectTask(id="T", protocol="mqtt", mq_topic="device/x")
    fields = MqttDriver.status_fields(t)
    assert fields["mq_topic"] == "device/x"
    assert fields["mq_payload"] == "raw"


def test_mqtt_driver_tag_topic_is_absolute():
    from gateway.drivers.mqtt import MqttDriver
    t = CollectTask(id="T", protocol="mqtt", mq_topic="device/x")
    # Even though topic_prefix is "1052os", MQTT-source uses the absolute topic.
    assert MqttDriver.tag_topic(t, "1052os") == "device/x"


def test_mqtt_driver_does_not_support_control_widget():
    from gateway.drivers.mqtt import MqttDriver
    t = CollectTask(id="T", protocol="mqtt")
    assert MqttDriver.supports_control_widget(t) is False
    assert MqttDriver.control_topic(t, "1052os") is None
    assert MqttDriver.control_function_body(t) is None


def test_mqtt_driver_describe_returns_schema_for_frontend():
    from gateway.drivers.mqtt import MqttDriver
    schema = MqttDriver.describe()
    assert schema["name"] == "mqtt"
    assert schema["label"] == "MQTT Source"
    keys = {f["key"] for f in schema["fields"]}
    assert {"broker_host", "broker_port", "topic", "payload"} <= keys


# ── ModbusDriver behavior ──────────────────────────────────────────


def test_modbus_driver_col_type_numeric_is_double():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", dtype="f32")
    assert ModbusDriver.col_type(t) == "DOUBLE"


def test_modbus_driver_col_type_integer_is_bigint():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", dtype="u16")
    assert ModbusDriver.col_type(t) == "BIGINT"


def test_modbus_driver_col_type_text_is_nchar():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", dtype="ascii")
    assert ModbusDriver.col_type(t) == "NCHAR(255)"


def test_modbus_driver_status_fields_returns_subset():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", mb_host="10.0.0.1", mb_port=5020,
                    mb_unit=7, mb_address=42, mb_count=2, mb_register="input")
    fields = ModbusDriver.status_fields(t)
    assert fields["mb_host"] == "10.0.0.1"
    assert fields["mb_port"] == 5020
    assert fields["mb_unit"] == 7
    assert fields["mb_register"] == "input"


def test_modbus_driver_supports_control_widget_for_writable_dtypes():
    from gateway.drivers.modbus import ModbusDriver
    for dtype in ("bit", "u16", "i16", "u32", "i32", "f32"):
        t = CollectTask(id="T", protocol="modbus", dtype=dtype)
        assert ModbusDriver.supports_control_widget(t) is True
    for dtype in ("ascii", "utf8"):
        t = CollectTask(id="T", protocol="modbus", dtype=dtype)
        assert ModbusDriver.supports_control_widget(t) is False


def test_modbus_driver_tag_topic_uses_prefix_site_device_tag():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", site="plant1", device="plc1")
    assert ModbusDriver.tag_topic(t, "1052os") == "1052os/plant1/plc1/T/value"


def test_modbus_driver_describe_returns_schema_for_frontend():
    from gateway.drivers.modbus import ModbusDriver
    schema = ModbusDriver.describe()
    assert schema["name"] == "modbus"
    assert schema["label"] == "Modbus TCP"
    keys = {f["key"] for f in schema["fields"]}
    assert {"host", "port", "address", "dtype", "endian"} <= keys


def test_modbus_driver_decode_row_double():
    from gateway.drivers.modbus import ModbusDriver
    t = CollectTask(id="T", protocol="modbus", dtype="u16")
    # 0x1234 as a single holding register.
    assert ModbusDriver.decode_row(t, [0x1234], "BIGINT") == {"v": 0x1234}


# ── OpcuaDriver behavior ───────────────────────────────────────────


def test_opcua_driver_col_type_is_double():
    from gateway.drivers.opcua import OpcuaDriver
    t = CollectTask(id="T", protocol="opcua", dtype="f32")
    assert OpcuaDriver.col_type(t) == "DOUBLE"


def test_opcua_driver_status_fields_returns_subset():
    from gateway.drivers.opcua import OpcuaDriver
    t = CollectTask(id="T", protocol="opcua", ua_url="opc.tcp://x:4840",
                    ua_node_id="ns=2;s=Y")
    fields = OpcuaDriver.status_fields(t)
    assert fields["ua_url"] == "opc.tcp://x:4840"
    assert fields["ua_node_id"] == "ns=2;s=Y"


def test_opcua_driver_supports_control_widget_with_node_id():
    from gateway.drivers.opcua import OpcuaDriver
    t = CollectTask(id="T", protocol="opcua", ua_node_id="ns=2;s=Y")
    assert OpcuaDriver.supports_control_widget(t) is True
    assert OpcuaDriver.control_topic(t, "1052os") == "1052os/cmd/write/opcua"
    body = OpcuaDriver.control_function_body(t)
    assert body is not None
    assert "write_node" in body
    assert "ns=2;s=Y" in body


def test_opcua_driver_no_control_widget_without_node_id():
    from gateway.drivers.opcua import OpcuaDriver
    t = CollectTask(id="T", protocol="opcua", ua_node_id="")
    assert OpcuaDriver.supports_control_widget(t) is False
    assert OpcuaDriver.control_topic(t, "1052os") is None
    assert OpcuaDriver.control_function_body(t) is None


def test_opcua_driver_tag_topic_uses_prefix_site_device_tag():
    from gateway.drivers.opcua import OpcuaDriver
    t = CollectTask(id="T", protocol="opcua", site="plant2", device="plc2")
    assert OpcuaDriver.tag_topic(t, "1052os") == "1052os/plant2/plc2/T/value"


def test_opcua_driver_describe_returns_schema_for_frontend():
    from gateway.drivers.opcua import OpcuaDriver
    schema = OpcuaDriver.describe()
    assert schema["name"] == "opcua"
    assert schema["label"] == "OPC UA"
    keys = {f["key"] for f in schema["fields"]}
    assert {"url", "node_id"} <= keys


# ── /api/collector/schemas endpoint ───────────────────────────────


def test_schemas_endpoint_returns_all_drivers():
    """The FastAPI app exposes a /api/collector/schemas route."""
    from fastapi.testclient import TestClient
    from gateway.server import app

    client = TestClient(app)
    resp = client.get("/api/collector/schemas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    names = {d["name"] for d in body["drivers"]}
    assert names == {"modbus", "mqtt", "opcua"}
    for d in body["drivers"]:
        assert "label" in d
        assert "fields" in d
        assert isinstance(d["fields"], list)
        assert all("key" in f and "label" in f for f in d["fields"])


def test_schemas_endpoint_mqtt_has_topic_field():
    from fastapi.testclient import TestClient
    from gateway.server import app
    client = TestClient(app)
    body = client.get("/api/collector/schemas").json()
    mqtt = next(d for d in body["drivers"] if d["name"] == "mqtt")
    assert mqtt["readonly"] is True
    keys = {f["key"] for f in mqtt["fields"]}
    assert {"broker_host", "topic", "payload"} <= keys


# ── Protocol conformance ────────────────────────────────────────


def test_mqtt_driver_isinstance_driver_protocol():
    """Runtime Protocol check: mqtt driver must satisfy the Driver Protocol."""
    mqtt = get_driver("mqtt")
    assert isinstance(mqtt, Driver)


def test_register_rejects_object_without_name():
    class _NoName:
        pass
    import pytest
    with pytest.raises(ValueError):
        register(_NoName())


def test_register_is_idempotent():
    reset_for_tests()
    from gateway.drivers.mqtt import MqttDriver
    d1 = MqttDriver()
    register(d1)
    register(d1)  # same instance — should be a no-op
    assert len([x for x in DRIVERS.values() if x.name == "mqtt"]) == 1
    # Re-register so other tests see the driver.
    register(MqttDriver())


# ── DriverContext helpers ────────────────────────────────────────


def test_driver_context_record_value_writes_to_last_values():
    ctx = DriverContext(td=None)  # type: ignore[arg-type]
    t = CollectTask(id="T", protocol="mqtt")
    ctx.record_value(t, 42.0, "f32")
    assert ctx.last_values["T"]["value"] == 42.0
    assert ctx.last_values["T"]["type"] == "f32"
