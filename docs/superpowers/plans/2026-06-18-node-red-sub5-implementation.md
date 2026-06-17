# 2026-06-18 — Node-RED Integration Sub-5 (Control Widgets) Implementation Plan

## Goal

Generate Node-RED Dashboard control widgets (ui_switch / ui_numeric) that
fire write commands through Sub-3's CommandHandler. Users can toggle
coils and set registers from `http://localhost:1880/ui` without manual
node-dragging.

## Architecture (recap)

```
dashboard_flows.build_dashboard_flows(tasks, channels, include_controls=True)
    ↑ pure function (extended from Sub-4)
server.GET /api/nodered/dashboard?controls=true
    ↑ HTTP (query param, not new endpoint)
frontend "Export control dashboard" button
    ↑ HTTP
```

## Tech Stack

- Python 3.14, FastAPI
- pytest (TDD red-green)
- Existing: `dashboard_flows` (Sub-4), `command_handler` (Sub-3), `nodered_tags` (Sub-1)

## Spec Reference

`docs/superpowers/specs/2026-06-18-node-red-integration-sub5-design.md`

## Sub-3/4 Pre-requisites (verified)

- `_collector.tasks` — dict of CollectTask (with `mb_address`, `mb_host`, `mb_port`,
  `mb_unit`, `ua_url`, `ua_node_id`, `dtype`)
- `_anomaly.channels` — dict of ChannelConfig (low/high)
- `build_dashboard_flows()` — Sub-4 generator (extended with `include_controls`)
- CommandHandler payload format (Sub-3): documented in `command_handler.py` docstring

## Task Summary

| # | Task | Files | TDD | Subagent |
|---|------|-------|-----|----------|
| 1 | `build_dashboard_flows(..., include_controls=True)` + tests | dashboard_flows.py + test | ✓ | impl + reviewers |
| 2 | `GET /api/nodered/dashboard?controls=true` query param | server.py | — | impl + reviewer |
| 3 | Frontend "Export control dashboard" button | index.html | — | impl + reviewer |
| 4 | User docs §11 | node-red-integration.md | — | impl + reviewer |
| 5 | E2E test for controls endpoint | test_dashboard_e2e.py (extend) | ✓ | impl + reviewer |
| 6 | DoD + tag nodered-sub5-v0.1 | — | — | self |

---

## Task 1: `build_dashboard_flows(include_controls=...)` extension

**Files:**
- Modify: `gateway_python/gateway/dashboard_flows.py`
- Create: `gateway_python/tests/test_dashboard_control_flows.py`

### Step 1: Write failing tests (RED)

```python
# test_dashboard_control_flows.py — see spec §Testing for 13 tests
```

### Step 2: Verify RED

```bash
cd gateway_python && .venv/bin/python -m pytest tests/test_dashboard_control_flows.py -v
# Expected: ImportError or all tests fail (function signature change)
```

### Step 3: Implement extension in `gateway/dashboard_flows.py`

