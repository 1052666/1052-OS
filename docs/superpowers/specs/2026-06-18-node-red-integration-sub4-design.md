# 2026-06-18 — Node-RED Integration (Sub-4: Dashboard Mirror)

## Context

Sub-1 (已完成) → MQTT 数据通道 (collector → MQTT broker → NR)
Sub-2 (已完成) → 一键导出 flows.json (订阅 value/meta topic 的 mqtt in + debug 节点)
Sub-3 (已完成) → MQTT 命令回写 + 审计 + 告警 ack

**Sub-4 跨越一个 UX 边界：让用户获得可视化的工业仪表盘**。当前 NR 流程里只有
`mqtt in` + `debug` 节点，用户必须自己拖拽 ui_gauge / ui_chart 等节点。100 个
tag 就要拖 100 次 — 不可接受。

### 关键发现（来自研究阶段）

**Node-RED Dashboard 生态存在两个版本**：
- **Legacy** `node-red-dashboard` (v2.x) — Angular v1, 稳定但停止维护
- **Dashboard 2.0** `@flowfuse/node-red-dashboard` — 现代版本，但 node 类型命名完全不同

**Sub-4 选用 legacy `node-red-dashboard`** — 理由：
1. 节点类型固定、文档完整、社区有大量示例
2. 3.x/4.x/5.x 全部兼容
3. Dashboard 2.0 的 ui-gauge 等节点命名变化大，会破坏 Sub-2 那种"一次生成兼容所有 NR 版本"的原则
4. 项目初期用户基数小，legacy dashboard 足够

**关键节点 schema**（已通过源码核对）：
- `ui_tab`: name, order, icon, disabled, hidden
- `ui_group`: name, tab, order, width, disp, collapse
- `ui_gauge`: name, label, group, order, width, height, gtype, min, max, seg1, seg2, colors
- `ui_chart`: chartType, label, group, order, width, height, legend, dot, xformat
- `ui_text`: label, group, order, width, height, format, layout, style

### 已锁定的设计决策（6 个 brainstorm 问题答案）

1. **Dashboard 版本** → Legacy `node-red-dashboard` (v2.x)
2. **Widget 类型映射** → numeric → ui_gauge + ui_chart；bit/string → ui_text
3. **Tab 组织** → 单 tab "1052-OS Industrial"，多个 group
4. **Group 划分** → Overview / Modbus Tags / OPC UA Tags / Anomalies / Writes
5. **控制 widgets** → 不生成（Sub-3 命令回写保持纯 MQTT 流；UI 控件由用户在 NR 中按需添加）
6. **阈值可视化** → ui_gauge 的 seg1/seg2 + colors 用 anomaly 阈值（如果有 channel 配置）

## Goals

- 用户在 §01 NR Bridge 面板点击"Export dashboard.json"按钮
- 浏览器下载 `1052os-dashboard.json` 文件
- 文件是 Node-RED 可直接 Import 的合法 `flows.json`（含 dashboard 节点）
- **前提**：用户必须已安装 `node-red-dashboard`（Sub-4 doc 提示用户安装）
- 导入后访问 `http://localhost:1880/ui` 立即看到所有 tag 的可视化（gauges + charts）
- Numeric tag → gauge + chart；bit/string → text
- 异常 channel 显示阈值（seg1/seg2 颜色）
- "Recent writes" 显示在 dashboard 内的 text widget（来自 audit topic）
- "Recent anomalies" 显示在 dashboard 内的 text widget（来自 anomaly topic）
- 整个生成路径是**只读**（不向 Node-RED 推送任何东西）

## Non-Goals (deferred)

- 控制 widgets（button / slider / switch 触发 Sub-3 写命令）— 留给后续 Sub-5
- Dashboard 2.0 兼容 — 单独 Sub-6
- 多 Dashboard 多 Tab — 单 tab 单 dashboard（用户可在 NR 内复制）
- 自定义主题 / 颜色 — 用 default
- Dashboard 节点拖拽布局自定义 — 用自动布局
- 用户手动 dashboard 配置持久化 — 不读不写 NR 配置
- Dashboard 鉴权 — 同 Sub-1/2/3（local trust）

