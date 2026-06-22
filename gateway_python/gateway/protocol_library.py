"""
1052-OS Industrial Gateway — Node-RED protocol library.

Parameterized, one-click-installable flow templates for common industrial
protocols. Each install creates/replaces one complete Node-RED tab that ends at
POST /api/td/insert, so adding a protocol path does not require Python driver
code changes.
"""
from __future__ import annotations

import copy
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    type: str = "text"
    default: Any = ""
    placeholder: str = ""
    help: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "type": self.type,
            "default": self.default,
            "placeholder": self.placeholder,
            "help": self.help,
        }


@dataclass(frozen=True)
class Protocol:
    name: str
    label: str
    category: str
    description: str
    required_modules: tuple[str, ...]
    param_schema: tuple[Param, ...]
    builder: Callable[..., list[dict[str, Any]]]

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "category": self.category,
            "description": self.description,
            "required_modules": list(self.required_modules),
            "param_schema": [p.as_dict() for p in self.param_schema],
        }


def _tab(tab_id: str, label: str, info: str) -> dict[str, Any]:
    return {"id": tab_id, "type": "tab", "label": label, "disabled": False, "info": info}


def _function(
    node_id: str,
    tab_id: str,
    name: str,
    func: str,
    x: int,
    y: int,
    targets: list[str],
) -> dict[str, Any]:
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
        "x": x,
        "y": y,
        "wires": [targets],
    }


def _http_request(
    node_id: str,
    tab_id: str,
    name: str,
    url: str,
    x: int,
    y: int,
    targets: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "http request",
        "z": tab_id,
        "name": name,
        "method": "POST",
        "ret": "obj",
        "paytoqs": "ignore",
        "url": url,
        "tls": "",
        "persist": False,
        "proxy": "",
        "authType": "",
        "headers": [],
        "x": x,
        "y": y,
        "wires": [targets or []],
    }


def _debug(node_id: str, tab_id: str, name: str, x: int, y: int) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "debug",
        "z": tab_id,
        "name": name,
        "active": True,
        "tosidebar": True,
        "console": False,
        "tostatus": False,
        "complete": "payload",
        "targetType": "msg",
        "statusVal": "",
        "statusType": "auto",
        "x": x,
        "y": y,
        "wires": [],
    }


def _to_td_func(device: str, tag: str, value_expr: str = "msg.payload") -> str:
    return (
        "const value = " + value_expr + ";\n"
        "msg.headers = {'Content-Type': 'application/json'};\n"
        "msg.payload = {\n"
        "  site: 'default',\n"
        f"  device: {json.dumps(device)},\n"
        f"  tag: {json.dumps(tag)},\n"
        "  value: Array.isArray(value) ? value[0] : value,\n"
        "  ts: new Date().toISOString(),\n"
        "};\n"
        "return msg;"
    )


def _gateway_url(gateway_api_url: str) -> str:
    return f"{gateway_api_url.rstrip('/')}/api/td/insert"


def _replace_strings(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, str):
        out = value
        for old, new in replacements.items():
            out = out.replace(old, str(new))
        return out
    if isinstance(value, list):
        return [_replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_strings(item, replacements) for key, item in value.items()}
    return value


def _load_docs_flow(filename: str, protocol_name: str, replacements: dict[str, str] | None = None) -> list[dict[str, Any]]:
    docs_dir = Path(__file__).resolve().parents[2] / "docs"
    with (docs_dir / filename).open(encoding="utf-8") as f:
        nodes = json.load(f)
    out = _replace_strings(copy.deepcopy(nodes), replacements or {})
    for node in out:
        if node.get("type") == "tab":
            node["label"] = f"protocol · {protocol_name}"
            break
    return out


