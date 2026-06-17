"""1052-OS Industrial Gateway — Node-RED Dashboard flows.json builder

Pure function: generates a Node-RED Dashboard flows.json from collector tasks,
anomaly channel configs, and recent audit/anomaly history.

Output is a flat list of Node-RED nodes ready for Import. Compatible with
node-red-dashboard v2.x (legacy Angular-based dashboard) on NR 3.x/4.x/5.x.

Read-only widgets (per tag dtype):
    u16/u32/u64/i16/i32/i64/f32 → ui_gauge + ui_chart
    bit/bool/ascii/utf8          → ui_text

Anomaly channels override gauge min/max/seg1/seg2 with their low/high values.

Control widgets (Sub-5, include_controls=True):
    bit          → ui_switch      (Modbus write_coil / OPC UA write_node)
    u16/i16      → ui_numeric     (Modbus write_register)
    u32/i32/f32  → ui_numeric     (Modbus write_float32)
    u64/i64      → ui_numeric     (Modbus write_registers, v0.2 split; OPC UA write_node)
    ascii/utf8   → (skipped)

Each control widget is wired to a per-task function node that wraps the raw
value into a CommandHandler-compatible JSON payload, then to an mqtt out node
publishing to 1052os/cmd/write/{modbus,opcua}.
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

# Sub-5: control widget write topics (matches CommandHandler subscriptions)
CONTROL_WRITE_TOPIC = {
    "modbus": "1052os/cmd/write/modbus",
    "opcua":  "1052os/cmd/write/opcua",
}

# dtype → (modbus_cmd, JS expression that extracts `value:` from msg.payload)
# u64 / i64 → write_registers is a v0.2 TODO; we still generate a function node
# that calls write_registers so the user can see it; v0.2 will implement proper
# 2-register split (high word / low word).
MODBUS_CMD_BY_DTYPE = {
    "bit":  ("write_coil",     "msg.payload === '1' || msg.payload === 1 || msg.payload === true"),
    "u16":  ("write_register", "parseInt(msg.payload, 10)"),
    "i16":  ("write_register", "parseInt(msg.payload, 10)"),
    "u32":  ("write_float32",  "parseFloat(msg.payload)"),
    "i32":  ("write_float32",  "parseFloat(msg.payload)"),
    "f32":  ("write_float32",  "parseFloat(msg.payload)"),
    "u64":  ("write_registers", "parseFloat(msg.payload)"),  # v0.2 TODO: split 2 registers
    "i64":  ("write_registers", "parseFloat(msg.payload)"),  # v0.2 TODO: split 2 registers
}

# dtpes that get a control widget
WRITABLE_DTYPES = {"bit", "u16", "i16", "u32", "i32", "f32", "u64", "i64"}


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


def _ui_group_node(name: str, order: int, width: int = 12,
                   group_id: str | None = None) -> dict:
    return {
        "id": group_id or f"grp_{name.lower().replace(' ', '_')}",
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


# ═══════════════════════════════════════════════════════
#  Sub-5: Control widget helpers (ui_switch / ui_numeric)
# ═══════════════════════════════════════════════════════


def _ui_numeric_node(node_id: str, label: str, group_id: str, order: int,
                     min_v, max_v, step, topic: str,
                     x: int, y: int, wires: list) -> dict:
    return {
        "id": node_id,
        "type": "ui_numeric",
        "z": "tab_1052os",
        "g": group_id,
        "group": group_id,
        "name": label,
        "label": label,
        "order": order,
        "width": 6,
        "height": 1,
        "min": min_v,
        "max": max_v,
        "step": step,
        "format": "{{value}}",
        "wrap": False,
        "topic": topic,
        "topicType": "str",
        "x": x,
        "y": y,
        "wires": wires,
    }


def _ui_switch_node(node_id: str, label: str, group_id: str, order: int,
                    topic: str, x: int, y: int, wires: list) -> dict:
    return {
        "id": node_id,
        "type": "ui_switch",
        "z": "tab_1052os",
        "g": group_id,
        "group": group_id,
        "name": label,
        "label": label,
        "order": order,
        "width": 6,
        "height": 1,
        "onvalue": "1",
        "onvalueType": "str",
        "offvalue": "0",
        "offvalueType": "str",
        "topic": topic,
        "topicType": "str",
        "x": x,
        "y": y,
        "wires": wires,
    }


def _function_node(node_id: str, name: str, func: str,
                   x: int, y: int, wires: list) -> dict:
    return {
        "id": node_id,
        "type": "function",
        "z": "tab_1052os",
        "name": name,
        "func": func,
        "outputs": 1,
        "timeout": "",
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": x,
        "y": y,
        "wires": wires,
    }


def _mqtt_out_node(node_id: str, name: str, topic: str,
                   x: int, y: int) -> dict:
    return {
        "id": node_id,
        "type": "mqtt out",
        "z": "tab_1052os",
        "name": name,
        "topic": topic,
        "qos": "",
        "retain": "",
        "broker": "brk_1052os",
        "x": x,
        "y": y,
        "wires": [],
    }


def _build_function_body_modbus(tag_id: str, host: str, port, unit_id,
                                address, dtype: str) -> str:
    """Build the JS body for the per-task function node (modbus writes)."""
    cmd, value_expr = MODBUS_CMD_BY_DTYPE.get(
        dtype, MODBUS_CMD_BY_DTYPE["f32"],
    )
    note = ""
    if dtype in ("u64", "i64"):
        note = "// TODO v0.2: split 64-bit into 2 Modbus registers\n"
    return (
        f"// 1052-OS: wrap raw value into CommandHandler write payload for {tag_id}\n"
        f"{note}"
        f"msg.payload = JSON.stringify({{\n"
        f"    request_id: '{tag_id}-' + Date.now(),\n"
        f"    cmd: '{cmd}',\n"
        f"    host: '{host}', port: {port}, unit_id: {unit_id},\n"
        f"    address: {address},\n"
        f"    value: {value_expr}\n"
        f"}});\n"
        f"return msg;\n"
    )


def _build_function_body_opcua(tag_id: str, url: str, node_id: str) -> str:
    """Build the JS body for the per-task function node (OPC UA writes)."""
    return (
        f"// 1052-OS: wrap raw value into CommandHandler write payload for {tag_id}\n"
        f"msg.payload = JSON.stringify({{\n"
        f"    request_id: '{tag_id}-' + Date.now(),\n"
        f"    cmd: 'write_node',\n"
        f"    url: '{url}',\n"
        f"    node_id: '{node_id}',\n"
        f"    value: msg.payload\n"
        f"}});\n"
        f"return msg;\n"
    )


def _emit_control_widgets(tasks: dict, channels: dict,
                          seen_ids: set) -> list[dict]:
    """For each writable task, generate ui_switch/ui_numeric + function + mqtt out.

    Layout:
        Modbus Commands group (order=6, id=grp_modbus_cmd)
        OPC UA  Commands group (order=7, id=grp_opcua_cmd)
        Per-task: widget (x=140) → function (x=340) → mqtt out (x=540)

    Idempotent: returns [] when no writable tasks exist (no Commands group
    is generated in that case).
    """
    nodes: list[dict] = []
    # First pass: collect writable tasks, split by protocol
    modbus_writable = []
    opcua_writable = []
    for tid in sorted(tasks.keys()):
        t = tasks[tid]
        if t.dtype not in WRITABLE_DTYPES:
            continue
        if getattr(t, "protocol", "modbus") == "opcua":
            opcua_writable.append(t)
        else:
            modbus_writable.append(t)
    if not modbus_writable and not opcua_writable:
        return nodes  # no Commands group at all

    # Per-protocol gating: each Commands group is emitted only if there is at
    # least one writable task of that protocol (spec §Data flow / "没有可控制
    # task 时 不生成 Commands group").
    modbus_gid = None
    opcua_gid = None
    if modbus_writable:
        modbus_gid = _safe_id("grp", "modbus", "cmd", _seen=seen_ids)
        nodes.append(_ui_group_node(
            "Modbus Commands", order=6, width=12, group_id=modbus_gid,
        ))
    if opcua_writable:
        opcua_gid = _safe_id("grp", "opcua", "cmd", _seen=seen_ids)
        nodes.append(_ui_group_node(
            "OPC UA Commands", order=7, width=12, group_id=opcua_gid,
        ))

    def _emit_series(task_list, group_id, y_base):
        for i, t in enumerate(task_list):
            is_bit = t.dtype == "bit"
            wid = _safe_id(
                ("sw" if is_bit else "num"), t.id, _seen=seen_ids,
            )
            fn_id = _safe_id("fn", t.id, _seen=seen_ids)
            out_id = _safe_id("out", t.id, _seen=seen_ids)
            topic = CONTROL_WRITE_TOPIC[
                "opcua" if getattr(t, "protocol", "modbus") == "opcua"
                else "modbus"
            ]
            x_w, x_f, x_o = 140, 340, 540
            y = y_base + (i // 2) * 80

            if is_bit:
                nodes.append(_ui_switch_node(
                    wid, t.id, group_id, order=i + 1, topic=topic,
                    x=x_w, y=y, wires=[[fn_id]],
                ))
            else:
                ch = channels.get(t.id) if channels else None
                if ch is not None:
                    min_v, max_v = ch.low, ch.high
                else:
                    min_v, max_v = DEFAULT_RANGE.get(t.dtype, (0, 100))
                step = 1 if t.dtype in ("u16", "i16", "u32", "i32") else 0.1
                nodes.append(_ui_numeric_node(
                    wid, t.id, group_id, order=i + 1,
                    min_v=min_v, max_v=max_v, step=step, topic=topic,
                    x=x_w, y=y, wires=[[fn_id]],
                ))

            # Function body: per-protocol
            if getattr(t, "protocol", "modbus") == "opcua":
                func_body = _build_function_body_opcua(
                    t.id, t.ua_url, t.ua_node_id,
                )
            else:
                func_body = _build_function_body_modbus(
                    t.id, t.mb_host, t.mb_port, t.mb_unit,
                    t.mb_address, t.dtype,
                )
            nodes.append(_function_node(
                fn_id, name=f"wrap: {t.id} {t.protocol}",
                func=func_body, x=x_f, y=y, wires=[[out_id]],
            ))

            # MQTT out
            nodes.append(_mqtt_out_node(
                out_id, name=f"mqtt: {t.protocol} write",
                topic=topic, x=x_o, y=y,
            ))

    if modbus_writable and modbus_gid is not None:
        _emit_series(modbus_writable, modbus_gid, y_base=680)
    if opcua_writable and opcua_gid is not None:
        _emit_series(opcua_writable, opcua_gid, y_base=1080)
    return nodes


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
                          include_controls: bool = False,
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
    include_controls : bool, default False
        Sub-5: when True, also emit ui_switch / ui_numeric + function + mqtt out
        that fire write commands through CommandHandler. When False (default),
        the dashboard is read-only and backward-compatible with Sub-4.
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

    # Sub-5: optional control widgets (ui_switch / ui_numeric + function + mqtt out)
    if include_controls:
        control_nodes = _emit_control_widgets(tasks, channels, seen_ids)
        flows.extend(control_nodes)
        # Track new IDs so subsequent calls (if any) remain collision-safe
        for n in control_nodes:
            nid = n.get("id")
            if nid:
                seen_ids.add(nid)

    return flows