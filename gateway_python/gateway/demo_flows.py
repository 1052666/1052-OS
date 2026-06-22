"""
1052-OS Industrial Gateway — Demo flows for Node-RED.

These are self-contained Node-RED flows that users can install with one click
to see the "Node-RED → /api/td/insert → TDengine" pipeline in action.

Each demo is a complete tab (label + nodes + wires). Install is idempotent:
re-installing replaces the same tab in place.
"""
from __future__ import annotations

import copy
import re
from typing import Iterable

# ── Node factories (minimal — only what the demos need) ──


def _broker(broker_id: str, host: str, port: int) -> dict:
    return {
        "id": broker_id,
        "type": "mqtt-broker",
        "name": f"{host}:{port}",
        "broker": host,
        "port": str(port),
        "clientid": "",
        "usetls": False,
        "protocolVersion": "4",
        "keepalive": "60",
        "cleansession": True,
        "autoConnect": True,
    }


def _tab(tab_id: str, label: str, info: str) -> dict:
    return {
        "id": tab_id,
        "type": "tab",
        "label": label,
        "disabled": False,
        "info": info,
    }


def _mqtt_in(node_id: str, tab_id: str, name: str, topic: str,
              broker_id: str, x: int, y: int, next_id: str) -> dict:
    return {
        "id": node_id,
        "type": "mqtt in",
        "z": tab_id,
        "name": name,
        "topic": topic,
        "qos": "0",
        "datatype": "auto",
        "broker": broker_id,
        "nl": False,
        "rap": True,
        "rh": 0,
        "inputs": 0,
        "x": x, "y": y,
        "wires": [[next_id]],
    }


def _http_in(node_id: str, tab_id: str, name: str, url: str, method: str,
             x: int, y: int, next_id: str) -> dict:
    return {
        "id": node_id,
        "type": "http in",
        "z": tab_id,
        "name": name,
        "url": url,
        "method": method,
        "upload": False,
        "swaggerDoc": "",
        "x": x, "y": y,
        "wires": [[next_id]],
    }


def _http_response(node_id: str, tab_id: str, name: str, status_code: int,
                    x: int, y: int) -> dict:
    """Terminates an http in request so it doesn't hang waiting for a response."""
    return {
        "id": node_id,
        "type": "http response",
        "z": tab_id,
        "name": name,
        "statusCode": str(status_code),
        "headers": {},
        "x": x, "y": y,
        "wires": [],
    }


def _ui_base(node_id: str) -> dict:
    """Top-level dashboard config (1 per dashboard)."""
    return {
        "id": node_id,
        "type": "ui_base",
        "theme": {"name": "theme-light", "lightTheme": {
            "default": {"background": "#f7f5ef", "baseColor": "#d8d6cf",
                         "baseFont": "Helvetica Neue", "edited": True,
                         "groupBackground": "#ffffff", "groupBorderColor": "#d8d6cf",
                         "groupTextColor": "#1f1f1f", "widgetBgColor": "#f7f5ef",
                         "widgetBorderColor": "#d8d6cf", "widgetTextColor": "#1f1f1f",
                         "textColor": "#1f1f1f", "fontSize": "13"},
                      "compact": {"background": "#f7f5ef", "baseColor": "#d8d6cf",
                          "baseFont": "Helvetica Neue", "edited": True,
                          "groupBackground": "#ffffff", "groupBorderColor": "#d8d6cf",
                          "groupTextColor": "#1f1f1f", "widgetBgColor": "#f7f5ef",
                          "widgetBorderColor": "#d8d6cf", "widgetTextColor": "#1f1f1f",
                          "textColor": "#1f1f1f", "fontSize": 11}},
                  "darkTheme": {"default": {"background": "#1f1f1f", "baseColor": "#1f1f1f",
                                              "baseFont": "Helvetica Neue", "edited": True,
                                              "groupBackground": "#333333", "groupBorderColor": "#555555",
                                              "groupTextColor": "#dddddd", "widgetBgColor": "#1f1f1f",
                                              "widgetBorderColor": "#555555", "widgetTextColor": "#dddddd",
                                              "textColor": "#dddddd", "fontSize": "13"}}},
        "site": {"name": "1052-OS Dashboard", "hideToolbar": "false",
                  "allowSwipe": "false", "lockMenu": "false",
                  "allowTempTheme": "true", "dateFormat": "DD/MM/YYYY",
                  "sizes": {"sx": 48, "sy": 48, "gx": 6, "gy": 6,
                            "cx": 6, "cy": 6, "px": 0, "py": 0}},
    }


def _ui_tab(node_id: str, name: str, icon: str = "dashboard") -> dict:
    return {"id": node_id, "type": "ui_tab", "name": name, "icon": icon,
            "disabled": False, "hidden": False}


