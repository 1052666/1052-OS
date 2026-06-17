# 2026-06-17 — Node-RED Integration (Sub-1: Foundation Data Channel)

## Context

The 1052-OS Industrial Gateway already exposes Modbus / OPC UA / MQTT / TDengine
via a FastAPI service on port 8765. The user wants Node-RED to integrate with the
gateway for four purposes (validated together, but implemented as four separate
sub-projects to keep specs scoped):

1. **Sub-1 (this spec)** — Foundation data channel: bidirectional realtime bridge
2. **Sub-2** — Flow export: gateway emits downloadable `flows.json`
3. **Sub-3** — Orchestration: Node-RED as the logic layer for alarm/linkage/control
4. **Sub-4** — Dashboard mirror: port gateway data into Node-RED Dashboard

This spec covers **Sub-1 only**. Other sub-projects get their own spec → plan →
implementation cycle after Sub-1 ships.

### Why Sub-1 first

Sub-2/3/4 all depend on Sub-1's data plane. Implementing Sub-1 first means every
subsequent sub-project can be tested against the same broker.

## Goals

- Make collector realtime values visible to Node-RED with one broker connection
- Expose tag metadata so Node-RED can discover what data points exist
- Expose anomaly events as a separate event stream
- Provide a `/api/tags` endpoint for ad-hoc NR queries
- Local-first: zero auth, Mosquitto embedded in docker-compose

## Non-Goals (deferred to later sub-projects)

- Writing from Node-RED back to the gateway (Sub-3)
- Admin REST API to deploy `flows.json` (Sub-2)
- WebSocket push from gateway (Sub-4 — frontend polling continues to work)
- Authentication / multi-tenant (kept out of all four sub-projects for now)
- TLS / encryption (local-only)

## Architecture

```
┌──────────────────────── 1052-OS Industrial Gateway (8765) ────────────────────────┐
│                                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                            │
│  │ modbus_     │    │ opcua_      │    │ mqtt_       │  (other)                  │
│  │ client      │    │ client      │    │ client      │                            │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘                            │
│         │                 │                                                      │
│         └────────┬────────┘                                                      │
│                  ▼                                                               │
│         ┌─────────────────┐                                                      │
│         │  DataCollector  │  pulls / decodes / writes TDengine                    │
│         └────┬────────┬───┘                                                      │
│              │        │                                                          │
│              ▼        ▼                                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐                       │
│  │ TdClient      │  │ MqttPublisher│  │ FastAPI routes   │                       │
│  │ (TDengine)    │  │ (NEW)        │  │ /api/tags        │                       │
│  │               │  │              │  │ /api/nodered/*   │                       │
│  └───────────────┘  └──────┬───────┘  └──────────────────┘                       │
│                            │                                                    │
└────────────────────────────┼────────────────────────────────────────────────────┘
                             ▼
                  ┌──────────────────────┐
                  │ Mosquitto broker     │  ← NEW (docker-compose service)
                  │ (port 1883, 9001)    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Node-RED (port 1880) │
                  │  ├ mqtt in           │
                  │  ├ function          │
                  │  ├ http request      │
                  │  └ dashboard         │
                  └──────────────────────┘
```

### Key architectural decisions

- **Collector is the single acquisition exit.** After every successful read
  (`modbus` or `opcua`), the collector calls `MqttPublisher.publish(...)` *before*
  the TDengine insert. One data point produces one publish, one DB write.
- **Mosquitto is an independent service** in `docker-compose.yml`. Gateway connects
  to `localhost:1883`; Node-RED connects to `localhost:1883`.
- **`/api/nodered/*` and `/api/tags` are read-only.** No write endpoints in Sub-1.
- **WebSocket is NOT implemented in Sub-1.** Frontend keeps the existing 2.5s
  polling pattern. WS is reserved for Sub-4.
- **Admin REST is NOT implemented in Sub-1.** Belongs to Sub-2. (Server.py will
  not have a placeholder either — keep the code clean.)

## Components

### New files

| File | Purpose | LoC est. |
|---|---|---|
| `gateway/mqtt_publisher.py` | Publisher-only Mosquitto client (separate from mqtt_client) | ~100 |
| `gateway/nodered_tags.py` | Build tag catalog from collector state for `/api/tags` | ~50 |
| `mosquitto/config/mosquitto.conf` | Mosquitto config (anonymous, ports 1883/9001) | ~30 |
| `mosquitto/Dockerfile` | eclipse-mosquitto custom image with our config | ~5 |
| `tests/test_mqtt_publisher.py` | Unit + integration tests for publisher | ~120 |
| `tests/test_nodered_e2e.py` | E2E: gateway + broker + simulated NR consumer | ~100 |
| `docs/node-red-integration.md` | User docs: docker-compose up, NR config, troubleshooting | ~150 |

### Modified files

