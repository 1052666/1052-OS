# 2026-06-17 — Node-RED Integration Sub-2 (Flow Export) Implementation Plan

## Goal

Enable the 1052-OS industrial gateway to generate a downloadable Node-RED
`flows.json` containing one `mqtt in` + `debug` node pair per collector task,
grouped by protocol into separate tabs. Users can import this file directly
into Node-RED and immediately see all realtime values.

## Architecture

```
collector.tasks ─▶ nodered_flows.build_flows_json() ─▶ GET /api/nodered/flows
                                                              │
                                                              ▼
                                          Browser downloads 1052os-flows.json
                                                              │
                                                              ▼
                                            User imports into Node-RED
```

- `nodered_flows.py` is a **pure function** — no I/O, no state, fully testable
- Endpoint serves `Content-Disposition: attachment` for browser save dialog
- Frontend button in §01 NR Bridge panel triggers download

## Tech Stack

- Python 3.14, FastAPI, pydantic
- pytest (TDD red-green)
- Node-RED 3.x/4.x/5.x compatibility (only common fields)

## Spec Reference

`docs/superpowers/specs/2026-06-17-node-red-integration-sub2-design.md`

## Sub-1 Pre-requisites (already complete, verified)

- `build_tag_catalog()` exists in `nodered_tags.py`
- `MqttPublisher` exists and uses `localhost:1883` default
- `/api/nodered/status` endpoint pattern exists
- §01 NR Bridge panel exists with `kpi-nodered` cell
- `docs/node-red-integration.md` user doc exists

## Task Summary

| # | Task | Files | TDD | Subagent |
|---|------|-------|-----|----------|
| 1 | `build_flows_json()` core + `_safe_id()` | nodered_flows.py + test | ✓ | impl + 2 reviewers |
| 2 | `GET /api/nodered/flows` endpoint | server.py | — | impl + reviewer |
| 3 | Frontend export button | index.html | — | impl + reviewer |
| 4 | Update user docs | node-red-integration.md | — | impl + reviewer |
| 5 | E2E test | test_nodered_flows_e2e.py | ✓ | impl + reviewer |
| 6 | DoD verification | — | — | self |

---

## Task 1: `nodered_flows.build_flows_json()` module + tests

**Files:**
- Create: `gateway_python/gateway/nodered_flows.py`
- Create: `gateway_python/tests/test_nodered_flows.py`

### Step 1: Write failing tests (RED)

Create `gateway_python/tests/test_nodered_flows.py`:

```python
"""Unit tests for nodered_flows — no broker required."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.nodered_flows import build_flows_json, _safe_id
from gateway.collector import CollectTask


def _mk_task(tid, **kw):
    return CollectTask(
        id=tid,
        protocol=kw.get("protocol", "modbus"),
        table=kw.get("table", "raw_data"),
        site=kw.get("site", "default"),
        device=kw.get("device", "plc1"),
        dtype=kw.get("dtype", "u16"),
        endian=kw.get("endian", "ABCD"),
        interval=kw.get("interval", 1.0),
    )


def test_safe_id_replaces_special_chars():
    assert _safe_id("in", "site1", "plc-1", "TI.101") == "in_site1_plc_1_TI_101"


def test_safe_id_preserves_underscores():
    assert _safe_id("in", "a", "b_c") == "in_a_b_c"


def test_empty_tasks_returns_tabs_and_broker_only():
    flows = build_flows_json({})
    types = sorted(n["type"] for n in flows)
    assert types == ["mqtt-broker", "tab", "tab"]
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["broker"] == "localhost"
    assert broker["port"] == "1883"
    assert broker["protocolVersion"] == "4"
    assert isinstance(broker["port"], str)


def test_single_modbus_tag_creates_mqtt_in_and_debug():
    tasks = {"440001": _mk_task("440001", site="site1", device="plc1")}
    flows = build_flows_json(tasks)
    types = [n["type"] for n in flows]
    assert types.count("mqtt in") == 1
    assert types.count("debug") == 1
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["topic"] == "1052os/site1/plc1/440001/value"
    assert in_node["broker"] == "brk_1052os"
    assert in_node["z"] == "tab_modbus"
    assert in_node["qos"] == "0"


def test_opcua_tag_uses_opcua_tab():
    tasks = {"x": _mk_task("x", protocol="opcua", site="s1", device="d1")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["z"] == "tab_opcua"


def test_wires_connect_mqtt_in_to_debug():
    tasks = {"440001": _mk_task("440001")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    debug_id = in_node["wires"][0][0]
    debug_node = next(n for n in flows if n["id"] == debug_id)
    assert debug_node["type"] == "debug"
    assert debug_node["z"] == in_node["z"]


def test_id_normalization_handles_tag_with_special_chars():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", protocol="modbus")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    assert in_node["id"] == "in_default_raw_data_TI_101_PV"


def test_idempotent_regeneration():
    tasks = {"440001": _mk_task("440001"), "440002": _mk_task("440002")}
    f1 = build_flows_json(tasks)
    f2 = build_flows_json(tasks)
    assert f1 == f2


def test_port_parameter_overrides_default():
    flows = build_flows_json({}, port=1884)
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["port"] == "1884"


def test_layout_coordinates_are_integers():
    tasks = {f"t{i}": _mk_task(f"t{i}") for i in range(8)}
    flows = build_flows_json(tasks)
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    for n in in_nodes:
        assert isinstance(n["x"], int)
        assert isinstance(n["y"], int)
        assert n["x"] >= 0 and n["y"] >= 0
```

