# 2026-06-18 — Node-RED Integration (Sub-3: Orchestration)

## Context

Sub-1（已完成, `nodered-sub1-v0.1`）建立了 MQTT 数据通道 — gateway 把 collector
实时值和异常事件推给 Node-RED。Sub-2（已完成, `nodered-sub2-v0.1`）让用户一键导出
可 Import 的 `flows.json`。

Sub-3 跨越一个关键边界：**让 Node-RED 写回 gateway**。这意味着：
- 用户在 Node-RED 中设计联动逻辑（例如：温度 > 80°C 时关闭阀门）
- 用户在 Node-RED Dashboard 中手动调整设定值
- Node-RED → gateway → Modbus 设备（或 OPC UA 服务器）

由于写入是**有副作用的**（开错阀可能导致事故），Sub-3 必须把"能写"和"安全"
两个属性同时落地。

### 关键发现（来自研究阶段）

**好消息**：所有底层写原语**已经存在**（`modbus_client.py` 提供了
`write_coil/write_register/write_coils/write_registers/write_float32`，
`opcua_client.py` 提供了 `async def write_node`），对应的 HTTP 端点
（`/api/modbus/write/*`, `/api/opcua/write`）也已经在 `server.py` 中。

**真正的工作**：在原语之上加 4 层护栏 — **命令通道**、**审计**、**告警确认**、**最小护栏集合**。
**不**做：白名单、范围检查、dry-run、鉴权（项目初期策略）。

### 已锁定的设计决策（7 个 brainstorm 问题答案）

1. **触发方式** → MQTT 命令主题（`1052os/cmd/write/modbus`, `1052os/cmd/write/opcua`）
2. **鉴权** → 不鉴权（与 Sub-1/2 一致；本地网络信任）
3. **写白名单** → 不设（项目初期；靠审计 + 人工责任）
4. **告警确认** → 简单 `acked BOOL` 字段（不复用 ack_by/ack_ts 复杂度）
5. **Dry-run** → 不提供（项目初期不做调测设施）
6. **审计保留期** → 7 天（TDengine 默认；项目初期足够）
7. **范围检查** → 不检查（项目初期；后续可加）

## Goals

- Node-RED 可通过 MQTT 触发 Modbus 写（coil / register / float32）和 OPC UA 写
- 每次写入都记到 TDengine `write_audit` 表，保留 7 天
- 异常告警可被 Node-RED 标记为 `acked=true`
- §01 NR 面板加 "Recent writes" 区域（最近 5 条审计）
- §01 异常告警区显示每条告警的 ack 状态，并支持一键 ack
- **零新增鉴权逻辑**（与 Sub-1/2 一致）
- **零范围检查**（项目初期不做）

## Non-Goals (deferred)

- 写白名单（per-tag / per-address / per-site）
- 写入范围检查（safe range / 上下限）
- Dry-run 模式
- 鉴权（token / 用户名密码 / mTLS）
- 写入回滚（write 失败时尝试恢复原值）
- 写入前后的设备读校验
- 多用户审计追踪（仅记 source 字段，不记 user）
- 写入速率限制
- 写审计的导出/合规报表
- Sub-4 才会做的 Dashboard 镜像

## Architecture