| File | Change |
|---|---|
| `gateway/collector.py` | ① `CollectTask` adds `site`, `device` fields (default "default" / `table`) ② `_poll_modbus/_poll_opcua` call `_publish_mqtt()` after decode, before TD insert ③ `start_task` accepts optional `MqttPublisher` ④ `add_task` registers task in tag catalog |
| `gateway/server.py` | ① `_mqtt_publisher` global state ② `/api/nodered/status` ③ `/api/tags` ④ lifespan manages publisher start/stop |
| `gateway/anomaly.py` | ① on `scan()` complete, publish each anomaly to `1052os/events/anomaly/{id}` ② keep existing `save_anomaly` write to TD |
| `docker-compose.yml` | New `mosquitto` service; gateway depends on `mosquitto` healthcheck |
| `frontend/public/industrial-gateway/index.html` | §01 status bar adds "Node-RED Bridge" panel: broker state, publish count, last 3 topics |
| `pyproject.toml` | Already has paho-mqtt via mqtt_client — **no new deps** |

### Module boundaries

```
collector ──publishes──▶ mqtt_publisher ──connects──▶ Mosquitto
collector ──inserts─────▶ tdengine_client ──connects──▶ TDengine
anomaly   ──emits───────▶ mqtt_publisher (via injected dep)
server.py ──reads────────▶ collector.status()
server.py ──reads────────▶ nodered_tags.build_tag_catalog()
```

`mqtt_publisher` does not know `collector` exists. It exposes
`publish(meta, value, ts, quality)`. `collector` calls it after each read.

## Data flow

### Topic hierarchy

```
1052os/
  ├── {site}/{device}/{tag}/
  │   ├── value      (collector realtime, QoS 0, NOT retained)
  │   └── meta       (retain=true, sent at task start)
  │
  ├── events/
  │   ├── anomaly/{channel_id}  (anomaly events, QoS 0)
  │   └── status                (5s heartbeat, QoS 1, retain=true)
  │
  └── system/
      └── logs                   (optional, debug only, default OFF)
```

Example topics:
- `1052os/site1/plc1/440001/value` — Modbus tag 440001 on plc1 in site1
- `1052os/events/anomaly/ch1` — anomaly events for channel ch1
- `1052os/events/status` — gateway heartbeat

### Payload schemas

**`/value`**
```json
{ "ts": 1700000000.123, "v": 3.14, "q": 192 }
```
- `ts` — Unix timestamp, float
- `v` — value (int/float/bool/string per dtype)
- `q` — quality code: `192` = Good (OPC UA status), `0` = Bad

**`/meta`** (retain, sent at task start/stop)
```json
{
  "tag": "440001",
  "device": "plc1",
  "site": "site1",
  "protocol": "modbus",
  "table": "raw_data",
  "dtype": "f32",
  "endian": "ABCD",
  "interval": 1.0,
  "unit": "mA",
  "ua_node_id": "",
  "ua_data_type": ""
}
```

**`/events/anomaly/{channel_id}`**
```json
{
  "ts": 1700000000.5,
  "channel": "ch1",
  "type": "high",
  "value": 85.0,
  "threshold": 80.0,
  "severity": "high",
  "message": "channel ch1 above high threshold"
}
```

**`/events/status`** (retain + QoS 1, 5s)
```json
{
  "ts": 1700000000.0,
  "gateway": "up",
  "broker": "connected",
  "td": "connected",
  "modbus": "connected",
  "opcua": "disconnected",
  "mqtt": "disconnected",
  "collector_tasks": 3,
  "anomaly_channels": 2
}
```

### Sequence

```
[1] collector poll (every interval)
      ↓
[2] decode → on success: mqtt_publisher.publish(meta, value, ts, q=192)
      ↓
[3] tdengine_client.insert(table, ts, {tag: value})  (existing path)
      ↓
[4] Mosquitto fans out to all subscribers (NR, SCADA, cloud)

[5] anomaly.scan() → for each anomaly: publish(events/anomaly/{id})

[6] background task: every 5s publish(events/status) with health snapshot
```

### Node-RED side (zero-code onboarding)

User in Node-RED editor:
1. Drag `mqtt in` node, broker = `localhost:1883`, topic = `1052os/#`
2. Drag `debug` node, connect
3. Deploy

All realtime values appear immediately. To discover tags at startup, NR can
subscribe to `1052os/+/+/+/meta` (retained) to receive the full tag catalog.

## Error handling

| Scenario | Strategy | Implementation |
|---|---|---|
| Mosquitto starts after gateway | Gateway retries connect every 5s | `MqttPublisher._connect_loop()` |
| Broker crashes | Auto-reconnect via paho; counter increments; no blocking | `reconnect_delay_set(5, 60)` |
| Publish failure (broker unresponsive) | Drop (QoS 0) + warning log + counter | Catch exception, `_publish_errors += 1` |
| Modbus read error | Skip publish, write NULL to TD | Existing path; add `if has_error: skip publish` |
| TDengine down, broker up | Continue publishing; TD insert handled by existing logic | No change |
| Anomaly publish failure | Log warning; event still in TD `anomaly_history` | Catch + log |
| Multi-instance gateway same topic | No dedup (user separates via `site`) | Doc: "multi-instance requires distinct `site`" |
| Long broker outage (>1h) | No buffering; status reflects | `_publish_errors` counter surfaced in UI |
| Gateway restart | NR auto-reconnects to broker; retained meta survives | No special handling |