### Step 2: Verify RED

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/test_nodered_flows.py -v
```

Expected: ImportError or all tests fail (module not yet created).

### Step 3: Implement `gateway_python/gateway/nodered_flows.py`

```python
"""
1052-OS Industrial Gateway — Node-RED flows.json builder
Generates a Node-RED-compatible flows.json from collector tasks.
"""
import re
from typing import Iterable


def _safe_id(prefix: str, *parts: str, _seen: set | None = None) -> str:
    """Build a Node-RED-safe node ID from prefix and tag-name parts.

    Replaces non-alphanumeric chars with '_'. Ensures uniqueness via _seen set.
    """
    if _seen is None:
        _seen = set()
    raw = re.sub(r"[^A-Za-z0-9_]", "_", "_".join([prefix, *parts]))
    base = raw
    n = 1
    while raw in _seen:
        n += 1
        raw = f"{base}_{n}"
    _seen.add(raw)
    return raw


def _broker_node(broker: str, port: int) -> dict:
    return {
        "id": "brk_1052os",
        "type": "mqtt-broker",
        "name": "1052-OS Broker",
        "broker": broker,
        "port": str(port),  # Node-RED exports port as STRING
        "clientid": "",
        "usetls": False,
        "protocolVersion": "4",  # MQTT 3.1.1
        "keepalive": "60",
        "cleansession": True,
        "autoConnect": True,
    }


def _tab_node(protocol: str) -> dict:
    return {
        "id": f"tab_{protocol}",
        "type": "tab",
        "label": protocol.upper() if protocol == "opcua" else protocol.capitalize(),
        "disabled": False,
        "info": "",
    }


def _mqtt_in_node(node_id: str, tab_id: str, name: str, topic: str,
                  broker_id: str, x: int, y: int, debug_id: str) -> dict:
    return {
        "id": node_id,
        "type": "mqtt in",
        "z": tab_id,
        "name": name,
        "topic": topic,
        "qos": "0",
        "datatype": "auto",
        "broker": broker_id,
        "nl": False,
        "rap": True,
        "rh": 0,
        "inputs": 0,
        "x": x,
        "y": y,
        "wires": [[debug_id]],
    }


def _debug_node(node_id: str, tab_id: str, x: int, y: int) -> dict:
    return {
        "id": node_id,
        "type": "debug",
        "z": tab_id,
        "name": "",
        "active": True,
        "tosidebar": True,
        "console": False,
        "tostatus": False,
        "complete": "payload",
        "targetType": "msg",
        "x": x,
        "y": y,
        "wires": [],
    }


