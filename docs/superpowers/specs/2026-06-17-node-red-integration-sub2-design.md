# 2026-06-17 — Node-RED Integration (Sub-2: Flow Export)

## Context

Sub-1 (已完成，v0.1 tagged) 建立了 1052-OS 工业网关与 Node-RED 之间的实时数据通道
（MQTT 桥接）。用户已经能让 Node-RED 订阅 `1052os/#` 看到所有 collector 实时值。

但当前体验是**手动的**：用户必须：
1. 自己打开 Node-RED
2. 拖 `mqtt in` 节点
3. 配置 broker 指向 `localhost:1883`
4. 手动输入 topic
5. 拖 `debug` 节点
6. **每个 tag 重复以上步骤**（100 个 tag 就是 100 次）

**Sub-2 的目标：让网关能一键生成 Node-RED 兼容的 `flows.json` 文件**，用户下载后
在 Node-RED 中 Import 即可立即看到所有 tag 实时值流。

### 与其他 Sub 的关系

- **Sub-1（已完）**：建立 MQTT 数据通道。本 Sub 复用其 topic 体系。
- **Sub-3（未来）**：Node-RED 作为编排层（写值/联动/告警）。本 Sub 只生成"读"侧。
- **Sub-4（未来）**：Dashboard 镜像。本 Sub **不**生成 dashboard 节点，Sub-4 负责。

### 已锁定的设计决策（5 个 brainstorm 问题答案）

1. **broker 地址** → 硬编码 `localhost:1883`（最简单，用户同机部署开箱即用）
2. **tab 组织** → 按 `protocol` 分 tab（`Modbus` / `OPC UA`）
3. **meta 订阅** → 只订阅 `value` topic，meta 由 NR 启动时通过 `1052os/+/+/+/meta` 自动拉
4. **节点 ID 策略** → 可读型（从 tag 名生成，例如 `in_site1_plc1_440001`）
5. **Dashboard 节点** → 不生成（Sub-4 负责）

## Goals

- 用户在网关前端点击"导出 flows.json"按钮
- 浏览器下载 `1052os-flows.json` 文件
- 文件内容是 Node-RED 可直接 Import 的合法 `flows.json`
- 导入后**立即**看到所有 collector 任务的实时值流（无需任何手动配置）
- 兼容 Node-RED 3.x / 4.x / 5.x（只用通用字段）
- 整个生成路径是**只读的**（不向 Node-RED 推送，不修改任何用户节点）

## Non-Goals

- 不向 Node-RED 写值（Sub-3 负责）
- 不生成 dashboard 节点（Sub-4 负责）
- 不支持 Admin REST 部署（用户必须手动 Import）
- 不支持多 broker 配置（只导出本地 Mosquitto）
- 不持久化生成的 flows.json（每次按需生成）

## Architecture

```
┌──────────────────── 1052-OS Industrial Gateway (8765) ────────────────────┐
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                       │
│  │ modbus_     │    │ opcua_      │    │ mqtt_       │                       │
│  │ client      │    │ client      │    │ client      │                       │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘                       │
│         └────────┬────────┘                                                │
│                  ▼                                                          │
│         ┌─────────────────┐                                                │
│         │  DataCollector  │  + MqttPublisher (Sub-1)                       │
│         └────────┬────────┘                                                │
│                  │                                                          │
│                  ▼                                                          │
│         ┌─────────────────┐    ┌──────────────────┐                         │
│         │ nodered_tags.py │    │ nodered_flows.py │  ← NEW                  │
│         │ (Sub-1: catalog)│    │ (Sub-2: builder) │                         │
│         └────────┬────────┘    └────────┬─────────┘                         │
│                  │                      │                                   │
│                  ▼                      ▼                                   │
│         ┌──────────────────────────────────────┐                            │
│         │ GET /api/nodered/flows               │  ← NEW endpoint            │
│         │   → Content-Disposition: attachment  │                            │
│         │   → Content-Type: application/json   │                            │
│         │   → body: flows.json array          │                            │
│         └──────────────────────────────────────┘                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼  (HTTP GET)
                  ┌──────────────────────┐
                  │ Browser downloads    │
                  │ 1052os-flows.json    │
                  └──────────┬───────────┘
                             │  user manually imports
                             ▼
                  ┌──────────────────────┐
                  │ Node-RED             │
                  │  Import → Deploy     │
                  │  → all mqtt in 节点  │
                  │     立即开始订阅     │
                  └──────────────────────┘
```

