"""
1052-OS Industrial Gateway — REST API Server
Exposes Modbus / OPC UA / MQTT via HTTP for the 1052-OS frontend.
"""

from contextlib import asynccontextmanager
from typing import Any
import json

import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from gateway.modbus_client import ModbusClient, ModbusConfig, ModbusMode
from gateway.opcua_client import OpcuaClientWrapper, OpcuaConfig
from gateway.mqtt_client import MqttClientWrapper, MqttConfig
from gateway.tdengine_client import TdClient, TdConfig
from gateway.collector import DataCollector, CollectTask
from gateway.modbus_decoder import dtype_catalog, endian_catalog, DTYPES, ENDIANS

from gateway.nodered_tags import build_tag_catalog
from gateway.nodered_flows import build_flows_json
from gateway.mqtt_publisher import MqttPublisher, MqttPublisherConfig
from gateway.status_heartbeat import StatusHeartbeat
from gateway.command_handler import CommandHandler
from gateway.write_audit import WriteAuditLogger
from gateway.dashboard_flows import build_dashboard_flows

from gateway.anomaly import AnomalyEngine, ChannelConfig, Anomaly
from datetime import datetime, timezone

from gateway.predictor import TrendPredictor

from gateway.reporter import ReportGenerator

# ── Global state ───────────────────────────────────────

_modbus: ModbusClient | None = None
_mb_config: ModbusConfig = ModbusConfig()

_opcua: OpcuaClientWrapper | None = None
_ua_config: OpcuaConfig = OpcuaConfig()

_mqtt: MqttClientWrapper | None = None
_mq_config: MqttConfig = MqttConfig()

_td: TdClient | None = None
_td_config: TdConfig = TdConfig()
_collector: DataCollector | None = None
_anomaly: AnomalyEngine | None = None
_predictor: TrendPredictor | None = None
_reporter: ReportGenerator | None = None
_mqtt_publisher: MqttPublisher | None = None
_heartbeat: StatusHeartbeat | None = None
_command_handler: CommandHandler | None = None
_audit_logger: WriteAuditLogger | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if _modbus and _modbus.connected:
        _modbus.disconnect()
    if _opcua:
        await _opcua.disconnect()
    if _mqtt:
        _mqtt.disconnect()
    if _td:
        _td.close()
    if _collector:
        _collector.stop_all()
    if _mqtt_publisher:
        _mqtt_publisher.stop()
    if _heartbeat:
        _heartbeat.stop()