def build_flows_json(tasks: dict, broker: str = "localhost", port: int = 1883) -> list[dict]:
    """Generate a Node-RED flows.json array from collector tasks.

    Layout: 4 nodes per row, 200px column / 80px row. OPC UA group offset +400 in y.
    Returns a list of node dicts; safe to serialize with json.dumps().
    """
    flows: list[dict] = []
    flows.append(_tab_node("modbus"))
    flows.append(_tab_node("opcua"))
    flows.append(_broker_node(broker, port))

    seen_ids: set[str] = {"tab_modbus", "tab_opcua", "brk_1052os"}

    # Group by protocol, preserve sorted tag order for determinism
    modbus_tasks = []
    opcua_tasks = []
    for tid in sorted(tasks.keys()):
        t = tasks[tid]
        (modbus_tasks if t.protocol == "modbus" else opcua_tasks).append(t)

    def _emit(t, idx, tab_id, y_offset=0):
        device = t.device or t.table
        site = t.site
        topic = f"1052os/{site}/{device}/{t.id}/value"
        in_id = _safe_id("in", site, device, t.id, _seen=seen_ids)
        dbg_id = _safe_id("dbg", site, device, t.id, _seen=seen_ids)
        col, row = idx % 4, idx // 4
        x, y = 240 + col * 200, 120 + row * 80 + y_offset
        flows.append(_mqtt_in_node(in_id, tab_id, f"{site}/{device}/{t.id}", topic,
                                   "brk_1052os", x, y, dbg_id))
        flows.append(_debug_node(dbg_id, tab_id, x + 190, y))

    for i, t in enumerate(modbus_tasks):
        _emit(t, i, "tab_modbus")
    for i, t in enumerate(opcua_tasks):
        _emit(t, i, "tab_opcua", y_offset=400)

    return flows
```

### Step 4: Verify GREEN

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/test_nodered_flows.py -v
```

Expected: all 10 tests pass.

### Step 5: No regression check

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/ -v
```

Expected: all prior tests still green (58+10 = 68+1 skip).

### Step 6: Commit

```bash
cd /Users/easonliu/1052-OS
git add gateway_python/gateway/nodered_flows.py gateway_python/tests/test_nodered_flows.py
git commit -m "feat(nodered-sub2): add nodered_flows.build_flows_json() pure function

- _safe_id() handles special chars (-, ., /) → _
- Per-protocol tabs: tab_modbus, tab_opcua
- mqtt-broker config node with anonymous localhost:1883
- mqtt in + debug pair per tag with wires connection
- Layout: 4 cols × N rows, 200/80 px spacing
- 10 unit tests covering TDD red-green for ID, layout, idempotency"
```

---

## Task 2: `GET /api/nodered/flows` endpoint

**Files:**
- Modify: `gateway_python/gateway/server.py`

### Step 1: Add import

```python
from gateway.nodered_flows import build_flows_json
```

### Step 2: Add endpoint in the `NODE-RED BRIDGE` section (after `/api/nodered/publish`)

```python
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
```

`Response` is from `fastapi.responses` (add to imports if not present):
```python
from fastapi.responses import Response
```

### Step 3: Verify

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -c "from gateway.server import app; print('OK')"
```

Expected: OK (no import errors).

### Step 4: Smoke test (optional, requires gateway running)

```bash
cd /Users/easonliu/1052-OS/gateway_python
uvicorn gateway.server:app --port 8765 &
sleep 2
curl -sI http://localhost:8765/api/nodered/flows | head -5
curl -s http://localhost:8765/api/nodered/flows | python3 -m json.tool | head -20
kill %1
```

Expected: 200 OK, Content-Disposition with filename, body is valid JSON array.

If TDengine isn't running, the smoke test will fail at /api/td/connect — that's OK,
skip with note in report.

### Step 5: Commit

```bash
cd /Users/easonliu/1052-OS
git add gateway_python/gateway/server.py
git commit -m "feat(nodered-sub2): add GET /api/nodered/flows endpoint

- Serves build_flows_json() as application/json
- Content-Disposition: attachment; filename='1052os-flows.json'
- Returns empty flows (just tabs + broker) when no tasks"
```

---

## Task 3: Frontend export button in §01 NR Bridge panel

**Files:**
- Modify: `frontend/public/industrial-gateway/index.html`

### Step 1: Add the button

In the `.kpi` cell for `kpi-nodered` (added in Sub-1 Task 10), add an
"Export flows.json" button after the topics div:

```html
<div class="kpi-foot">
  <div class="bar" id="kpi-nodered-bar"></div>
  <div class="kpi-recent" id="kpi-nodered-topics"></div>
  <button class="export-btn" id="export-flows-btn" type="button">
    ⬇ Export flows.json
  </button>
</div>
```

### Step 2: Add CSS for the button (near existing `.kpi-recent` rule)

