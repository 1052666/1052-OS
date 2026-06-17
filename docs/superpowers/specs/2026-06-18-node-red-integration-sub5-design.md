# 2026-06-18 — Node-RED Integration (Sub-5: Control Widgets)

## Context

Sub-1 → MQTT 数据通道 (collector → broker → NR)
Sub-2 → 一键导出 flows.json (mqtt in + debug)
Sub-3 → MQTT 命令回写 + 审计 + 告警 ack
Sub-4 (已完成) → Dashboard mirror (read-only: ui_gauge + ui_chart + ui_text)

**Sub-5 跨越另一半 UX 边界：让用户从仪表盘触发写命令**。Sub-4 只解决了
"看"（gauge/chart/text），但工业用户还需要"控"（button/switch/slider 触发
Modbus/OPC UA 写入）。Sub-3 已经实现了 1052os/cmd/write/{modbus,opcua} 的
命令接收与审计，但用户必须自己在 NR 里拖拽 ui_button + function + mqtt out
并手工配置 JavaScript — 100 个 tag 又要拖 100 次。

### 关键发现（来自研究阶段）

通过直接抓取 `node-red/node-red-dashboard` 与 `node-red/node-red` master 分支源码，
确认所有 control widget 字段（`oneditprepare` + `defaults`）和发射行为
（`convertBack` / `beforeSend`）：

| Widget | Emits | 关键字段 | Payload 类型 |
|---|---|---|---|
| **ui_button** | on click | name, label, group, icon, color, bgcolor, payload, payloadType, topic, topicType, passthru | typed (str/num/bool/json/...) |
| **ui_switch** | on toggle | name, label, group, onvalue, onvalueType, offvalue, offvalueType, onicon, oncolor, officon, offcolor, topic, topicType, passthru, decouple, animate | typed per state |
| **ui_numeric** | on change | name, label, group, min, max, step, format, topic, topicType, wrap, passthru | float (parseFloat) |
| **ui_slider** | on drag/release | name, label, group, min, max, step, outs ("all"\|"end"), topic, topicType, passthru | float |
| **ui_dropdown** | on select | name, label, group, options[{label,value,type}], place, multiple, topic, topicType, passthru, payload | typed per option |
| **mqtt out** | on input | name, topic, qos, retain, broker | passes msg.payload as-is |
| **function** | on input → on output | name, func (JS body), outputs, noerr | mutates msg, returns |

**关键 wiring 发现**：
- 每个 widget 都有 `topic` 字段（typedInput: str/msg/flow/global）— 设置后会写到
  `msg.topic` 然后由 mqtt out 用作发布目标。
- `mqtt out.topic` 默认空，使用 `msg.topic` 作为发布 topic。
- mqtt out / mqtt in 都引用 `broker` 节点（id = `brk_1052os`，与 Sub-4 兼容）。
- function 节点用 `msg.payload = ...; return msg;` 转换消息。

**CommandHandler (Sub-3) 期望的 wire payload 格式**（已经实装）：
- Modbus (1052os/cmd/write/modbus): `{"request_id": ..., "cmd": "write_*", "host", "port", "unit_id", "address", "value"}`
- OPC UA (1052os/cmd/write/opcua): `{"request_id": ..., "cmd": "write_node", "url", "node_id", "value"}`

### 已锁定的设计决策（5 个 brainstorm 问题答案）

1. **控制 widget 类型** → ui_switch (bit) + ui_numeric (numeric)；ui_slider/ui_dropdown 留 v0.2
2. **Widget 命名空间** → 同一 tab "1052-OS Industrial"，新增 "Modbus Commands" / "OPC UA Commands" 两个 group
3. **覆盖 read-only dashboard** → 新增 `GET /api/nodered/dashboard?controls=true` 参数，不替换现有 endpoint
4. **payload 装配点** → 每个 widget 后串联一个 **function 节点**（per-task 定制 body），把 msg.payload (裸值) 包装成 CommandHandler 期望的 JSON
5. **写入安全** → v0.1 不做"二段确认"（ui_button 触发）— 用户改值即写；v0.2 引入"Set/Execute"双按钮模式

## Goals