app = FastAPI(title="1052-OS Industrial Gateway", version="0.4.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════
#  MODELS
# ═══════════════════════════════════════════════════════

class ModbusConfigIn(BaseModel):
    mode: str = "tcp"
    host: str = "127.0.0.1"
    port: int = 502
    serial_port: str = "/dev/ttyUSB0"
    baudrate: int = 9600
    parity: str = "N"
    stopbits: int = 1
    bytesize: int = 8
    unit_id: int = 1
    timeout: float = 3.0


class ReadRequest(BaseModel):
    address: int
    count: int = 1


class WriteCoilRequest(BaseModel):
    address: int
    value: bool


class WriteRegisterRequest(BaseModel):
    address: int
    value: int = 0
    values: list[int] | None = None


class WriteCoilsRequest(BaseModel):
    address: int
    values: list[bool]


class Float32Request(BaseModel):
    address: int
    value: float | None = None


class ScanRequest(BaseModel):
    start: int = 0
    count: int = 10


class OpcuaConfigIn(BaseModel):
    url: str = "opc.tcp://127.0.0.1:4840"
    timeout: float = 5.0
    username: str | None = None
    password: str | None = None


class OpcuaReadNodes(BaseModel):
    node_ids: list[str]


class OpcuaWriteNode(BaseModel):
    node_id: str
    value: Any


class OpcuaBrowseRequest(BaseModel):
    node_id: str | None = None
    depth: int = 2


class MqttConfigIn(BaseModel):
    host: str = "127.0.0.1"
    port: int = 1883
    client_id: str = ""
    username: str | None = None
    password: str | None = None
    keepalive: int = 60
    topic_prefix: str = "1052os"


class MqttPublish(BaseModel):
    topic: str
    payload: str
    qos: int = 0
    retain: bool = False


class MqttSubscribe(BaseModel):
    topic: str
    qos: int = 0


# ═══════════════════════════════════════════════════════
#  MODBUS
# ═══════════════════════════════════════════════════════

@app.get("/api/modbus/config")
def modbus_get_config():
    return _mb_config.to_dict()

@app.post("/api/modbus/config")
def modbus_set_config(body: ModbusConfigIn):
    global _mb_config
    _mb_config = ModbusConfig.from_dict(body.model_dump())
    return {"ok": True, "config": _mb_config.to_dict()}

@app.post("/api/modbus/connect")
def modbus_connect():
    global _modbus
    _modbus = ModbusClient(_mb_config)
    if not _modbus.connect():
        _modbus = None
        raise HTTPException(503, "Modbus connection failed")
    return {"ok": True, "message": f"Connected to {_mb_config.host}:{_mb_config.port}"}

@app.post("/api/modbus/disconnect")
def modbus_disconnect():
    global _modbus
    if _modbus: _modbus.disconnect(); _modbus = None
    return {"ok": True}

@app.get("/api/modbus/status")
def modbus_status():
    return {"ok": True, "connected": bool(_modbus and _modbus.connected), "config": _mb_config.to_dict()}

@app.get("/api/modbus/ping")
def modbus_ping():
    if not _modbus: return {"ok": False, "message": "Not connected"}
    return _modbus.ping()

@app.get("/api/modbus/types")
def modbus_types():
    """Static catalog of supported data types and endians (for UI reference)."""
    return {
        "ok": True,
        "dtypes": list(DTYPES),
        "endians": list(ENDIANS),
        "dtype_catalog": dtype_catalog(),
        "endian_catalog": endian_catalog(),
    }

@app.post("/api/modbus/read/coils")
def modbus_read_coils(body: ReadRequest):
    return _modbus_call(lambda: {"ok": True, "values": _modbus.read_coils(body.address, body.count)})

@app.post("/api/modbus/read/discrete-inputs")
def modbus_read_di(body: ReadRequest):
    return _modbus_call(lambda: {"ok": True, "values": _modbus.read_discrete_inputs(body.address, body.count)})

@app.post("/api/modbus/read/holding")
def modbus_read_hr(body: ReadRequest):
    return _modbus_call(lambda: {"ok": True, "values": _modbus.read_holding_registers(body.address, body.count)})

@app.post("/api/modbus/read/input")
def modbus_read_ir(body: ReadRequest):
    return _modbus_call(lambda: {"ok": True, "values": _modbus.read_input_registers(body.address, body.count)})

@app.post("/api/modbus/read/float32")
def modbus_read_f32(body: ReadRequest):
    return _modbus_call(lambda: {"ok": True, "value": _modbus.read_float32(body.address)})

@app.post("/api/modbus/write/coil")
def modbus_write_coil(body: WriteCoilRequest):
    return _modbus_call(lambda: (_modbus.write_coil(body.address, body.value), {"ok": True})[1])

@app.post("/api/modbus/write/register")
def modbus_write_register(body: WriteRegisterRequest):
    def _w():
        if body.values is not None:
            _modbus.write_registers(body.address, body.values)
        else:
            _modbus.write_register(body.address, body.value)
        return {"ok": True}
    return _modbus_call(_w)

@app.post("/api/modbus/write/coils")
def modbus_write_coils(body: WriteCoilsRequest):
    return _modbus_call(lambda: (_modbus.write_coils(body.address, body.values), {"ok": True})[1])

@app.post("/api/modbus/write/float32")
def modbus_write_f32(body: Float32Request):
    if body.value is None: raise HTTPException(400, "value required")
    return _modbus_call(lambda: (_modbus.write_float32(body.address, body.value), {"ok": True})[1])

@app.post("/api/modbus/scan")
def modbus_scan(body: ScanRequest):
    return _modbus_call(lambda: {"ok": True, "registers": _modbus.scan_registers(body.start, body.count)})

def _modbus_call(fn):
    if not _modbus: raise HTTPException(503, "Not connected")
    try: return fn()
    except (ConnectionError, IOError) as e: raise HTTPException(502, str(e))


# ═══════════════════════════════════════════════════════
#  OPC UA
# ═══════════════════════════════════════════════════════

@app.get("/api/opcua/config")
def ua_get_config():
    return _ua_config.to_dict()

@app.post("/api/opcua/config")
def ua_set_config(body: OpcuaConfigIn):
    global _ua_config
    _ua_config = OpcuaConfig.from_dict(body.model_dump())
    return {"ok": True, "config": _ua_config.to_dict()}

@app.post("/api/opcua/connect")
async def ua_connect():
    global _opcua
    _opcua = OpcuaClientWrapper(_ua_config)
    try:
        await _opcua.connect()
        return {"ok": True, "message": f"Connected to {_ua_config.url}"}
    except Exception as e:
        _opcua = None
        raise HTTPException(503, str(e))

@app.post("/api/opcua/disconnect")
async def ua_disconnect():
    global _opcua
    if _opcua: await _opcua.disconnect(); _opcua = None
    return {"ok": True}

@app.get("/api/opcua/status")
def ua_status():
    return {"ok": True, "connected": _opcua is not None, "config": _ua_config.to_dict()}

@app.get("/api/opcua/ping")
async def ua_ping():
    if not _opcua: return {"ok": False, "message": "Not connected"}
    return await _opcua.ping()

@app.post("/api/opcua/browse")
async def ua_browse(body: OpcuaBrowseRequest):
    if not _opcua: raise HTTPException(503, "Not connected")
    try:
        if body.depth:
            tree = await _opcua.browse_tree(body.node_id, body.depth)
            return {"ok": True, "tree": tree}
        else:
            children = await _opcua.browse_children(body.node_id)
            return {"ok": True, "children": children}
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/api/opcua/read")
async def ua_read(body: OpcuaReadNodes):
    if not _opcua: raise HTTPException(503, "Not connected")
    try:
        if len(body.node_ids) == 1:
            node = await _opcua.read_node(body.node_ids[0])
            return {"ok": True, "node": node}
        nodes = await _opcua.read_nodes(body.node_ids)
        return {"ok": True, "nodes": nodes}
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/api/opcua/write")
async def ua_write(body: OpcuaWriteNode):
    if not _opcua: raise HTTPException(503, "Not connected")
    try:
        await _opcua.write_node(body.node_id, body.value)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(502, str(e))


# ═══════════════════════════════════════════════════════
#  MQTT
# ═══════════════════════════════════════════════════════

@app.get("/api/mqtt/config")
def mqtt_get_config():
    return _mq_config.to_dict()

@app.post("/api/mqtt/config")
def mqtt_set_config(body: MqttConfigIn):
    global _mq_config
    _mq_config = MqttConfig.from_dict(body.model_dump())
    return {"ok": True, "config": _mq_config.to_dict()}

@app.post("/api/mqtt/connect")
def mqtt_connect():
    global _mqtt
    try:
        _mqtt = MqttClientWrapper(_mq_config)
        _mqtt.connect()
        return {"ok": True, "message": f"Connected to {_mq_config.host}:{_mq_config.port}"}
    except Exception as e:
        _mqtt = None
        raise HTTPException(503, str(e))

@app.post("/api/mqtt/disconnect")
def mqtt_disconnect():
    global _mqtt
    if _mqtt: _mqtt.disconnect(); _mqtt = None
    return {"ok": True}

@app.get("/api/mqtt/status")
def mqtt_status():
    return {"ok": True, "connected": bool(_mqtt and _mqtt.connected), "config": _mq_config.to_dict()}

@app.get("/api/mqtt/ping")
def mqtt_ping():
    if not _mqtt: return {"ok": False, "message": "Not connected"}
    return _mqtt.ping()

@app.post("/api/mqtt/publish")
def mqtt_publish(body: MqttPublish):
    if not _mqtt: raise HTTPException(503, "Not connected")
    try:
        return _mqtt.publish(body.topic, body.payload, body.qos, body.retain)
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/api/mqtt/subscribe")
def mqtt_subscribe(body: MqttSubscribe):
    if not _mqtt: raise HTTPException(503, "Not connected")
    try:
        return _mqtt.subscribe(body.topic, body.qos)
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/api/mqtt/unsubscribe")
def mqtt_unsubscribe(body: MqttSubscribe):
    if not _mqtt: raise HTTPException(503, "Not connected")
    _mqtt.unsubscribe(body.topic)
    return {"ok": True}

@app.get("/api/mqtt/messages")
def mqtt_messages(limit: int = 50):
    if not _mqtt: return {"ok": True, "messages": []}
    return {"ok": True, "messages": _mqtt.get_messages(limit)}

@app.post("/api/mqtt/clear")
def mqtt_clear():
    if _mqtt: _mqtt.clear_messages()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
#  TDENGINE
# ═══════════════════════════════════════════════════════

class TdConfigIn(BaseModel):
    host: str = "localhost"
    port: int = 6041
    user: str = "root"
    password: str = "taosdata"
    database: str = "industrial"

class CollectTaskIn(BaseModel):
    id: str
    protocol: str = "modbus"
    mb_host: str = "127.0.0.1"
    mb_port: int = 502
    mb_unit: int = 1
    mb_address: int = 0
    mb_count: int = 1
    mb_register: str = "holding"
    dtype: str = "u16"
    endian: str = "ABCD"
    bit_index: int = 0
    string_len: int = 1
    ua_url: str = "opc.tcp://127.0.0.1:4840"
    ua_node_id: str = ""
    ua_dtype: str = ""           # OPC UA server-returned data type label (display only)
    table: str = "raw_data"
    col_map: dict[str, str] = {}
    interval: float = 1.0

@app.post("/api/td/connect")
def td_connect(config: TdConfigIn | None = None):
    global _td, _td_config, _collector, _anomaly, _predictor, _reporter, _mqtt_publisher
    global _heartbeat, _audit_logger, _command_handler
    try:
        if config:
            _td_config = TdConfig(
                host=config.host, port=config.port,
                user=config.user, password=config.password,
                database=config.database,
            )
        _td = TdClient(_td_config)
        _td.connect()
        _collector = DataCollector(_td_config)
        _anomaly = AnomalyEngine(_td)
        _predictor = TrendPredictor(_td)
        _reporter = ReportGenerator(_anomaly, _predictor)
        global _mqtt_publisher
        if _mqtt_publisher is None:
            _mqtt_publisher = MqttPublisher(MqttPublisherConfig())
            _mqtt_publisher.start()
        # Wire publisher into collector so its pollers can publish
        if _collector and _collector.mqtt_publisher is None:
            _collector.mqtt_publisher = _mqtt_publisher
        if _mqtt_publisher:
            _anomaly.mqtt_publisher = _mqtt_publisher
        # Start status heartbeat (5s) once publisher is alive
        if _heartbeat is None:
            _heartbeat = StatusHeartbeat(_mqtt_publisher, lambda: health(), interval=5.0)
            _heartbeat.start()
        # Initialize WriteAuditLogger for Sub-3 (TDengine write_audit stable)
        if _audit_logger is None and _td:
            _audit_logger = WriteAuditLogger(_td)
            _audit_logger.ensure_table()
        # Initialize CommandHandler for Sub-3 (MQTT subscriber for NR writes)
        if _command_handler is None and _audit_logger:
            _command_handler = CommandHandler(
                mqtt_client=_mqtt_publisher,  # publisher is also a paho mqtt client
                audit=_audit_logger,
            )
            _command_handler.start()
        return {"ok": True, "message": f"Connected to {_td_config.host}:{_td_config.port}"}
    except Exception as e:
        raise HTTPException(503, str(e))

@app.get("/api/td/ping")
def td_ping():
    if not _td: return {"ok": False}
    return _td.ping()

@app.get("/api/td/tables")
def td_tables():
    if not _td: raise HTTPException(503, "Not connected")
    return {"ok": True, "tables": _td.list_tables(), "stables": _td.list_stables()}

@app.get("/api/td/describe")
def td_describe(table: str):
    if not _td: raise HTTPException(503, "Not connected")
    return {"ok": True, "schema": _td.describe(table)}

@app.get("/api/td/query")
def td_query(table: str, start: str = "", end: str = "", limit: int = 1000):
    if not _td: raise HTTPException(503, "Not connected")
    if start and end:
        return {"ok": True, "data": _td.query_range(table, start, end, limit)}
    return {"ok": True, "data": _td.query_latest(table, limit)}

@app.get("/api/td/aggregate")
def td_aggregate(table: str, col: str, interval: str = "10s", start: str = "", end: str = "", agg: str = "avg"):
    if not _td: raise HTTPException(503, "Not connected")
    return {"ok": True, "data": _td.query_aggregate(table, col, interval, start, end, agg)}

@app.get("/api/td/count")
def td_count(table: str):
    if not _td: raise HTTPException(503, "Not connected")
    return {"ok": True, "count": _td.count(table)}

class TdWriteIn(BaseModel):
    table: str = "test_data"
    values: dict[str, Any] = {}

class AnomalyChannelIn(BaseModel):
    id: str
    table: str = "raw_data"
    col: str = "v0"
    low: float = 4.0
    high: float = 20.0
    step_threshold: float = 2.0
    drift_threshold: float = 0.5
    drift_window: int = 20
    baseline: float | None = None
    enabled: bool = True

@app.post("/api/td/write")
def td_write(body: TdWriteIn):
    if not _td: raise HTTPException(503, "Not connected")
    from datetime import datetime, timezone
    _td.insert(body.table, datetime.now(timezone.utc), body.values)
    return {"ok": True}

# ── Collector ─────────────────────────────────────────

@app.post("/api/collector/add")
def collector_add(body: CollectTaskIn):
    if not _collector: raise HTTPException(503, "TDengine not connected")
    task = CollectTask.from_dict(body.model_dump())
    _collector.add_task(task)
    return {"ok": True, "task": task.to_dict()}

@app.post("/api/collector/start")
def collector_start(task_id: str):
    if not _collector: raise HTTPException(503, "TDengine not connected")
    _collector.start_task(task_id)
    return {"ok": True}

@app.post("/api/collector/stop")
def collector_stop(task_id: str):
    if not _collector: raise HTTPException(503, "TDengine not connected")
    _collector.stop_task(task_id)
    return {"ok": True}

@app.get("/api/collector/status")
def collector_status():
    if not _collector: return {"ok": True, "tasks": []}
    return {"ok": True, "tasks": _collector.status()}


# ═══════════════════════════════════════════════════════
#  NODE-RED BRIDGE
# ═══════════════════════════════════════════════════════

@app.get("/api/tags")
def nodered_tags():
    if not _collector:
        return {"ok": True, "tags": []}
    return {"ok": True, "tags": build_tag_catalog(_collector.tasks)}


@app.get("/api/nodered/status")
def nodered_status():
    if not _mqtt_publisher:
        return {"ok": True, "broker": "not_initialized", "broker_host": "n/a",
                "publish_count": 0, "publish_errors": 0, "last_publish_at": None,
                "last_error": None, "last_topics": []}
    return {"ok": True, **_mqtt_publisher.status()}


class NoderedPublishIn(BaseModel):
    topic: str
    payload: dict
    retain: bool = False

@app.post("/api/nodered/publish")
def nodered_publish(body: NoderedPublishIn):
    if not _mqtt_publisher:
        raise HTTPException(503, "Publisher not initialized")
    info = _mqtt_publisher._client.publish(body.topic, json.dumps(body.payload), qos=0, retain=body.retain)
    return {"ok": info.rc == mqtt.MQTT_ERR_SUCCESS, "rc": info.rc}


@app.get("/api/nodered/flows")
def nodered_flows():
    """Generate and serve a Node-RED flows.json for all collector tasks."""
    tasks = _collector.tasks if _collector else {}
    flows = build_flows_json(tasks)
    body = json.dumps(flows, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="1052os-flows.json"',
        },
    )