```python
# At the top, add constants:
CONTROL_WRITE_TOPIC = {
    "modbus": "1052os/cmd/write/modbus",
    "opcua":  "1052os/cmd/write/opcua",
}

# New: dtype → (modbus_cmd, value_parser)
MODBUS_CMD_BY_DTYPE = {
    "bit":  ("write_coil",     "msg.payload === '1' || msg.payload === 1 || msg.payload === true"),
    "u16":  ("write_register", "parseInt(msg.payload, 10)"),
    "i16":  ("write_register", "parseInt(msg.payload, 10)"),
    "u32":  ("write_float32",  "parseFloat(msg.payload)"),
    "i32":  ("write_float32",  "parseFloat(msg.payload)"),
    "f32":  ("write_float32",  "parseFloat(msg.payload)"),
    "u64":  ("write_registers", "parseFloat(msg.payload)"),  # v0.2 TODO
    "i64":  ("write_registers", "parseFloat(msg.payload)"),  # v0.2 TODO
}
WRITABLE_DTYPES = {"bit", "u16", "i16", "u32", "i32", "f32", "u64", "i64"}


# New helpers:
def _ui_numeric_node(node_id, label, group_id, order, min_v, max_v, step, topic, x, y, wires):
    return {
        "id": node_id, "type": "ui_numeric", "z": "tab_1052os",
        "g": group_id, "group": group_id, "name": label, "label": label,
        "order": order, "width": 6, "height": 1,
        "min": min_v, "max": max_v, "step": step, "format": "{{value}}",
        "wrap": False, "topic": topic, "topicType": "str", "x": x, "y": y, "wires": wires,
    }


def _ui_switch_node(node_id, label, group_id, order, topic, x, y, wires):
    return {
        "id": node_id, "type": "ui_switch", "z": "tab_1052os",
        "g": group_id, "group": group_id, "name": label, "label": label,
        "order": order, "width": 6, "height": 1,
        "onvalue": "1", "onvalueType": "str",
        "offvalue": "0", "offvalueType": "str",
        "topic": topic, "topicType": "str", "x": x, "y": y, "wires": wires,
    }


def _function_node(node_id, name, func, x, y, wires):
    return {
        "id": node_id, "type": "function", "z": "tab_1052os",
        "name": name, "func": func, "outputs": 1, "timeout": "",
        "noerr": 0, "initialize": "", "finalize": "", "libs": [],
        "x": x, "y": y, "wires": wires,
    }


def _mqtt_out_node(node_id, name, topic, x, y):
    return {
        "id": node_id, "type": "mqtt out", "z": "tab_1052os",
        "name": name, "topic": topic, "qos": "", "retain": "",
        "broker": "brk_1052os", "x": x, "y": y, "wires": [],
    }


def _build_function_body_modbus(tag_id, host, port, unit_id, address, dtype) -> str:
    cmd, value_expr = MODBUS_CMD_BY_DTYPE.get(dtype, MODBUS_CMD_BY_DTYPE["f32"])
    return (
        f"// 1052-OS: wrap raw value into CommandHandler write payload for {tag_id}\n"
        f"msg.payload = JSON.stringify({{\n"
        f"    request_id: '{tag_id}-' + Date.now(),\n"
        f"    cmd: '{cmd}',\n"
        f"    host: '{host}', port: {port}, unit_id: {unit_id},\n"
        f"    address: {address},\n"
        f"    value: {value_expr}\n"
        f"}});\n"
        f"return msg;\n"
    )


def _build_function_body_opcua(tag_id, url, node_id) -> str:
    return (
        f"// 1052-OS: wrap raw value into CommandHandler write payload for {tag_id}\n"
        f"msg.payload = JSON.stringify({{\n"
        f"    request_id: '{tag_id}-' + Date.now(),\n"
        f"    cmd: 'write_node',\n"
        f"    url: '{url}',\n"
        f"    node_id: '{node_id}',\n"
        f"    value: msg.payload\n"
        f"}});\n"
        f"return msg;\n"
    )


def _emit_control_widgets(tasks: dict, channels: dict, seen_ids: set) -> list[dict]:
    """For each writable task, generate ui_switch/ui_numeric + function + mqtt out."""
    nodes: list[dict] = []
    # First pass: collect writable tasks by protocol
    modbus_writable, opcua_writable = [], []
    for tid in sorted(tasks.keys()):
        t = tasks[tid]
        if t.dtype not in WRITABLE_DTYPES:
            continue
        if t.protocol == "opcua":
            opcua_writable.append(t)
        else:
            modbus_writable.append(t)
    if not modbus_writable and not opcua_writable:
        return nodes  # no command group, no nodes

    # Groups
    if modbus_writable:
        gid = _safe_id("grp", "modbus", "cmd", _seen=seen_ids)
        nodes.append(_ui_group_node("Modbus Commands", order=6, width=12, group_id=gid))
    if opcua_writable:
        gid = _safe_id("grp", "opcua", "cmd", _seen=seen_ids)
        nodes.append(_ui_group_node("OPC UA Commands", order=7, width=12, group_id=gid))

    def _emit_series(task_list, group_id, y_base):
        for i, t in enumerate(task_list):
            is_bit = t.dtype == "bit"
            wid = _safe_id(("sw" if is_bit else "num"), t.id, _seen=seen_ids)
            fn_id = _safe_id("fn", t.id, _seen=seen_ids)
            out_id = _safe_id("out", t.id, _seen=seen_ids)
            topic = CONTROL_WRITE_TOPIC[t.protocol]
            x_w, x_f, x_o = 140, 340, 540
            y = y_base + (i // 2) * 80

            # Widget
            if is_bit:
                nodes.append(_ui_switch_node(
                    wid, t.id, group_id, order=i + 1, topic=topic,
                    x=x_w, y=y, wires=[[fn_id]],
                ))
            else:
                # min/max from anomaly channel or default range
                ch = channels.get(t.id) if channels else None
                if ch is not None:
                    min_v, max_v = ch.low, ch.high
                else:
                    min_v, max_v = DEFAULT_RANGE.get(t.dtype, (0, 100))
                step = 1 if t.dtype in ("u16", "i16", "u32", "i32") else 0.1
                nodes.append(_ui_numeric_node(
                    wid, t.id, group_id, order=i + 1,
                    min_v=min_v, max_v=max_v, step=step, topic=topic,
                    x=x_w, y=y, wires=[[fn_id]],
                ))

            # Function body
            if t.protocol == "opcua":
                func_body = _build_function_body_opcua(
                    t.id, t.ua_url, t.ua_node_id
                )
            else:
                func_body = _build_function_body_modbus(
                    t.id, t.mb_host, t.mb_port, t.mb_unit, t.mb_address, t.dtype
                )
            nodes.append(_function_node(
                fn_id, name=f"wrap: {t.id} {t.protocol}",
                func=func_body, x=x_f, y=y, wires=[[out_id]],
            ))

            # MQTT out
            nodes.append(_mqtt_out_node(
                out_id, name=f"mqtt: {t.protocol} write",
                topic=topic, x=x_o, y=y,
            ))

    if modbus_writable:
        _emit_series(modbus_writable, "grp_modbus_cmd", y_base=680)
    if opcua_writable:
        _emit_series(opcua_writable, "grp_opcua_cmd", y_base=1080)
    return nodes


# Update _ui_group_node signature to accept group_id explicitly (or rename existing)
# Actually, _ui_group_node already takes name and order; for control we need to
# provide a deterministic id matching "grp_modbus_cmd" / "grp_opcua_cmd".
# Refactor: make _ui_group_node accept an explicit id, or use _safe_id wrapper.
```