- 用户在 §01 NR 面板点击 "Export control dashboard" 按钮（或勾选 controls 复选框）
- 浏览器下载 `1052os-dashboard-controls.json` 文件
- 文件是 Node-RED 可直接 Import 的合法 `flows.json`（在 Sub-4 基础上加入控制 widgets）
- 导入后访问 `http://localhost:1880/ui` 看到：
  - 原有 read-only widgets (gauge/chart/text) — 复用 Sub-4
  - **新增**：每个 numeric tag 一个 ui_numeric 控件（带 min/max/step）；每个 bit tag 一个 ui_switch 控件
  - **新增**：每个控件下方一个 ui_text 显示 "last write"（订阅 1052os/events/+/+ 回显审计）
- 用户调整 ui_numeric → 自动触发 function 节点 → mqtt out → 1052os/cmd/write/{modbus,opcua} → CommandHandler 写入
- 写命令在 Sub-3 audit 表（write_audit stable）落盘，可在 §05 Recent writes 面板查看
- 整个生成路径**只生成 flows，不直接连 PLC**（用户必须 Import + Deploy 才生效）

## Non-Goals (deferred)

- ui_slider / ui_dropdown control widgets — v0.2
- "Set/Execute" 二段确认按钮 — v0.2（v0.1 改值即写）
- Modbus 多值写入 (write_coils / write_registers 数组) — v0.2（v0.1 只支持单值）
- 写入权限分层 / 操作员鉴权 — v0.2（local trust）
- 实时回写成功的 UI 反馈 (toast) — v0.2
- 撤销 / 写前预览 — 不在范围内
- 移动端适配 — dashboard 自身支持，Sub-5 不做定制

## Architecture

```
┌──────────────────── 1052-OS Industrial Gateway (8765) ────────────────────┐
│                                                                              │
│  Sub-3 (已完) Command Handler:                                                │
│  1052os/cmd/write/modbus ← JSON → write_register/coil/float32 → ModbusClient │
│  1052os/cmd/write/opcua  ← JSON → write_node             → OpcuaClient      │
│                                                                              │
│  Sub-4 (已完) Read-only Dashboard:                                            │
│  build_dashboard_flows(tasks) → mqtt in + ui_gauge/ui_chart/ui_text          │
│                                                                              │
│  Sub-5 (NEW) Control Widgets:                                                  │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐    │
│  │ build_dashboard_ │ →  │ build_dashboard_ │ →  │ GET /api/nodered/   │    │
│  │ flows(tasks,     │    │ flows(...,       │    │ dashboard?controls= │    │
│  │ include_controls │    │ include_controls │    │ true                │    │
│  │ =True)            │    │ =True)            │    │ → 1052os-dashboard │    │
│  └─────────────────┘    └──────────────────┘    │   -controls.json    │    │
│                                                   └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼  (HTTP GET)
                  ┌──────────────────────┐
                  │ Browser downloads    │
                  │ 1052os-dashboard-    │
                  │ controls.json        │
                  └──────────┬───────────┘
                             │  user imports
                             ▼
                  ┌──────────────────────────────────────┐
                  │ Node-RED                              │
                  │  Import → Deploy                      │
                  │  Visit http://localhost:1880/ui       │
                  │  → see all gauges + controls          │
                  │  → user toggles a ui_switch           │
                  │     ↓                                 │
                  │  function node (per-task JS)          │
                  │    msg.payload = JSON.stringify({    │
                  │      request_id, cmd, host, port,    │
                  │      unit_id, address, value          │
                  │    })                                 │
                  │     ↓                                 │
                  │  mqtt out → 1052os/cmd/write/modbus   │
                  │     ↓                                 │
                  │  CommandHandler → ModbusClient.write_ │
                  │  AuditLogger → write_audit table      │
                  └──────────────────────────────────────┘
```

### 关键架构决策

- **生成是纯只读**：`build_dashboard_flows(..., include_controls=True)` 只读
  tasks，不修改任何 NR 状态。多次调用幂等。
- **per-task function 节点**：每个控制 widget 后串联一个独立的 function 节点，
  其 `func` 字段是该 task 的定制 JS（包含 `request_id` 前缀、`host`/`port`/
  `unit_id`/`address`/`node_id` 等）。这是必要的 — 因为每个 widget 需要把
  不同的 `target` 信息合并到 JSON payload 中。
- **写入立即生效**：ui_switch 切换 / ui_numeric 改值 → function → mqtt out
  → broker → CommandHandler。**没有 Set/Execute 二段确认**（v0.1 简化）。
  在生产环境需要操作员培训 + 流程纪律；技术上的二段确认留 v0.2。