@app.get("/api/nodered/dashboard")
def nodered_dashboard():
    """Generate and serve a Node-RED Dashboard flows.json (Sub-4)."""
    tasks = _collector.tasks if _collector else {}
    channels = _anomaly.channels if _anomaly else {}
    recent_audit: list = []
    recent_anomalies: list = []
    if _td:
        try:
            recent_audit = _td._query(
                "SELECT ts, protocol, target, cmd, result FROM write_audit "
                "ORDER BY ts DESC LIMIT 10"
            )
        except Exception:
            pass
        try:
            recent_anomalies = _td._query(
                "SELECT ts, channel_id, severity, message FROM anomaly_log "
                "ORDER BY ts DESC LIMIT 10"
            )
        except Exception:
            pass
    flows = build_dashboard_flows(
        tasks, channels,
        recent_audit=recent_audit, recent_anomalies=recent_anomalies,
    )
    body = json.dumps(flows, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="1052os-dashboard.json"',
        },
    )


# ── Sub-3: Anomaly ack + Write audit ─────────────────


@app.post("/api/anomaly/ack")
def anomaly_ack(channel: str, ts: str, by: str = "gateway"):
    """Mark a single anomaly as acked. Returns ok=true if updated.

    After ack, publishes a retained event to 1052os/events/ack/{channel}
    so Node-RED subscribers see the state change immediately.
    """
    if not _anomaly:
        raise HTTPException(503, "anomaly engine not initialized")
    ok = _anomaly.ack_one(channel, ts, by=by)
    if not ok:
        raise HTTPException(404, f"anomaly not found: channel={channel} ts={ts}")
    if _mqtt_publisher:
        _mqtt_publisher.publish_event("ack", channel, {
            "ts": ts, "channel": channel, "acked": True, "acked_by": by,
        })
    return {"ok": True, "channel": channel, "ts": ts, "acked_by": by}