## Architecture

```
┌──────────────────── 1052-OS Industrial Gateway (8765) ────────────────────┐
│                                                                              │
│  Sub-1 (数据通道, 已完):                                                       │
│  collector → MqttPublisher → 1052os/{site}/{device}/{tag}/value            │
│                              1052os/{site}/{device}/{tag}/meta             │
│                              1052os/events/anomaly/{channel}                │
│                              1052os/events/ack/{channel} (Sub-3)            │
│                                                                              │
│  Sub-4 (NEW) Dashboard 生成器:                                                  │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐    │
│  │ build_tag_      │ →  │ build_dashboard_ │ →  │ GET /api/nodered/   │    │
│  │ catalog()       │    │ flows(tasks,     │    │ dashboard           │    │
│  │ (Sub-1)         │    │ audit, anomaly)  │    │ → 1052os-dashboard  │    │
│  └─────────────────┘    └──────────────────┘    │    .json            │    │
│                                                   └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼  (HTTP GET)
                  ┌──────────────────────┐
                  │ Browser downloads    │
                  │ 1052os-dashboard.json│
                  └──────────┬───────────┘
                             │  user imports + installs node-red-dashboard
                             ▼
                  ┌──────────────────────┐
                  │ Node-RED             │
                  │  Import → Deploy     │
                  │  Visit http://       │
                  │  localhost:1880/ui   │
                  │  → see all gauges,   │
                  │    charts, text      │
                  │    widgets live      │
                  └──────────────────────┘
```

### 关键架构决策

- **生成是纯只读**：`build_dashboard_flows()` 只读 tasks / audit history / anomaly
  history，不修改任何 NR 状态。多次调用幂等。
- **每个 numeric tag 两个 widget**：ui_gauge（当前值）+ ui_chart（趋势）。
  用户可隐藏其一，但不能拖拽初始生成。
- **阈值即 gauge 段**：anomaly channel 的 low/high 自动转为 seg1/seg2 +
  colors（绿/黄/红）。
- **审计 + 异常用 text widget 显示**：不需要额外节点类型，订阅
  `1052os/events/+/+` 通配即可。
- **不引入鉴权**：与 Sub-1/2/3 一致。

## Components

### 新文件

| 文件 | 用途 | LoC est. |
|---|---|---|
| `gateway_python/gateway/dashboard_flows.py` | `build_dashboard_flows(tasks, anomaly_channels, recent_audit, recent_anomalies)` 纯函数 | ~280 |
| `gateway_python/tests/test_dashboard_flows.py` | 单元测试：tab/group 数量、widget 类型映射、threshold-as-segments、layout、空 tasks | ~250 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `gateway_python/gateway/server.py` | 新增 `GET /api/nodered/dashboard` 端点（约 +30 行） |
| `frontend/public/industrial-gateway/index.html` | §01 NR 面板加 "Export dashboard.json" 按钮 |
| `docs/node-red-integration.md` | 增补"§10 Dashboard 一键生成" + 安装指南 |

### 模块边界

```
dashboard_flows.build_dashboard_flows(tasks, anomaly_channels, recent_audit, recent_anomalies)
    ↑ reads
nodered_tags.build_tag_catalog(tasks)  (Sub-1)
    ↑ reads
server._collector.tasks, server._anomaly.channels, server._audit_logger, server._anomaly
    ↑
server.GET /api/nodered/dashboard
    ↑ HTTP
frontend "Export dashboard" button
```

`dashboard_flows` 不知道 `server` 或 `frontend` 的存在。它接收 plain Python
dicts/lists 作为输入。测试时不依赖 FastAPI / TDengine / NR。

## Data flow

### 生成的 dashboard flows.json 形状