- **topic 选择**：`mqtt out.topic` 字段直接硬编码为
  `1052os/cmd/write/modbus` 或 `1052os/cmd/write/opcua`，**不依赖 msg.topic**。
  这样如果 widget 的 `topic` 字段被用户在 NR 里改坏，write 仍走对路径。
- **Modbus cmd 映射**（根据 dtype）：
  - `bit` → `write_coil` (value = bool)
  - `u16`, `i16` → `write_register` (value = int)
  - `u32`, `i32`, `f32` → `write_float32` (value = float)
  - `u64`, `i64` → `write_registers` 写入两个字（v0.1 暂不支持，留 TODO）
- **OPC UA cmd 映射**（所有 dtype 一致）：
  - → `write_node` (value = msg.payload)
- **Min/max 来源**：
  - 有 anomaly channel → 用 channel.low / channel.high
  - 无 anomaly channel → 用 Sub-4 的 `DEFAULT_RANGE` (例如 f32 → 0..100)
- **request_id 格式**：`"<tag_id>-<timestamp>"` 便于在审计中按 tag 搜索
  （如 `TI-101-1718700000000`）
- **不影响 read-only endpoint**：`/api/nodered/dashboard` 维持现状（无 controls），
  新增 `?controls=true` query param 启用 controls。向后兼容。

## Components

### 修改文件

| 文件 | 变更 |
|---|---|
| `gateway_python/gateway/dashboard_flows.py` | `build_dashboard_flows()` 新增 `include_controls=False` 参数；新增 `_emit_control_widgets()` 私有函数 |
| `gateway_python/gateway/server.py` | `nodered_dashboard()` 新增 `controls: bool = False` query param |
| `frontend/public/industrial-gateway/index.html` | §01 NR 面板新增 "Export control dashboard" 按钮（紧邻 "Export dashboard"） |
| `docs/node-red-integration.md` | 增补"§11 控制 widgets (button/switch/numeric 触发写命令)" |
| `docs/superpowers/specs/2026-06-18-node-red-integration-sub5-design.md` | 本文档 |

### 新文件

| 文件 | 用途 | LoC est. |
|---|---|---|
| `gateway_python/tests/test_dashboard_control_flows.py` | 单元测试：per-task widget 生成、function node 主题、mqtt out topic、payload 转换、min/max 映射 | ~280 |

### 模块边界

```
build_dashboard_flows(tasks, anomaly_channels, include_controls=False)
    ↑ reads (unchanged from Sub-4)
nodered_tags.build_tag_catalog(tasks)  (Sub-1)
    ↑
server._collector.tasks, server._anomaly.channels
    ↑
server.GET /api/nodered/dashboard?controls=true  (NEW query param)
    ↑ HTTP
frontend "Export control dashboard" button
```

`dashboard_flows` 不知道 `server` 或 `frontend` 的存在。测试时用 plain Python
dicts/lists 作为输入，不依赖 FastAPI / TDengine / NR。

## Data flow

### 生成的 dashboard+controls flows.json 形状（关键节点示例）