@app.get("/api/audit/writes")
def audit_writes(limit: int = 20):
    """Return recent write audit records (newest first)."""
    if not _td:
        return {"ok": True, "writes": []}
    try:
        rows = _td._query(
            f"SELECT ts, request_id, source, protocol, target, cmd, value_str, result, error_msg "
            f"FROM write_audit ORDER BY ts DESC LIMIT {int(limit)}"
        )
        # Normalize for JSON
        for r in rows:
            if "ts" in r and hasattr(r["ts"], "isoformat"):
                r["ts"] = r["ts"].isoformat()
        return {"ok": True, "writes": rows}
    except Exception as e:
        return {"ok": False, "error": str(e), "writes": []}


# ═══════════════════════════════════════════════════════
#  ANOMALY DETECTION
# ═══════════════════════════════════════════════════════

@app.post("/api/anomaly/channel/add")
def anomaly_add_channel(body: AnomalyChannelIn):
    if not _anomaly: raise HTTPException(503, "TDengine not connected")
    cfg = ChannelConfig.from_dict(body.model_dump())
    _anomaly.set_channel(cfg)
    return {"ok": True, "channel": cfg.to_dict()}

@app.post("/api/anomaly/channel/remove")
def anomaly_remove_channel(channel_id: str):
    if not _anomaly: raise HTTPException(503, "TDengine not connected")
    _anomaly.remove_channel(channel_id)
    return {"ok": True}

