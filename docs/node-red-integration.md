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