```json
[
  ... (Sub-4 节点: tab_1052os, ui_base, 5 个 group, gauge/chart/text) ...
  
  {"id":"grp_modbus_cmd","type":"ui_group","name":"Modbus Commands","tab":"tab_1052os","order":6,"disp":true,"width":12,"collapse":false},
  {"id":"grp_opcua_cmd","type":"ui_group","name":"OPC UA Commands","tab":"tab_1052os","order":7,"disp":true,"width":12,"collapse":false},

  // Per-tag control widget + function + mqtt out
  {"id":"num_TI_101","type":"ui_numeric","z":"tab_1052os","g":"grp_modbus_cmd","group":"grp_modbus_cmd","name":"TI-101","label":"TI-101 (setpoint)","order":1,"width":6,"height":1,"min":0,"max":100,"step":1,"topic":"1052os/cmd/write/modbus","topicType":"str","x":140,"y":680,"wires":[["fn_TI_101"]]},
  
  {"id":"fn_TI_101","type":"function","z":"tab_1052os","name":"wrap: TI-101 modbus","func":"// Wrap raw value into CommandHandler JSON for TI-101\nmsg.payload = JSON.stringify({\n    request_id: 'TI-101-' + Date.now(),\n    cmd: 'write_float32',\n    host: '127.0.0.1', port: 502, unit_id: 1,\n    address: 100,\n    value: parseFloat(msg.payload)\n});\nreturn msg;","outputs":1,"noerr":0,"x":340,"y":680,"wires":[["out_TI_101"]]},
  
  {"id":"out_TI_101","type":"mqtt out","z":"tab_1052os","name":"mqtt: write modbus","topic":"1052os/cmd/write/modbus","qos":"","retain":"","broker":"brk_1052os","x":540,"y":680,"wires":[]},

  // Per-bit tag
  {"id":"sw_PUMP1_RUN","type":"ui_switch","z":"tab_1052os","g":"grp_modbus_cmd","group":"grp_modbus_cmd","name":"PUMP1_RUN","label":"PUMP1_RUN","order":2,"width":6,"height":1,"onvalue":"1","onvalueType":"str","offvalue":"0","offvalueType":"str","topic":"1052os/cmd/write/modbus","topicType":"str","x":140,"y":760,"wires":[["fn_PUMP1_RUN"]]},
  
  {"id":"fn_PUMP1_RUN","type":"function","z":"tab_1052os","name":"wrap: PUMP1_RUN modbus","func":"msg.payload = JSON.stringify({\n    request_id: 'PUMP1_RUN-' + Date.now(),\n    cmd: 'write_coil',\n    host: '127.0.0.1', port: 502, unit_id: 1,\n    address: 0,\n    value: msg.payload === '1' || msg.payload === 1 || msg.payload === true\n});\nreturn msg;","outputs":1,"noerr":0,"x":340,"y":760,"wires":[["out_PUMP1_RUN"]]},

  {"id":"out_PUMP1_RUN","type":"mqtt out","z":"tab_1052os","name":"mqtt: write modbus","topic":"1052os/cmd/write/modbus","qos":"","retain":"","broker":"brk_1052os","x":540,"y":760,"wires":[]}
]
```

### Widget 类型映射（control 视图）

| Tag `dtype` | Modbus cmd | OPC UA cmd | Control Widget | Function body 含 |
|---|---|---|---|---|
| `bit` | `write_coil` | `write_node` | **ui_switch** | onvalue="1", offvalue="0" |
| `u16` | `write_register` | `write_node` | **ui_numeric** | value=parseInt(msg.payload) |
| `i16` | `write_register` | `write_node` | **ui_numeric** | value=parseInt(msg.payload) |
| `u32` | `write_float32` | `write_node` | **ui_numeric** | value=parseFloat(msg.payload) |
| `i32` | `write_float32` | `write_node` | **ui_numeric** | value=parseFloat(msg.payload) |
| `f32` | `write_float32` | `write_node` | **ui_numeric** | value=parseFloat(msg.payload) |
| `u64`, `i64` | (TODO v0.2) | `write_node` | **ui_numeric** | value=parseFloat(msg.payload); 注释说明 v0.2 待写 |
| `ascii`, `utf8` | — | — | **skip** (no control) | — |

### Function 节点 body 生成模板

#### Modbus numeric (u16/i16):
```js
msg.payload = JSON.stringify({
    request_id: '<TAG_ID>-' + Date.now(),
    cmd: 'write_register',
    host: '<HOST>', port: <PORT>, unit_id: <UNIT>,
    address: <ADDRESS>,
    value: parseInt(msg.payload, 10)
});
return msg;
```

#### Modbus numeric (u32/i32/f32):
```js
msg.payload = JSON.stringify({
    request_id: '<TAG_ID>-' + Date.now(),
    cmd: 'write_float32',
    host: '<HOST>', port: <PORT>, unit_id: <UNIT>,
    address: <ADDRESS>,
    value: parseFloat(msg.payload)
});
return msg;
```

#### Modbus bit:
```js
msg.payload = JSON.stringify({
    request_id: '<TAG_ID>-' + Date.now(),
    cmd: 'write_coil',
    host: '<HOST>', port: <PORT>, unit_id: <UNIT>,
    address: <ADDRESS>,
    value: msg.payload === '1' || msg.payload === 1 || msg.payload === true
});
return msg;
```

#### OPC UA (所有 dtype):
```js
msg.payload = JSON.stringify({
    request_id: '<TAG_ID>-' + Date.now(),
    cmd: 'write_node',
    url: '<URL>',
    node_id: '<NODE_ID>',
    value: msg.payload
});
return msg;
```