@app.get("/api/anomaly/channels")
def anomaly_channels():
    if not _anomaly: return {"ok": True, "channels": []}
    return {"ok": True, "channels": _anomaly.get_channels()}

@app.post("/api/anomaly/scan")
def anomaly_scan():
    if not _anomaly: raise HTTPException(503, "TDengine not connected")
    anomalies = _anomaly.scan()
    for a_dict in anomalies:
        a = Anomaly(
            ts=datetime.fromisoformat(a_dict["ts"]),
            channel_id=a_dict["channel_id"],
            a_type=a_dict["type"],
            severity=a_dict["severity"],
            value=a_dict["value"],
            threshold_val=a_dict["threshold"],
            message=a_dict["message"],
        )
        _anomaly.save_anomaly(a)
    return {"ok": True, "count": len(anomalies), "anomalies": anomalies}

@app.post("/api/anomaly/scan/{channel_id}")
def anomaly_scan_channel(channel_id: str):
    if not _anomaly: raise HTTPException(503, "TDengine not connected")
    return {"ok": True, "anomalies": _anomaly.scan_channel(channel_id)}

@app.get("/api/anomaly/history")
def anomaly_history(channel_id: str = "", type: str = "", limit: int = 100):
    if not _anomaly: return {"ok": True, "data": []}
    return {"ok": True, "data": _anomaly.get_history(channel_id, type, limit)}

