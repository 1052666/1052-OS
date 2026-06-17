# 2026-06-18 — Node-RED Integration Sub-4 (Dashboard Mirror) Implementation Plan

## Goal

Generate a Node-RED Dashboard flows.json that visualizes all collector tags
as gauges/charts/text widgets. Users get a `http://localhost:1880/ui` view of
their industrial data without manual node-dragging.

## Architecture (recap)

```
dashboard_flows.build_dashboard_flows(tasks, channels, audit, anomalies)
    ↑ pure function
server.GET /api/nodered/dashboard
    ↑ HTTP
frontend "Export dashboard.json" button
```

## Tech Stack

- Python 3.14, FastAPI, paho-mqtt
- pytest (TDD red-green)
- Existing: `nodered_flows`, `nodered_tags`, `collector`, `anomaly`, `server`

## Spec Reference

`docs/superpowers/specs/2026-06-18-node-red-integration-sub4-design.md`

## Sub-1/2/3 Pre-requisites (verified)

- `_collector.tasks` — dict of CollectTask
- `_anomaly.channels` — dict of ChannelConfig (has low/high thresholds)
- `_audit_logger` — WriteAuditLogger (Sub-3)
- `_anomaly.get_history(...)` — recent anomalies list
- `build_tag_catalog(tasks)` — Sub-1 helper

## Task Summary

| # | Task | Files | TDD | Subagent |
|---|------|-------|-----|----------|
| 1 | `dashboard_flows.build_dashboard_flows()` + tests | dashboard_flows.py + test | ✓ | impl + reviewers |
| 2 | `GET /api/nodered/dashboard` endpoint | server.py | — | impl + reviewer |
| 3 | Frontend "Export dashboard.json" button | index.html | — | impl + reviewer |
| 4 | User docs §10 | node-red-integration.md | — | impl + reviewer |
| 5 | E2E test | test_dashboard_e2e.py | ✓ | impl + reviewer |
| 6 | DoD + tag nodered-sub4-v0.1 | — | — | self |

---

## Task 1: `dashboard_flows.build_dashboard_flows()`

**Files:**
- Create: `gateway_python/gateway/dashboard_flows.py`
- Create: `gateway_python/tests/test_dashboard_flows.py`

### Step 1: Write failing tests (RED)

```python
# test_dashboard_flows.py — see spec §Testing for 8 tests
```

### Step 2: Verify RED

```bash
cd gateway_python && .venv/bin/python -m pytest tests/test_dashboard_flows.py -v
# Expected: ImportError
```

### Step 3: Implement `gateway_python/gateway/dashboard_flows.py`

```python
"""Pure function: build Node-RED Dashboard flows.json from gateway state."""
import re
from typing import Iterable

# Node-red-dashboard v2.x node types we generate
UI_TAB = "ui_tab"
UI_GROUP = "ui_group"
UI_BASE = "ui_base"
UI_GAUGE = "ui_gauge"
UI_CHART = "ui_chart"
UI_TEXT = "ui_text"
MQTT_IN = "mqtt in"

# Tag dtype → (use_gauge, default_min, default_max)
NUMERIC_DTYPES = {
    "u16": (0, 65535), "u32": (0, 4294967295),
    "u64": (0, 100),    "i16": (-100, 100),
    "i32": (-100, 100), "i64": (-100, 100),
    "f32": (0.0, 100.0),
}
TEXT_DTYPES = {"bit", "bool", "ascii", "utf8"}


def _safe_id(prefix: str, *parts: str, _seen: set | None = None) -> str:
    if _seen is None: _seen = set()
    raw = re.sub(r"[^A-Za-z0-9_]", "_", "_".join([prefix, *parts]))
    n = 1
    base = raw
    while raw in _seen:
        n += 1; raw = f"{base}_{n}"
    _seen.add(raw); return raw


def _ui_tab_node(): ...
def _ui_base_node(): ...
def _ui_group_node(name, tab_id, order, width=12): ...
def _ui_gauge_node(name, label, group_id, min, max, seg1, seg2, width=6, height=4): ...
def _ui_chart_node(name, label, group_id, width=12, height=4): ...
def _ui_text_node(name, label, group_id, format, height): ...
def _mqtt_in_node(name, topic, tab_id, wires, x, y): ...


def build_dashboard_flows(tasks: dict, anomaly_channels: dict | None = None,
                          recent_audit: list | None = None,
                          recent_anomalies: list | None = None,
                          broker: str = "localhost", port: int = 1883) -> list[dict]:
    """Generate a Node-RED Dashboard flows.json array.
    
    Numeric tags → ui_gauge + ui_chart.
    bit/bool/ascii/utf8 → ui_text.
    Anomaly channel low/high → gauge seg1/seg2.
    """
    # 1. base structure: tab + ui_base + 5 groups
    # 2. Overview text (subscribes to 1052os/events/status)
    # 3. Per-tag nodes (split by protocol into Modbus / OPC UA groups)
    # 4. Anomalies text (subscribes to 1052os/events/anomaly/#)
    # 5. Writes text (subscribes to 1052os/events/+/+)
```

