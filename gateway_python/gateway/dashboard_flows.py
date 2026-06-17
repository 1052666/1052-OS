"""1052-OS Industrial Gateway — Node-RED Dashboard flows.json builder

Pure function: generates a Node-RED Dashboard flows.json from collector tasks,
anomaly channel configs, and recent audit/anomaly history.

Output is a flat list of Node-RED nodes ready for Import. Compatible with
node-red-dashboard v2.x (legacy Angular-based dashboard) on NR 3.x/4.x/5.x.

Widget mapping (per tag dtype):
    u16/u32/u64/i16/i32/i64/f32 → ui_gauge + ui_chart
    bit/bool/ascii/utf8          → ui_text

Anomaly channels override gauge min/max/seg1/seg2 with their low/high values.
"""
import re

# Tag dtype → default gauge range (min, max)
DEFAULT_RANGE = {
    "u16": (0, 65535),
    "u32": (0, 4294967295),
    "u64": (0, 100),
    "i16": (-100, 100),
    "i32": (-100, 100),
    "i64": (-100, 100),
    "f32": (0.0, 100.0),
}

# dtpes that get gauge + chart
NUMERIC_DTYPES = set(DEFAULT_RANGE.keys())

# dtpes that get only text widget
TEXT_DTYPES = {"bit", "bool", "ascii", "utf8"}

# Default gauge segments + colors (green/yellow/red)
DEFAULT_COLORS = ["#00B500", "#E6E600", "#CA3838"]


def _safe_id(prefix: str, *parts: str, _seen: set | None = None) -> str:
    """Build a Node-RED-safe node ID with uniqueness check (counter suffix)."""
    if _seen is None:
        _seen = set()
    raw = re.sub(r"[^A-Za-z0-9_]", "_", "_".join([prefix, *parts]))
    base = raw
    n = 1
    while raw in _seen:
        n += 1
        raw = f"{base}_{n}"
    _seen.add(raw)
    return raw


def _ui_tab_node() -> dict:
    return {
        "id": "tab_1052os",
        "type": "ui_tab",
        "name": "1052-OS Industrial",
        "order": 1,
        "icon": "dashboard",
        "disabled": False,
        "hidden": False,
    }


def _ui_base_node() -> dict:
    return {
        "id": "ui_base",
        "type": "ui_base",
        "theme": {
            "name": "theme-light",
            "lightTheme": {
                "default": "#0094CE",
                "baseColor": "#0094CE",
                "baseFont": "Helvetica Neue",
                "edited": True,
                "reset": False,
            },
            "darkTheme": {
                "default": "#097479",
                "baseColor": "#097479",
                "baseFont": "Helvetica Neue",
                "edited": True,
                "reset": False,
            },
            "customTheme": {
                "name": "Untitled Theme 1",
                "default": "#4B7930",
                "baseColor": "#4B7930",
                "baseFont": "Helvetica Neue",
            },
            "themeState": {
                "base-color": {"default": "#0094CE", "value": "#0094CE", "edited": False},
                "page-titleBar-backgroundColor": {"default": "#0094CE", "value": "#0094CE", "edited": False},
                "page-backgroundColor": {"default": "#fafafa", "value": "#fafafa", "edited": False},
                "page-sidebar-backgroundColor": {"default": "#ffffff", "value": "#ffffff", "edited": False},
                "group-textColor": {"default": "#1bbfff", "value": "#1bbfff", "edited": False},
                "group-borderColor": {"default": "#ffffff", "value": "#ffffff", "edited": False},
                "group-backgroundColor": {"default": "#ffffff", "value": "#ffffff", "edited": False},
                "widget-textColor": {"default": "#111111", "value": "#111111", "edited": False},
                "widget-backgroundColor": {"default": "#0094CE", "value": "#0094CE", "edited": False},
                "widget-borderColor": {"default": "#ffffff", "value": "#ffffff", "edited": False},
                "base-font": {"default": "Helvetica Neue", "value": "Helvetica Neue", "edited": False},
            },
        },
        "site": {
            "name": "1052-OS Industrial Gateway",
            "hideToolbar": "false",
            "allowSwipe": "false",
            "lockMenu": "false",
            "allowTempTheme": "true",
            "dateFormat": "DD/MM/YYYY",
            "sizes": {
                "sx": 48, "sy": 48, "gx": 6, "gy": 6, "cx": 6, "cy": 6,
                "px": 0, "py": 0,
            },
        },
    }


def _ui_group_node(name: str, order: int, width: int = 12) -> dict:
    return {
        "id": f"grp_{name.lower().replace(' ', '_')}",
        "type": "ui_group",
        "name": name,
        "tab": "tab_1052os",
        "order": order,
        "disp": True,
        "width": width,
        "collapse": False,
        "className": "",
    }