### 关键架构决策

- **生成是只读操作**：`build_flows_json()` 只读取 `collector.tasks`（来自 Sub-1），
  不修改任何状态。重复调用安全。
- **每个 tag 一节点**（方案 A）：简单透明，工业用户熟悉"按位号接线"的思维。
- **按 protocol 分 tab**：Modbus 和 OPC UA 在不同画布上，逻辑分组清晰。
- **broker 硬编码 localhost**：用户的 Node-RED 实例必须能访问 `localhost:1883`。
  这是 Sub-1 的隐含假设（同机部署），本 Sub 沿用。
- **不持久化文件**：每次请求重新生成。`build_flows_json()` 是纯函数。
- **ID 可读但稳定**：从 tag 名生成（例如 `in_site1_plc1_440001`），
  多次生成 ID 一致，方便用户版本管理。

## Components

### 新文件

| 文件 | 用途 | LoC est. |
|---|---|---|
| `gateway_python/gateway/nodered_flows.py` | `build_flows_json(tasks, broker="localhost", port=1883) -> list[dict]` 纯函数 | ~120 |
| `gateway_python/tests/test_nodered_flows.py` | 单元测试：tab 数量、节点 ID 格式、broker config、wires 连线、特殊字符处理 | ~150 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `gateway_python/gateway/server.py` | 新增 `GET /api/nodered/flows` 端点（约 +15 行） |
| `frontend/public/industrial-gateway/index.html` | §01 NR Bridge 面板加 "导出 flows.json" 按钮（调 fetch + 触发下载） |
| `docs/node-red-integration.md` | 增补"导出 flows"一节（含 Import 步骤截图描述） |

### 模块边界

```
nodered_flows.build_flows_json(tasks, broker, port)
    ↑ reads
nodered_tags.build_tag_catalog(tasks)  (Sub-1)
    ↑ reads
server.collector.tasks
    ↑
server.GET /api/nodered/flows
    ↑ HTTP
frontend "Export" button
```

`nodered_flows` 不知道 `server` 或 `frontend` 的存在。它是一个纯数据转换器。
测试时不依赖 FastAPI。

## Data Flow

### 生成的 flows.json 形状

```json
[
  {"id":"tab_modbus","type":"tab","label":"Modbus","disabled":false,"info":""},
  {"id":"tab_opcua","type":"tab","label":"OPC UA","disabled":false,"info":""},
  {"id":"brk_1052os","type":"mqtt-broker","name":"1052-OS Broker",
   "broker":"localhost","port":"1883","clientid":"",
   "usetls":false,"protocolVersion":"4","keepalive":"60",
   "cleansession":true,"autoConnect":true},
  {"id":"in_site1_plc1_440001","type":"mqtt in","z":"tab_modbus",
   "name":"site1/plc1/440001","topic":"1052os/site1/plc1/440001/value",
   "qos":"0","datatype":"auto","broker":"brk_1052os",
   "nl":false,"rap":true,"rh":0,"inputs":0,
   "x":240,"y":120,"wires":[["dbg_site1_plc1_440001"]]},
  {"id":"dbg_site1_plc1_440001","type":"debug","z":"tab_modbus",
   "name":"","active":true,"tosidebar":true,"console":false,
   "tostatus":false,"complete":"payload","targetType":"msg",
   "x":430,"y":120,"wires":[]},
  ...  // 一个 tag 重复上述 mqtt in + debug 两节点模式
]
```

### 节点生成规则