```json
[
  {"id":"tab_1052os","type":"ui_tab","name":"1052-OS Industrial","order":1,"icon":"dashboard","disabled":false,"hidden":false},

  {"id":"grp_overview","type":"ui_group","name":"Overview","tab":"tab_1052os","order":1,"disp":true,"width":12,"collapse":false},
  {"id":"grp_modbus","type":"ui_group","name":"Modbus Tags","tab":"tab_1052os","order":2,"disp":true,"width":12,"collapse":false},
  {"id":"grp_opcua","type":"ui_group","name":"OPC UA Tags","tab":"tab_1052os","order":3,"disp":true,"width":12,"collapse":false},
  {"id":"grp_anomalies","type":"ui_group","name":"Anomalies","tab":"tab_1052os","order":4,"disp":true,"width":12,"collapse":false},
  {"id":"grp_writes","type":"ui_group","name":"Recent Writes","tab":"tab_1052os","order":5,"disp":true,"width":12,"collapse":false},

  {"id":"ui_base","type":"ui_base","theme":{"name":"theme-light","lightTheme":{"default":"#0094CE","baseColor":"#0094CE","baseFont":"Helvetica Neue"},"darkTheme":{"default":"#097479","baseColor":"#097479"}}},

  {"id":"in_overview_status","type":"mqtt in","z":"tab_1052os","name":"Status","topic":"1052os/events/status","qos":"0","datatype":"auto","broker":"brk_1052os","x":140,"y":80,"wires":[["txt_overview_status"]]},
  {"id":"txt_overview_status","type":"ui_text","z":"tab_1052os","g":"grp_overview","group":"grp_overview","name":"Gateway Status","order":1,"width":0,"height":1,"label":"Gateway","format":"{{msg.payload}}","layout":"row-spread","x":340,"y":80,"wires":[]},

  {"id":"in_TI_101","type":"mqtt in","z":"tab_1052os","name":"TI-101","topic":"1052os/site1/plc1/TI-101/value","qos":"0","datatype":"auto","broker":"brk_1052os","x":140,"y":160,"wires":[["g_TI_101","ch_TI_101"]]},
  {"id":"g_TI_101","type":"ui_gauge","z":"tab_1052os","g":"grp_modbus","name":"TI-101","label":"TI-101","group":"grp_modbus","order":1,"width":6,"height":4,"gtype":"gage","min":0,"max":100,"seg1":40,"seg2":80,"colors":["#00B500","#E6E600","#CA3838"],"format":"{{value}}","x":340,"y":120,"wires":[]},
  {"id":"ch_TI_101","type":"ui_chart","z":"tab_1052os","g":"grp_modbus","name":"TI-101","label":"TI-101 trend","group":"grp_modbus","order":2,"width":12,"height":4,"chartType":"line","legend":false,"dot":false,"xformat":"HH:mm:ss","ymin":"","ymax":"","interpolate":"linear","x":340,"y":200,"wires":[]},

  {"id":"in_anomalies","type":"mqtt in","z":"tab_1052os","name":"Anomaly events","topic":"1052os/events/anomaly/#","qos":"0","datatype":"auto","broker":"brk_1052os","x":140,"y":320,"wires":[["txt_anomalies"]]},
  {"id":"txt_anomalies","type":"ui_text","z":"tab_1052os","g":"grp_anomalies","group":"grp_anomalies","name":"Recent Anomalies","label":"Recent Anomalies","order":1,"width":0,"height":6,"format":"{{msg.payload.channel}} · {{msg.payload.severity}} · {{msg.payload.message}}","layout":"row-spread","x":340,"y":320,"wires":[]},

  {"id":"in_writes","type":"mqtt in","z":"tab_1052os","name":"Write audit","topic":"1052os/events/+/+","qos":"0","datatype":"auto","broker":"brk_1052os","x":140,"y":400,"wires":[["txt_writes"]]},
  {"id":"txt_writes","type":"ui_text","z":"tab_1052os","g":"grp_writes","group":"grp_writes","name":"Recent Writes","label":"Recent Writes","order":1,"width":0,"height":6,"format":"{{msg.payload.cmd}} · {{msg.payload.target}} · {{msg.payload.result}}","layout":"row-spread","x":340,"y":400,"wires":[]},

  ... one in_node + ui_gauge + ui_chart per numeric tag
]
```

