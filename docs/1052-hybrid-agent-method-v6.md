# 1052-PD 实施计划（第六版）

状态：Draft v0.6  
日期：2026-04-24  
正式名称：`1052 单核渐进披露法`  
固定简称：`1052-PD`

## 0. 本版定位

V1 ~ V5 已经把方向和关键机制定得差不多了。  
V6 不再继续讨论方法论，只做一件事：

`把 1052-PD 变成可执行实施计划。`

这份文档回答五个问题：

1. 先做什么，后做什么  
2. 具体改哪些文件  
3. 每一阶段的验收标准是什么  
4. 如何灰度、回滚、兼容老会话  
5. 你现在应该审核哪些锁定项

## 1. 交付目标

V6 的交付目标不是“一次把 1052 全部重构完”，而是在不破坏现有产品结构的前提下，分阶段落地下面这些结果：

### 1.1 核心结果

- 将首轮静态注入从 `2w+ token` 降到 `P0 <= 3k`
- `P0` 不再挂全量业务工具 schema
- 引入 `request_context_upgrade` 元工具，按需挂载 pack
- 首批只试点：
  - `base-read-pack`
  - `repo-pack`
  - `search-pack`
- 新增 `checkpoint` 子系统，用于续跑，不替代历史存储
- 老会话可通过 `seed checkpoint` 平滑续聊
- usage 面板能分开显示：
  - 主链路消耗
  - upgrade overhead
  - cache hit

### 1.2 非目标

V6 明确不在首轮实现以下内容：

- 一次做完全部 `7` 个 pack
- 一次重写全部工具层
- 一次做完历史版本批量迁移
- 一次做完“编排日志 -> Skill 晋升”全流程
- 为所有 provider 做完全一致的缓存能力抽象

## 2. 锁定决策

V6 基于以下已锁定决策展开，默认不再回头改方向：

1. 单引擎，不做双引擎  
2. `P0` 固定启动，不做前置任务分档分类器  
3. `P0` 只挂一个元工具：`request_context_upgrade`  
4. 续跑时绝不追加新的 `system message`  
5. 单轮最多 `2` 次升级，单次最多 `2` 个 pack  
6. 首批 pack 只给读能力，不给写能力  
7. `checkpoint` 用于续跑，`chat-history` 用于审计与 UI 恢复  
8. 老会话首次续聊时懒生成种子检查点  
9. `upgrade overhead` 必须单独计量和展示  
10. `1052-PD` 作为固定名称，不再改名

## 3. 成功指标

V6 要求把成功指标写成可验证数字，而不是“应该更省”。

### 3.1 Token 指标

| 指标 | 目标 |
| --- | ---: |
| `P0` 静态总预算 | `<= 3000` |
| `1052.md` 核心规则 | `<= 800` |
| `1052.local.md` | `<= 200` |
| 项目画像摘要 | `<= 500` |
| checkpoint 注入摘要 | `<= 800` |
| 能力路由提示词 | `<= 400` |
| 元工具 schema | `<= 200` |
| `UAPIs` P0 目录 | `<= 300` |

### 3.2 行为指标

- `P0` 请求时不出现任何业务工具 schema
- `request_context_upgrade` 第三次请求会被硬拦截
- pack 挂载后自动续跑，无需用户重复发消息
- 用户点击 Stop 时，升级链路任何阶段都能终止并清理
- 老会话有 `compactSummary` 时，seed 不调用 LLM
- 老会话无 `compactSummary` 时，seed 只调用一次便宜模型

### 3.3 可观测性指标

- 单条 assistant 消息记录完整 usage
- usage 面板单独展示 `upgrade overhead`
- provider cache hit / read / write token 可见
- 后端日志能看到：
  - 请求是否走 `P0`
  - 挂载了哪些 pack
  - 升级次数
  - seed 状态

## 4. 代码改动总表

这一节是 V6 最重要的部分之一：把实现落到具体文件。

### 4.1 后端：修改现有文件