```
┌──────────────────── 1052-OS Industrial Gateway (8765) ────────────────────┐
│                                                                              │
│  Sub-1 (数据通道):                                                           │
│  collector → MqttPublisher → 1052os/{site}/{device}/{tag}/value            │
│                                                                              │
│  Sub-3 (NEW) 命令通道:                                                        │
│  MQTT Subscriber ← 1052os/cmd/write/modbus ← NR (mqtt out)                  │
│  MQTT Subscriber ← 1052os/cmd/write/opcua  ← NR (mqtt out)                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────┐    ┌──────────────────┐                                │
│  │ CommandHandler  │ →  │ modbus_client    │                                │
│  │ (NEW)           │    │   .write_coil    │ (existing)                     │
│  │                 │    │   .write_register│                                │
│  │                 │    │ opcua_client     │                                │
│  │                 │    │   .write_node    │                                │
│  └────────┬────────┘    └──────────────────┘                                │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                        │
│  │ write_audit_log │ (NEW TDengine stable)                                   │
│  │ ts | source |   │                                                        │
│  │ protocol | addr │                                                        │
│  │ value | result  │                                                        │
│  └─────────────────┘                                                        │
│                                                                              │
│  异常 ack:                                                                    │
│  POST /api/anomaly/ack?id=X → anomaly.ack_one() (NEW)                      │
│  anomaly_log: ALTER STABLE ADD COLUMN acked BOOL (NEW)                      │
│                                                                              │
│  通知反馈:                                                                    │
│  MqttPublisher.publish_event("ack", channel_id, {acked: true, ...}) (NEW)   │
│       │                                                                      │
│       ▼                                                                      │
│  1052os/events/ack/{channel_id}  (retained, QoS 0)                          │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ MQTT 1052os/cmd/write/*
                            │
                  ┌──────────────────────┐
                  │ Node-RED             │
                  │  mqtt out (cmd)      │
                  │  mqtt in  (audit)    │   ◀── NEW
                  │  mqtt in  (ack)      │   ◀── NEW
                  │  function (logic)    │
                  │  dashboard (control) │   (Sub-4 will integrate deeper)
                  └──────────────────────┘
```

### 关键架构决策

- **命令走 MQTT，不走 HTTP** — 统一架构（与 Sub-1 数据通道对称），Node-RED 侧
  只需 `mqtt out` 节点，不需 `http request`。同时天然支持多 NR 实例和多 gateway 实例。
- **每次写入都审计** — 即使失败也记。失败时 `result=error`，附 `error` 字段。
- **ack 字段直接 ALTER STABLE 添加** — 不重写 anomaly_log 表。
- **ack 后发保留消息** — NR 通过 `1052os/events/ack/{id}` 立即看到状态变化。
- **不引入任何写前的状态机** — 不做"半成功"、不做"事务"。

## Components

### 新文件

| 文件 | 用途 | LoC est. |
|---|---|---|
| `gateway_python/gateway/command_handler.py` | 订阅 `1052os/cmd/write/#`，分发到 modbus/opcua，写审计 | ~150 |
| `gateway_python/gateway/write_audit.py` | `WriteAuditLogger` — TDengine 写审计 helper | ~60 |
| `gateway_python/gateway/ack_handler.py` | `AnomalyAckHandler` — ack 逻辑 + 事件发布 | ~50 |
| `gateway_python/tests/test_command_handler.py` | 单元测试：payload 解析、modbus 写、opcua 写、错误处理、审计 | ~200 |
| `gateway_python/tests/test_write_audit.py` | 单元测试：写审计格式、字段、TDengine SQL | ~80 |
| `gateway_python/tests/test_ack_handler.py` | 单元测试：ack 流程、事件发布、TDengine 更新 | ~80 |
| `gateway_python/tests/test_command_e2e.py` | E2E: 真实 broker + NR 模拟器，发命令、收审计、ack 告警 | ~150 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `gateway_python/gateway/server.py` | ① 新增 `POST /api/anomaly/ack` 端点 ② 新增 `GET /api/audit/writes?limit=20` 端点 ③ lifespan 启动 `CommandHandler` 和 `WriteAuditLogger` ④ `_mqtt_client` 已有，命令订阅复用 |
| `gateway_python/gateway/anomaly.py` | ① `_ensure_log_table` 升级：`acked BOOL` 列 ② 新增 `ack_one(channel_id, ts) -> bool` 方法 |
| `frontend/public/industrial-gateway/index.html` | ① §01 NR 面板加 "Recent writes" 列表 ② §03 事件区 ack 状态显示 + "Ack" 按钮 |
| `docs/node-red-integration.md` | 增补"§9 Writing from Node-RED to gateway" + ack 一节 |

### 模块边界

```
mqtt 1052os/cmd/write/modbus → CommandHandler._on_modbus_cmd
                                  → modbus_client.write_coil/register/float32
                                  → WriteAuditLogger.log(...)

mqtt 1052os/cmd/write/opcua  → CommandHandler._on_opcua_cmd
                                  → opcua_client.write_node (async wrapper)
                                  → WriteAuditLogger.log(...)

POST /api/anomaly/ack        → anomaly.ack_one(channel_id, ts)
                                  → td._exec("UPDATE anomaly_log SET acked=1 WHERE channel_id=? AND ts=?")
                                  → mqtt_publisher.publish_event("ack", channel_id, {acked: true, ts, by: "gateway"})
```

