# AIAAS Agent Bridge Phase 4 QA

## Scope

Phase 4 adds a repeatable AIAAS-to-1052 end-to-end smoke test.

The smoke test validates:

- AIAAS API health: `GET /health`
- AIAAS current state: `GET /api/state`
- 1052 AIAAS bridge bootstrap: `POST /api/aiaas/bridge/bootstrap`
- Query-ready AIAAS tags from `GET /api/tags`
- Optional MQTT telemetry seed through `POST /api/nodered/publish`
- TDengine aggregate trend queries for DO, NH4-N, pressure, blower frequency, and valve opening

## Command

For AIAAS-only smoke testing, start the gateway with embedded Node-RED disabled
so stale local flows cannot pollute the result:

```bash
cd /Users/easonliu/1052-OS/gateway_python
GATEWAY_DISABLE_NODERED=1 uv run uvicorn gateway.server:app --host 0.0.0.0 --port 18765
```

Then run:

```bash
cd /Users/easonliu/1052-OS
node scripts/aiaas-e2e-smoke.mjs \
  --gateway-url http://127.0.0.1:18765 \
  --table aiaas_smoke \
  --seed-mqtt \
  --strict-trends \
  --trend-attempts 8 \
  --poll-ms 1000
```

Use a separate `--table`, such as `aiaas_smoke`, to avoid old TDengine schemas from previous collector versions.

If port `18765` is already occupied, kill the stale gateway before testing:

```bash
lsof -iTCP:18765 -sTCP:LISTEN -n -P
kill <PID>
```

## Query Contract

The bridge exposes one child table per AIAAS metric:

```json
{
  "tag": "AIAAS_DO_MG_L",
  "table": "aiaas_smoke_AIAAS_DO_MG_L",
  "stable": "aiaas_smoke",
  "col": "v",
  "metric": "do_mg_l",
  "unit": "mg/L"
}
```

The Agent should query `table + col`, where `col` is always `v` for these one-metric child tables.

## Verified Result

On June 22, 2026, the strict local smoke command passed against:

- AIAAS API: `http://127.0.0.1:8000`
- Temporary 1052 gateway: `http://127.0.0.1:18765`
- MQTT broker: `127.0.0.1:1883`
- TDengine: local auto-connected gateway TD client

The smoke report returned:

- `AIAAS health`: PASS
- `AIAAS state`: PASS
- `Bridge bootstrap`: PASS
- `Seed MQTT frame`: PASS
- `Required tags`: PASS, `5/5`
- TDengine trend checks: PASS for `do_mg_l`, `nh4n_mg_l`, `pressure_kpa`, `blower_frequency_hz`, and `valve_opening_pct`

Known failure signatures and meanings:

| Failure | Likely cause | Fix |
| --- | --- | --- |
| `/api/aiaas/bridge/bootstrap: 404` | An old gateway process is still serving port `18765` | Kill the old PID and restart gateway from the current checkout |
| `/api/nodered/publish: 503 Publisher not initialized` | Gateway has not connected TDengine and initialized the MQTT publisher, or the request hit an old gateway | Check `/api/td/ping`, restart latest gateway |
| Missing AIAAS tags | Bootstrap did not run on the current gateway, or collector was unavailable | Restart latest gateway, rerun smoke with a fresh `--table` |
| Node-RED log spam with `127.0.0.1:590x` or `${INFLUXDB_URL}` | Stale local Node-RED flows from another demo | Use `GATEWAY_DISABLE_NODERED=1` for AIAAS smoke, or clean/reset the Node-RED userDir separately |

## Safety Boundary

The smoke test is observer-only:

- It may register and start MQTT-source collector tasks.
- It may publish one AIAAS telemetry JSON frame to MQTT when `--seed-mqtt` is used.
- It does not write PLC registers, switch AIAAS control mode, acknowledge alarms, change PID/control parameters, or promote models.
