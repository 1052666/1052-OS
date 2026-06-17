"""Tests for CommandHandler (Sub-3 Task 2).

Subscribes to 1052os/cmd/write/{modbus,opcua} and dispatches to the underlying
write primitives. Audits every attempt.
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.command_handler import CommandHandler


def _handler(mqtt_client=None, audit=None):
    return CommandHandler(
        mqtt_client=mqtt_client or MagicMock(),
        audit=audit or MagicMock(),
    )


def _modbus_msg(payload: dict):
    """Build a mock paho MQTT message for a modbus command."""
    msg = MagicMock()
    msg.topic = "1052os/cmd/write/modbus"
    msg.payload = json.dumps(payload).encode()
    return msg


def _opcua_msg(payload: dict):
    msg = MagicMock()
    msg.topic = "1052os/cmd/write/opcua"
    msg.payload = json.dumps(payload).encode()
    return msg


# ── modbus dispatch ───────────────────────────────────


def test_modbus_write_coil_dispatches_to_factory_client():
    handler = _handler()
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_coil",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 0, "value": True,
    }))
    fake_mc.__enter__.return_value.write_coil.assert_called_once_with(0, True)


def test_modbus_write_register_dispatches():
    handler = _handler()
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_register",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 100, "value": 42,
    }))
    fake_mc.__enter__.return_value.write_register.assert_called_once_with(100, 42)


def test_modbus_write_coils_dispatches():
    handler = _handler()
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_coils",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 10, "values": [True, False, True],
    }))
    fake_mc.__enter__.return_value.write_coils.assert_called_once_with(10, [True, False, True])


def test_modbus_write_registers_dispatches():
    handler = _handler()
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_registers",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 200, "values": [10, 20, 30],
    }))
    fake_mc.__enter__.return_value.write_registers.assert_called_once_with(200, [10, 20, 30])


def test_modbus_write_float32_dispatches():
    handler = _handler()
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_float32",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 300, "value": 3.14,
    }))
    fake_mc.__enter__.return_value.write_float32.assert_called_once_with(300, 3.14)


# ── error handling ────────────────────────────────────


def test_modbus_unknown_cmd_does_not_dispatch_but_audits():
    audit = MagicMock()
    handler = _handler(audit=audit)
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({"cmd": "write_unknown"}))
    fake_mc.__enter__.return_value.write_coil.assert_not_called()
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "error"


def test_modbus_invalid_json_does_not_raise(caplog):
    handler = _handler()
    msg = MagicMock()
    msg.topic = "1052os/cmd/write/modbus"
    msg.payload = b"not json at all"
    # Should not raise
    handler._on_modbus_paho_msg(None, None, msg)


def test_modbus_write_failure_audits_with_error():
    audit = MagicMock()
    handler = _handler(audit=audit)
    fake_mc = MagicMock()
    fake_mc.__enter__.return_value.write_coil.side_effect = IOError("FC5 failed")
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_coil",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 0, "value": True,
    }))
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "error"
    assert "FC5 failed" in audit.log.call_args.kwargs["error"]


def test_modbus_write_success_audits_with_ok():
    audit = MagicMock()
    handler = _handler(audit=audit)
    fake_mc = MagicMock()
    handler._make_modbus_client = MagicMock(return_value=fake_mc)
    handler._on_modbus_paho_msg(None, None, _modbus_msg({
        "request_id": "r1", "cmd": "write_coil",
        "host": "127.0.0.1", "port": 502, "unit_id": 1,
        "address": 0, "value": True,
    }))
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "ok"
    assert audit.log.call_args.kwargs["cmd"] == "write_coil"
    assert audit.log.call_args.kwargs["protocol"] == "modbus"


# ── subscribe / lifecycle ────────────────────────────


def test_start_subscribes_to_cmd_topics():
    mqtt_client = MagicMock()
    handler = _handler(mqtt_client=mqtt_client)
    handler.start()
    assert mqtt_client.subscribe.called
    topics = [c.args[0] for c in mqtt_client.subscribe.call_args_list]
    assert "1052os/cmd/write/modbus" in topics
    assert "1052os/cmd/write/opcua" in topics


def test_start_with_no_mqtt_client_is_noop():
    handler = CommandHandler(mqtt_client=None, audit=MagicMock())
    # Should not raise
    handler.start()


# ── opcua dispatch (sync via async helper) ──────────


def test_opcua_unknown_cmd_does_not_dispatch_but_audits():
    audit = MagicMock()
    handler = _handler(audit=audit)
    handler._on_opcua_paho_msg(None, None, _opcua_msg({"cmd": "bad"}))
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "error"


def test_opcua_invalid_json_does_not_raise():
    handler = _handler()
    msg = MagicMock()
    msg.topic = "1052os/cmd/write/opcua"
    msg.payload = b"not json"
    # Should not raise
    handler._on_opcua_paho_msg(None, None, msg)


def test_opcua_write_node_success_audits_with_ok(monkeypatch):
    audit = MagicMock()
    handler = _handler(audit=audit)
    # Mock asyncio.run to skip real async machinery
    def fake_run(coro):
        coro.close()  # close the coroutine to avoid warnings
        return None
    import asyncio
    monkeypatch.setattr(asyncio, "run", fake_run)
    # Mock _make_opcua_client to avoid real OpcuaClientWrapper construction
    fake_oc = MagicMock()
    handler._make_opcua_client = MagicMock(return_value=fake_oc)
    handler._on_opcua_paho_msg(None, None, _opcua_msg({
        "request_id": "r1", "cmd": "write_node",
        "url": "opc.tcp://127.0.0.1:4840",
        "node_id": "ns=2;s=Tag1", "value": 42.0,
    }))
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "ok"
    assert audit.log.call_args.kwargs["protocol"] == "opcua"


def test_opcua_write_node_failure_audits_with_error(monkeypatch):
    audit = MagicMock()
    handler = _handler(audit=audit)
    def fake_run(coro):
        coro.close()
        raise RuntimeError("asyncua connection refused")
    import asyncio
    monkeypatch.setattr(asyncio, "run", fake_run)
    handler._make_opcua_client = MagicMock(return_value=MagicMock())
    handler._on_opcua_paho_msg(None, None, _opcua_msg({
        "request_id": "r1", "cmd": "write_node",
        "url": "opc.tcp://127.0.0.1:4840",
        "node_id": "ns=2;s=Tag1", "value": 42.0,
    }))
    assert audit.log.called
    assert audit.log.call_args.kwargs["result"] == "error"
