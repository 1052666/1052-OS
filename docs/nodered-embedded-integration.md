# 1052-OS Node-RED Embedded Integration

This document is the engineering quick reference for the embedded Node-RED runtime inside the 1052-OS industrial gateway.

## Purpose

1052-OS embeds Node-RED so new industrial data acquisition paths can be built without writing new Python drivers. The default path is:

```text
Industrial protocol node → Function node → HTTP Request → POST /api/td/insert → TDengine
```

Use Node-RED for low/medium frequency protocol integration, rapid commissioning, dashboards, and customer-specific glue logic. Keep the Python drivers for high-frequency polling or strict deterministic acquisition.

## Local startup

From the project root:

```bash
cd /Users/easonliu/1052-OS/gateway_python
GATEWAY_DISABLE_AUTOCONNECT=1 uv run python -m gateway.server

cd /Users/easonliu/1052-OS/frontend
npm run dev -- --host 0.0.0.0 --port 10052
```

Expected ports:

| Service | URL |
|---|---|
| Frontend | `http://localhost:10052` |
| Industrial Gateway | `http://localhost:10052/industrial-gateway` |
| Gateway API | `http://localhost:8765` |
| Embedded Node-RED editor | `http://localhost:10052/industrial-gateway/nodered/` |
| Node-RED runtime direct port | `http://localhost:1880` |

## Important routes

| Route | Purpose |
|---|---|
| `GET /api/nodered/runtime` | Embedded Node-RED process status |
| `POST /api/nodered/restart` | Restart embedded Node-RED |
| `POST /api/nodered/reset-bootstrap` | Rewrite bootstrap `flows.json` |
| `GET /api/nodered/protocols` | List protocol templates and installed status |
| `POST /api/nodered/protocols/{name}/install` | Install or replace a protocol template tab |
| `POST /api/nodered/protocols/{name}/install-module` | Install a missing Node-RED contrib module |
| `POST /api/td/insert` | Tag-driven write endpoint used by Node-RED flows |
| `GET /api/collector/schemas` | Dynamic schema source for 通用 / DRIVERS |
| `/nodered/` | Gateway reverse proxy to the embedded Node-RED editor |

Do not confuse these two routes:

- `/api/nodered/runtime` = embedded Node-RED child process status.
- `/api/nodered/status` = MQTT bridge / publish status used by the old Node-RED bridge panel.

## Protocol Library

The Protocol Library appears in the **CONFIGURE → Node-RED** tab. It currently provides:

| Template | Required module | Notes |
|---|---|---|
| `mqtt-subscribe` | none | MQTT in → shape payload → `/api/td/insert` |
| `http-webhook` | none | Node-RED HTTP endpoint → `/api/td/insert` |
| `modbus-tcp-hr` | `node-red-contrib-modbus` | Holding register polling |
| `opcua-read` | `node-red-contrib-opcua` | OPC UA node read |
| `s7-read` | `node-red-contrib-s7` | Siemens S7 variable read |

Install is idempotent. Reinstalling a template replaces the matching `protocol · ...` tab instead of duplicating it.

## Node-RED flow contract

Function nodes should emit this body before the HTTP Request node:

```js
msg.headers = {'Content-Type': 'application/json'};
msg.payload = {
  site: 'default',
  device: 'plc1',
  tag: 'temperature',
  value: msg.payload,
  ts: new Date().toISOString(),
};
return msg;
```

HTTP Request node:

```text
method: POST
url: http://127.0.0.1:8765/api/td/insert
return: parsed JSON object
```

`/api/td/insert` auto-creates the TDengine supertable/child table for the tag and inserts into column `v`.

## Runtime behavior

`gateway/nodered_runtime.py` owns the Node-RED subprocess:

- uses `NODERED_USER_DIR` or `~/.1052os/node-red`
- uses `NODERED_PORT` or `1880`
- uses `GATEWAY_API_URL` or `http://127.0.0.1:8765`
- writes logs to `~/.1052os/node-red/gateway.log`
- starts Node-RED in its own process group
- supervises crashes with a 5 restarts / 60 seconds guard
- seeds `flows.json` only if missing

## Reverse proxy notes

Node-RED must be opened under a trailing slash:

```text
/industrial-gateway/nodered/
```

Without the trailing slash, Node-RED's relative static paths such as `vendor/vendor.js` and `red/red.min.js` resolve under `/industrial-gateway/` instead of `/industrial-gateway/nodered/`, causing a blank page. The gateway now redirects `/nodered` to `/industrial-gateway/nodered/`, and the frontend links use the slash form.

The proxy strips `Accept-Encoding` and rewrites `Location` headers. Keep both behaviors; otherwise the editor can show garbled HTML or redirect out of the `/industrial-gateway/nodered/` path.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Node-RED page blank | Missing trailing slash or static assets 404 | Use `/industrial-gateway/nodered/`; check browser Network for `/vendor` or `/red` 404 |
| `schemas 加载失败: HTTP 404` | Frontend points to old backend on `8765` | Ensure `8765` is `gateway.server:app`, not `api.main:app` |
| `/api/nodered/runtime` 404 | Wrong backend process | Restart gateway from `gateway_python` with `python -m gateway.server` |
| Protocol install returns missing module | Contrib package not installed | Use the UI install-module button or `npm install` in the Node-RED userDir |
| Protocol flow posts to wrong port | `GATEWAY_API_URL` stale | Restart gateway with correct `GATEWAY_API_URL` and reinstall the template |
| Node-RED crash loop | port conflict or bad userDir settings | Check `~/.1052os/node-red/gateway.log` and `lsof -nP -iTCP:1880` |

## Verification checklist

1. Open `http://localhost:10052/industrial-gateway`.
2. Confirm it redirects to `/industrial-gateway/index.html`.
3. Click **CONFIGURE**.
4. Open **通用 / DRIVERS** and confirm `✓ 3 个驱动`.
5. Open **Node-RED** and confirm runtime shows `running`.
6. Open `http://localhost:10052/industrial-gateway/nodered/` and confirm the editor shows **Deploy**, **Flows**, and the bootstrap tab.
7. Install or reinstall `MQTT · Subscribe` from Protocol Library.
8. Confirm Node-RED contains `protocol · mqtt-subscribe`.