### Min/Max 范围

复用 Sub-4 的 `DEFAULT_RANGE`：
- bit → 0..1, step=1
- u16 → 0..65535, step=1
- i16 → -32768..32767, step=1
- u32/i32 → 0..100, step=1
- f32 → 0..100, step=0.1
- ascii/utf8 → 跳过（不生成 control）

**Anomaly channel 覆盖**：如果 `anomaly_channels[T.id]` 存在且 T.dtype != bit，
用 `channel.low` / `channel.high` 作为 ui_numeric 的 min/max。

### Endpoint 行为

```
GET /api/nodered/dashboard
  → (现有) read-only dashboard, 无 controls

GET /api/nodered/dashboard?controls=true
  → 200 OK
    Content-Type: application/json
    Content-Disposition: attachment; filename="1052os-dashboard-controls.json"
    Body: [ ...flows array... (read widgets + control widgets) ]
  → 500 (only if internal error; not for "no tasks" — returns base flows)
```

**没有 tasks 时**：返回基础 flows（tab + ui_base + 5 group + 1 overview text）。
**不**生成空的 Commands group（避免无意义的 group 显示在 UI）。

**所有 task 都没有 control（全是 ascii/utf8）时**：**不**生成 Commands group
和控件。Endpoint 等价于 `controls=false`。

### Layout 算法

- Modbus Commands: `x=140, y=680 + (idx // 2) * 80`
- OPC UA Commands: `x=140, y=1080 + (idx // 2) * 80`
- Per-control: widget (x=140), function (x=340), mqtt out (x=540)

### 节点 ID 规范化（复用 Sub-2 的 `_safe_id`）

- widget IDs: `num_<safe_tag>` / `sw_<safe_tag>` (控件)
- function IDs: `fn_<safe_tag>`
- mqtt out IDs: `out_<safe_tag>`
- group IDs: `grp_modbus_cmd` / `grp_opcua_cmd`

## Error handling

| 场景 | 策略 | 实现 |
|---|---|---|
| 没有 tasks | 不生成 Commands group；等同于 read-only | `if not tasks: skip control block` |
| 所有 task 都是 ascii/utf8 | 同上 | `if not control_tasks: skip control block` |
| tag 是 u64/i64 | 仍然生成 ui_numeric，但 function 注释为 v0.2 TODO | 不阻塞 |
| 异常 channel 不存在对应 tag | ui_numeric 用 default min/max | 不阻塞 |
| 标签含特殊字符 | 替换为 `_` | `_safe_id()` 复用 Sub-2 |
| ID 重复 | 递增后缀 `_2`, `_3`... | `_safe_id()` 计数器 |
| 写入被 CommandHandler 拒绝 | 用户的 NR 配置错（cmd 错 / 设备不通）— 不在本 Sub-5 范围 | 由 Sub-3 audit 反馈 |
| mqtt broker 未配置 | 用户 Import 后无连接 | doc §11 提示；Sub-4 同 |
| node-red-dashboard 未安装 | 用户 Import 后无 dashboard tab | doc §11 提示安装 |

## Testing

### 单元测试（不依赖 Node-RED / MQTT）