| 文件 | 计划改动 |
| --- | --- |
| `backend/src/modules/agent/agent.types.ts` | 扩展 `TokenUsage`、新增 upgrade 相关 usage 字段；补充 checkpoint 相关类型 |
| `backend/src/modules/agent/agent.routes.ts` | 扩展 SSE 事件类型；接入升级中间态；扩展 usage 校验 |
| `backend/src/modules/agent/agent.service.ts` | 从“直接拼大 prompt”改成“P0 -> 升级 -> 续跑”的总协调器 |
| `backend/src/modules/agent/agent.tool.service.ts` | 支持按 pack 返回工具定义，而不是永远全量返回 |
| `backend/src/modules/agent/agent.stats.service.ts` | 新增 `upgradeOverhead*`、`cacheReadTokens`、`cacheWriteTokens` 聚合统计 |
| `backend/src/modules/agent/agent.history.service.ts` | 存储扩展后的 usage 字段 |
| `backend/src/modules/agent/llm.client.ts` | provider 缓存 usage 归一化；MiniMax/DeepSeek/Anthropic 的 cache usage 对齐 |
| `backend/src/modules/settings/settings.types.ts` | 新增 `1052-PD` 相关开关 |
| `backend/src/modules/settings/settings.service.ts` | 归一化与默认值 |
| `backend/src/modules/uapis/uapis.service.ts` | 增加极简目录接口/渲染逻辑；拆分 P0 目录和 `search-pack` 详情链路 |

### 4.2 后端：新增文件

| 文件 | 作用 |
| --- | --- |
| `backend/src/modules/agent/agent.pack.service.ts` | pack 注册表、pack -> tools 映射、schema 预算控制 |
| `backend/src/modules/agent/agent.upgrade.service.ts` | `request_context_upgrade` 校验、升级次数限制、pack 长度限制、续跑状态控制 |
| `backend/src/modules/agent/agent.checkpoint.service.ts` | checkpoint 读写、压缩、注入摘要生成 |
| `backend/src/modules/agent/agent.seed.service.ts` | 老会话 seed checkpoint 的快路径/慢路径 |
| `backend/src/modules/agent/agent.redaction.service.ts` | seed 前脱敏逻辑 |
| `backend/src/modules/agent/agent.runtime.types.ts` | stream event、pack、checkpoint、seed 状态等运行时类型 |
| `backend/src/modules/agent/agent.p0.service.ts` | 组装 `P0` 的最小上下文和元工具 |
| `backend/src/modules/agent/agent.cache-policy.service.ts` | provider 缓存策略、前缀构造顺序、cache usage 归一 |

### 4.3 前端：修改现有文件

| 文件 | 计划改动 |
| --- | --- |
| `frontend/src/api/agent.ts` | 扩展 stream event 类型，支持 upgrade 中间态；扩展 `TokenUsage` 字段 |
| `frontend/src/pages/Chat.tsx` | 处理 `context-upgrade-*` 事件；Stop 按钮中止多阶段请求；显示中间态 |
| `frontend/src/components/TokenUsagePanel.tsx` | 新增 `upgrade overhead`、cache hit 展示 |
| `frontend/src/styles.css` | 补充升级状态条、usage 新区块样式 |
| `frontend/src/api/settings.ts` | 扩展 agent 设置项 |
| `frontend/src/pages/Settings.tsx` | 暴露灰度开关和调试项 |

### 4.4 前端：可选新增文件

| 文件 | 作用 |
| --- | --- |
| `frontend/src/components/AgentUpgradeStatus.tsx` | 聊天中的升级状态条 |
| `frontend/src/components/CheckpointDebugCard.tsx` | 调试态查看当前挂载 pack 和 checkpoint 摘要 |

## 5. 数据结构变更

### 5.1 TokenUsage

现有 `TokenUsage` 需要扩成下面这样：

```ts
type TokenUsage = {
  userTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  upgradeOverheadInputTokens?: number
  upgradeOverheadOutputTokens?: number
  upgradeOverheadTotalTokens?: number
  estimated?: boolean
}
```

### 5.2 StreamEvent

现有 `delta/usage/done/error` 事件需要扩成：

```ts
type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; packs: string[] }
  | { type: 'context-upgrade-applied'; packs: string[] }
  | { type: 'context-upgrade-aborted'; stage: string }
  | { type: 'done' }
  | { type: 'error'; status?: number; message: string }
```

### 5.3 Checkpoint