| 节点类型 | 数量 | 字段 |
|---|---|---|
| `tab` | 1 (modbus) + 1 (opcua) = 2 | `id="tab_<protocol>"`, `label=<Protocol>` |
| `mqtt-broker` | 1 (共享 config node) | `id="brk_1052os"`, `broker="localhost"`, `port="1883"` |
| `mqtt in` | N (每个 tag 一个) | topic = `1052os/{site}/{device}/{tag}/value`, wires → 对应 debug |
| `debug` | N (每个 tag 一个) | wires = `[]`, complete = `"payload"` |

**布局算法**：x 坐标每 200px 一列，y 坐标每 80px 一行，N 个节点按
`(index % 4)` × 200, `(index // 4)` × 80 排布。`modbus` 标签在
`(0..modbus_count-1)`，`opcua` 标签在 `(0..opcua_count-1)`，y 偏移 +400 避免重叠。

### ID 规范化规则

```python
def _safe_id(prefix: str, *parts: str) -> str:
    raw = "_".join([prefix] + list(parts))
    # 替换 Node-RED ID 不允许的字符: ., -, /, 空格
    return re.sub(r"[^A-Za-z0-9_]", "_", raw)
```

- `in_site1.plc1/440001` → `in_site1_plc1_440001`
- `dbg_TI-101` → `dbg_TI_101`
- `tab_modbus` / `tab_opcua` / `brk_1052os` 是固定字符串

ID 长度限制：Node-RED 不强制限制，但建议 < 64 字符。我们的格式
（`in_<site>_<device>_<tag>`）通常 < 40 字符，安全。

### Endpoint 行为

```
GET /api/nodered/flows
  → 200 OK
    Content-Type: application/json
    Content-Disposition: attachment; filename="1052os-flows.json"
    Body: [ ...flows array... ]
  → 500 (only if internal error; not for "no tasks" — returns empty flows)
```

**没有 tasks 时返回**：只包含 2 个 tab + 1 个 broker 节点（无 mqtt in/debug）。
用户可以正常 Import 看到空画布，然后再添加 tag 后重新导出。

## Error handling

| 场景 | 策略 | 实现 |
|---|---|---|
| `_collector` 未初始化 | 返回只含 broker + 2 tab 的空 flows | `if not _collector: return _empty_flows()` |
| 没有 tasks | 同上 | 正常返回（用户可正常 Import） |
| tag 名含特殊字符 | 替换为 `_` | `_safe_id()` 规范化 |
| topic 含 `+` 或 `#`（不应该）| 双下划线替换 | `_safe_id()` 同样处理 |
| ID 重复（两个 tag 规范化后相同）| 加递增后缀 `_2`, `_3`... | `_safe_id()` 内置计数器 |
| Node-RED 版本不识别某些字段 | 不处理；Node-RED 会忽略未知字段 | 文档说明 "tested on 3.x/4.x/5.x" |
| HTTP 下载被浏览器拦截 | 浏览器默认行为（不会拦截下载） | 无需处理 |

## Testing

### 单元测试（不依赖 Node-RED / MQTT）