```python
# test_dashboard_control_flows.py

def test_default_no_controls():
    """Backward compat: build_dashboard_flows() without include_controls kwarg."""
    tasks = {"TI-101": _mk_task("TI-101")}
    flows = build_dashboard_flows(tasks)
    # No command group
    assert not any(n.get("name") == "Modbus Commands" for n in flows
                   if n["type"] == "ui_group")
    # No function nodes
    assert not any(n["type"] == "function" for n in flows)
    # No mqtt out
    assert not any(n["type"] == "mqtt out" for n in flows)


def test_explicit_include_controls_false_omits_controls():
    flows = build_dashboard_flows({"TI-101": _mk_task("TI-101")}, include_controls=False)
    assert not any(n["type"] == "function" for n in flows)


def test_include_controls_true_adds_command_groups():
    flows = build_dashboard_flows({"TI-101": _mk_task("TI-101")}, include_controls=True)
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" in group_names
    assert "OPC UA Commands" in group_names


def test_modbus_numeric_tag_creates_ui_numeric_function_mqtt_out():
    tasks = {"TI-101": _mk_task("TI-101", protocol="modbus", dtype="f32",
                                 mb_host="127.0.0.1", mb_port=502, mb_unit=1,
                                 mb_address=100)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    # One ui_numeric for TI-101
    nums = [n for n in flows if n["type"] == "ui_numeric" and n.get("name") == "TI-101"]
    assert len(nums) == 1
    # One function node
    fns = [n for n in flows if n["type"] == "function" and "TI-101" in n["name"]]
    assert len(fns) == 1
    # One mqtt out
    outs = [n for n in flows if n["type"] == "mqtt out"]
    assert len(outs) == 1
    # function wires to mqtt out
    assert fns[0]["wires"] == [[outs[0]["id"]]]
    # function body contains the address
    assert "100" in fns[0]["func"]
    assert "write_float32" in fns[0]["func"]
    # ui_numeric wires to function
    assert nums[0]["wires"] == [[fns[0]["id"]]]


def test_modbus_bit_tag_creates_ui_switch():
    tasks = {"PUMP1_RUN": _mk_task("PUMP1_RUN", protocol="modbus", dtype="bit",
                                    mb_address=0)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    sw = next(n for n in flows if n["type"] == "ui_switch" and n.get("name") == "PUMP1_RUN")
    fn = next(n for n in flows if n["type"] == "function" and "PUMP1_RUN" in n["name"])
    assert sw["wires"] == [[fn["id"]]]
    assert "write_coil" in fn["func"]
    # onvalue / offvalue default to "1" / "0" (strings) for the function body
    assert "msg.payload === '1'" in fn["func"]


def test_opcua_tag_creates_write_node_function():
    tasks = {"PRESSURE": _mk_task("PRESSURE", protocol="opcua", dtype="f32",
                                    ua_url="opc.tcp://127.0.0.1:4840",
                                    ua_node_id="ns=2;s=PRESSURE")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    nums = [n for n in flows if n["type"] == "ui_numeric" and n.get("name") == "PRESSURE"]
    fns = [n for n in flows if n["type"] == "function" and "PRESSURE" in n["name"]]
    assert len(nums) == 1
    assert len(fns) == 1
    assert "write_node" in fns[0]["func"]
    assert "ns=2;s=PRESSURE" in fns[0]["func"]


def test_ascii_dtype_no_control_widget():
    tasks = {"MSG": _mk_task("MSG", dtype="ascii")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    # No ui_numeric / ui_switch for MSG
    assert not any(n.get("name") == "MSG" for n in flows
                   if n["type"] in ("ui_numeric", "ui_switch"))


def test_all_ascii_skips_command_groups():
    tasks = {"MSG1": _mk_task("MSG1", dtype="ascii"),
             "MSG2": _mk_task("MSG2", dtype="utf8")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    group_names = {n["name"] for n in flows if n["type"] == "ui_group"}
    assert "Modbus Commands" not in group_names
    assert "OPC UA Commands" not in group_names


def test_mqtt_out_uses_correct_topic_per_protocol():
    tasks = {"TI-101": _mk_task("TI-101", protocol="modbus"),
             "PRESSURE": _mk_task("PRESSURE", protocol="opcua")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    outs = [n for n in flows if n["type"] == "mqtt out"]
    topics = {n["topic"] for n in outs}
    assert "1052os/cmd/write/modbus" in topics
    assert "1052os/cmd/write/opcua" in topics


def test_numeric_min_max_from_anomaly_channel():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    channels = {"TI-101": _mk_channel("TI-101", low=10, high=90)}
    flows = build_dashboard_flows(tasks, anomaly_channels=channels, include_controls=True)
    num = next(n for n in flows if n["type"] == "ui_numeric" and n.get("name") == "TI-101")
    assert num["min"] == 10
    assert num["max"] == 90


def test_function_body_contains_request_id_prefix():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(n for n in flows if n["type"] == "function" and "TI-101" in n["name"])
    assert "'TI-101-' + Date.now()" in fn["func"]


def test_function_node_id_collision_safe_id():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", dtype="f32")}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fns = [n for n in flows if n["type"] == "function" and "TI_101_PV" in n["id"]]
    assert len(fns) == 1


def test_idempotent_regeneration_with_controls():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    f1 = build_dashboard_flows(tasks, include_controls=True)
    f2 = build_dashboard_flows(tasks, include_controls=True)
    assert f1 == f2


def test_modbus_register_cmd_for_u16():
    """u16 should use write_register (not write_float32)."""
    tasks = {"REG1": _mk_task("REG1", dtype="u16", mb_address=200)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(n for n in flows if n["type"] == "function" and "REG1" in n["name"])
    assert "write_register" in fn["func"]
    assert "parseInt(msg.payload, 10)" in fn["func"]


def test_modbus_float32_cmd_for_f32():
    tasks = {"TEMP": _mk_task("TEMP", dtype="f32", mb_address=300)}
    flows = build_dashboard_flows(tasks, include_controls=True)
    fn = next(n for n in flows if n["type"] == "function" and "TEMP" in n["name"])
    assert "write_float32" in fn["func"]
    assert "parseFloat(msg.payload)" in fn["func"]
```

