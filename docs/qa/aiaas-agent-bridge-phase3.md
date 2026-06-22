# AIAAS Agent Bridge Phase 3 QA

## Scope

Phase 3 adds `aiaas_factory_diagnose`, a factory-level read-only diagnosis tool for the 1052 Agent.

The tool combines:

- AIAAS realtime state: `/api/state`
- AIAAS alarms: `/api/alarms`
- AIAAS prediction analysis: `/api/prediction/analysis`
- AIAAS control decision logs: `/api/control/logs`
- 1052 tag catalog: `/api/tags`
- 1052 collector status: `/api/collector/status`
- Node-RED runtime and MQTT bridge status
- TDengine aggregate trends for DO, NH4-N, pressure, blower frequency, and valve opening

## Agent Contract

Use `aiaas_factory_diagnose` when the user asks:

```text
请做一次精准曝气综合诊断
当前报警是不是采集或通信异常造成的？
氨氮为什么上升，要不要加大曝气？
过去 30 分钟 DO 和 NH4-N 变化是否支持 AIAAS 判断？
```

The answer should follow:

```text
结论 → AIAAS 专科意见 → 1052 现场证据链 → 已排除项 → 可能原因 → 建议动作 → 安全边界 → 不确定性
```

## Safety Boundary

`aiaas_factory_diagnose` is read-only and returns:

```json
{
  "direct_control_allowed": false,
  "recommendation_level": "factory_diagnosis_only"
}
```

It does not write PLC registers, switch AIAAS control mode, acknowledge alarms, change PID parameters, or promote models.

## Runtime Degradation

Factory diagnosis must remain usable when optional AIAAS analysis endpoints are
not available in the currently running AIAAS process. For example, a stale
AIAAS API may expose `/api/state`, `/api/alarms`, and `/api/control/logs` but
not `/api/prediction/analysis`.

In that case the tool should:

- keep returning `source=aiaas_factory_diagnosis`;
- derive `risk_level` from alarms and realtime state when prediction is absent;
- include per-source status under `aiaas_opinion.sources`;
- add the missing endpoint to `uncertainties`;
- preserve `direct_control_allowed=false` and
  `recommendation_level=factory_diagnosis_only`;
- continue using 1052 tags and TDengine trends when available.

## Verification

```bash
cd /Users/easonliu/1052-OS/backend
npm test -- src/modules/agent/tools/aiaas.tools.test.ts src/modules/agent/__tests__/agent.progressive.test.ts --reporter verbose
npm test -- src/modules/agent/__tests__/agent.aiaas-stream.test.ts --reporter verbose
npm test
npm run build
```

Expected:

- The tool is mounted through `data-pack`.
- The tool produces AIAAS opinion, 1052 site evidence, excluded causes, possible causes, recommended actions, uncertainties, and safety metadata.
- Runtime smoke against the local AIAAS process passed with prediction endpoint unavailable: state/alarms/control logs were read, `5/5` AIAAS tags were matched, TDengine trend keys were returned, and the unavailable prediction endpoint was recorded in `uncertainties`.
- Route-level SSE test covers the real `/api/agent/chat/stream` progressive disclosure path: first `request_context_upgrade` asks for `data-pack`, then the mounted tool set exposes and calls `aiaas_factory_diagnose`, then the final streamed answer preserves the read-only safety boundary.
- Backend tests and TypeScript build pass.
