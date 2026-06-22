from unittest import mock

import pytest

from gateway.protocol_library import (
    build_protocol_flow,
    installed_protocols,
    list_missing_modules,
    list_protocols,
    merge_into_flows,
)


def test_list_protocols_contains_core_templates():
    names = {p["name"] for p in list_protocols()}
    assert {
        "modbus-tcp-hr",
        "mqtt-subscribe",
        "http-webhook",
        "opcua-read",
        "s7-read",
        "dlt645-2007",
        "ethernet-ip-tag",
        "mitsubishi-mc-read",
        "omron-fins-read",
        "hj212-2017",
        "hj212-2025",
        "data-integration",
        "1052-debug-dashboard",
    } <= names


def test_build_mqtt_protocol_flow_posts_to_td_insert():
    nodes = build_protocol_flow("mqtt-subscribe", broker_host="broker.local", topic="sensors/temp")
    assert any(n["type"] == "tab" and n["label"] == "protocol · mqtt-subscribe" for n in nodes)
    assert any(n["type"] == "mqtt in" and n["topic"] == "sensors/temp" for n in nodes)
    assert any(n["type"] == "http request" and n["url"].endswith("/api/td/insert") for n in nodes)


def test_build_hj212_2025_protocol_flow_uses_params():
    nodes = build_protocol_flow("hj212-2025", mn="ABCDEF0123456789ABCDEF01", base_url="http://mock:5906")
    assert any(n["type"] == "tab" and n["label"] == "protocol · hj212-2025" for n in nodes)
    text = repr(nodes)
    assert "ABCDEF0123456789ABCDEF01" in text
    assert "http://mock:5906" in text


def test_build_data_integration_protocol_flow_uses_params():
    nodes = build_protocol_flow("data-integration", qyid="QY-001", base_url="http://mock:5904/ws")
    assert any(n["type"] == "tab" and n["label"] == "protocol · data-integration" for n in nodes)
    text = repr(nodes)
    assert "QY-001" in text
    assert "http://mock:5904/ws" in text


def test_build_1052_debug_dashboard_flow_paths():
    nodes = build_protocol_flow("1052-debug-dashboard")
    assert any(n["type"] == "tab" and n["label"] == "protocol · 1052-debug-dashboard" for n in nodes)
    assert any(n["type"] == "ui-base" and n.get("path") == "/dashboard" for n in nodes)
    assert any(n["type"] == "ui-page" and n.get("path") == "/1052-debug" for n in nodes)


def test_build_dlt645_protocol_flow_serial_to_td_insert():
    nodes = build_protocol_flow(
        "dlt645-2007",
        serial_port="/dev/ttyUSB9",
        baud_rate=9600,
        meter_address="123456789012",
        data_id="02010100",
        device="meter-a",
        tag="phase_a_voltage",
    )
    assert any(n["type"] == "tab" and n["label"] == "protocol · dlt645-2007" for n in nodes)
    assert any(n["type"] == "serial-port" and n["serialport"] == "/dev/ttyUSB9" and n["serialbaud"] == "9600" for n in nodes)
    assert any(n["type"] == "serial request" and n["serial"] == "proto_dlt645_serial" for n in nodes)
    assert any(n["type"] == "function" and "02010100" in n["func"] and "123456789012" in n["func"] for n in nodes)
    assert any(n["type"] == "function" and "meter-a" in n["func"] and "phase_a_voltage" in n["func"] for n in nodes)
    assert any(n["type"] == "http request" and n["url"].endswith("/api/td/insert") for n in nodes)


def test_build_ethernet_ip_protocol_flow():
    nodes = build_protocol_flow("ethernet-ip-tag", host="10.0.0.10", tag_name="Tank.Level")
    assert any(n["type"] == "tab" and n["label"] == "protocol · ethernet-ip-tag" for n in nodes)
    assert any(n["type"] == "eth-ip endpoint" and n["address"] == "10.0.0.10" for n in nodes)
    assert any(n["type"] == "eth-ip in" and n["variable"] == "Tank.Level" for n in nodes)
    assert any(n["type"] == "http request" and n["url"].endswith("/api/td/insert") for n in nodes)


def test_build_mitsubishi_mc_protocol_flow():
    nodes = build_protocol_flow("mitsubishi-mc-read", host="10.0.0.20", address="D200", points=2)
    assert any(n["type"] == "tab" and n["label"] == "protocol · mitsubishi-mc-read" for n in nodes)
    assert any(n["type"] == "mcprotocol connection" and n["host"] == "10.0.0.20" for n in nodes)
    assert any(n["type"] == "mcprotocol read" and n["address"] == "D200" and n["points"] == "2" for n in nodes)
    assert any(n["type"] == "http request" and n["url"].endswith("/api/td/insert") for n in nodes)


def test_build_omron_fins_protocol_flow():
    nodes = build_protocol_flow("omron-fins-read", host="10.0.0.30", area="D", address=300)
    assert any(n["type"] == "tab" and n["label"] == "protocol · omron-fins-read" for n in nodes)
    assert any(n["type"] == "fins-connection" and n["host"] == "10.0.0.30" for n in nodes)
    assert any(n["type"] == "fins-read" and n["addressType"] == "D" and n["address"] == "300" for n in nodes)
    assert any(n["type"] == "http request" and n["url"].endswith("/api/td/insert") for n in nodes)


def test_unknown_protocol_raises_keyerror():
    with pytest.raises(KeyError):
        build_protocol_flow("nope")


def test_merge_protocol_flow_is_idempotent():
    first = build_protocol_flow("http-webhook", path="/a")
    second = build_protocol_flow("http-webhook", path="/b")
    merged = merge_into_flows(first, second)
    tabs = [n for n in merged if n.get("type") == "tab" and n.get("label") == "protocol · http-webhook"]
    http_in = [n for n in merged if n.get("type") == "http in"]
    assert len(tabs) == 1
    assert len(http_in) == 1
    assert http_in[0]["url"] == "/b"


def test_installed_protocols_by_tab_label():
    flows = build_protocol_flow("mqtt-subscribe") + build_protocol_flow("http-webhook")
    assert set(installed_protocols(flows)) == {"mqtt-subscribe", "http-webhook"}


def test_list_missing_modules_uses_npm_probe(monkeypatch):
    with mock.patch("gateway.protocol_library.subprocess.run") as run:
        run.side_effect = Exception("missing")
        assert list_missing_modules("modbus-tcp-hr", user_dir="/tmp/nope") == ["node-red-contrib-modbus"]
