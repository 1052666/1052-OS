"""Tests for dashboard_flows.build_dashboard_flows() Sub-5 control widgets.

Generates Node-RED Dashboard control widgets (ui_switch / ui_numeric) that
fire write commands through Sub-3's CommandHandler.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.dashboard_flows import build_dashboard_flows


class _FakeTask:
    def __init__(self, **kw):
        self.id = kw.get("id", "tag1")
        self.protocol = kw.get("protocol", "modbus")
        self.site = kw.get("site", "site1")
        self.device = kw.get("device", "plc1")
        self.dtype = kw.get("dtype", "f32")
        self.table = kw.get("table", "raw_data")
        # Modbus fields (only present for modbus tasks)
        self.mb_host = kw.get("mb_host", "127.0.0.1")
        self.mb_port = kw.get("mb_port", 502)
        self.mb_unit = kw.get("mb_unit", 1)
        self.mb_address = kw.get("mb_address", 0)
        # OPC UA fields
        self.ua_url = kw.get("ua_url", "opc.tcp://127.0.0.1:4840")
        self.ua_node_id = kw.get("ua_node_id", "")


class _FakeChannel:
    def __init__(self, **kw):
        self.id = kw.get("id", "tag1")
        self.low = kw.get("low", 10)
        self.high = kw.get("high", 90)


def _mk_task(tid="TI-101", **kw):
    return _FakeTask(id=tid, **kw)


def _mk_channel(cid="TI-101", **kw):
    return _FakeChannel(id=cid, **kw)


# ── backward compat (no controls) ──────────────────────


def test_default_no_controls():
    """Backward compat: build_dashboard_flows() without include_controls kwarg."""
    tasks = {"TI-101": _mk_task("TI-101")}
    flows = build_dashboard_flows(tasks)
    # No command group
    assert not any(
        n.get("name") == "Modbus Commands"
        for n in flows
        if n["type"] == "ui_group"
    )
    # No function nodes
    assert not any(n["type"] == "function" for n in flows)
    # No mqtt out
    assert not any(n["type"] == "mqtt out" for n in flows)


def test_explicit_include_controls_false_omits_controls():
    flows = build_dashboard_flows(
        {"TI-101": _mk_task("TI-101")},
        include_controls=False,
    )
    assert not any(n["type"] == "function" for n in flows)
    assert not any(n["type"] == "mqtt out" for n in flows)


def test_include_controls_true_adds_modbus_command_group():
    """When at least one Modbus writable task exists, only 'Modbus Commands' appears."""
    flows = build_dashboard_flows(
        {"TI-101": _mk_task("TI-101", dtype="f32")},
        include_controls=True,
    )
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" in group_names
    assert "OPC UA Commands" not in group_names


def test_include_controls_true_adds_opcua_command_group():
    """When at least one OPC UA writable task exists, only 'OPC UA Commands' appears."""
    flows = build_dashboard_flows(
        {"PRESSURE": _mk_task("PRESSURE", protocol="opcua", dtype="f32")},
        include_controls=True,
    )
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "OPC UA Commands" in group_names
    assert "Modbus Commands" not in group_names


def test_include_controls_true_adds_both_groups_when_mixed():
    """When both protocols have writable tasks, both groups appear."""
    flows = build_dashboard_flows(
        {
            "TI-101": _mk_task("TI-101", dtype="f32"),
            "PRESSURE": _mk_task("PRESSURE", protocol="opcua", dtype="f32"),
        },
        include_controls=True,
    )
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" in group_names
    assert "OPC UA Commands" in group_names


# ── per-protocol / per-dtype widget mapping ────────────


def test_modbus_numeric_tag_creates_ui_numeric_function_mqtt_out():
    tasks = {
        "TI-101": _mk_task(
            "TI-101", protocol="modbus", dtype="f32",
            mb_host="127.0.0.1", mb_port=502, mb_unit=1, mb_address=100,
        )
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    nums = [n for n in flows if n["type"] == "ui_numeric" and n.get("name") == "TI-101"]
    assert len(nums) == 1
    fns = [n for n in flows if n["type"] == "function" and "TI-101" in n["name"]]
    assert len(fns) == 1
    outs = [n for n in flows if n["type"] == "mqtt out"]
    assert len(outs) == 1
    # function wires to mqtt out
    assert fns[0]["wires"] == [[outs[0]["id"]]]
    # function body contains target fields
    assert "100" in fns[0]["func"]
    assert "write_float32" in fns[0]["func"]
    # ui_numeric wires to function
    assert nums[0]["wires"] == [[fns[0]["id"]]]


def test_modbus_bit_tag_creates_ui_switch():
    tasks = {
        "PUMP1_RUN": _mk_task(
            "PUMP1_RUN", protocol="modbus", dtype="bit", mb_address=0,
        )
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    sw = next(
        n for n in flows
        if n["type"] == "ui_switch" and n.get("name") == "PUMP1_RUN"
    )
    fn = next(
        n for n in flows
        if n["type"] == "function" and "PUMP1_RUN" in n["name"]
    )
    assert sw["wires"] == [[fn["id"]]]
    assert "write_coil" in fn["func"]
    # function body accepts str "1", int 1, bool true
    assert "msg.payload === '1'" in fn["func"]
    assert "msg.payload === 1" in fn["func"]
    assert "msg.payload === true" in fn["func"]


def test_opcua_tag_creates_write_node_function():
    tasks = {
        "PRESSURE": _mk_task(
            "PRESSURE", protocol="opcua", dtype="f32",
            ua_url="opc.tcp://127.0.0.1:4840",
            ua_node_id="ns=2;s=PRESSURE",
        )
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    nums = [
        n for n in flows
        if n["type"] == "ui_numeric" and n.get("name") == "PRESSURE"
    ]
    fns = [
        n for n in flows
        if n["type"] == "function" and "PRESSURE" in n["name"]
    ]
    assert len(nums) == 1
    assert len(fns) == 1
    assert "write_node" in fns[0]["func"]
    assert "ns=2;s=PRESSURE" in fns[0]["func"]


# ── non-writable dtypes skip controls ──────────────────


def test_ascii_dtype_no_control_widget():
    tasks = {"MSG": _mk_task("MSG", dtype="ascii")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    # No ui_numeric / ui_switch for MSG
    assert not any(
        n.get("name") == "MSG"
        for n in flows
        if n["type"] in ("ui_numeric", "ui_switch")
    )


def test_all_ascii_skips_command_groups():
    tasks = {
        "MSG1": _mk_task("MSG1", dtype="ascii"),
        "MSG2": _mk_task("MSG2", dtype="utf8"),
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" not in group_names
    assert "OPC UA Commands" not in group_names


# ── MQTT topic per protocol ────────────────────────────


def test_mqtt_out_uses_correct_topic_per_protocol():
    tasks = {
        "TI-101": _mk_task("TI-101", protocol="modbus"),
        "PRESSURE": _mk_task("PRESSURE", protocol="opcua"),
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    outs = [n for n in flows if n["type"] == "mqtt out"]
    topics = {n["topic"] for n in outs}
    assert "1052os/cmd/write/modbus" in topics
    assert "1052os/cmd/write/opcua" in topics


# ── min/max from anomaly channel ───────────────────────


def test_numeric_min_max_from_anomaly_channel():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    channels = {"TI-101": _mk_channel("TI-101", low=10, high=90)}
    flows = build_dashboard_flows(
        tasks, anomaly_channels=channels, include_controls=True,
    )
    num = next(
        n for n in flows
        if n["type"] == "ui_numeric" and n.get("name") == "TI-101"
    )
    assert num["min"] == 10
    assert num["max"] == 90


# ── request_id format ──────────────────────────────────


def test_function_body_contains_request_id_prefix():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(
        n for n in flows
        if n["type"] == "function" and "TI-101" in n["name"]
    )
    assert "'TI-101-' + Date.now()" in fn["func"]


# ── id collisions / safe-id ────────────────────────────


def test_function_node_id_collision_safe_id():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", dtype="f32")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fns = [
        n for n in flows
        if n["type"] == "function" and "TI_101_PV" in n["id"]
    ]
    assert len(fns) == 1


# ── idempotency ────────────────────────────────────────


def test_idempotent_regeneration_with_controls():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    f1 = build_dashboard_flows(tasks, include_controls=True)
    f2 = build_dashboard_flows(tasks, include_controls=True)
    assert f1 == f2


# ── dtype → Modbus cmd mapping extras ──────────────────


def test_modbus_register_cmd_for_u16():
    """u16 should use write_register (not write_float32)."""
    tasks = {"REG1": _mk_task("REG1", dtype="u16", mb_address=200)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(
        n for n in flows
        if n["type"] == "function" and "REG1" in n["name"]
    )
    assert "write_register" in fn["func"]
    assert "parseInt(msg.payload, 10)" in fn["func"]


def test_modbus_float32_cmd_for_f32():
    tasks = {"TEMP": _mk_task("TEMP", dtype="f32", mb_address=300)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(
        n for n in flows
        if n["type"] == "function" and "TEMP" in n["name"]
    )
    assert "write_float32" in fn["func"]
    assert "parseFloat(msg.payload)" in fn["func"]