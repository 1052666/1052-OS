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
        # MQTT source fields (only meaningful when protocol=="mqtt")
        self.mq_topic = kw.get("mq_topic", "")
        self.mq_payload = kw.get("mq_payload", "raw")
        self.mq_field = kw.get("mq_field", "v")
        self.mq_broker_host = kw.get("mq_broker_host", "127.0.0.1")
        self.mq_broker_port = kw.get("mq_broker_port", 1883)
        self.mq_qos = kw.get("mq_qos", 0)


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


def test_base_has_six_groups():
    flows = build_dashboard_flows({})
    groups = [n for n in flows if n["type"] == "ui_group"]
    assert len(groups) == 6
    group_names = {g["name"] for g in groups}
    assert {"Overview", "Modbus Tags", "OPC UA Tags", "MQTT Tags",
            "Anomalies", "Recent Writes"} <= group_names


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
    Plus: tab(1) + ui_base(1) + 6 groups + 3 fixed text+in pairs (overview/anomaly/writes)."""
    tasks = {"A": _mk_task("A", dtype="f32"), "B": _mk_task("B", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    # Expected breakdown:
    #   1 tab + 1 ui_base + 6 groups = 8
    #   3 fixed (overview + anomaly + writes) × (mqtt_in + text) = 6
    #   2 numeric tags × (mqtt_in + gauge + chart) = 6
    # Total = 20
    assert len(flows) == 20


def test_safe_id_replaces_special_chars():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    # Name keeps the original dots/dashes (user-friendly), but node ID is sanitized.
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TI-101.PV")
    assert gauge is not None
    assert "TI_101_PV" in gauge["id"]  # ID has sanitized form
    assert "." not in gauge["id"]
    assert "-" not in gauge["id"]


# ── MQTT-source tasks ─────────────────────────────────


def test_mqtt_numeric_task_creates_gauge_with_absolute_topic():
    """MQTT-source tasks subscribe to their absolute topic, not prefix/site/device/tag/value."""
    tasks = {
        "TEMP": _mk_task(
            "TEMP", protocol="mqtt", dtype="f32",
            mq_topic="device/temperature",
        ),
    }
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge" and n.get("name") == "TEMP"]
    assert len(gauges) == 1
    in_nodes = [n for n in flows if n["type"] == "mqtt in" and n.get("name") == "TEMP"]
    assert len(in_nodes) == 1
    assert in_nodes[0]["topic"] == "device/temperature"
    # And the gauge lives in the MQTT group, not Modbus / OPC UA.
    assert gauges[0]["group"] == "grp_mqtt_tags"


def test_mqtt_text_task_creates_text_widget():
    """MQTT-source text dtype (e.g. status/alarm enum strings) → ui_text."""
    tasks = {
        "STATUS": _mk_task(
            "STATUS", protocol="mqtt", dtype="ascii",
            mq_topic="device/status",
        ),
    }
    flows = build_dashboard_flows(tasks)
    texts = [n for n in flows if n["type"] == "ui_text" and n.get("name") == "STATUS"]
    assert len(texts) == 1
    in_nodes = [n for n in flows if n["type"] == "mqtt in" and n.get("name") == "STATUS"]
    assert len(in_nodes) == 1
    assert in_nodes[0]["topic"] == "device/status"
    assert texts[0]["group"] == "grp_mqtt_tags"


def test_mqtt_tasks_dont_generate_control_widgets():
    """MQTT-source tasks are read-only — no ui_switch / ui_numeric write path."""
    tasks = {
        "TEMP": _mk_task("TEMP", protocol="mqtt", dtype="f32",
                         mq_topic="device/temperature"),
    }
    flows = build_dashboard_flows(tasks, include_controls=True)
    fns = [n for n in flows if n["type"] == "function"]
    outs = [n for n in flows if n["type"] == "mqtt out"]
    assert not any("TEMP" in n.get("name", "") for n in fns)
    assert not any("TEMP" in n.get("name", "") for n in outs)
    # And no "Modbus/OPC UA Commands" group for mqtt-only configs.
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" not in group_names
    assert "OPC UA Commands" not in group_names


def test_mqtt_mixed_with_other_protocols_splits_into_three_groups():
    """When all three protocols are present, each gets its own group + widgets."""
    tasks = {
        "TI-101": _mk_task("TI-101", protocol="modbus", dtype="f32"),
        "PRESSURE": _mk_task("PRESSURE", protocol="opcua", dtype="f32"),
        "TEMP": _mk_task("TEMP", protocol="mqtt", dtype="f32",
                         mq_topic="device/temperature"),
    }
    flows = build_dashboard_flows(tasks)
    # Each tag lives in its protocol's group.
    groups_for_tag = {
        "TI-101": "grp_modbus_tags",
        "PRESSURE": "grp_opc_ua_tags",
        "TEMP": "grp_mqtt_tags",
    }
    for tag, expected_group in groups_for_tag.items():
        gauge = next(n for n in flows
                     if n["type"] == "ui_gauge" and n.get("name") == tag)
        assert gauge["group"] == expected_group, f"{tag} in wrong group"
    # MQTT task uses its absolute topic.
    in_topic = next(n["topic"] for n in flows
                    if n["type"] == "mqtt in" and n.get("name") == "TEMP")
    assert in_topic == "device/temperature"


def test_mqtt_task_falls_back_to_prefix_path_when_mq_topic_empty():
    """Defensive: a misconfigured MQTT task (no mq_topic) falls back to the
    standard prefix/site/device/tag/value path so the dashboard still loads."""
    tasks = {
        "TEMP": _mk_task("TEMP", protocol="mqtt", dtype="f32", mq_topic=""),
    }
    flows = build_dashboard_flows(tasks)
    in_topic = next(n["topic"] for n in flows
                    if n["type"] == "mqtt in" and n.get("name") == "TEMP")
    assert in_topic == "1052os/site1/plc1/TEMP/value"