def _ui_group(node_id: str, tab_id: str, name: str, width: int = 6,
              height: int = 4, order: int = 1) -> dict:
    return {"id": node_id, "type": "ui_group", "name": name, "tab": tab_id,
            "order": order, "disp": True, "width": str(width), "collapse": False,
            "height": str(height)}


def _ui_gauge(node_id: str, group_id: str, label: str, name: str,
              min_v: float, max_v: float, x: int, y: int,
              tab_id: str, next_ids: list[str] | None = None,
              unit: str = "") -> dict:
    return {
        "id": node_id,
        "type": "ui_gauge",
        "z": tab_id,
        "name": name,
        "label": label,
        "group": group_id,
        "order": 1,
        "width": 0,
        "height": 0,
        "gtype": "gage",
        "title": label,
        # node-red-dashboard ui_gauge format uses {{value}} (Angular mustache).
        # No nested braces / escaping issues — the previous {value}{unit} pattern
        # rendered the literal "{value}" string on v3.6.6.
        "format": "{{value}}" + (f" {unit}" if unit else ""),
        "min": str(min_v),
        "max": str(max_v),
        "colors": ["#00b500", "#e6e600", "#ca3838"],
        "seg1": "",
        "seg2": "",
        "x": x, "y": y,
        "wires": [next_ids or []],
    }


def _ui_chart(node_id: str, group_id: str, label: str, name: str,
              x: int, y: int, tab_id: str,
              next_ids: list[str] | None = None) -> dict:
    return {
        "id": node_id,
        "type": "ui_chart",
        "z": tab_id,
        "name": name,
        "group": group_id,
        "order": 2,
        "width": 0,
        "height": 0,
        "label": label,
        "chartType": "line",
        "legend": "false",
        "xformat": "HH:mm:ss",
        "interpolate": "linear",
        "nodata": "等待数据…",
        "dot": False,
        "ymin": "",
        "ymax": "",
        "removeOlder": "10",
        "removeOlderPoints": "",
        "removeOlderUnit": "60",
        "cutout": 0,
        "useOneColor": False,
        "colors": ["#1f77b4", "#aec7e8", "#ff7f0e", "#2ca02c", "#98df8a",
                    "#d62728", "#ff9896", "#9467bd", "#c5b0d5"],
        "useOldStyle": False,
        "outputs": 1,
        "x": x, "y": y,
        "wires": [next_ids or []],
    }


def _function(node_id: str, tab_id: str, name: str, func: str,
              x: int, y: int, next_ids: list[str]) -> dict:
    return {
        "id": node_id,
        "type": "function",
        "z": tab_id,
        "name": name,
        "func": func,
        "outputs": 1,
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": x, "y": y,
        "wires": [next_ids],
    }


def _http_request(node_id: str, tab_id: str, name: str, url: str,
                  x: int, y: int, next_ids: list[str] | None = None,
                  method: str = "POST") -> dict:
    return {
        "id": node_id,
        "type": "http request",
        "z": tab_id,
        "name": name,
        "method": method,
        "ret": "obj",
        "paytoqs": "ignore",
        "url": url,
        "tls": "",
        "persist": False,
        "proxy": "",
        "authType": "",
        "x": x, "y": y,
        "wires": [next_ids or []],
    }


def _debug(node_id: str, tab_id: str, name: str, x: int, y: int) -> dict:
    return {
        "id": node_id,
        "type": "debug",
        "z": tab_id,
        "name": name,
        "active": True,
        "tosidebar": True,
        "console": False,
        "tostatus": False,
        "complete": "false",
        "targetType": "full",
        "statusVal": "",
        "statusType": "auto",
        "x": x, "y": y,
        "wires": [],
    }


def _inject(node_id: str, tab_id: str, name: str, repeat: str,
             x: int, y: int, next_id: str) -> dict:
    """Inject tick: fires once + every `repeat` seconds (str, e.g. '5')."""
    return {
        "id": node_id,
        "type": "inject",
        "z": tab_id,
        "name": name,
        "props": [{"p": "payload"}, {"p": "topic", "vt": "str"}],
        "repeat": repeat,
        "crontab": "",
        "once": True,
        "onceDelay": 0.5,
        "topic": "",
        "payload": "",
        "payloadType": "date",
        "x": x, "y": y,
        "wires": [[next_id]],
    }


# ── Demos ───────────────────────────────────────────────────


