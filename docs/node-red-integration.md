# Node-RED Integration (Sub-1: Data Channel)

## Quick start

```bash
cd /Users/easonliu/1052-OS
docker compose up -d mosquitto
cd gateway_python && uvicorn gateway.server:app --port 8765
```

Open `http://localhost:1880` (Node-RED, if running). Drag an `mqtt in` node, set broker to `localhost:1883`, topic to `1052os/#`, deploy. You will see all collector realtime values stream in.

## Verifying with mosquitto_sub

```bash
mosquitto_sub -h localhost -p 1883 -t '1052os/#' -v
```

You should see lines like:

```
1052os/site1/plc1/440001/value {"ts":1700000000.123,"v":3.14,"q":192}
1052os/site1/plc1/440001/meta {"tag":"440001","device":"plc1","site":"site1",...}
1052os/events/status {"gateway":"up","broker":"connected",...}
```

## Topic structure

- `1052os/{site}/{device}/{tag}/value` — realtime collector value
- `1052os/{site}/{device}/{tag}/meta` — tag metadata (retained)
- `1052os/events/anomaly/{channel_id}` — anomaly event
- `1052os/events/status` — gateway heartbeat (retained, 5s)

## REST endpoints

- `GET /api/tags` — discoverable tag catalog
- `GET /api/nodered/status` — broker connection + counters
- `POST /api/nodered/publish` — debug publish (test hook)

## Adding a tag in Node-RED (3 steps)

1. `mqtt in` node — broker `localhost:1883`, topic `1052os/#`
2. `debug` node — show complete msg
3. `mqtt out` node — for control actions (Sub-3, not yet)

## Exporting flows.json (one-click onboarding)

Click the **"⬇ Export flows.json"** button in the gateway §01 System Overview panel, or hit the API directly: `curl -O -J http://localhost:8765/api/nodered/flows`.

This downloads `1052os-flows.json` containing one `mqtt in` + `debug` pair per collector task, grouped by protocol into tabs (`Modbus` / `OPC UA`).

### Importing into Node-RED

1. Open Node-RED editor (`http://localhost:1880`)
2. Click the hamburger menu (top right) → **Import** → **select a file to import**
3. Choose `1052os-flows.json`
4. Click **Import** to drop the nodes onto the canvas
5. Click **Deploy** (red button, top right)

All `mqtt in` nodes are pre-wired to `debug` nodes — you should immediately see realtime values appearing in the debug sidebar.

### Regenerating after adding tags

The exported `flows.json` is a snapshot of the tag catalog at the time of download. After adding new collect tasks via `/api/collector/task/add` (or the configure drawer), click the export button again and re-import. New `mqtt in` nodes will be added; old ones are unaffected (Node-RED de-duplicates by `id`).

## Troubleshooting

| Symptom | Check |
|---|---|
| No messages in NR | `mosquitto_sub` works? `GET /api/nodered/status` broker=connected? |
| Stale topics | Meta is retained; restart NR to refresh |
| Errors counter rising | Broker offline? `docker compose logs mosquitto` |
| 1052os/events/status missing | Re-run `/api/td/connect` to re-init publisher |
| 1052os/events/status missing | Re-run `/api/td/connect` to re-init publisher |

## §9 Writing from Node-RED to gateway (orchestration)

Node-RED can write back to Modbus registers / OPC UA nodes by publishing
command messages to the gateway. Every write is logged to TDengine for audit.

### Modbus write (coil / register / float32)

Publish to `1052os/cmd/write/modbus` (QoS 0 or 1, **not** retained):

```json
{
  "request_id": "uuid-here",
  "cmd": "write_coil",
  "host": "127.0.0.1",
  "port": 502,
  "unit_id": 1,
  "address": 0,
  "value": true
}
```

Supported `cmd` values:

| cmd | value field | notes |
|---|---|---|
| `write_coil` | `value: bool` | FC5 |
| `write_register` | `value: int` | FC6 |
| `write_coils` | `values: [bool, ...]` | FC15 |
| `write_registers` | `values: [int, ...]` | FC16 |
| `write_float32` | `value: float` | big-endian word order (ABCD) |

### OPC UA write

Publish to `1052os/cmd/write/opcua`:

```json
{
  "request_id": "uuid-here",
  "cmd": "write_node",
  "url": "opc.tcp://127.0.0.1:4840",
  "node_id": "ns=2;s=Channel1.Device1.Tag1",
  "value": 42.0
}
```

Only `cmd=write_node` is supported. The `value` type is interpreted by the
target OPC UA server.

### Audit log

Every write (success or failure) is recorded in TDengine `write_audit` (7-day
retention, project-init policy; manual cleanup).

Access:

- `GET /api/audit/writes?limit=20` — JSON list (newest first)
- §01 NR Bridge panel "Recent writes" widget (last 5)
- TDengine SQL: `SELECT * FROM write_audit ORDER BY ts DESC LIMIT N`

### Alarm acknowledge (ack)

Mark an anomaly as acknowledged by channel + timestamp:

```bash
curl -X POST 'http://localhost:8765/api/anomaly/ack?channel=ch1&ts=2026-06-18T10:00:00+00:00'
```

Returns `{"ok": true, "channel": "...", "ts": "...", "acked_by": "gateway"}`
or `404` if the anomaly row does not exist.

After ack:
- `1052os/events/ack/{channel_id}` is published (retained, QoS 0)
- §03 Event Log shows "✓ acked" instead of "Ack" button

### Safety notes (project-init policy)