### Status API

`/api/nodered/status` returns:
```json
{
  "ok": true,
  "broker": "connected",
  "broker_host": "localhost:1883",
  "publish_count": 142857,
  "publish_errors": 0,
  "last_publish_at": 1700000000.0,
  "last_error": null,
  "last_topics": [
    "1052os/site1/plc1/440001/value",
    "1052os/site1/plc1/440002/value",
    "1052os/site1/plc1/440003/value"
  ]
}
```

### Reconnect state machine

```
MqttPublisher._state:
  DISCONNECTED  ──start()──▶  CONNECTING
                                    │
                              ┌─────┴──────┐
                              ▼            ▼
                          CONNECTED    DISCONNECTED (on error)
                              │
                              │ (on broker disconnect)
                              ▼
                          CONNECTING (reconnect with backoff)
```

paho-mqtt provides built-in reconnect. We add:
- `is_connected` property exposed via `/api/nodered/status`
- 5s health-check task that pings broker and updates `/events/status`
- When broker drops, publish a "last known state" retained status so NR sees it immediately

## Testing

### Levels

| Level | Tool | Coverage |
|---|---|---|
| Unit | pytest, no broker | topic build, is_connected state, /api/tags output |
| Integration | pytest + testcontainers/mosquitto container | broker start/stop, gateway reconnect, message correctness |
| E2E (Playwright) | webapp-testing skill | docker-compose full stack, NR receives data, UI shows broker connected |
| Manual smoke | `mosquitto_sub -t '1052os/#' -v` | one-line check of all realtime data |

### Key test cases

```python
# test_mqtt_publisher.py
def test_topic_building():
    pub = MqttPublisher(broker="localhost:1883")
    assert pub._build_topic("site1", "plc1", "440001", "value") \
        == "1052os/site1/plc1/440001/value"

def test_publish_failure_does_not_raise(capsys):
    pub = MqttPublisher(broker="invalid:1883")
    pub.start()
    assert pub.publish("site1", "plc1", "440001", 3.14, ts=time.time(), q=192) is False

def test_status_counter_increments():
    pub = MqttPublisher(broker="localhost:1883")
    pub.start()
    pub.publish("site1", "plc1", "440001", 3.14, ts=time.time(), q=192)
    pub.publish("site1", "plc1", "440001", 3.15, ts=time.time(), q=192)
    s = pub.status()
    assert s["publish_count"] == 2

# test_nodered_e2e.py
def test_modbus_value_publishes_to_broker(mosquitto_container, gateway_running):
    add_collect_task(task_id="440001", protocol="modbus", ...)
    msgs = mosquitto_subscribe("1052os/+/+/440001/value", timeout=2.0)
    assert len(msgs) >= 1
    payload = json.loads(msgs[0].payload)
    assert set(payload.keys()) == {"ts", "v", "q"}
    assert payload["q"] == 192
```

### Definition of Done (DoD)

- [ ] `docker-compose up` starts broker + gateway in one command
- [ ] `mosquitto_sub -t '1052os/#' -v` shows all realtime values + meta
- [ ] NR with `mqtt in` on `1052os/#` receives all data
- [ ] After adding a collect task, frontend §01 status bar shows broker connected within 1s
- [ ] Killing broker: gateway does not crash; broker restart → gateway reconnects within 5s
- [ ] 100 collect tasks × 1Hz: gateway CPU < 10%
- [ ] 1000 messages no drop at QoS 0
- [ ] `pytest -v` green: test_mqtt_publisher.py + test_nodered_e2e.py
- [ ] `docs/node-red-integration.md` covers: docker-compose up, NR 3-step config, troubleshooting

## Open questions

- None for Sub-1. All 8 questions during brainstorming were answered.

## Risks

| Risk | Mitigation |
|---|---|
| paho-mqtt callback API mismatch (V1 vs V2) | Match the existing pattern in `mqtt_client.py` (already V2) |
| Mosquitto Dockerfile build differs from official | Use `eclipse-mosquitto:2.0` base + mount our config |
| Testcontainers not installed in CI | Fall back to docker-compose up in tests if testcontainers missing |
| Frontend adds dashboard widget; risks affecting Phase 8 work | Keep widget in §01 only, reuse existing CSS classes |
| Anomaly engine publish hooks break existing `scan()` callers | Publish only on `anomaly.scan()` (the API endpoint path), not on `scan_channel()` |