## Data flow

### MQTT 命令 payload schemas

**`1052os/cmd/write/modbus`** (QoS 0/1, **不 retained**):
```json
{
  "cmd": "write_coil",
  "host": "127.0.0.1",
  "port": 502,
  "unit_id": 1,
  "address": 0,
  "value": true
}
```

支持的 `cmd` 字段：
- `write_coil` — `value: bool`
- `write_register` — `value: int`
- `write_coils` — `value: list[bool]`
- `write_registers` — `value: list[int]`
- `write_float32` — `value: float`, `byteorder`: "ABCD"|"CDAB"|"BADC"|"DCBA" (默认 "ABCD")

**`1052os/cmd/write/opcua`** (QoS 0/1, **不 retained**):
```json
{
  "cmd": "write_node",
  "url": "opc.tcp://127.0.0.1:4840",
  "node_id": "ns=2;s=Channel1.Device1.Tag1",
  "value": 42.0
}
```

支持的 `cmd` 字段：
- `write_node` — `value: any` (类型由 OPC UA 服务器决定)

### 错误响应模式

写失败时，CommandHandler 仍发一条**审计记录**（result=error），并 publish 一条
**响应**到 `1052os/cmd/response/{request_id}` 主题（QoS 0）：
```json
{
  "request_id": "uuid",
  "ts": 1700000000.5,
  "cmd": "write_coil",
  "ok": false,
  "error": "FC5 write_coil failed: Connection refused"
}
```

成功时：
```json
{
  "request_id": "uuid",
  "ts": 1700000000.5,
  "cmd": "write_coil",
  "ok": true,
  "address": 0,
  "value": true
}
```

`request_id` 由 NR 在 cmd payload 中提供（UUID），用于关联请求和响应。

### 写审计表 schema

TDengine `write_audit` stable:
```sql
CREATE STABLE IF NOT EXISTS write_audit (
  ts TIMESTAMP,
  request_id BINARY(64),
  source BINARY(64),         -- e.g. "nodered:user" or "http:127.0.0.1"
  protocol BINARY(16),       -- "modbus" | "opcua"
  target BINARY(256),        -- e.g. "127.0.0.1:502/u1/0" or "opc.tcp://.../ns=2;s=Tag"
  cmd BINARY(32),            -- e.g. "write_coil"
  value_str BINARY(256),     -- string repr of value (since values are heterogeneous)
  result BINARY(16),         -- "ok" | "error"
  error BINARY(512)          -- null on success
) TAGS (site BINARY(64));
```

每条记录创建子表 `w_<request_id_short>` via `USING write_audit TAGS ("default")`。

**保留期**：7 天。TDengine 数据文件可手动清理；本 Sub 不实现自动清理（项目初期，
数据量小）。

### ack 表 schema (ALTER STABLE)

```sql
ALTER STABLE anomaly_log ADD COLUMN acked BOOL;
```

默认值 NULL（不显式设置时）。`ack_one()` 设置为 `true` (1)。

### ack 事件 schema

`1052os/events/ack/{channel_id}` (retained, QoS 0):
```json
{
  "ts": 1700000000.5,
  "channel": "ch1",
  "acked": true,
  "acked_by": "gateway"
}
```

`acked_by` 字段为简化 — 永远是 `"gateway"`，因为 Sub-3 无鉴权。

## Error handling

| 场景 | 策略 | 实现 |
|---|---|---|
| 收到 payload 缺字段 | 忽略 + 警告日志 + 记审计（result=error） | `try/except KeyError` |
| 收到未知 cmd | 忽略 + 警告日志 + 记审计（result=error） | `if cmd not in SUPPORTED` |
| Modbus 设备离线 | 捕获 IOError + 记审计（result=error, error=msg） | `_modbus.write_*` 抛 IOError |
| OPC UA 服务器离线 | 同上 | `_opcua.write_node` 抛异常 |
| TDengine 写审计失败 | 不抛；仅日志警告（审计失败不影响主流程） | `try/except Exception` 包裹 `_td._exec` |
| Ack 找不到对应告警 | 返 404 + 警告日志 | 检查 `ack_one()` 返回值 |
| 多 NR 同时写同一寄存器 | **最后写入生效**（last-write-wins，无应用锁） | 文档说明 |
| Broker 断开 | CommandHandler 内部重连（paho auto-reconnect） | `reconnect_delay_set(5, 60)` |
| MQTT 订阅器重启 | 重启后自动重新订阅 | paho 持久 session 或 `loop_start` 重连后重新 `subscribe` |