```css
.export-btn {
  margin-top: 6px;
  display: block;
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  font-family: var(--mono, monospace);
  background: var(--ok-soft, #d3f3d3);
  color: var(--ok, #1a7a1a);
  border: 1px solid currentColor;
  border-radius: 4px;
  cursor: pointer;
}
.export-btn:hover { opacity: 0.85; }
.export-btn:disabled { opacity: 0.4; cursor: not-allowed; }
```

(Use existing CSS variables if `--mono`, `--ok-soft`, `--ok` exist; otherwise
fall back to hardcoded values — the existing panel already uses these vars.)

### Step 3: Add JS handler

In the existing `<script>` block, after the `refresh()` function or near other
button handlers, add:

```js
document.getElementById('export-flows-btn').addEventListener('click', async () => {
  const btn = document.getElementById('export-flows-btn')
  btn.disabled = true
  btn.textContent = '⏳ Generating...'
  try {
    const r = await fetch('/industrial-gateway/api/nodered/flows')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '1052os-flows.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    btn.textContent = '✓ Downloaded'
  } catch (e) {
    btn.textContent = '✗ Failed'
    console.error('Export flows failed:', e)
  } finally {
    setTimeout(() => {
      btn.disabled = false
      btn.textContent = '⬇ Export flows.json'
    }, 2000)
  }
})
```

### Step 4: Verify

```bash
# Quick HTML balance check
.venv/bin/python -c "
import html.parser
class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errs = 0
    def handle_starttag(self, tag, attrs):
        if tag not in ('br','hr','img','input','meta','link'):
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errs += 1
p = P()
p.feed(open('frontend/public/industrial-gateway/index.html').read())
print(f'errs={p.errs} unclosed={p.stack}')"
```

Expected: `errs=0 unclosed=[]` (or small number that matches the existing baseline).

### Step 5: Commit

```bash
cd /Users/easonliu/1052-OS
git add frontend/public/industrial-gateway/index.html
git commit -m "feat(nodered-sub2): add Export flows.json button to §01 NR Bridge panel

- Click triggers fetch + blob download of 1052os-flows.json
- Button states: idle → Generating → Downloaded/Failed → idle
- CSS matches existing §01 .kpi styles"
```

---

## Task 4: Update user documentation

**Files:**
- Modify: `docs/node-red-integration.md`

### Step 1: Add a new section after "Adding a tag in Node-RED (3 steps)"

Insert this section:

```markdown
## Exporting flows.json (one-click onboarding)

Click the **"⬇ Export flows.json"** button in the gateway §01 System Overview
panel, or hit the API directly:

```bash
curl -O -J http://localhost:8765/api/nodered/flows
```

This downloads `1052os-flows.json` containing one `mqtt in` + `debug` pair per
collector task, grouped by protocol into tabs (`Modbus` / `OPC UA`).

### Importing into Node-RED

1. Open Node-RED editor (`http://localhost:1880`)
2. Click the hamburger menu (top right) → **Import** → **select a file to import**
3. Choose `1052os-flows.json`
4. Click **Import** to drop the nodes onto the canvas
5. Click **Deploy** (red button, top right)

All `mqtt in` nodes are pre-wired to `debug` nodes — you should immediately see
realtime values appearing in the debug sidebar.

### Regenerating after adding tags

The exported `flows.json` is a snapshot of the tag catalog at the time of
download. After adding new collect tasks via `/api/collector/task/add` (or
the configure drawer), click the export button again and re-import. New
`mqtt in` nodes will be added; old ones are unaffected (Node-RED de-duplicates
by `id`).
```

### Step 2: Verify

```bash
wc -l /Users/easonliu/1052-OS/docs/node-red-integration.md
```

Expected: ~80+ lines (was 53).

### Step 3: Commit

```bash
cd /Users/easonliu/1052-OS
git add docs/node-red-integration.md
git commit -m "docs(nodered-sub2): add Export flows.json + Import into Node-RED guide

- §01 button reference
- API curl alternative
- 5-step Node-RED Import procedure
- Regeneration pattern after adding tags"
```

---

## Task 5: End-to-end test for the endpoint

**Files:**
- Create: `gateway_python/tests/test_nodered_flows_e2e.py`

### Step 1: Write E2E test

```python
"""E2E test: verify /api/nodered/flows endpoint returns valid flows.json."""
import json
import socket
import sys
import time
from pathlib import Path
from urllib import request, error