Note: refactor `_ui_group_node` to accept an explicit id parameter (or have the
control emit function call it with the desired id). Both Sub-4 tests and the
new tests must pass.

```python
# Existing _ui_group_node:
def _ui_group_node(name: str, order: int, width: int = 12) -> dict:
    return {
        "id": f"grp_{name.lower().replace(' ', '_')}",
        ...
    }

# Refactor to:
def _ui_group_node(name: str, order: int, width: int = 12,
                   group_id: str | None = None) -> dict:
    return {
        "id": group_id or f"grp_{name.lower().replace(' ', '_')}",
        ...
    }
```

```python
# Update build_dashboard_flows() signature:
def build_dashboard_flows(tasks, anomaly_channels=None,
                          recent_audit=None, recent_anomalies=None,
                          include_controls=False,
                          broker="localhost", port=1883) -> list[dict]:
    """..."""
    flows = []
    flows.append(_ui_tab_node())
    flows.append(_ui_base_node())
    flows.append(_ui_group_node("Overview", 1, width=12))
    flows.append(_ui_group_node("Modbus Tags", 2, width=12))
    flows.append(_ui_group_node("OPC UA Tags", 3, width=12))
    flows.append(_ui_group_node("Anomalies", 4, width=12))
    flows.append(_ui_group_node("Recent Writes", 5, width=12))

    seen_ids: set[str] = {
        "tab_1052os", "ui_base",
        "grp_overview", "grp_modbus_tags", "grp_opc_ua_tags",
        "grp_anomalies", "grp_recent_writes",
    }
    channels = anomaly_channels or {}

    # ... existing overview + per-tag logic (unchanged) ...

    # NEW: when include_controls=True, add Commands group + per-task control widgets
    if include_controls:
        control_nodes = _emit_control_widgets(tasks, channels, seen_ids)
        flows.extend(control_nodes)
        # Update seen_ids with the new group IDs (for collision avoidance)
        for n in control_nodes:
            if n.get("id"):
                seen_ids.add(n["id"])

    return flows
```

### Step 4: Verify GREEN

```bash
.venv/bin/python -m pytest tests/test_dashboard_control_flows.py -v
# Expected: 13/13 pass
```

### Step 5: No regression

```bash
.venv/bin/python -m pytest tests/ -q
# Expected: 120 + 13 = 133 pass + 6 skip
```

### Step 6: Commit

```bash
git add gateway_python/gateway/dashboard_flows.py gateway_python/tests/test_dashboard_control_flows.py
git commit -m "feat(nodered-sub5): add include_controls=True to build_dashboard_flows()"
```

---

## Task 2: `GET /api/nodered/dashboard?controls=true` query param

**Files:**
- Modify: `gateway_python/gateway/server.py`

### Step 1: Add `controls` query param to existing endpoint

```python
@app.get("/api/nodered/dashboard")
def nodered_dashboard(controls: bool = False):
    """Generate and serve a Node-RED Dashboard flows.json.

    When controls=true, include ui_switch/ui_numeric widgets that fire write
    commands through Sub-3 CommandHandler.
    """
    tasks = _collector.tasks if _collector else {}
    channels = _anomaly.channels if _anomaly else {}
    recent_audit: list = []
    recent_anomalies: list = []
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
        include_controls=controls,
    )
    filename = "1052os-dashboard-controls.json" if controls else "1052os-dashboard.json"
    body = json.dumps(flows, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
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
git commit -m "feat(nodered-sub5): add controls query param to /api/nodered/dashboard"
```

---

## Task 3: Frontend "Export control dashboard" button

**Files:**
- Modify: `frontend/public/industrial-gateway/index.html`

### Step 1: Add button after the existing "Export dashboard" button