def mqtt_to_td_flow(gateway_api_url: str = "http://127.0.0.1:8765",
                    broker_host: str = "127.0.0.1",
                    broker_port: int = 1883,
                    subscribe_topic: str = "1052os/demo/+") -> list[dict]:
    """Subscribe to MQTT, parse JSON {site,device,tag,value}, POST to /api/td/insert.

    Wire path: mqtt in → function (build payload) → http request → TDengine.

    Test after install:
        mosquitto_pub -h 127.0.0.1 -t '1052os/demo/temp' \\
            -m '{"site":"plant1","device":"plc1","tag":"temp","value":21.5}'
    """
    tab_id = "demo_mqtt_to_td"
    return [
        _tab(tab_id, "demo · mqtt→td",
             "Subscribes to MQTT, writes each message into TDengine via /api/td/insert.\n"
             "Test: mosquitto_pub -h 127.0.0.1 -t 1052os/demo/temp "
             "-m '{\"site\":\"plant1\",\"device\":\"plc1\",\"tag\":\"temp\",\"value\":21.5}'"),
        _broker("demo_broker", broker_host, broker_port),
        _mqtt_in("demo_m1", tab_id, "subscribe 1052os/demo/+", subscribe_topic,
                 "demo_broker", 160, 120, "demo_f1"),
        _function("demo_f1", tab_id,
                  "→ {site,device,tag,value}",
                  "// msg.payload arrives as a Buffer or string on MQTT in.\n"
                  "let raw = (typeof msg.payload === 'string') ? msg.payload : "
                  "(msg.payload && msg.payload.toString ? msg.payload.toString() : '');\n"
                  "let p; try { p = JSON.parse(raw); } "
                  "catch(e) { node.warn('bad json: '+raw); return null; }\n"
                  "// Accept either {site,device,tag,value} or a flat {tag,value}.\n"
                  "msg.payload = {\n"
                  "  site: p.site || 'demo',\n"
                  "  device: p.device || (msg.topic.split('/').pop() || 'mqtt'),\n"
                  "  tag: p.tag || msg.topic.split('/').pop(),\n"
                  "  value: p.value,\n"
                  "};\n"
                  "msg.headers = {'Content-Type': 'application/json'};\n"
                  "return msg;",
                  420, 120, ["demo_h1"]),
        _http_request("demo_h1", tab_id, "POST /api/td/insert",
                      f"{gateway_api_url}/api/td/insert", 720, 120, ["demo_dbg"]),
        _debug("demo_dbg", tab_id, "TDengine ack", 980, 120),
    ]


def dashboard_demo_flow(gateway_api_url: str = "http://127.0.0.1:8765",
                          table: str = "raw_data_demo_sim_temp") -> list[dict]:
    """Poll TDengine and render values on the embedded Node-RED dashboard.

    Requires `node-red-dashboard` installed (gateway does this on first launch).
    Wire path: inject (5s) → http request → function → ui_gauge + ui_chart.

    Open the "DASHBOARD" tab after install to see live values.
    """
    tab_id = "demo_dashboard"
    base_id = "demo_ui_base"
    ui_tab_id = "demo_ui_tab"
    ui_grp_id = "demo_ui_group"
    return [
        _tab(tab_id, "demo · dashboard",
             "Polls TDengine and renders on /ui. Requires node-red-dashboard."),
        _ui_base(base_id),
        _ui_tab(ui_tab_id, "Live", "show_chart"),
        _ui_group(ui_grp_id, ui_tab_id, "TDengine realtime", width=12, height=5),
        _inject("demo_d1", tab_id, "tick (5s)", "5", x=160, y=120, next_id="demo_d2"),
        _http_request("demo_d2", tab_id, "GET last row",
                      f"{gateway_api_url}/api/td/query?table={table}&limit=1",
                      420, 120, next_ids=["demo_d3"], method="GET"),
        _function("demo_d3", tab_id,
                  "→ value",
                  "// gateway returns {ok, data: [{ts, v}]}\n"
                  "let d = (msg.payload && msg.payload.data) ? msg.payload.data : [];\n"
                  "if (!d.length) { return null; }\n"
                  "// ui_gauge / ui_chart both read msg.payload as the value.\n"
                  "msg.payload = d[0].v;\n"
                  "msg.topic = d[0].ts;  // chart can use this for the x-axis\n"
                  "return msg;",
                  720, 120, next_ids=["demo_dg", "demo_dc"]),
        _ui_gauge("demo_dg", ui_grp_id, "Temperature", "Demo gauge",
                   min_v=0, max_v=50, x=980, y=80, tab_id=tab_id, unit="°C"),
        _ui_chart("demo_dc", ui_grp_id, "Live history", "Demo chart",
                   x=980, y=180, tab_id=tab_id),
    ]