## Testing

### 单元测试（不依赖 TDengine / Modbus 真实设备）

```python
# test_command_handler.py
def test_modbus_write_coil_dispatches_to_modbus():
    fake_modbus = MagicMock()
    handler = CommandHandler(modbus=fake_modbus, ...)
    payload = {"cmd": "write_coil", "host": "127.0.0.1", "port": 502,
               "unit_id": 1, "address": 0, "value": True}
    handler._handle_modbus_cmd(json.dumps(payload).encode())
    fake_modbus.write_coil.assert_called_once_with(0, True)

def test_modbus_unknown_cmd_logs_and_audits():
    ...

def test_opcua_write_node_dispatches():
    ...

def test_modbus_write_failure_still_audits():
    fake_modbus = MagicMock()
    fake_modbus.write_coil.side_effect = IOError("FC5 failed")
    handler = CommandHandler(modbus=fake_modbus, audit=...)
    payload = {...}
    handler._handle_modbus_cmd(json.dumps(payload).encode())
    audit.log.assert_called_once()
    assert audit.log.call_args.kwargs["result"] == "error"
```

### 集成测试（需要 broker + TDengine）

```python
# test_command_e2e.py
def test_e2e_mqtt_command_triggers_modbus_write():
    if not _broker_up() or not _tdengine_up():
        pytest.skip("need broker + TDengine")
    # ... connect a fake modbus server, send MQTT command, assert write reached
```

### Definition of Done (DoD)

- [ ] `mosquitto_pub -h localhost -t 1052os/cmd/write/modbus -m '{...write_coil...}'` 触发实际 Modbus 写
- [ ] 写审计记录出现在 `write_audit` 表（`SELECT * FROM write_audit LIMIT 5`）
- [ ] §01 NR 面板 "Recent writes" 显示最新 5 条
- [ ] §01 告警列表显示 `acked` 状态，并支持一键 ack
- [ ] POST `/api/anomaly/ack?channel=ch1&ts=...` 返回 200
- [ ] Ack 后，`1052os/events/ack/ch1` 收到 retained 消息
- [ ] Modbus 设备离线时，写审计记 result=error，不抛异常
- [ ] 多 NR 实例并发写同一寄存器 — last-write-wins，无应用崩溃
- [ ] `pytest -v` 全绿（新 tests + 已有 71）
- [ ] `docs/node-red-integration.md` 增补 §9 写入 + ack 指南
- [ ] 编译无错误

## Open questions

无。7 个设计问题已在 brainstorm 阶段全部解决。

## Risks

| Risk | Mitigation |
|---|---|
| 多 NR 写同一寄存器造成设备状态混乱 | 文档明确说"last-write-wins"；运维约定"只有一个 NR 实例做控制" |
| NR 写一个无效值导致设备报警 | **不**做范围检查（项目初期策略）；靠操作员责任 + 审计 |
| Modbus 设备响应慢导致 MQTT cmd 积压 | QoS=0，broker 不积压；超时由 pymodbus 默认 3s |
| TDengine 写审计失败导致审计缺失 | 审计失败仅日志，不影响主流程；运维通过日志告警 |
| Ack 事件 published 失败 | retained = false；下次 ack 重发即可 |
| 7 天后审计丢失，无法追溯 | 文档说明；运维需定期导出 |
| 写端点无鉴权 | 文档明确"仅限本地网络"；项目初期不补 |
| CommandHandler 重启后未完成命令丢失 | 无事务；快速失败；运维通过审计追踪 |
| OPC UA `value` 类型不匹配服务器期望 | 透传（asyncua 自己会报错）；审计记 error |
| ack_one 误用（ack 不存在的告警） | 返回 bool false；端点返 404 |
