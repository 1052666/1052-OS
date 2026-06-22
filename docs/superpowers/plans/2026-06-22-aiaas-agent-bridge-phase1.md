# AIAAS Agent Bridge Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose AIAAS precision aeration diagnostics to the 1052 Agent as read-only tools.

**Architecture:** Keep AIAAS as the domain system and safety boundary. Add a small 1052 backend tool module that calls AIAAS FastAPI endpoints through `AIAAS_API_URL` and returns simulation/diagnostic results with explicit `direct_control_allowed=false` metadata. Register the tools under `data-pack` so the 1052 Agent can use them alongside existing industrial gateway tools.

**Tech Stack:** TypeScript, Express backend Agent tool runtime, Vitest.

---

### Task 1: AIAAS Read-Only Tool Module

**Files:**
- Create: `backend/src/modules/agent/tools/aiaas.tools.ts`
- Create: `backend/src/modules/agent/tools/aiaas.tools.test.ts`

- [ ] Write failing tests for `aiaas_get_state`, `aiaas_get_alarms`, and `aiaas_get_prediction_analysis`.
- [ ] Run the focused tests and confirm they fail because the module is missing.
- [ ] Implement minimal fetch wrappers using `AIAAS_API_URL || http://127.0.0.1:8000`.
- [ ] Ensure every result includes `safety.direct_control_allowed=false` and `safety.recommendation_level=advisory_only`.
- [ ] Run focused tests and confirm they pass.

### Task 2: Agent Runtime Registration

**Files:**
- Modify: `backend/src/modules/agent/agent.tool.service.ts`
- Modify: `backend/src/modules/agent/agent.pack.service.ts`
- Modify: `backend/src/modules/agent/__tests__/agent.progressive.test.ts`

- [ ] Write failing tests proving AIAAS tools are mounted and exposed through `data-pack`.
- [ ] Import `aiaasTools` into the Agent tool registry.
- [ ] Add AIAAS tool names to `data-pack`.
- [ ] Run focused progressive tests and backend build.

### Task 3: Safety and Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/qa/aiaas-agent-bridge-phase1.md`

- [ ] Document that AIAAS tools are read-only and cannot dispatch PLC commands.
- [ ] Record verification commands and the expected first user questions.

### Follow-Up Phase 2: AIAAS MQTT to 1052 TDengine

**Files:**
- Create: `gateway_python/gateway/aiaas_bridge.py`
- Modify: `gateway_python/gateway/server.py`
- Modify: `gateway_python/gateway/nodered_tags.py`
- Test: `gateway_python/tests/test_aiaas_bridge.py`

- [ ] Map the AIAAS telemetry topic `aiaas/plc/line-1/zone-1/telemetry` into MQTT collector tasks.
- [ ] Expose `/api/aiaas/bridge/bootstrap` for registering and optionally starting tasks.
- [ ] Ensure `/api/tags` returns query-ready `table` and `col` for each AIAAS metric.
- [ ] Keep the bridge observer-only: telemetry ingest and TDengine history only, no PLC writes.