第一版 checkpoint 建议使用：

```ts
type AgentCheckpoint = {
  sessionId: string
  goal?: string
  phase?: string
  facts: string[]
  done: string[]
  failedAttempts: string[]
  nextStep?: string
  mountedPacks: string[]
  relatedRules: string[]
  relatedMemories: string[]
  relatedSkills: string[]
  summaryInjectedTokens?: number
  seedStatus?: 'pending' | 'ready' | 'failed'
  seedAttempts?: number
  seedInputFingerprint?: string
  updatedAt: number
}
```

### 5.4 AgentSettings

建议在 `settings` 里最少新增这几项：

```ts
type AgentSettings = {
  streaming: boolean
  userPrompt: string
  fullAccess: boolean
  contextMessageLimit: number
  progressiveDisclosureEnabled: boolean
  providerCachingEnabled: boolean
  checkpointEnabled: boolean
  seedOnResumeEnabled: boolean
  upgradeDebugEventsEnabled: boolean
}
```

其中：

- `progressiveDisclosureEnabled`
  作为总开关
- `providerCachingEnabled`
  允许单独关闭缓存，便于排查
- `checkpointEnabled`
  支持先只上 P0+pack，不上 checkpoint
- `seedOnResumeEnabled`
  控制老会话种子生成
- `upgradeDebugEventsEnabled`
  允许先在开发环境显示更多中间态

## 6. Pack 计划

### 6.1 Phase 1 只实现三个 pack

第一批只做：

- `base-read-pack`
- `repo-pack`
- `search-pack`

### 6.2 Pack 定义

#### `base-read-pack`

- `filesystem-read`

#### `repo-pack`

- `repository-read`
- `terminal-readonly`
- 自动叠加 `base-read-pack`

#### `search-pack`

- `websearch`
- `uapis_list`
- `uapis_read`
- `uapis_call`
- 自动叠加 `base-read-pack`

### 6.3 不在首批做的 pack

后置到后续阶段：

- `memory-pack`
- `skill-pack`
- `plan-pack`
- `data-pack`
- `channel-pack`
- `edit-pack`
- `exec-pack`

## 7. 分阶段实施计划

这一节是 V6 的核心执行表。

### Phase 0：基线与开关

目标：

- 在不改变用户体验的前提下，把 `1052-PD` 的基线框架铺好

任务：

1. 扩展 `settings` 增加灰度开关  
2. 扩展 `TokenUsage` 与统计结构  
3. 扩展 `stream event` 类型  
4. 补 `P0` token 审计输出  
5. 建立 pack 注册表空壳

涉及文件：

- `backend/src/modules/settings/settings.types.ts`
- `backend/src/modules/settings/settings.service.ts`
- `frontend/src/api/settings.ts`
- `frontend/src/pages/Settings.tsx`
- `backend/src/modules/agent/agent.types.ts`
- `backend/src/modules/agent/agent.runtime.types.ts`
- `backend/src/modules/agent/agent.stats.service.ts`
- `frontend/src/api/agent.ts`

验收标准：

- 所有新增字段能正常序列化/反序列化
- 旧 settings 文件不报错
- 旧 usage 面板不崩
- 默认关闭 `progressiveDisclosureEnabled` 时，行为与当前主线一致

回滚方式：

- 关闭 `progressiveDisclosureEnabled`

### Phase 1：P0 瘦身 + Provider 缓存 + UAPIs 极简目录

目标：

- 先把首轮静态载荷大头砍掉

任务：

1. 实现 `agent.p0.service.ts`  
2. `P0` 只挂 `request_context_upgrade`  
3. `UAPIs` 改成极简目录模式  
4. `llm.client.ts` 归一化 cache usage  
5. `agent.cache-policy.service.ts` 实现三家 provider 的缓存策略  
6. 输出 cache hit / read / write usage

涉及文件：

- `backend/src/modules/agent/agent.p0.service.ts`
- `backend/src/modules/agent/agent.service.ts`
- `backend/src/modules/agent/llm.client.ts`
- `backend/src/modules/agent/agent.cache-policy.service.ts`
- `backend/src/modules/uapis/uapis.service.ts`
- `backend/src/modules/agent/agent.routes.ts`
- `frontend/src/api/agent.ts`