### Step 4: Verify GREEN

```bash
.venv/bin/python -m pytest tests/test_dashboard_flows.py -v
# Expected: 8/8 pass
```

### Step 5: No regression

```bash
.venv/bin/python -m pytest tests/ -q
# Expected: 99 + 8 = 107 pass + 5 skip
```

### Step 6: Commit

```bash
git add gateway_python/gateway/dashboard_flows.py gateway_python/tests/test_dashboard_flows.py
git commit -m "feat(nodered-sub4): add dashboard_flows.build_dashboard_flows()
```

---

## Task 2: `GET /api/nodered/dashboard` endpoint

**Files:**
- Modify: `gateway_python/gateway/server.py`

### Step 1: Add endpoint

```python
from gateway.dashboard_flows import build_dashboard_flows


@app.get("/api/nodered/dashboard")
def nodered_dashboard():
    """Generate and serve a Node-RED Dashboard flows.json."""
    tasks = _collector.tasks if _collector else {}
    channels = _anomaly.channels if _anomaly else {}
    recent_audit = []
    recent_anomalies = []
    # Pull last 10 audit + anomalies if TDengine is up
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
```

### Step 2: Verify

```bash
.venv/bin/python -c "from gateway.server import app; print('OK')"
.venv/bin/python -m pytest tests/ -q
```

### Step 3: Commit

```bash
git add gateway_python/gateway/server.py
git commit -m "feat(nodered-sub4): add /api/nodered/dashboard endpoint"
```

---

## Task 3: Frontend "Export dashboard.json" button

**Files:**
- Modify: `frontend/public/industrial-gateway/index.html`

### Step 1: Add button after the flows.json button

```html
<button class="export-btn" id="export-dashboard-btn" type="button">⬇ Export dashboard.json</button>
```

### Step 2: Add click handler near the existing flows button handler

```js
document.getElementById('export-dashboard-btn')?.addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = '/industrial-gateway/api/nodered/dashboard'
  a.download = '1052os-dashboard.json'
  document.body.appendChild(a); a.click(); a.remove()
})
```

### Step 3: Verify HTML balance + commit

---

## Task 4: User docs §10

**Files:**
- Modify: `docs/node-red-integration.md`

Append:

```markdown
## §10 Building a Node-RED Dashboard (mirror)

Generate a Node-RED Dashboard that visualizes all collector tags.

### One-time setup

1. Install `node-red-dashboard` in your Node-RED instance:
   - Open Node-RED → top-right menu → Manage palette → Install tab
   - Search "node-red-dashboard" → Install
   - Restart Node-RED

### Export dashboard

1. In §01 NR Bridge panel, click "⬇ Export dashboard.json"
2. Browser downloads `1052os-dashboard.json`
3. In Node-RED → top-right menu → Import → select file
4. Deploy

### View

Visit `http://localhost:1880/ui` to see the dashboard.

Tabs: single "1052-OS Industrial" tab with groups:
- **Overview**: gateway status (live)
- **Modbus Tags**: gauge + chart per numeric tag
- **OPC UA Tags**: same for OPC UA
- **Anomalies**: live anomaly feed
- **Recent Writes**: audit log feed

### Threshold colors

For tags with anomaly channels configured, the gauge uses:
- Green: below `low`
- Yellow: between `low` and `high`
- Red: above `high`

Edit `channels` via REST `/api/anomaly/channel/add` to customize.
```

---

## Task 5: E2E test

**Files:**
- Create: `gateway_python/tests/test_dashboard_e2e.py`

Tests:
1. Module imports
2. Endpoint registered on app
3. HTTP endpoint returns 200 with attachment header (skips if no gateway)
4. Endpoint returns base flows for empty tasks

---

## Task 6: DoD + tag

```bash
.venv/bin/python -c "import py_compile, pathlib; [py_compile.compile(str(p), doraise=True) for p in pathlib.Path('gateway').glob('*.py')]; print('OK')"
.venv/bin/python -m pytest tests/ -v
# Expected: 107 pass + 5 skip

git tag nodered-sub4-v0.1
```

---

## Self-Review

**Spec coverage:**
- Goals → Tasks 1, 2, 3, 4, 5
- Architecture → Tasks 1 (pure function) + 2 (endpoint)
- Widget mapping → Task 1 (gauge/chart/text per dtype)
- Threshold-as-segments → Task 1 (channels argument)
- DoD → Task 6

**Risks covered:**
- Dashboard not installed → doc §10 explicit install step
- ID collisions → _safe_id() reused from Sub-2
- Min/max defaults → numeric dtype table; anomaly channel overrides
- Empty tasks → base flows + 1 overview text widget

**Why Sub-4 is also smaller than Sub-1/2/3:**
- No new protocol / library
- Pure function + endpoint + UI button + docs
- ~280 LoC implementation vs Sub-2's ~120 LoC (more widgets per task)