def http_to_td_flow(gateway_api_url: str = "http://127.0.0.1:8765") -> list[dict]:
    """HTTP webhook on Node-RED port → TDengine. No broker required.

    Wire path: http in (POST /demo/ingest) → function → http request → http response.

    The http response node is required — without it the incoming request hangs
    waiting for a reply. It returns 202 Accepted with the TDengine ack payload.

    Test after install:
        curl -X POST http://127.0.0.1:1880/demo/ingest \\
            -H 'Content-Type: application/json' \\
            -d '{"site":"webhook","device":"sensor","tag":"temp","value":42.5}'
    """
    tab_id = "demo_http_to_td"
    return [
        _tab(tab_id, "demo · http→td",
             "HTTP webhook on Node-RED port (1880). Writes each POST into TDengine.\n"
             "Test: curl -X POST http://127.0.0.1:1880/demo/ingest "
             "-H 'Content-Type: application/json' "
             "-d '{\"site\":\"webhook\",\"device\":\"sensor\",\"tag\":\"temp\",\"value\":42.5}'"),
        _http_in("demo_w1", tab_id, "POST /demo/ingest", "/demo/ingest", "post",
                 160, 120, "demo_f2"),
        _function("demo_f2", tab_id,
                  "→ {site,device,tag,value}",
                  "// http in gives us req.body as parsed JSON (express-body-parser default).\n"
                  "let p = msg.payload || msg.req.body || {};\n"
                  "msg.payload = {\n"
                  "  site: p.site || 'webhook',\n"
                  "  device: p.device || 'http',\n"
                  "  tag: p.tag || 'unknown',\n"
                  "  value: p.value,\n"
                  "};\n"
                  "msg.headers = {'Content-Type': 'application/json'};\n"
                  "return msg;",
                  420, 120, ["demo_h2"]),
        _http_request("demo_h2", tab_id, "POST /api/td/insert",
                      f"{gateway_api_url}/api/td/insert", 720, 120, ["demo_r1"]),
        _http_response("demo_r1", tab_id, "202 Accepted", 202, 980, 120),
    ]


# ── Registry & merge logic ─────────────────────────────────


DEMOS: dict[str, dict] = {
    "mqtt-to-td": {
        "name": "mqtt-to-td",
        "label": "MQTT → TDengine",
        "tab_label": "demo · mqtt→td",
        "description": (
            "Subscribes to an MQTT broker topic and writes each message into "
            "TDengine. Use this as the template for any sensor that publishes "
            "via MQTT (most industrial IoT gateways do)."
        ),
        "builder": mqtt_to_td_flow,
    },
    "http-to-td": {
        "name": "http-to-td",
        "label": "HTTP webhook → TDengine",
        "tab_label": "demo · http→td",
        "description": (
            "Exposes an HTTP POST endpoint on Node-RED's port (1880) that "
            "writes each request into TDengine. No broker required — useful "
            "for devices that can only POST."
        ),
        "builder": http_to_td_flow,
    },
    "dashboard-demo": {
        "name": "dashboard-demo",
        "label": "Dashboard · 实时 TDengine 仪表",
        "tab_label": "demo · dashboard",
        "description": (
            "Polls the latest value from TDengine every 5s and renders it as "
            "a gauge + line chart on the embedded Node-RED dashboard "
            "(node-red-dashboard). Open the DASHBOARD tab after install."
        ),
        "builder": dashboard_demo_flow,
    },
}


def list_demos() -> list[dict]:
    return [
        {"name": d["name"], "label": d["label"], "description": d["description"]}
        for d in DEMOS.values()
    ]


def build_demo_flow(name: str, **kwargs) -> list[dict]:
    if name not in DEMOS:
        raise KeyError(f"unknown demo: {name}")
    return DEMOS[name]["builder"](**kwargs)


def merge_into_flows(current_flows: list[dict], new_nodes: list[dict]) -> list[dict]:
    """Replace any tab whose label matches one of new_nodes' tabs; otherwise append.

    Idempotent: re-installing a demo overwrites in place rather than duplicating.
    Drops both the matching tab AND every node whose `z` references that tab.
    """
    new_tab_labels = {n.get("label") for n in new_nodes if n.get("type") == "tab"}
    # Find old tab ids that need to be replaced (matched by label).
    old_tab_ids = {n["id"] for n in current_flows
                   if n.get("type") == "tab" and n.get("label") in new_tab_labels}
    out = []
    for n in current_flows:
        if n.get("type") == "tab" and n.get("label") in new_tab_labels:
            continue  # drop the old tab
        if n.get("z") in old_tab_ids:
            continue  # drop every node that belongs to the old tab
        out.append(n)
    out.extend(copy.deepcopy(new_nodes))
    return out


def installed_demos(flows: list[dict]) -> list[str]:
    """Return names of demos whose tab is present in `flows`."""
    present_labels = {n.get("label") for n in flows if n.get("type") == "tab"}
    return [d["name"] for d in DEMOS.values() if d["tab_label"] in present_labels]