验收标准：

- `P0` 请求无业务工具 schema
- `P0` 估算静态预算 `<= 3k`
- `UAPIs` P0 目录 `<= 300`
- Anthropic / DeepSeek / MiniMax 的 cache usage 字段能被记录

回滚方式：

- 关闭 `providerCachingEnabled`
- 关闭 `progressiveDisclosureEnabled`

### Phase 2：升级动作 + base-read/repo/search pack 试点

目标：

- 跑通“元工具申请 -> 挂载 pack -> 同轮续跑”

任务：

1. 实现 `agent.upgrade.service.ts`  
2. 实现 `agent.pack.service.ts`  
3. 加入：
   - 单轮最多 2 次升级
   - 单次最多 2 个 pack
4. 明确禁止续跑追加新 `system message`
5. 接入 `base-read-pack / repo-pack / search-pack`
6. SSE 中输出：
   - `context-upgrade-requested`
   - `context-upgrade-applying`
   - `context-upgrade-applied`
   - `context-upgrade-aborted`
7. 前端聊天页展示升级状态条

涉及文件：

- `backend/src/modules/agent/agent.upgrade.service.ts`
- `backend/src/modules/agent/agent.pack.service.ts`
- `backend/src/modules/agent/agent.tool.service.ts`
- `backend/src/modules/agent/agent.service.ts`
- `backend/src/modules/agent/agent.routes.ts`
- `frontend/src/api/agent.ts`
- `frontend/src/pages/Chat.tsx`
- `frontend/src/styles.css`
- `frontend/src/components/AgentUpgradeStatus.tsx`

验收标准：

- 复杂问题能在同一轮请求内完成 1 次或 2 次升级
- 第 3 次升级会被硬拦截
- Stop 能中断 `reasoning` / `upgrade-requested` / `upgrade-applying` / `rerun-after-upgrade`
- MiniMax 不因续跑新增 `system` 再触发多 system 问题

回滚方式：

- 保留 `agent.service.ts` 里的旧链路实现
- 关闭 `progressiveDisclosureEnabled`

### Phase 3：checkpoint + 老会话 seed + usage 面板升级

目标：

- 把续跑状态真正从历史里解耦出来

任务：

1. 实现 `agent.checkpoint.service.ts`  
2. 实现 `agent.seed.service.ts`  
3. 实现 `agent.redaction.service.ts`  
4. `compactSummary` 快路径直接 seed  
5. 无 `compactSummary` 时同步调用便宜模型 seed  
6. 增加：
   - `seedStatus`
   - `seedAttempts`
   - `seedInputFingerprint`
7. 保证 checkpoint 注入版 `<= 800 token`
8. usage 面板新增：
   - `upgrade overhead`
   - `cache hit`
   - `conversation total (excluding upgrade overhead)`

涉及文件：

- `backend/src/modules/agent/agent.checkpoint.service.ts`
- `backend/src/modules/agent/agent.seed.service.ts`
- `backend/src/modules/agent/agent.redaction.service.ts`
- `backend/src/modules/agent/agent.history.service.ts`
- `backend/src/modules/agent/agent.stats.service.ts`
- `frontend/src/components/TokenUsagePanel.tsx`
- `frontend/src/styles.css`

验收标准：

- 老会话首次续聊可以生成种子检查点
- 敏感内容不会被固化进 checkpoint
- seed 最多重试 3 次
- usage 面板能单独显示升级成本

回滚方式：

- 关闭 `checkpointEnabled`
- 关闭 `seedOnResumeEnabled`

### Phase 4：扩展 pack

目标：

- 在 P0 / upgrade / checkpoint 骨架稳定后再扩功能面

任务：

1. 接入 `memory-pack`
2. 接入 `skill-pack`
3. 接入 `plan-pack`
4. 接入 `data-pack`
5. 接入 `channel-pack`
6. 为每个 pack 建预算阈值

验收标准：

- 新增 pack 不影响 P0 预算
- 每个 pack 的 schema 预算可单独观测

### Phase 5：1052 特色闭环 + 批量迁移

目标：

- 补上 `1052` 真正独特的长期能力沉淀

任务：