@app.get("/api/anomaly/history/count")
def anomaly_history_count():
    if not _anomaly: return {"ok": True, "count": 0}
    return {"ok": True, "count": _anomaly.get_history_count()}

@app.post("/api/anomaly/clear")
def anomaly_clear():
    if not _anomaly: raise HTTPException(503, "TDengine not connected")
    _anomaly.clear_history()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
#  TREND PREDICTION
# ═══════════════════════════════════════════════════════

@app.get("/api/predict/trend")
def predict_trend(table: str, col: str, window: float = 300, horizon: float = 300):
    if not _predictor: raise HTTPException(503, "TDengine not connected")
    result = _predictor.predict(table, col, window, horizon)
    return {"ok": True, **result.to_dict()}

@app.get("/api/predict/forecast")
def predict_forecast(table: str, col: str, window: float = 300, horizon: float = 600, steps: int = 10):
    if not _predictor: raise HTTPException(503, "TDengine not connected")
    return {"ok": True, "forecast": _predictor.forecast(table, col, window, horizon, min(steps, 50))}

@app.get("/api/predict/ttl")
def predict_ttl(table: str, col: str, limit: float, window: float = 300):
    """Time-to-limit: how long until value crosses the given threshold."""
    if not _predictor: raise HTTPException(503, "TDengine not connected")
    result = _predictor.time_to_threshold(table, col, limit, window)
    return {"ok": True, **result.to_dict()}