def _ui_gauge_node(node_id: str, label: str, group_id: str, order: int,
                   min_v, max_v, seg1, seg2, width: int = 6, height: int = 4) -> dict:
    return {
        "id": node_id,
        "type": "ui_gauge",
        "z": "tab_1052os",
        "g": group_id,
        "name": label,
        "label": label,
        "group": group_id,
        "order": order,
        "width": width,
        "height": height,
        "gtype": "gage",
        "title": label,
        "label": label,
        "format": "{{value}}",
        "min": min_v,
        "max": max_v,
        "colors": DEFAULT_COLORS,
        "seg1": seg1,
        "seg2": seg2,
        "diff": False,
        "className": "",
        "x": 340,
        "y": 0,
        "wires": [],
    }


def _ui_chart_node(node_id: str, label: str, group_id: str, order: int,
                   width: int = 12, height: int = 4) -> dict:
    return {
        "id": node_id,
        "type": "ui_chart",
        "z": "tab_1052os",
        "g": group_id,
        "name": label,
        "label": f"{label} trend",
        "group": group_id,
        "order": order,
        "width": width,
        "height": height,
        "chartType": "line",
        "legend": False,
        "xformat": "HH:mm:ss",
        "interpolate": "linear",
        "nodata": "",
        "dot": False,
        "ymin": "",
        "ymax": "",
        "removeOlder": 1,
        "removeOlderPoints": "",
        "removeOlderUnit": "3600",
        "cutout": 0,
        "useOneColor": False,
        "useUTC": False,
        "colors": ["#1F77B4", "#AEC7E8", "#FF7F0E", "#2CA02C", "#98DF8A",
                   "#D62728", "#FF9896", "#9467BD", "#C5B0D5"],
        "useDifferentColor": False,
        "className": "",
        "x": 560,
        "y": 0,
        "wires": [],
    }


def _ui_text_node(node_id: str, label: str, group_id: str, order: int,
                  fmt: str, height: int = 1) -> dict:
    return {
        "id": node_id,
        "type": "ui_text",
        "z": "tab_1052os",
        "g": group_id,
        "group": group_id,
        "name": label,
        "label": label,
        "order": order,
        "width": 0,
        "height": height,
        "format": fmt,
        "layout": "row-spread",
        "style": False,
        "font": "",
        "fontSize": 16,
        "color": "#111111",
        "className": "",
        "x": 560,
        "y": 0,
        "wires": [],
    }


def _mqtt_in_node(node_id: str, name: str, topic: str, tab_id: str,
                  wires: list, x: int, y: int) -> dict:
    return {
        "id": node_id,
        "type": "mqtt in",
        "z": tab_id,
        "name": name,
        "topic": topic,
        "qos": "0",
        "datatype": "auto",
        "broker": "brk_1052os",
        "nl": False,
        "rap": True,
        "rh": 0,
        "inputs": 0,
        "x": x,
        "y": y,
        "wires": wires,
    }


def _emit_tag_widgets(t, group_id: str, x: int, y: int, order: int,
                      anomaly_channels: dict, seen_ids: set) -> list[dict]:
    """Generate mqtt_in + ui_gauge/ui_chart (numeric) or + ui_text (text) for a tag."""
    nodes: list[dict] = []
    device = getattr(t, "device", "") or getattr(t, "table", "raw_data")
    site = getattr(t, "site", "default")
    topic = f"1052os/{site}/{device}/{t.id}/value"
    in_id = _safe_id("in", site, device, t.id, _seen=seen_ids)
    is_numeric = t.dtype in NUMERIC_DTYPES

    if is_numeric:
        g_id = _safe_id("g", site, device, t.id, _seen=seen_ids)
        ch_id = _safe_id("ch", site, device, t.id, _seen=seen_ids)
        # Threshold: use anomaly channel low/high if available, else default range
        ch_cfg = anomaly_channels.get(t.id) if anomaly_channels else None
        if ch_cfg is not None:
            min_v, max_v = ch_cfg.low, ch_cfg.high
            seg1, seg2 = ch_cfg.low, ch_cfg.high
        else:
            min_v, max_v = DEFAULT_RANGE[t.dtype]
            # Default seg1/seg2 split range into thirds
            try:
                span = float(max_v) - float(min_v)
                seg1 = float(min_v) + span / 3
                seg2 = float(min_v) + 2 * span / 3
            except (TypeError, ValueError):
                seg1, seg2 = min_v, max_v
        nodes.append(_mqtt_in_node(in_id, t.id, topic, "tab_1052os", [[g_id, ch_id]], x, y))
        nodes.append(_ui_gauge_node(g_id, t.id, group_id, order, min_v, max_v, seg1, seg2,
                                    width=6, height=4))
        nodes[-1]["x"], nodes[-1]["y"] = x + 200, y
        nodes.append(_ui_chart_node(ch_id, t.id, group_id, order + 1, width=12, height=4))
        nodes[-1]["x"], nodes[-1]["y"] = x + 200, y + 80
    else:
        # Text widget only (bit / ascii / etc.)
        txt_id = _safe_id("txt", site, device, t.id, _seen=seen_ids)
        nodes.append(_mqtt_in_node(in_id, t.id, topic, "tab_1052os", [[txt_id]], x, y))
        nodes.append(_ui_text_node(txt_id, t.id, group_id, order,
                                   fmt="{{msg.payload.v}}", height=1))
        nodes[-1]["x"], nodes[-1]["y"] = x + 200, y
    return nodes