1. 编排日志 -> SOP 草稿
2. SOP -> 候选 Skill
3. 候选 Skill 验证
4. 正式 Skill 晋升
5. 历史版本目录/压缩包批量迁移

验收标准：

- 能从编排日志稳定生成候选 SOP/Skill
- 批量迁移与运行时懒迁移互不冲突

## 8. 测试计划

V6 的测试重点是“本地正确性与协议正确性”，不跑真实模型验证。

### 8.1 后端单元测试

建议新增：

- `agent.upgrade.service.test.ts`
- `agent.pack.service.test.ts`
- `agent.checkpoint.service.test.ts`
- `agent.seed.service.test.ts`
- `agent.redaction.service.test.ts`
- `agent.cache-policy.service.test.ts`

重点覆盖：

- 第三次升级被拒绝
- 单次 `packs.length > 2` 被拒绝
- pack 挂载不追加新 `system`
- checkpoint 注入版不会超过预算
- seed 脱敏与窗口裁剪正确
- cache usage 归一化正确

### 8.2 前端测试

当前项目前端测试基础较少，V6 至少要求：

- stream event 解析不崩
- `context-upgrade-*` 事件能正确驱动 UI
- Stop 能在升级阶段终止
- `TokenUsagePanel` 能显示新增指标

### 8.3 验证命令

阶段性代码正确性验证建议至少包括：

- `backend: npm test`
- `backend: npm run build`
- `frontend: npm run build` 或等价静态检查命令

不做：

- 真实 provider 模型调用
- 真实 E2E 聊天验证

## 9. 灰度与回滚

### 9.1 灰度顺序

建议灰度顺序固定为：

1. 只开 usage 扩展和缓存统计  
2. 再开 `P0` 瘦身  
3. 再开 `repo-pack / search-pack`  
4. 再开 checkpoint  
5. 最后开 seed on resume

### 9.2 回滚顺序

出现问题时按这个顺序回退：

1. 关闭 `seedOnResumeEnabled`
2. 关闭 `checkpointEnabled`
3. 关闭 `providerCachingEnabled`
4. 关闭 `progressiveDisclosureEnabled`

这样能确保：

- 最坏情况仍回到当前稳定链路

## 10. 风险清单

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| pack schema 预算低估 | token 回升 | pack 预算审计 + 硬阈值 |
| 续跑阶段误拼 system | MiniMax 再报错 | 单元测试 + 代码禁令 |
| seed 摘要泄露敏感信息 | 安全风险 | 先脱敏再摘要 |
| 升级往返过多 | 体验变慢 | 单轮最多 2 次升级 |
| cache 统计口径不一致 | 指标失真 | provider 归一化层 |
| 前端 Stop 清理不全 | 卡住流式状态 | 明确阶段状态机 |

## 11. 审核清单

这份 V6 建议你重点审核下面这些条目。  
如果这些都通过，就可以开始真正动代码了。

### 11.1 需要你拍板的锁定项

1. `AgentSettings` 里这 5 个开关是否接受  
2. `base-read-pack / repo-pack / search-pack` 的首批边界是否接受  
3. `P0 <= 3k` 与 checkpoint 注入 `<= 800 token` 是否接受  
4. `request_context_upgrade` 单轮最多 2 次、单次最多 2 个 pack 是否接受  
5. 老会话 seed 的“快路径 + 同步便宜模型慢路径”是否接受  
6. usage 面板拆出 `upgrade overhead` 是否接受  
7. Phase 顺序是否接受

### 11.2 通过标准

如果上面 `7` 条都通过，我建议下一步就不再继续写方案文档，而是直接进入：

`Phase 0 + Phase 1 实施`

---

## 参考

- `docs/1052-hybrid-agent-method-v4.md`
- `docs/1052-hybrid-agent-method-v5.md`
- `backend/src/modules/agent/agent.service.ts`
- `backend/src/modules/agent/agent.routes.ts`
- `backend/src/modules/agent/agent.types.ts`
- `backend/src/modules/agent/agent.stats.service.ts`
- `frontend/src/api/agent.ts`
- `frontend/src/pages/Chat.tsx`
- `frontend/src/components/TokenUsagePanel.tsx`