### 集成测试（HTTP endpoint）

```python
# extend test_dashboard_e2e.py
def test_dashboard_with_controls_endpoint():
    if not _gateway_running(): pytest.skip(...)
    r = requests.get("http://localhost:8765/api/nodered/dashboard?controls=true")
    assert r.status_code == 200
    assert "1052os-dashboard-controls.json" in r.headers.get("Content-Disposition", "")
    flows = r.json()
    # Has Commands group
    assert any(n["type"] == "ui_group" and n["name"] == "Modbus Commands"
               for n in flows)


def test_dashboard_default_no_controls():
    if not _gateway_running(): pytest.skip(...)
    r = requests.get("http://localhost:8765/api/nodered/dashboard")
    assert r.status_code == 200
    flows = r.json()
    # No Commands group by default
    assert not any(n["type"] == "ui_group" and n["name"] == "Modbus Commands"
                   for n in flows)
```

### Definition of Done (DoD)

- [ ] `GET /api/nodered/dashboard?controls=true` 返回合法 flows.json（含 read widgets + control widgets）
- [ ] `GET /api/nodered/dashboard` (无 param) 维持原行为（无 controls，向后兼容）
- [ ] 响应头 `Content-Disposition: attachment; filename="1052os-dashboard-controls.json"`
- [ ] Numeric/bit tasks → ui_numeric/ui_switch + function + mqtt out
- [ ] ascii/utf8 tasks → 无 control
- [ ] 没有可控制 task → 不生成 Commands group
- [ ] Modbus → `write_coil` / `write_register` / `write_float32`（按 dtype）
- [ ] OPC UA → `write_node`
- [ ] Function 节点 `func` 字段含正确的 request_id 前缀、target (host/port/unit_id/address 或 url/node_id)
- [ ] Function → mqtt out wiring 正确（id 引用）
- [ ] Anomaly channel low/high → ui_numeric min/max
- [ ] §01 NR 面板有"Export control dashboard"按钮
- [ ] `pytest -v` 全绿 (含新 tests + 已有 105-120 个)
- [ ] `docs/node-red-integration.md` 增补 §11
- [ ] 编译无错误

## Open questions

无。5 个设计问题已在 brainstorm 阶段全部解决。

## Risks

| Risk | Mitigation |
|---|---|
| 误操作导致 PLC 写错值 | v0.1 简化（改值即写）；v0.2 引入 Set/Execute 二段确认；doc §11 提示工业环境谨慎 |
| Function 节点 JS 注入 | task id / address 等都是 python 层生成，不接受用户输入；安全 |
| 大批量 (100+) tag 生成 300+ 节点 | doc §11 提示用户在 NR 内可折叠/删除；可选 `?task_ids=` 过滤（v0.2） |
| Modbus 多字 (u64/i64) | v0.1 TODO 注释，v0.2 写两字 |
| Bit dtype value 类型 | ui_switch 的 onvalue/offvalue 设为字符串 "1"/"0"，function 节点同时接受 str/int/bool 三种形式 |
| Function 节点 `outputs=1` 但 widget 改值频繁 | function 节点 stateless，每次调用都生成新 request_id；无状态风险 |
| Modbus host 不是默认 127.0.0.1 | function 节点 body 内嵌 task.mb_host/port/unit；多任务 → 多 function 节点（per-task）|
| 与 Sub-4 node ID 冲突 | seen_ids 集合共享；新 ID 前缀 num_/sw_/fn_/out_/grp_modbus_cmd 等不与 Sub-4 冲突 |