def build_hj212_2017_flow(
    mn: str = "88888880000001",
    pw: str = "123456",
    st: str = "31",
    base_url: str = "http://127.0.0.1:5905",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    del gateway_api_url
    return _load_docs_flow(
        "hj212-nodered-flow.json",
        "hj212-2017",
        {
            "88888880000001": mn,
            "123456": pw,
            "flow.set('hj212_st', '31')": f"flow.set('hj212_st', {json.dumps(str(st))})",
            "http://127.0.0.1:5905": base_url,
        },
    )


def build_hj212_2025_flow(
    mn: str = "010000A8900016F000169DC0",
    pw: str = "123456",
    base_url: str = "http://127.0.0.1:5906",
    sm4_key: str = "0123456789abcdeffedcba9876543210",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    del gateway_api_url
    return _load_docs_flow(
        "hj212-2025-nodered-flow.json",
        "hj212-2025",
        {
            "010000A8900016F000169DC0": mn,
            "123456": pw,
            "http://127.0.0.1:5906": base_url,
            "0123456789abcdeffedcba9876543210": sm4_key,
        },
    )


def build_data_integration_flow(
    qyid: str = "588A7E39-4B56-486F-8430-C07705053259",
    base_url: str = "http://127.0.0.1:5904/web_service/ws/cz_alarm",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    del gateway_api_url
    return _load_docs_flow(
        "data-integration-nodered-flow.json",
        "data-integration",
        {
            "588A7E39-4B56-486F-8430-C07705053259": qyid,
            "http://127.0.0.1:5904/web_service/ws/cz_alarm": base_url,
        },
    )


def build_1052_debug_dashboard_flow(gateway_api_url: str = "http://127.0.0.1:8765") -> list[dict[str, Any]]:
    del gateway_api_url
    return _load_docs_flow("1052-debug-dashboard-flow.json", "1052-debug-dashboard")


def build_modbus_tcp_hr_flow(
    host: str = "192.168.1.10",
    port: int = 502,
    unit_id: int = 1,
    address: int = 0,
    quantity: int = 1,
    device: str = "plc1",
    tag: str = "hr40001",
    interval_ms: int = 5000,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_modbus_tcp_hr"
    client_id = "proto_modbus_tcp_client"
    read_id = "proto_modbus_tcp_read"
    fn_id = "proto_modbus_tcp_shape"
    http_id = "proto_modbus_tcp_post"
    dbg_id = "proto_modbus_tcp_debug"
    return [
        _tab(tab_id, "protocol · modbus-tcp-hr", "Modbus TCP holding-register read → /api/td/insert."),
        {
            "id": client_id,
            "type": "modbus-client",
            "name": f"{host}:{port} unit {unit_id}",
            "clientType": "tcp",
            "host": host,
            "port": str(port),
            "unit_id": str(unit_id),
            "commandDelay": "1",
            "reconnectTimeout": "4000",
            "delayOnConnect": "100",
            "queueUnitIdLength": 100,
            "queueInterval": 200,
            "tcpType": "DEFAULT",
        },
        {
            "id": read_id,
            "type": "modbus-read",
            "z": tab_id,
            "name": f"HR[{address}..{address + quantity - 1}]",
            "topic": "",
            "dataType": "HoldingRegister",
            "adr": str(address),
            "quantity": str(quantity),
            "rate": str(interval_ms),
            "rateUnit": "ms",
            "server": client_id,
            "ieee754": False,
            "ieeeType": "off",
            "emptyMsgOnFail": False,
            "x": 170,
            "y": 120,
            "wires": [[fn_id], []],
        },
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload?.data ?? msg.payload"), 390, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 620, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 820, 120),
    ]


def build_mqtt_subscribe_flow(
    broker_host: str = "127.0.0.1",
    broker_port: int = 1883,
    topic: str = "sensors/+/value",
    device: str = "mqtt_device",
    tag: str = "value",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_mqtt_subscribe"
    broker_id = "proto_mqtt_broker"
    in_id = "proto_mqtt_in"
    fn_id = "proto_mqtt_shape"
    http_id = "proto_mqtt_post"
    dbg_id = "proto_mqtt_debug"
    return [
        _tab(tab_id, "protocol · mqtt-subscribe", "MQTT subscribe → /api/td/insert."),
        {
            "id": broker_id,
            "type": "mqtt-broker",
            "name": f"{broker_host}:{broker_port}",
            "broker": broker_host,
            "port": str(broker_port),
            "clientid": "",
            "autoConnect": True,
            "usetls": False,
            "protocolVersion": "4",
            "keepalive": "60",
            "cleansession": True,
        },
        {
            "id": in_id,
            "type": "mqtt in",
            "z": tab_id,
            "name": topic,
            "topic": topic,
            "qos": "0",
            "datatype": "auto",
            "broker": broker_id,
            "nl": False,
            "rap": True,
            "rh": 0,
            "inputs": 0,
            "x": 150,
            "y": 120,
            "wires": [[fn_id]],
        },
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload"), 370, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 600, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 800, 120),
    ]


def build_http_webhook_flow(
    path: str = "/1052os/ingest",
    device: str = "http_device",
    tag: str = "value",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_http_webhook"
    in_id = "proto_http_in"
    fn_id = "proto_http_shape"
    post_id = "proto_http_post"
    resp_id = "proto_http_response"
    dbg_id = "proto_http_debug"
    return [
        _tab(tab_id, "protocol · http-webhook", "HTTP webhook → /api/td/insert."),
        {"id": in_id, "type": "http in", "z": tab_id, "name": f"POST {path}", "url": path, "method": "post", "upload": False, "swaggerDoc": "", "x": 140, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload?.value ?? msg.payload"), 360, 120, [post_id]),
        _http_request(post_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 590, 120, [resp_id, dbg_id]),
        {"id": resp_id, "type": "http response", "z": tab_id, "name": "200", "statusCode": "200", "headers": {}, "x": 810, "y": 100, "wires": []},
        _debug(dbg_id, tab_id, "td result", 810, 150),
    ]


def build_opcua_read_flow(
    endpoint: str = "opc.tcp://127.0.0.1:4840",
    node_id: str = "ns=2;s=Device1.Temperature",
    device: str = "opcua_device",
    tag: str = "temperature",
    interval_ms: int = 5000,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_opcua_read"
    inj_id = "proto_opcua_tick"
    item_id = "proto_opcua_item"
    client_id = "proto_opcua_client"
    fn_id = "proto_opcua_shape"
    http_id = "proto_opcua_post"
    dbg_id = "proto_opcua_debug"
    return [
        _tab(tab_id, "protocol · opcua-read", "OPC UA read → /api/td/insert."),
        {"id": inj_id, "type": "inject", "z": tab_id, "name": "poll", "props": [{"p": "payload"}], "repeat": str(interval_ms / 1000), "crontab": "", "once": True, "onceDelay": "0.5", "topic": "", "payload": "", "payloadType": "date", "x": 120, "y": 120, "wires": [[item_id]]},
        {"id": item_id, "type": "OpcUa-Item", "z": tab_id, "item": node_id, "datatype": "Double", "value": "", "name": node_id, "x": 310, "y": 120, "wires": [[client_id]]},
        {"id": client_id, "type": "OpcUa-Client", "z": tab_id, "endpoint": endpoint, "action": "read", "deadbandtype": "a", "deadbandvalue": 1, "time": 10, "timeUnit": "s", "certificate": "n", "localfile": "", "localkeyfile": "", "securitymode": "None", "securitypolicy": "None", "name": endpoint, "x": 530, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload?.value ?? msg.payload"), 760, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 990, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 1190, 120),
    ]


def build_s7_read_flow(
    endpoint: str = "192.168.1.10",
    variable: str = "DB1,REAL0",
    device: str = "s7_device",
    tag: str = "db1_real0",
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_s7_read"
    endpoint_id = "proto_s7_endpoint"
    in_id = "proto_s7_in"
    fn_id = "proto_s7_shape"
    http_id = "proto_s7_post"
    dbg_id = "proto_s7_debug"
    return [
        _tab(tab_id, "protocol · s7-read", "Siemens S7 read → /api/td/insert."),
        {"id": endpoint_id, "type": "s7 endpoint", "transport": "iso-on-tcp", "address": endpoint, "port": "102", "rack": "0", "slot": "2", "localtsaphi": "01", "localtsaplo": "00", "remotetsaphi": "01", "remotetsaplo": "00", "connmode": "rack-slot", "adapter": "", "busaddr": "2", "cycletime": "1000", "timeout": "2000", "name": endpoint, "vartable": [{"addr": variable, "name": tag}]},
        {"id": in_id, "type": "s7 in", "z": tab_id, "endpoint": endpoint_id, "mode": "single", "variable": tag, "diff": True, "name": tag, "x": 150, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload"), 370, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 600, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 800, 120),
    ]


def build_dlt645_2007_flow(
    serial_port: str = "/dev/ttyUSB0",
    baud_rate: int = 2400,
    meter_address: str = "000000000001",
    data_id: str = "00010000",
    device: str = "electric_meter_1",
    tag: str = "forward_active_energy",
    interval_ms: int = 15000,
    scale: float = 0.01,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_dlt645_2007"
    serial_id = "proto_dlt645_serial"
    tick_id = "proto_dlt645_tick"
    make_id = "proto_dlt645_make"
    req_id = "proto_dlt645_request"
    parse_id = "proto_dlt645_parse"
    http_id = "proto_dlt645_post"
    dbg_id = "proto_dlt645_debug"
    make_func = f"""const meterAddress = {json.dumps(meter_address)}.replace(/\\s/g, '').padStart(12, '0');
const dataId = {json.dumps(data_id)}.replace(/\\s/g, '').padStart(8, '0');
function bytesFromHex(hex) {{
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}}
function reversePairs(hex) {{ return bytesFromHex(hex).reverse(); }}
const addr = reversePairs(meterAddress);
const di = reversePairs(dataId).map(b => (b + 0x33) & 0xff);
const frame = [0x68, ...addr, 0x68, 0x11, 0x04, ...di];
const cs = frame.reduce((acc, b) => (acc + b) & 0xff, 0);
msg.payload = Buffer.from([...frame, cs, 0x16]);
msg.dlt645 = {{ meterAddress, dataId: dataId.toUpperCase() }};
node.status({{fill:'blue', shape:'dot', text:`read ${{dataId.toUpperCase()}} @ ${{meterAddress}}`}});
return msg;"""
    parse_func = f"""const buf = Buffer.isBuffer(msg.payload) ? msg.payload : Buffer.from(msg.payload || []);
let start = -1;
for (let i = 0; i < buf.length - 7; i++) {{
  if (buf[i] === 0x68 && buf[i + 7] === 0x68) {{ start = i; break; }}
}}
if (start < 0 || buf[buf.length - 1] !== 0x16) {{
  node.status({{fill:'red', shape:'ring', text:'invalid frame'}});
  return null;
}}
const len = buf[start + 9];
const dataStart = start + 10;
const dataEnd = dataStart + len;
const checksumEnd = dataEnd;
const cs = Array.from(buf.slice(start, checksumEnd)).reduce((acc, b) => (acc + b) & 0xff, 0);
if (cs !== buf[checksumEnd]) {{
  node.status({{fill:'red', shape:'ring', text:'checksum error'}});
  return null;
}}
const data = Array.from(buf.slice(dataStart, dataEnd)).map(b => (b - 0x33 + 256) & 0xff);
const di = data.slice(0, 4).reverse().map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const valueBytes = data.slice(4).reverse();
const bcd = valueBytes.map(b => b.toString(16).padStart(2, '0')).join('');
const rawValue = bcd ? Number(bcd) : null;
if (rawValue === null || Number.isNaN(rawValue)) {{
  node.status({{fill:'yellow', shape:'ring', text:`${{di}} no numeric value`}});
  return null;
}}
const value = rawValue * {float(scale)!r};
msg.headers = {{'Content-Type': 'application/json'}};
msg.payload = {{
  site: 'default',
  device: {json.dumps(device)},
  tag: {json.dumps(tag)},
  value,
  ts: new Date().toISOString(),
  dtype: 'DOUBLE',
}};
msg.dlt645 = {{ di, rawValue, value }};
node.status({{fill:'green', shape:'dot', text:`${{di}}=${{value}}`}});
return msg;"""
    return [
        _tab(tab_id, "protocol · dlt645-2007", "DL/T645-2007 electricity meter read → /api/td/insert."),
        {"id": serial_id, "type": "serial-port", "name": serial_port, "serialport": serial_port, "serialbaud": str(baud_rate), "databits": "8", "parity": "none", "stopbits": "1", "waitfor": "", "dtr": "none", "rts": "none", "cts": "none", "dsr": "none", "newline": "", "bin": "bin", "out": "time", "addchar": "", "responsetimeout": "1000"},
        {"id": tick_id, "type": "inject", "z": tab_id, "name": "poll meter", "props": [{"p": "payload"}], "repeat": str(interval_ms / 1000), "crontab": "", "once": True, "onceDelay": "1", "topic": "", "payload": "", "payloadType": "date", "x": 130, "y": 120, "wires": [[make_id]]},
        _function(make_id, tab_id, "组帧 DL/T645 读数据", make_func, 350, 120, [req_id]),
        {"id": req_id, "type": "serial request", "z": tab_id, "name": f"DL/T645 {meter_address}", "serial": serial_id, "x": 590, "y": 120, "wires": [[parse_id]]},
        _function(parse_id, tab_id, "解析 DL/T645 响应", parse_func, 820, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 1050, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 1260, 120),
    ]


def build_ethernet_ip_tag_flow(
    host: str = "192.168.1.10",
    tag_name: str = "Program:MainProgram.Temperature",
    device: str = "ab_plc_1",
    tag: str = "temperature",
    interval_ms: int = 1000,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_ethernet_ip_tag"
    endpoint_id = "proto_eip_endpoint"
    read_id = "proto_eip_read"
    fn_id = "proto_eip_shape"
    http_id = "proto_eip_post"
    dbg_id = "proto_eip_debug"
    return [
        _tab(tab_id, "protocol · ethernet-ip-tag", "EtherNet/IP tag read → /api/td/insert."),
        {"id": endpoint_id, "type": "eth-ip endpoint", "address": host, "slot": "0", "cycletime": str(interval_ms), "timeout": "10000", "name": host},
        {"id": read_id, "type": "eth-ip in", "z": tab_id, "endpoint": endpoint_id, "mode": "single", "variable": tag_name, "program": "", "name": tag_name, "x": 170, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "msg.payload?.value ?? msg.payload"), 420, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 650, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 850, 120),
    ]


def build_mitsubishi_mc_read_flow(
    host: str = "192.168.1.20",
    port: int = 5000,
    address: str = "D100",
    points: int = 1,
    device: str = "mitsubishi_plc_1",
    tag: str = "d100",
    interval_ms: int = 1000,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_mitsubishi_mc_read"
    endpoint_id = "proto_mc_endpoint"
    tick_id = "proto_mc_tick"
    req_id = "proto_mc_request"
    fn_id = "proto_mc_shape"
    http_id = "proto_mc_post"
    dbg_id = "proto_mc_debug"
    request_func = f"""msg.payload = {{
  host: {json.dumps(host)},
  port: {int(port)},
  address: {json.dumps(address)},
  points: {int(points)},
  command: 'read',
}};
return msg;"""
    return [
        _tab(tab_id, "protocol · mitsubishi-mc-read", "Mitsubishi MC protocol read → /api/td/insert."),
        {"id": endpoint_id, "type": "mcprotocol connection", "name": f"{host}:{port}", "host": host, "port": str(port), "protocol": "TCP", "frame": "3E", "plcType": "Q", "ascii": False, "timeout": "1000"},
        {"id": tick_id, "type": "inject", "z": tab_id, "name": "poll", "props": [{"p": "payload"}], "repeat": str(interval_ms / 1000), "crontab": "", "once": True, "onceDelay": "1", "topic": "", "payload": "", "payloadType": "date", "x": 130, "y": 120, "wires": [[req_id]]},
        _function(req_id, tab_id, "MC read request", request_func, 330, 120, [endpoint_id]),
        {"id": endpoint_id + "_node", "type": "mcprotocol read", "z": tab_id, "connection": endpoint_id, "address": address, "points": str(points), "name": address, "x": 550, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "Array.isArray(msg.payload) ? msg.payload[0] : msg.payload"), 780, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 1010, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 1210, 120),
    ]


def build_omron_fins_read_flow(
    host: str = "192.168.1.30",
    port: int = 9600,
    area: str = "D",
    address: int = 100,
    count: int = 1,
    device: str = "omron_plc_1",
    tag: str = "d100",
    interval_ms: int = 1000,
    gateway_api_url: str = "http://127.0.0.1:8765",
) -> list[dict[str, Any]]:
    tab_id = "proto_omron_fins_read"
    endpoint_id = "proto_fins_endpoint"
    tick_id = "proto_fins_tick"
    read_id = "proto_fins_read"
    fn_id = "proto_fins_shape"
    http_id = "proto_fins_post"
    dbg_id = "proto_fins_debug"
    return [
        _tab(tab_id, "protocol · omron-fins-read", "Omron FINS read → /api/td/insert."),
        {"id": endpoint_id, "type": "fins-connection", "name": f"{host}:{port}", "host": host, "port": str(port), "protocol": "udp", "SA1": "1", "DA1": "0", "DNA": "0", "SNA": "0", "timeout": "1000"},
        {"id": tick_id, "type": "inject", "z": tab_id, "name": "poll", "props": [{"p": "payload"}], "repeat": str(interval_ms / 1000), "crontab": "", "once": True, "onceDelay": "1", "topic": "", "payload": "", "payloadType": "date", "x": 130, "y": 120, "wires": [[read_id]]},
        {"id": read_id, "type": "fins-read", "z": tab_id, "connection": endpoint_id, "addressType": area, "address": str(address), "count": str(count), "name": f"{area}{address}", "x": 350, "y": 120, "wires": [[fn_id]]},
        _function(fn_id, tab_id, "→ td insert body", _to_td_func(device, tag, "Array.isArray(msg.payload) ? msg.payload[0] : msg.payload"), 580, 120, [http_id]),
        _http_request(http_id, tab_id, "POST /api/td/insert", _gateway_url(gateway_api_url), 810, 120, [dbg_id]),
        _debug(dbg_id, tab_id, "td result", 1010, 120),
    ]


PROTOCOLS: dict[str, Protocol] = {
    "modbus-tcp-hr": Protocol(
        name="modbus-tcp-hr",
        label="Modbus TCP · Holding Register",
        category="modbus",
        description="周期读取 Modbus TCP Holding Register,写入 /api/td/insert。",
        required_modules=("node-red-contrib-modbus",),
        param_schema=(
            Param("host", "PLC IP", default="192.168.1.10"),
            Param("port", "TCP Port", "number", 502),
            Param("unit_id", "Unit ID", "number", 1),
            Param("address", "Start Address", "number", 0, help="0 = 40001"),
            Param("quantity", "Quantity", "number", 1),
            Param("interval_ms", "Poll Interval ms", "number", 5000),
            Param("device", "Device", default="plc1"),
            Param("tag", "Tag", default="hr40001"),
        ),
        builder=build_modbus_tcp_hr_flow,
    ),
    "mqtt-subscribe": Protocol(
        name="mqtt-subscribe",
        label="MQTT · Subscribe",
        category="iot",
        description="订阅 MQTT topic,将 payload 写入 /api/td/insert。",
        required_modules=(),
        param_schema=(
            Param("broker_host", "Broker Host", default="127.0.0.1"),
            Param("broker_port", "Broker Port", "number", 1883),
            Param("topic", "Topic", default="sensors/+/value"),
            Param("device", "Device", default="mqtt_device"),
            Param("tag", "Tag", default="value"),
        ),
        builder=build_mqtt_subscribe_flow,
    ),
    "http-webhook": Protocol(
        name="http-webhook",
        label="HTTP · Webhook",
        category="iot",
        description="在 Node-RED 暴露 HTTP POST 入口,收到数据后写入 /api/td/insert。",
        required_modules=(),
        param_schema=(
            Param("path", "Webhook Path", default="/1052os/ingest"),
            Param("device", "Device", default="http_device"),
            Param("tag", "Tag", default="value"),
        ),
        builder=build_http_webhook_flow,
    ),
    "opcua-read": Protocol(
        name="opcua-read",
        label="OPC UA · Read",
        category="plc",
        description="按周期读取 OPC UA NodeId,写入 /api/td/insert。",
        required_modules=("node-red-contrib-opcua",),
        param_schema=(
            Param("endpoint", "Endpoint", default="opc.tcp://127.0.0.1:4840"),
            Param("node_id", "NodeId", default="ns=2;s=Device1.Temperature"),
            Param("interval_ms", "Poll Interval ms", "number", 5000),
            Param("device", "Device", default="opcua_device"),
            Param("tag", "Tag", default="temperature"),
        ),
        builder=build_opcua_read_flow,
    ),
    "s7-read": Protocol(
        name="s7-read",
        label="Siemens S7 · Read",
        category="plc",
        description="读取 S7 变量表中的一个变量,写入 /api/td/insert。",
        required_modules=("node-red-contrib-s7",),
        param_schema=(
            Param("endpoint", "PLC IP", default="192.168.1.10"),
            Param("variable", "S7 Address", default="DB1,REAL0"),
            Param("device", "Device", default="s7_device"),
            Param("tag", "Variable Name", default="db1_real0"),
        ),
        builder=build_s7_read_flow,
    ),
    "dlt645-2007": Protocol(
        name="dlt645-2007",
        label="DL/T645-2007 · 电表采集",
        category="power",
        description="通过串口/RS485 轮询 DL/T645-2007 电表数据标识，解析 BCD 数据后写入 /api/td/insert。",
        required_modules=("node-red-node-serialport",),
        param_schema=(
            Param("serial_port", "串口", default="/dev/ttyUSB0"),
            Param("baud_rate", "波特率", "number", 2400),
            Param("meter_address", "表地址", default="000000000001", help="12 位表地址，组帧时自动低位在前"),
            Param("data_id", "数据标识 DI", default="00010000", help="如 00010000=当前正向有功总电能"),
            Param("interval_ms", "轮询周期 ms", "number", 15000),
            Param("scale", "缩放系数", "number", 0.01),
            Param("device", "Device", default="electric_meter_1"),
            Param("tag", "Tag", default="forward_active_energy"),
        ),
        builder=build_dlt645_2007_flow,
    ),
    "ethernet-ip-tag": Protocol(
        name="ethernet-ip-tag",
        label="EtherNet/IP · AB/罗克韦尔标签采集",
        category="plc",
        description="读取 EtherNet/IP/CIP 标签值，适合 Allen-Bradley/罗克韦尔 PLC。",
        required_modules=("node-red-contrib-cip-ethernet-ip",),
        param_schema=(
            Param("host", "PLC IP", default="192.168.1.10"),
            Param("tag_name", "PLC Tag", default="Program:MainProgram.Temperature"),
            Param("interval_ms", "轮询周期 ms", "number", 1000),
            Param("device", "Device", default="ab_plc_1"),
            Param("tag", "1052 Tag", default="temperature"),
        ),
        builder=build_ethernet_ip_tag_flow,
    ),
    "mitsubishi-mc-read": Protocol(
        name="mitsubishi-mc-read",
        label="三菱 MC · 寄存器读取",
        category="plc",
        description="通过 Mitsubishi MC/SLMP 协议读取 D/M/R 等软元件，写入 /api/td/insert。",
        required_modules=("node-red-contrib-mcprotocol",),
        param_schema=(
            Param("host", "PLC IP", default="192.168.1.20"),
            Param("port", "TCP Port", "number", 5000),
            Param("address", "软元件地址", default="D100"),
            Param("points", "点数", "number", 1),
            Param("interval_ms", "轮询周期 ms", "number", 1000),
            Param("device", "Device", default="mitsubishi_plc_1"),
            Param("tag", "1052 Tag", default="d100"),
        ),
        builder=build_mitsubishi_mc_read_flow,
    ),
    "omron-fins-read": Protocol(
        name="omron-fins-read",
        label="欧姆龙 FINS · DM/CIO 读取",
        category="plc",
        description="通过 Omron FINS UDP 读取 DM/CIO 等存储区，写入 /api/td/insert。",
        required_modules=("node-red-contrib-omron-fins",),
        param_schema=(
            Param("host", "PLC IP", default="192.168.1.30"),
            Param("port", "UDP Port", "number", 9600),
            Param("area", "存储区", default="D", help="如 D=DM, C=CIO，按节点库实际字段调整"),
            Param("address", "地址", "number", 100),
            Param("count", "点数", "number", 1),
            Param("interval_ms", "轮询周期 ms", "number", 1000),
            Param("device", "Device", default="omron_plc_1"),
            Param("tag", "1052 Tag", default="d100"),
        ),
        builder=build_omron_fins_read_flow,
    ),
    "hj212-2017": Protocol(
        name="hj212-2017",
        label="HJ212-2017 · 环保上传仿真",
        category="environment",
        description="HJ212-2017 报文生成、CRC 校验、实时/分钟数据上传 mock 平台。",
        required_modules=(),
        param_schema=(
            Param("mn", "MN", default="88888880000001"),
            Param("pw", "PW", default="123456"),
            Param("st", "ST", default="31", help="31=废气,32=废水,39=扬尘等"),
            Param("base_url", "Mock/Base URL", default="http://127.0.0.1:5905"),
        ),
        builder=build_hj212_2017_flow,
    ),
    "hj212-2025": Protocol(
        name="hj212-2025",
        label="HJ212-2025 · 强制新版仿真",
        category="environment",
        description="HJ212-2025 新版：用电监控、关键工况、VOC 原始数据、现场机信息、SM4 通道仿真。",
        required_modules=(),
        param_schema=(
            Param("mn", "MN", default="010000A8900016F000169DC0"),
            Param("pw", "PW", default="123456"),
            Param("base_url", "Mock/Base URL", default="http://127.0.0.1:5906"),
            Param("sm4_key", "SM4 Key", default="0123456789abcdeffedcba9876543210"),
        ),
        builder=build_hj212_2025_flow,
    ),
    "data-integration": Protocol(
        name="data-integration",
        label="数据对接接口 · 报警/参数仿真",
        category="http",
        description="按数据对接接口.docx 生成报警和实时参数 JSON 数组并推送 mock 平台。",
        required_modules=(),
        param_schema=(
            Param("qyid", "企业 QYID", default="588A7E39-4B56-486F-8430-C07705053259"),
            Param("base_url", "接口 Base URL", default="http://127.0.0.1:5904/web_service/ws/cz_alarm"),
        ),
        builder=build_data_integration_flow,
    ),
    "1052-debug-dashboard": Protocol(
        name="1052-debug-dashboard",
        label="1052 Debug Dashboard · 综合联调页",
        category="dashboard",
        description="安装 FlowFuse Dashboard 2 页面 /dashboard/1052-debug，在 1052 前端 DASHBOARD tab 内嵌显示。",
        required_modules=("@flowfuse/node-red-dashboard",),
        param_schema=(),
        builder=build_1052_debug_dashboard_flow,
    ),
}


def list_protocols() -> list[dict[str, Any]]:
    return [p.as_dict() for p in PROTOCOLS.values()]


def _apply_param_defaults(protocol: Protocol, params: dict[str, Any]) -> dict[str, Any]:
    out = {p.key: p.default for p in protocol.param_schema}
    allowed = set(out)
    out.update({k: v for k, v in params.items() if k in allowed})
    return out


def build_protocol_flow(name: str, **params: Any) -> list[dict[str, Any]]:
    if name not in PROTOCOLS:
        raise KeyError(f"unknown protocol: {name}")
    protocol = PROTOCOLS[name]
    merged = _apply_param_defaults(protocol, params)
    return protocol.builder(**merged)


def merge_into_flows(current_flows: list[dict[str, Any]], new_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    new_tab_labels = {n.get("label") for n in new_nodes if n.get("type") == "tab"}
    old_tab_ids = {n["id"] for n in current_flows if n.get("type") == "tab" and n.get("label") in new_tab_labels}
    old_config_ids = {n["id"] for n in current_flows if n.get("z") is None and n.get("type") != "tab" and n.get("id", "").startswith("proto_")}
    new_config_ids = {n["id"] for n in new_nodes if n.get("z") is None and n.get("type") != "tab"}

    out = []
    for node in current_flows:
        if node.get("type") == "tab" and node.get("label") in new_tab_labels:
            continue
        if node.get("z") in old_tab_ids:
            continue
        if node.get("id") in old_config_ids & new_config_ids:
            continue
        out.append(node)
    out.extend(copy.deepcopy(new_nodes))
    return out


def installed_protocols(flows: list[dict[str, Any]]) -> list[str]:
    present_labels = {n.get("label") for n in flows if n.get("type") == "tab"}
    return [p.name for p in PROTOCOLS.values() if f"protocol · {p.name}" in present_labels]


def _module_installed(module: str, user_dir: str | Path | None = None) -> bool:
    candidates = []
    if user_dir is not None:
        candidates.append(Path(user_dir) / "node_modules" / module)
    candidates.append(Path.home() / ".node-red" / "node_modules" / module)
    if any(path.exists() for path in candidates):
        return True
    try:
        subprocess.run(
            ["npm", "list", "-g", module, "--depth=0"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def list_missing_modules(name: str, user_dir: str | Path | None = None) -> list[str]:
    if name not in PROTOCOLS:
        raise KeyError(f"unknown protocol: {name}")
    return [m for m in PROTOCOLS[name].required_modules if not _module_installed(m, user_dir)]