import pytest

GATEWAY_URL = "http://localhost:8765"


def _gateway_up(host="localhost", port=8765, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_endpoint_returns_200_and_attachment_header():
    try:
        req = request.Request(f"{GATEWAY_URL}/api/nodered/flows")
        with request.urlopen(req, timeout=5) as r:
            assert r.status == 200
            assert r.headers["Content-Type"].startswith("application/json")
            cd = r.headers.get("Content-Disposition", "")
            assert "attachment" in cd
            assert "1052os-flows.json" in cd
    except error.URLError as e:
        pytest.skip(f"Gateway not reachable: {e}")


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_endpoint_body_is_valid_flows_array():
    try:
        with request.urlopen(f"{GATEWAY_URL}/api/nodered/flows", timeout=5) as r:
            data = json.loads(r.read().decode())
            assert isinstance(data, list)
            # At minimum: 2 tabs + 1 broker
            types = {n["type"] for n in data}
            assert "tab" in types
            assert "mqtt-broker" in types
    except error.URLError as e:
        pytest.skip(f"Gateway not reachable: {e}")
```

### Step 2: Run E2E test

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/test_nodered_flows_e2e.py -v
```

Expected: skip (gateway not running) OR pass (if gateway happens to be up).

### Step 3: Full pytest run

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/ -v
```

Expected: all green (no regressions).

### Step 4: Commit

```bash
cd /Users/easonliu/1052-OS
git add gateway_python/tests/test_nodered_flows_e2e.py
git commit -m "test(nodered-sub2): add E2E test for /api/nodered/flows endpoint

- Skip if gateway not running
- Verify 200 + Content-Disposition + Content-Type
- Verify body is a valid flows.json array with at least tabs+broker"
```

---

## Task 6: Final DoD verification

**Files:** none (verification only)

### Step 1: Compile check

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -c "
import py_compile, pathlib
files = list(pathlib.Path('gateway').glob('*.py'))
[py_compile.compile(str(p), doraise=True) for p in files]
print(f'{len(files)} files compile clean')

# Import check
from gateway import server, mqtt_publisher, nodered_tags, nodered_flows, status_heartbeat
print('All modules import OK')
"
```

Expected: clean compile, all imports OK.

### Step 2: Full test suite

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -m pytest tests/ -v
```

Expected: all green (or skip pattern).

### Step 3: Live broker round-trip (existing Sub-1 publisher still works)

```bash
cd /Users/easonliu/1052-OS/gateway_python
.venv/bin/python -c "
from gateway.mqtt_publisher import MqttPublisher
import time
pub = MqttPublisher(); pub.start(); time.sleep(0.5)
print('status:', pub.status())
pub.stop()
"
```

Expected: `broker: connected`, no errors.

### Step 4: Walk through DoD

- [ ] `build_flows_json({})` → 3 nodes (2 tabs + broker)
- [ ] `build_flows_json(N tasks)` → `2 + 1 + 2*N` nodes
- [ ] modbus → tab_modbus, opcua → tab_opcua
- [ ] broker port is `"1883"` (string)
- [ ] ID normalization handles `-`, `.`, `/`
- [ ] wires connect mqtt in → debug
- [ ] Idempotent (same input → same output)
- [ ] `/api/nodered/flows` returns 200 + Content-Disposition
- [ ] Frontend §01 has Export button
- [ ] `docs/node-red-integration.md` updated
- [ ] All pytest green

### Step 5: Tag the release

```bash
cd /Users/easonliu/1052-OS
git tag nodered-sub2-v0.1
git log --oneline -10
```

---

## Self-Review

**Spec coverage:**
- Goals → Task 1 (core), Task 2 (endpoint), Task 3 (button)
- Architecture → Task 1 (pure function)
- Data flow → Task 1 (node shapes), Task 2 (HTTP)
- Error handling → Task 1 (empty tasks), Task 1 (ID dedup)
- Testing → Task 1 (unit), Task 5 (E2E)
- DoD → Task 6 (final)

**Risks covered:**
- ID conflicts → `_safe_id()` with `_seen` set + counter
- Special chars → regex `[^A-Za-z0-9_]` replacement
- broker port type → `str(port)` explicit
- Node-RED version compat → only common 3.x/4.x/5.x fields
- Layout crowding → 4 cols × N rows, well below viewport for N < 100
