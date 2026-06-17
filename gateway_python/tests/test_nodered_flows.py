"""Unit tests for nodered_flows — no broker required."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.nodered_flows import build_flows_json, _safe_id
from gateway.collector import CollectTask


def _mk_task(tid, **kw):
    return CollectTask(
        id=tid,
        protocol=kw.get("protocol", "modbus"),
        table=kw.get("table", "raw_data"),
        site=kw.get("site", "default"),
        device=kw.get("device", ""),
        dtype=kw.get("dtype", "u16"),
        endian=kw.get("endian", "ABCD"),
        interval=kw.get("interval", 1.0),
    )


def test_safe_id_replaces_special_chars():
    assert _safe_id("in", "site1", "plc-1", "TI.101") == "in_site1_plc_1_TI_101"


def test_safe_id_preserves_underscores():
    assert _safe_id("in", "a", "b_c") == "in_a_b_c"


def test_empty_tasks_returns_tabs_and_broker_only():
    flows = build_flows_json({})
    types = sorted(n["type"] for n in flows)
    assert types == ["mqtt-broker", "tab", "tab"]
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["broker"] == "localhost"
    assert broker["port"] == "1883"
    assert broker["protocolVersion"] == "4"
    assert isinstance(broker["port"], str)


def test_single_modbus_tag_creates_mqtt_in_and_debug():
    tasks = {"440001": _mk_task("440001", site="site1", device="plc1")}
    flows = build_flows_json(tasks)
    types = [n["type"] for n in flows]
    assert types.count("mqtt in") == 1
    assert types.count("debug") == 1
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["topic"] == "1052os/site1/plc1/440001/value"
    assert in_node["broker"] == "brk_1052os"
    assert in_node["z"] == "tab_modbus"
    assert in_node["qos"] == "0"


def test_opcua_tag_uses_opcua_tab():
    tasks = {"x": _mk_task("x", protocol="opcua", site="s1", device="d1")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["z"] == "tab_opcua"


def test_wires_connect_mqtt_in_to_debug():
    tasks = {"440001": _mk_task("440001")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    debug_id = in_node["wires"][0][0]
    debug_node = next(n for n in flows if n["id"] == debug_id)
    assert debug_node["type"] == "debug"
    assert debug_node["z"] == in_node["z"]


def test_id_normalization_handles_tag_with_special_chars():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", protocol="modbus")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["id"] == "in_default_raw_data_TI_101_PV"


def test_idempotent_regeneration():
    tasks = {"440001": _mk_task("440001"), "440002": _mk_task("440002")}
    f1 = build_flows_json(tasks)
    f2 = build_flows_json(tasks)
    assert f1 == f2


def test_port_parameter_overrides_default():
    flows = build_flows_json({}, port=1884)
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["port"] == "1884"


def test_layout_coordinates_are_integers():
    tasks = {f"t{i}": _mk_task(f"t{i}") for i in range(8)}
    flows = build_flows_json(tasks)
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    for n in in_nodes:
        assert isinstance(n["x"], int)
        assert isinstance(n["y"], int)
        assert n["x"] >= 0 and n["y"] >= 0