### Widget 类型映射

| Tag `dtype` | ui_gauge | ui_chart | ui_text |
|---|---|---|---|
| `u16`, `i16`, `u32`, `i32`, `u64`, `i64`, `f32` | ✓ | ✓ | — |
| `bit`, `bool` | — | — | ✓ |
| `ascii`, `utf8` | — | — | ✓ |

Min/max 默认值: `dtype in [u16, u32, u64, bit] → min=0`；`dtype in [i16, i32, i64] → min=-100, max=100`；`f32 → min=0, max=100`。

**Anomaly channel 覆盖默认**：如果 tag 在 anomaly 通道中有配置（`channel.id == tag.id` 或 `tag.table`），用 `channel.low / channel.high` 作为 seg1/seg2。

### Layout 算法

- Modbus gauge: `x=240 + (idx % 2) * 320, y=120 + (idx // 2) * 100`（2 per row）
- Modbus chart: `x=240, y=120 + (idx // 2) * 100 + 60`（每个 chart 占满行）
- OPC UA 整体 y 偏移 +400
- Anomaly text: x=340, y=320
- Write text: x=340, y=400
- Overview text: x=340, y=80

### Endpoint 行为

```
GET /api/nodered/dashboard
  → 200 OK
    Content-Type: application/json
    Content-Disposition: attachment; filename="1052os-dashboard.json"
    Body: [ ...flows array... ]
  → 500 (only if internal error; not for "no tasks" — returns base flows)
```

**没有 tasks 时返回**：1 个 tab + 1 个 ui_base + 5 个 group + 1 个 Overview text widget。
用户可正常 Import 看到空 dashboard，再添加 tag 后重新导出。

### 节点 ID 规范化（复用 Sub-2 的 `_safe_id`）

- `tab_1052os` / `ui_base` 是固定
- group IDs: `grp_overview` / `grp_modbus` / `grp_opcua` / `grp_anomalies` / `grp_writes`
- widget IDs: `in_<safe_tag>` / `g_<safe_tag>` / `ch_<safe_tag>` / `txt_<name>`

## Error handling

| 场景 | 策略 | 实现 |
|---|---|---|
| 没有 tasks | 返回基础 flows（tab + ui_base + 5 group + 1 overview） | `if not tasks: return _base_flows()` |
| 异常 channel 不存在对应 tag | gauge 用 default min/max | 不阻塞 |
| 标签含特殊字符 | 替换为 `_` | `_safe_id()` 复用 Sub-2 |
| ID 重复 | 递增后缀 `_2`, `_3`... | `_safe_id()` 计数器 |
| node-red-dashboard 未安装 | 用户 Import 后无 dashboard tab | doc §10 提示安装；不自动安装 |
| HTTP 下载被浏览器拦截 | 默认不拦截 | 无需处理 |

## Testing

### 单元测试（不依赖 Node-RED / MQTT）