# ═══════════════════════════════════════════════════════
#  SMART REPORT
# ═══════════════════════════════════════════════════════

@app.post("/api/report/generate")
def report_generate():
    if not _reporter: raise HTTPException(503, "TDengine not connected")
    report = _reporter.generate()
    _reporter.save_report(report)
    return {"ok": True, "report": report}

@app.get("/api/report/history")
def report_history(limit: int = 20):
    if not _reporter: return {"ok": True, "reports": []}
    return {"ok": True, "reports": _reporter.get_history(limit)}

@app.get("/api/report/view")
def report_view(ts: str):
    if not _reporter: raise HTTPException(503, "TDengine not connected")
    report = _reporter.get_report(ts)
    if not report:
        raise HTTPException(404, "Report not found")
    return {"ok": True, "report": report}


# ═══════════════════════════════════════════════════════
#  HEALTH
# ═══════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "1052-OS Industrial Gateway v0.4",
        "modbus": bool(_modbus and _modbus.connected),
        "opcua": _opcua is not None,
        "mqtt": bool(_mqtt and _mqtt.connected),
        "tdengine": _td is not None,
        "anomaly": _anomaly is not None,
        "collector_tasks": len(_collector.tasks) if _collector else 0,
    }


# ── Main ───────────────────────────────────────────────

def main():
    import uvicorn
    uvicorn.run("gateway.server:app", host="0.0.0.0", port=8765, reload=True)

if __name__ == "__main__":
    main()