```python
# test_nodered_flows.py

def test_empty_tasks_returns_only_tabs_and_broker():
    flows = build_flows_json({})
    assert len(flows) == 3  # 2 tabs + 1 broker
    assert {n["type"] for n in flows} == {"tab", "mqtt-broker"}

def test_modbus_tag_creates_mqtt_in_node():
    tasks = {"440001": _mk_task("440001", protocol="modbus",
                                site="site1", device="plc1")}
    flows = build_flows_json(tasks)
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    assert len(in_nodes) == 1
    assert in_nodes[0]["topic"] == "1052os/site1/plc1/440001/value"
    assert in_nodes[0]["broker"] == "brk_1052os"
    assert in_nodes[0]["z"] == "tab_modbus"

def test_opcua_tag_uses_opcua_tab():
    tasks = {"x": _mk_task("x", protocol="opcua", site="site1", device="plc1")}
    flows = build_flows_json(tasks)
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    assert in_nodes[0]["z"] == "tab_opcua"

def test_id_normalization_handles_special_chars():
    tasks = {"TI-101.PV": _mk_task("TI-101.PV", protocol="modbus")}
    flows = build_flows_json(tasks)
    in_nodes = [n for n in flows if n["type"] == "mqtt in"]
    assert in_nodes[0]["id"] == "in_default_raw_data_TI_101_PV"

def test_wires_connect_mqtt_in_to_debug():
    tasks = {"440001": _mk_task("440001")}
    flows = build_flows_json(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in")
    debug_id = in_node["wires"][0][0]
    debug_node = next(n for n in flows if n["id"] == debug_id)
    assert debug_node["type"] == "debug"

def test_broker_port_is_string():
    flows = build_flows_json({})
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["port"] == "1883"  # NOT 1883 (int)
    assert isinstance(broker["port"], str)

def test_idempotent_regeneration():
    tasks = {"440001": _mk_task("440001")}
    f1 = build_flows_json(tasks)
    f2 = build_flows_json(tasks)
    assert f1 == f2  # same input → same output

def test_port_parameter_overrides_default():
    flows = build_flows_json({}, port=1884)
    broker = next(n for n in flows if n["type"] == "mqtt-broker")
    assert broker["port"] == "1884"
```

### 集成测试（HTTP endpoint）

```python
# test_nodered_flows_endpoint.py (or in test_nodered_e2e.py)
def test_endpoint_returns_valid_flows_json():
    if not _gateway_running():
        pytest.skip("Gateway not running on :8765")
    r = requests.get("http://localhost:8765/api/nodered/flows")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/json"
    flows = r.json()
    assert isinstance(flows, list)
    # minimal sanity
    assert any(n["type"] == "mqtt-broker" for n in flows)
```

### 验证方式（手动）

```
1. 启动 gateway + broker
2. 添加几个 collect tasks
3. 浏览器 GET http://localhost:8765/api/nodered/flows → 下载 1052os-flows.json
4. 打开 Node-RED → Import → 选择文件
5. 部署后立即看到所有 mqtt in 节点 + 实时值
```

## Definition of Done (DoD)

- [ ] `GET /api/nodered/flows` 返回合法 `flows.json` (list of dicts)
- [ ] 响应头包含 `Content-Disposition: attachment; filename="1052os-flows.json"`
- [ ] 空 tasks 返回 `{2 tabs, 1 broker}` (3 nodes)
- [ ] N 个 tasks 返回 `2 + 1 + 2*N` nodes
- [ ] modbus tags 关联 `tab_modbus`，opcua 关联 `tab_opcua`
- [ ] broker port 是字符串 `"1883"` (不是 int)
- [ ] ID 规范化处理 `-`, `.`, `/` 等特殊字符
- [ ] wires 正确连接 `mqtt in` → `debug`
- [ ] 多次调用产生相同输出（idempotent）
- [ ] Node-RED 3.x/4.x/5.x 都能 Import
- [ ] `pytest -v` 全绿 (含新 tests)
- [ ] 前端 §01 面板有"Export flows.json"按钮
- [ ] `docs/node-red-integration.md` 增补导出/Import 步骤

## Open questions

无。5 个设计问题已在 brainstorm 阶段全部解决。

## Risks

| Risk | Mitigation |
|---|---|
| Node-RED 版本不识别某些字段 | 只用 3.x/4.x/5.x 通用字段（`wires`, `x/y`, `z`, `broker`, `topic`, `qos` 等） |
| 100+ tags 导致画布拥挤 | 文档说明"可按需折叠/分组"；x/y 布局每 4 个换行避免完全重叠 |
| ID 冲突 | `_safe_id()` 内置计数器 + unique-check |
| 浏览器下载文件名乱码 | `Content-Disposition` 用 ASCII filename；中文名在 URL 中风险 |
| Node-RED 不接受新字段如 `protocolVersion: "4"` | 测试在 5.x 验证；若 4.x 报错则降级为 `protocolVersion: "3"` |
| 大文件下载阻塞 | N < 1000 时文件 < 100KB，远低于浏览器下载阈值 |