def build_dashboard_flows(tasks: dict, anomaly_channels: dict | None = None,
                          recent_audit: list | None = None,
                          recent_anomalies: list | None = None,
                          broker: str = "localhost", port: int = 1883) -> list[dict]:
    """Generate a Node-RED Dashboard flows.json array.

    Parameters
    ----------
    tasks : dict
        Collector tasks dict {tag_id: CollectTask}.
    anomaly_channels : dict, optional
        Anomaly channels dict {tag_id: ChannelConfig} for gauge thresholds.
    recent_audit : list, optional
        Recent write audit rows (currently informational; not emitted as separate widgets).
    recent_anomalies : list, optional
        Recent anomaly rows (informational; not emitted as separate widgets).
    broker : str, default "localhost"
        MQTT broker host for the in-flow mqtt nodes (cosmetic; uses brk_1052os which
        user can reconfigure in NR).
    port : int, default 1883
        MQTT broker port (cosmetic).

    Returns
    -------
    list[dict]
        Flat list of Node-RED node dicts ready for json.dumps() and Import.
    """
    flows: list[dict] = []
    flows.append(_ui_tab_node())
    flows.append(_ui_base_node())
    flows.append(_ui_group_node("Overview", 1, width=12))
    flows.append(_ui_group_node("Modbus Tags", 2, width=12))
    flows.append(_ui_group_node("OPC UA Tags", 3, width=12))
    flows.append(_ui_group_node("Anomalies", 4, width=12))
    flows.append(_ui_group_node("Recent Writes", 5, width=12))

    seen_ids: set[str] = {
        "tab_1052os", "ui_base",
        "grp_overview", "grp_modbus_tags", "grp_opc_ua_tags",
        "grp_anomalies", "grp_recent_writes",
    }
    channels = anomaly_channels or {}

    # Overview: mqtt in (1052os/events/status) + ui_text
    in_id = _safe_id("in", "overview", "status", _seen=seen_ids)
    txt_id = _safe_id("txt", "overview", "status", _seen=seen_ids)
    flows.append(_mqtt_in_node(in_id, "Status", "1052os/events/status",
                                "tab_1052os", [[txt_id]], x=140, y=80))
    text = _ui_text_node(txt_id, "Gateway Status", "grp_overview", 1,
                          fmt='<i class="fa fa-heartbeat"></i> {{msg.payload}}', height=1)
    text["x"], text["y"] = 340, 80
    flows.append(text)

    # Per-tag widgets: split by protocol into Modbus / OPC UA groups
    modbus_tasks = []
    opcua_tasks = []
    for tid in sorted(tasks.keys()):
        t = tasks[tid]
        if t.protocol == "opcua":
            opcua_tasks.append(t)
        else:
            modbus_tasks.append(t)

    def _emit_series(task_list, group_id, y_offset):
        for i, t in enumerate(task_list):
            x = 140
            y = 120 + (i // 2) * 100 + y_offset
            order = i + 1
            nodes = _emit_tag_widgets(t, group_id, x, y, order, channels, seen_ids)
            flows.extend(nodes)

    _emit_series(modbus_tasks, "grp_modbus_tags", 0)
    _emit_series(opcua_tasks, "grp_opc_ua_tags", 400)

    # Anomalies: mqtt in (1052os/events/anomaly/#) + ui_text
    in_id = _safe_id("in", "anomalies", _seen=seen_ids)
    txt_id = _safe_id("txt", "anomalies", _seen=seen_ids)
    flows.append(_mqtt_in_node(in_id, "Anomaly events", "1052os/events/anomaly/#",
                                "tab_1052os", [[txt_id]], x=140, y=560))
    text = _ui_text_node(txt_id, "Recent Anomalies", "grp_anomalies", 1,
                          fmt='<b>{{msg.payload.channel}}</b> · '
                              '<span style="color:{{msg.payload.severity === "critical" ? "#CA3838" : "#E6E600"}}">'
                              '{{msg.payload.severity}}</span> · '
                              '{{msg.payload.message}}',
                          height=6)
    text["x"], text["y"] = 340, 560
    flows.append(text)

    # Recent Writes: mqtt in (1052os/events/+/+) + ui_text
    in_id = _safe_id("in", "writes", _seen=seen_ids)
    txt_id = _safe_id("txt", "writes", _seen=seen_ids)
    flows.append(_mqtt_in_node(in_id, "Write audit", "1052os/events/+/+",
                                "tab_1052os", [[txt_id]], x=140, y=640))
    text = _ui_text_node(txt_id, "Recent Writes", "grp_recent_writes", 1,
                          fmt='{{msg.payload.cmd}} · {{msg.payload.target}} · '
                              '<span style="color:{{msg.payload.result === "ok" ? "#00B500" : "#CA3838"}}">'
                              '{{msg.payload.result}}</span>',
                          height=6)
    text["x"], text["y"] = 340, 640
    flows.append(text)

    return flows