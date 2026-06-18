"""Tests for dashboard_flows.build_dashboard_flows() (Sub-4 Task 1).

Pure function: generates Node-RED Dashboard flows.json from gateway state.
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


class _FakeChannel:
    def __init__(self, **kw):
        self.id = kw.get("id", "tag1")
        self.low = kw.get("low", 10)
        self.high = kw.get("high", 90)


def _mk_task(tid="TI-101", **kw):
    return _FakeTask(id=tid, **kw)


def _mk_channel(cid="TI-101", **kw):
    return _FakeChannel(id=cid, **kw)


# ── base structure ────────────────────────────────────


def test_empty_tasks_returns_base_flows():
    flows = build_dashboard_flows({})
    types = {n["type"] for n in flows}
    assert "ui_tab" in types
    assert "ui_base" in types
    assert "ui_group" in types
    assert "ui_text" in types  # at least overview text


def test_base_has_five_groups():
    flows = build_dashboard_flows({})
    groups = [n for n in flows if n["type"] == "ui_group"]
    assert len(groups) == 5
    group_names = {g["name"] for g in groups}
    assert {"Overview", "Modbus Tags", "OPC UA Tags", "Anomalies", "Recent Writes"} <= group_names


def test_tab_is_1052os():
    flows = build_dashboard_flows({})
    tab = next(n for n in flows if n["type"] == "ui_tab")
    assert tab["name"] == "1052-OS Industrial"


def test_base_includes_overview_status_text():
    flows = build_dashboard_flows({})
    text_nodes = [n for n in flows if n["type"] == "ui_text"]
    overview = [t for t in text_nodes if "Status" in (t.get("name") or "")]
    assert len(overview) >= 1


# ── widget mapping per tag dtype ──────────────────────


def test_numeric_dtype_creates_gauge_and_chart():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101"]
    charts = [n for n in flows if n["type"] == "ui_chart" and n.get("name") == "TI-101"]
    assert len(gauges) == 1
    assert len(charts) == 1


def test_bit_dtype_creates_text_widget_not_gauge():
    tasks = {"PUMP1_RUN": _mk_task("PUMP1_RUN", dtype="bit")}
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "PUMP1_RUN"]
    texts = [n for n in flows if n["type"] == "ui_text" and n.get("name") == "PUMP1_RUN"]
    assert len(gauges) == 0
    assert len(texts) >= 1


def test_ascii_dtype_creates_text_widget_not_gauge():
    tasks = {"MSG": _mk_task("MSG", dtype="ascii")}
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "MSG"]
    assert len(gauges) == 0


# ── anomaly threshold → gauge segments ────────────────


def test_anomaly_threshold_used_as_gauge_segments():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    channels = {"TI-101": _mk_channel("TI-101", low=10, high=90)}
    flows = build_dashboard_flows(tasks, anomaly_channels=channels)
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101")
    assert gauge["seg1"] == 10
    assert gauge["seg2"] == 90


def test_no_channel_uses_default_range():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    flows = build_dashboard_flows(tasks, anomaly_channels={})
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101")
    # f32 default: 0..100
    assert gauge["min"] == 0
    assert gauge["max"] == 100


# ── group placement ────────────────────────────────────


def test_modbus_tag_belongs_to_modbus_group():
    tasks = {"TI-101": _mk_task("TI-101", protocol="modbus")}
    flows = build_dashboard_flows(tasks)
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101")
    assert gauge["group"] == "grp_modbus_tags"


def test_opcua_tag_belongs_to_opcua_group():
    tasks = {"PRESSURE": _mk_task("PRESSURE", protocol="opcua")}
    flows = build_dashboard_flows(tasks)
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "PRESSURE")
    assert gauge["group"] == "grp_opc_ua_tags"


# ── mqtt topics ───────────────────────────────────────


def test_mqtt_in_topic_uses_value_path():
    tasks = {"TI-101": _mk_task("TI-101", site="site1", device="plc1")}
    flows = build_dashboard_flows(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in" and n.get("name") == "TI-101")
    assert in_node["topic"] == "1052os/site1/plc1/TI-101/value"


def test_mqtt_in_topic_respects_custom_topic_prefix():
    """Frontend-configurable topic_prefix flows through to all topic strings."""
    tasks = {"TI-101": _mk_task("TI-101", site="site1", device="plc1")}
    flows = build_dashboard_flows(tasks, topic_prefix="device")
    in_node = next(n for n in flows if n["type"] == "mqtt in" and n.get("name") == "TI-101")
    assert in_node["topic"] == "device/site1/plc1/TI-101/value"
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    # Overview / anomaly / write audit all use the custom prefix
    assert any(n["topic"] == "device/events/status" for n in in_nodes)
    assert any(n["topic"] == "device/events/anomaly/#" for n in in_nodes)
    assert any(n["topic"] == "device/events/+/+" for n in in_nodes)


def test_anomaly_text_subscribes_to_wildcard():
    flows = build_dashboard_flows({})
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    anomaly_in = [n for n in in_nodes if n.get("topic") == "1052os/events/anomaly/#"]
    assert len(anomaly_in) == 1


# ── structure invariants ──────────────────────────────


def test_idempotent_regeneration():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32"),
             "PUMP1_RUN": _mk_task("PUMP1_RUN", dtype="bit")}
    f1 = build_dashboard_flows(tasks)
    f2 = build_dashboard_flows(tasks)
    assert f1 == f2


def test_broker_default_is_localhost():
    flows = build_dashboard_flows({})
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    # All mqtt in nodes use brk_1052os (set internally)
    assert all(n.get("broker") == "brk_1052os" for n in in_nodes)


def test_node_count_formula():
    """Per-tag nodes: mqtt_in + gauge/chart (3 per numeric tag).
    Plus: tab(1) + ui_base(1) + 5 groups + 3 fixed text+in pairs (overview/anomaly/writes)."""
    tasks = {"A": _mk_task("A", dtype="f32"), "B": _mk_task("B", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    # Expected breakdown:
    #   1 tab + 1 ui_base + 5 groups = 7
    #   3 fixed (overview + anomaly + writes) × (mqtt_in + text) = 6
    #   2 numeric tags × (mqtt_in + gauge + chart) = 6
    # Total = 19
    assert len(flows) == 19


def test_safe_id_replaces_special_chars():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    # Name keeps the original dots/dashes (user-friendly), but node ID is sanitized.
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101.PV")
    assert gauge is not None
    assert "TI_101_PV" in gauge["id"]  # ID has sanitized form
    assert "." not in gauge["id"]
    assert "-" not in gauge["id"]