- **No authentication** on write endpoints — assumes local network trust
- **No range checking** — any value is written
- **No write whitelist** — any register / node is writable
- **No dry-run mode** — every write is real
- Multiple Node-RED instances writing the same target: **last write wins**
- Audit failures are logged but never abort the write (best-effort)
- 7-day audit retention; export regularly for long-term compliance

### Example Node-RED flow: close valve on over-temperature

```
[ mqtt in: 1052os/site1/plc1/TI-101/value ]
  → [ function: if msg.payload.v > 80 ]
  → [ mqtt out: 1052os/cmd/write/modbus ]
       payload: {
         request_id: msg.request_id || (new Date().toISOString()),
         cmd: "write_coil",
         host: "127.0.0.1", port: 502, unit_id: 1,
         address: 100, value: false
       }
```

## §10 Building a Node-RED Dashboard (mirror)

Generate a Node-RED Dashboard that visualizes all collector tags automatically.

### One-time setup

1. Install `node-red-dashboard` in your Node-RED instance:
   - Open Node-RED → top-right menu → **Manage palette** → **Install** tab
   - Search for `node-red-dashboard` → click **Install**
   - Restart Node-RED when prompted
2. Verify: open `http://localhost:1880/ui` — you should see a blank dashboard tab.

### Export the dashboard

1. In the gateway frontend, open **§01 NR Bridge panel**
2. Click **⬇ Export dashboard.json**
3. Browser downloads `1052os-dashboard.json`
4. In Node-RED → top-right menu → **Import** → select the file → **Import**
5. Click **Deploy**

### View

Open `http://localhost:1880/ui` in a browser. You should see a single
**"1052-OS Industrial"** tab with five groups:

| Group | Contents |
|---|---|
| **Overview** | Gateway status (live, from `1052os/events/status`) |
| **Modbus Tags** | One gauge + one trend chart per numeric Modbus tag |
| **OPC UA Tags** | Same for OPC UA tags |
| **Anomalies** | Live feed of anomaly events (red/yellow severity) |
| **Recent Writes** | Audit feed of writes (green ok / red error) |

For non-numeric tags (bit / bool / ascii / utf8), only a text widget is shown.

### Threshold colors

For tags with anomaly channels configured (low/high limits), the gauge uses:

- **Green** segment: below `low`
- **Yellow** segment: between `low` and `high`
- **Red** segment: above `high`

Configure thresholds via the gateway REST API:

```bash
curl -X POST 'http://localhost:8765/api/anomaly/channel/add' \
  -H 'Content-Type: application/json' \
  -d '{"id":"TI-101","table":"raw_data","col":"v0","low":10,"high":90}'
```

### Tips

- **First deploy shows no data**: ensure MQTT broker is running and the collector
  is publishing to `1052os/+/+/+/value`.
- **Tags not appearing**: check `/api/tags` to confirm the tag catalog.
- **Dashboard 2.0 users**: this export is for legacy `node-red-dashboard`
  (v2.x). Dashboard 2.0 uses different node types (`@flowfuse/node-red-dashboard`)
  and is not yet supported.
- **Customize in NR**: after Import, you can rearrange, resize, or remove
  widgets in the NR editor. Re-exporting will overwrite your changes.

## §11 Building a Control Dashboard (write widgets)

Generate a Node-RED Dashboard that exposes **control widgets** (switch /
numeric input) which fire write commands to your Modbus / OPC UA devices.

### What you get

In addition to the read-only widgets from §10, the "control" version adds:

- **Modbus Commands** group: a `ui_switch` (for `bit` tags) or `ui_numeric`
  (for numeric tags) per writable task
- **OPC UA Commands** group: same for OPC UA tasks
- Each widget is wired to a `function` node → `mqtt out` → write command topic
  (`1052os/cmd/write/{modbus,opcua}`)
- The gateway's CommandHandler (Sub-3) receives the message and writes the
  value to the device, then logs the attempt to `write_audit`

### One-time setup

Same as §10 (install `node-red-dashboard`).

### Export control dashboard

1. In §01 NR Bridge panel, click "⬇ Export control dashboard.json"
2. Browser downloads `1052os-dashboard-controls.json`
3. In Node-RED → Import → select file
4. Deploy
5. Visit `http://localhost:1880/ui`

### What gets written for each dtype

| Tag `dtype` | Modbus cmd | OPC UA cmd | UI Widget |
|---|---|---|---|
| `bit` | `write_coil` | `write_node` | `ui_switch` (1/0) |
| `u16`, `i16` | `write_register` | `write_node` | `ui_numeric` (integer) |
| `u32`, `i32`, `f32` | `write_float32` | `write_node` | `ui_numeric` (float) |
| `u64`, `i64` | `write_registers` (v0.2) | `write_node` | `ui_numeric` (float; v0.2 split) |
| `ascii`, `utf8` | — | — | (no widget) |

### Request ID format

Each write generates a `request_id` of the form `<TAG_ID>-<timestamp-ms>`,
which appears in the `write_audit` table. Use it to correlate writes with
dashboard actions.

### Safety

> v0.1 has no Set/Execute two-step confirmation. Changing a widget value
> fires a write immediately. In production environments, restrict access
> to the Node-RED UI, train operators, and consider a separate "operator"
> dashboard with limited write surface.

### Min/Max ranges

- If an anomaly channel is configured for the tag, the widget's min/max use
  `channel.low` / `channel.high`.
- Otherwise the widget uses the dtype's default range (e.g., `f32` → 0..100).
- Edit ranges in NR after import, or set anomaly channels via
  `/api/anomaly/channel/add`.

### Verifying writes

After triggering a write, check:
- §05 **Recent writes** panel in the gateway frontend (live audit feed)
- The `write_audit` table in TDengine
- The `Recent Writes` group on the Node-RED dashboard
