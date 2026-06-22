# AIAAS Agent Bridge Phase 2 QA

## Scope

Phase 2 adds the AIAAS MQTT telemetry observer path to the 1052 industrial gateway.

Default source:

```text
aiaas/plc/line-1/zone-1/telemetry
```

The bridge maps AIAAS JSON fields into normal 1052 MQTT collector tasks:

- `AIAAS_DO_MG_L`
- `AIAAS_NH4N_MG_L`
- `AIAAS_NO3N_MG_L`
- `AIAAS_MLSS_MG_L`
- `AIAAS_FLOW_M3_H`
- `AIAAS_AIR_FLOW_M3_MIN`
- `AIAAS_PRESSURE_KPA`
- `AIAAS_BLOWER_FREQUENCY_HZ`
- `AIAAS_VALVE_OPENING_PCT`
- `AIAAS_ENERGY_KW`
- `AIAAS_DO_SETPOINT_MG_L`

## Bootstrap

```bash
curl -X POST "http://127.0.0.1:18765/api/aiaas/bridge/bootstrap" \
  -H "Content-Type: application/json" \
  -d '{"topic":"aiaas/plc/line-1/zone-1/telemetry","start":true}'
```

## Agent Query Contract

`/api/tags` returns query-ready entries:

```json
{
  "tag": "AIAAS_DO_MG_L",
  "table": "raw_data_AIAAS_DO_MG_L",
  "stable": "raw_data",
  "col": "v",
  "metric": "do_mg_l",
  "unit": "mg/L"
}
```

The 1052 Agent should use `table + col` when calling `industrial_query_timeseries` or `industrial_aggregate_timeseries`.
All one-tag child tables expose the stable value column `v`; the tag id remains in `tag` and the child table name.

## Verification

```bash
cd /Users/easonliu/1052-OS/gateway_python
uv run pytest tests/test_aiaas_bridge.py tests/test_nodered_tags.py -q
uv run pytest -q
```

Expected:

- AIAAS MQTT tasks are generated with `mq_payload=json` and per-field `mq_field`.
- Bootstrap endpoint registers and optionally starts all AIAAS collector tasks.
- Tag catalog exposes queryable child table names and value columns.

## Safety Boundary

The bridge is observer-only. It subscribes to MQTT telemetry and writes TDengine history. It does not write PLC values, change AIAAS control mode, acknowledge alarms, or modify AIAAS control parameters.