```python
# test_dashboard_flows.py

def test_empty_tasks_returns_base_flows():
    flows = build_dashboard_flows({})
    assert any(n["type"] == "ui_tab" for n in flows)
    assert any(n["type"] == "ui_base" for n in flows)
    # 5 groups
    groups = [n for n in flows if n["type"] == "ui_group"]
    assert len(groups) == 5

def test_numeric_tag_creates_gauge_and_chart():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge"]
    charts = [n for n in flows if n["type"] == "ui_chart"]
    assert any(g["label"] == "TI-101" for g in gauges)
    assert any(c["label"] == "TI-101" for c in charts)

def test_bit_dtype_creates_text_widget_not_gauge():
    tasks = {"PUMP1_RUN": _mk_task("PUMP1_RUN", dtype="bit")}
    flows = build_dashboard_flows(tasks)
    gauges = [n for n in flows if n["type"] == "ui_gauge"]
    assert not any(g["name"] == "PUMP1_RUN" for g in gauges)
    texts = [n for n in flows if n["type"] == "ui_text"]
    assert any(t["name"] == "PUMP1_RUN" for t in texts)

def test_anomaly_threshold_used_as_gauge_segments():
    tasks = {"TI-101": _mk_task("TI-101", dtype="f32")}
    channels = {"TI-101": _mk_channel("TI-101", low=10, high=90)}
    flows = build_dashboard_flows(tasks, channels)
    gauge = next(g for g in flows if g["type"] == "ui_gauge" and g["name"] == "TI-101")
    assert gauge["seg1"] == 10
    assert gauge["seg2"] == 90

def test_widgets_belong_to_correct_groups():
    tasks = {"TI-101": _mk_task("TI-101", protocol="modbus")}
    flows = build_dashboard_flows(tasks)
    gauge = next(g for g in flows if g["type"] == "ui_gauge" and g["name"] == "TI-101")
    assert gauge["group"] == "grp_modbus"

def test_mqtt_in_nodes_use_correct_topic():
    tasks = {"TI-101": _mk_task("TI-101", site="site1", device="plc1")}
    flows = build_dashboard_flows(tasks)
    in_node = next(n for n in flows if n["type"] == "mqtt in" and "TI_101" in n["name"])
    assert in_node["topic"] == "1052os/site1/plc1/TI-101/value"

def test_anomaly_text_subscribes_to_wildcard():
    flows = build_dashboard_flows({})
    in_node = next(n for n in flows if n["type"] == "mqtt in" and "Anomaly" in n["name"])
    assert "1052os/events/anomaly/#" == in_node["topic"]

def test_idempotent_regeneration():
    tasks = {"TI-101": _mk_task("TI-101")}
    f1 = build_dashboard_flows(tasks)
    f2 = build_dashboard_flows(tasks)
    assert f1 == f2
```

### 集成测试（HTTP endpoint）

```python
def test_endpoint_returns_valid_dashboard_json():
    if not _gateway_running(): pytest.skip(...)
    r = requests.get("http://localhost:8765/api/nodered/dashboard")
    assert r.status_code == 200
    flows = r.json()
    assert any(n["type"] == "ui_tab" for n in flows)
```

### Definition of Done (DoD)

- [ ] `GET /api/nodered/dashboard` 返回合法 dashboard flows.json
- [ ] 响应头含 `Content-Disposition: attachment; filename="1052os-dashboard.json"`
- [ ] 空 tasks 返回 base flows（tab + ui_base + 5 group + 1 overview text）
- [ ] N 个 numeric tasks 返回 5 + 1 (overview) + 2*N + 2 (anomaly + writes text) + 2N (mqtt in) 个节点
- [ ] Numeric tag → gauge + chart；bit/string → text
- [ ] Anomaly channel 的 low/high → gauge seg1/seg2
- [ ] §01 NR 面板有"Export dashboard.json"按钮
- [ ] `pytest -v` 全绿 (含新 tests + 已有 99)
- [ ] `docs/node-red-integration.md` 增补 §10 含 dashboard 安装说明
- [ ] 编译无错误

## Open questions

无。6 个设计问题已在 brainstorm 阶段全部解决。

## Risks

| Risk | Mitigation |
|---|---|
| 用户未装 `node-red-dashboard` | doc §10 提示安装命令；Import 后无 tab 是用户的错 |
| Dashboard 2.0 用户期望不同 node 类型 | doc 明确说明 Sub-4 是 legacy dashboard v1.x |
| 100+ tags 导致 UI 拥挤 | NR Dashboard 支持分组折叠；doc 说明"在 NR 内可隐藏小组件" |
| gauge min/max 默认值不准确 | 用户可在 NR 内修改；默认覆盖仅当无 anomaly channel |
| color segments 误用 | 仅在 anomaly channel 配置时使用；否则默认绿黄红 0-100 范围 |
| Node-RED 版本不识别 `disp` / `collapse` 字段 | 这些是 legacy dashboard v2.16+ 才有的字段；Sub-4 假设 NR ≥ 3.0 |