Locate the existing button in the §01 NR Bridge panel:
```html
<button class="export-btn" id="export-dashboard-btn" type="button">⬇ Export dashboard.json</button>
```

Add immediately after it:
```html
<button class="export-btn" id="export-dashboard-controls-btn" type="button">⬇ Export control dashboard.json</button>
```

### Step 2: Add click handler

```js
document.getElementById('export-dashboard-controls-btn')?.addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = '/industrial-gateway/api/nodered/dashboard?controls=true'
  a.download = '1052os-dashboard-controls.json'
  document.body.appendChild(a); a.click(); a.remove()
})
```

### Step 3: Verify HTML balance + commit

```bash
# Quick HTML check: open index.html, confirm both buttons present
grep -c "export-dashboard" frontend/public/industrial-gateway/index.html
# Expected: 3 (one for "export-dashboard-btn", one for "export-dashboard-controls-btn",
# and one in the JS handler, or similar)
```

---

## Task 4: User docs §11

**Files:**
- Modify: `docs/node-red-integration.md`

Append after §10:

```markdown
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
```

---

## Task 5: E2E test

**Files:**
- Modify: `gateway_python/tests/test_dashboard_e2e.py`

Add tests:

```python
def test_dashboard_with_controls_returns_200_and_attachment():
    """GET /api/nodered/dashboard?controls=true returns valid flows with control widgets."""
    if not _gateway_up(): pytest.skip("Gateway not running on :8765")
    try:
        with urllib.request.urlopen(
            "http://localhost:8765/api/nodered/dashboard?controls=true", timeout=3
        ) as r:
            data = json.loads(r.read().decode())
            content_disp = r.headers.get("Content-Disposition", "")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        pytest.skip(f"Gateway not reachable: {e}")
    assert "attachment" in content_disp
    assert "1052os-dashboard-controls.json" in content_disp
    # Has Commands group (if there are any tasks) or just base flows
    types = {n["type"] for n in data}
    assert "ui_tab" in types
    assert "ui_base" in types
    # If there are writable tasks, expect function + mqtt out
    fns = [n for n in data if n["type"] == "function"]
    outs = [n for n in data if n["type"] == "mqtt out"]
    if fns:
        assert len(outs) >= 1
        # Function wires to mqtt out
        for fn in fns:
            assert len(fn["wires"]) == 1
            assert fn["wires"][0][0] in {o["id"] for o in outs}


def test_dashboard_default_no_controls_unchanged():
    """Backward compat: GET /api/nodered/dashboard (no param) has no control widgets."""
    if not _gateway_up(): pytest.skip("Gateway not running on :8765")
    try:
        with urllib.request.urlopen(
            "http://localhost:8765/api/nodered/dashboard", timeout=3
        ) as r:
            data = json.loads(r.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        pytest.skip(f"Gateway not reachable: {e}")
    # No function / mqtt out nodes in default mode
    assert not any(n["type"] == "function" for n in data)
    assert not any(n["type"] == "mqtt out" for n in data)
    # No Commands group
    group_names = {n["name"] for n in data if n["type"] == "ui_group"}
    assert "Modbus Commands" not in group_names
    assert "OPC UA Commands" not in group_names
```

---

## Task 6: DoD + tag

```bash
.venv/bin/python -c "import py_compile, pathlib; [py_compile.compile(str(p), doraise=True) for p in pathlib.Path('gateway').glob('*.py')]; print('OK')"
.venv/bin/python -m pytest tests/ -v
# Expected: 133 pass + 6 skip

git tag nodered-sub5-v0.1
```

---

## Self-Review

**Spec coverage:**
- Goals → Tasks 1, 2, 3, 4, 5
- Architecture → Tasks 1 (pure function extension) + 2 (query param)
- Widget mapping → Task 1 (ui_switch / ui_numeric per dtype)
- Function body templates → Task 1 (per-protocol + per-cmd)
- Wiring (widget → function → mqtt out) → Task 1
- Min/Max from anomaly channel → Task 1
- Endpoint filename change → Task 2 (1052os-dashboard-controls.json)
- DoD → Task 6

**Risks covered:**
- Backward compat → `include_controls` defaults to False; existing tests must still pass
- ID collisions → reuse `_safe_id` from Sub-2; new prefixes (num/sw/fn/out/grp_*_cmd) don't clash
- u64/i64 multi-word → v0.2 TODO comment in function body
- Safety (no Set/Execute) → doc §11 explicit warning
- Empty tasks / all-ascii → no Commands group generated

**Why Sub-5 is similar in size to Sub-4:**
- Reuses Sub-4's `_safe_id`, `_ui_group_node`, `DEFAULT_RANGE`
- Adds ~150 LoC: control widget emitters, function body builders, MQTT out helper
- ~280 LoC tests (13 unit + 2 e2e)
- Total ~430 LoC vs Sub-4's ~530 LoC
