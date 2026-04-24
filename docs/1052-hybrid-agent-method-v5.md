# 1052-PD 方案（第五版）

状态：Draft v0.5  
日期：2026-04-24  
正式名称：`1052 单核渐进披露法`  
固定简称：`1052-PD`

## 这版只做一件事

第五版不再讨论方向，只锁实现细节。

这一版专门定死四类问题：

1. `request_context_upgrade` 的最小 schema、升级上限、续跑和中止语义  
2. `repo-pack / search-pack` 的首批边界  
3. 老会话 `seed checkpoint` 的同步算法  
4. 升级动作带来的额外 token 如何计费和展示

## 1. request_context_upgrade：协议定稿

### 1.1 仍然使用 tool call

升级动作的协议形式固定为：

- `function/tool call`
- 工具名固定：`request_context_upgrade`

不使用：

- XML tag
- 特殊 message role
- 自然语言伪指令解析

### 1.2 schema 最小化

schema 本体不解释 pack 语义。  
pack 的用途说明一律挪到 `P0` 的“能力路由提示词”里。

P0 唯一工具定义固定为：

```ts
type RequestContextUpgrade = {
  packs: ('repo-pack' | 'search-pack' | 'memory-pack' | 'skill-pack' | 'plan-pack' | 'data-pack' | 'channel-pack')[]
  reason: string
  scope?: string[]
}
```

约束：

- `description` 保持极短
- 不附带 pack 逐项说明
- 不附带示例
- 目标体积：`<= 200 token`

### 1.3 单轮升级次数上限

同一条用户消息最多允许：

- `2` 次升级

第三次升级请求时，后端不再挂载新 pack，而是返回一个标准 tool result：

```json
{
  "ok": false,
  "error": "upgrade_limit_reached",
  "message": "当前消息已达到上下文升级上限，请直接回复用户或先提出澄清问题。"
}
```

这样可以避免一条消息被打成无限 round-trip。

### 1.4 单次 packs 数组上限

单次请求：

- `packs.length <= 2`

如果一次申请超过 `2` 个 pack，后端直接拒绝，不自动拆分。

后续如有需要，再加第二层限制：

- 基于估算 schema token 的总量阈值拦截

但 Phase 1 先用 `长度 <= 2` 即可。

### 1.5 续跑链路

`request_context_upgrade` 的运行时行为固定为：

1. 模型在 `P0` 发出 tool call  
2. 后端校验：
   - 本轮升级次数
   - `packs.length`
   - pack 合法性
3. 后端挂载新 pack
4. 后端写入 checkpoint
5. 后端在同一条用户请求内自动继续下一轮推理

这意味着：

- 用户不需要重新发送消息
- 前端看到的是同一条 assistant 回复流内部完成升级与续跑

### 1.6 续跑时的消息拼装禁令

这一条必须写死：

`续跑时绝对不能追加新的 system message。`

原因：

- MiniMax 多 `system` 兼容问题刚修过
- 追加新 `system` 会破坏缓存前缀稳定性
- 也会让 pack 挂载逻辑变得不可控

所以续跑时允许变化的部分只有：

- `tools` 数组扩展
- 非 `system` 的运行时状态
- checkpoint 注入摘要的下一轮版本

但：

- 不允许在同一轮升级后再拼新的 `system` message

### 1.7 中止语义

同一条用户消息可能经历多个状态，必须逐个可 abort：

| 状态 | 含义 | 中止动作 |
| --- | --- | --- |
| `reasoning` | 模型还在 `P0` 推理 | 终止当前 LLM 请求 |
| `upgrade-requested` | 已发起 pack 申请，后端尚未挂载 | 取消挂载并结束本轮 |
| `upgrade-applying` | 正在构造 tools / checkpoint | 停止后续续跑，不写半成品状态 |
| `rerun-after-upgrade` | 已挂载，正在续跑 | 终止续跑请求，保留已落盘 checkpoint |

对应 SSE 事件建议固定为：

```ts
type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; packs: string[] }
  | { type: 'context-upgrade-applied'; packs: string[] }
  | { type: 'context-upgrade-aborted'; stage: string }
```

前端 Stop 按钮只做一件事：

- 发送统一 abort

后端根据当前状态清理对应阶段。

## 2. repo-pack / search-pack：首批边界定稿

第五版明确采用：

- 读写彻底拆分
- 首批 pack 只给读能力

### 2.1 filesystem 拆分

拆成：

- `filesystem-read`
- `filesystem-write`

`repo-pack` 首批只挂：

- `filesystem-read`

不挂：

- 写文件
- 覆盖
- 删除
- 移动
- 批量替换

这些全部留到后续 `edit-pack` 或 `exec-pack`。

### 2.2 terminal 拆分

拆成：

- `terminal-readonly`
- `terminal-exec`

`repo-pack` 首批只挂：

- `terminal-readonly`

白名单先锁死为：

- `ls`
- `dir`
- `cat`
- `type`
- `rg`
- `git status`
- `git log`
- `git diff`

不包含：

- `npm test`
- `npm run`
- `git commit`
- `git push`
- 任意写磁盘或改环境状态的命令

### 2.3 repository 归属

`repo-pack` 首批包含：

- `repository-read`
- `filesystem-read`
- `terminal-readonly`

也就是：

```text
repo-pack
= repository-read
+ filesystem-read
+ terminal-readonly
```

### 2.4 search-pack 只暴露 UAPIs 三元工具

这一条必须锁死，否则 `search-pack` 的 token 会重新膨胀。

`search-pack` 中，UAPIs 只暴露：

- `uapis_list`
- `uapis_read`
- `uapis_call`

不把 88 个 API 各自展开成独立 schema。

同时配合两层目录：

- P0：只有极简类别目录
- search-pack：只有三元工具 + 被选中 API 的详情链路

### 2.5 filesystem-read 的归属选择

这里正式选择你建议的：

`A：filesystem-read 独立为 base-read-pack。`

具体含义：

- P0 不带任何业务工具
- 只要升级任意 pack，系统自动一并挂上 `base-read-pack`

于是：

```text
base-read-pack
= filesystem-read
```

```text
repo-pack
= repository-read
+ terminal-readonly
+ base-read-pack
```

```text
search-pack
= websearch
+ uapis_list
+ uapis_read
+ uapis_call
+ base-read-pack
```

这样做的好处：

- 搜索结果可直接读取本地参考文件
- 不需要把 `filesystem-read` 在多个 pack 里重复定义
- schema 只维护一份

## 3. 老会话 seed checkpoint：算法定稿

### 3.1 是否调用 LLM：结论

需要，但分两条路径。

#### 快路径

如果存在：

- `compactSummary`

则：

- 直接用 `compactSummary`
- 不调用 LLM

#### 慢路径

如果不存在：

- 同步调用便宜模型生成 seed 摘要

建议使用：

- `haiku` 级别
- 或 `minimax-lite` 级别

原则：

- 不做异步 seed

因为异步会导致：

- 用户首次续聊时仍使用降级上下文
- 体验很差

所以第五版锁定：

`seed 必须在首次续聊时同步完成。`

### 3.2 seed_status 三态

checkpoint 新增字段：

```ts
type SeedStatus = 'pending' | 'ready' | 'failed'
```

语义：

- `pending`：正在生成，不能被正式注入
- `ready`：可作为正式 seed 使用
- `failed`：本次生成失败

### 3.3 失败重试上限

seed 最多允许：

- `3` 次重试

超过后：

- 不再自动无限重试
- 明确要求用户确认是否以空 checkpoint 继续

建议提示：

`旧会话的检查点生成失败，是否以空检查点继续本轮对话？`

### 3.4 脱敏规则

这一条必须在 seed 前执行。

老 `chat-history.json` 中可能包含：

- API key
- token
- 数据库连接串
- Bearer 凭证
- password 参数

所以 seed 输入必须先脱敏，再进入：

- 启发式抽取
- 或便宜模型摘要

最少先覆盖这些模式：

- `sk-...`
- `xoxb-...`
- `Bearer ...`
- `password=...`
- 常见数据库 URI 中的凭据段

如果某条消息敏感模式过多，也可以直接跳过不纳入 seed。

### 3.5 seed 窗口

“最近历史”必须量化，不允许全量历史直接喂 seed。

固定窗口：

- `compactSummary`：全量使用
- 明文历史：最近 `20` 轮

超过即截断。

这样可以保证：

- 成本可控
- 结果稳定
- 不会因为几百轮老会话而失控

### 3.6 幂等要求

同样的 seed 输入，结果应尽量可重现。

checkpoint 新增字段：

```ts
type SeedMeta = {
  seedInputFingerprint: string
  seedStatus: 'pending' | 'ready' | 'failed'
  seedAttempts: number
}
```

`seedInputFingerprint` 建议由这些内容 hash 得到：

- `compactSummary` hash
- 最近 20 轮历史 hash
- 脱敏版本 hash

这样出问题时可以复盘：

- 为什么这次 seed 结果是这样
- 是否重复生成了同一输入

## 4. checkpoint 注入上限继续保留

第四版的这条约束继续有效，并在第五版不再改：

- 注入到 `P0` 的 checkpoint 摘要上限：`800 token`

超限处理继续是：

1. 先删最老条目  
2. 再合并成阶段摘要  
3. 永远保留：
   - `goal`
   - `next_step`
   - `mounted_packs`

## 5. usage / 计费口径

这是第五版新增的跨层规则。

### 5.1 为什么要单独记 upgrade overhead

同一条用户消息可能经历：

- `P0` 推理
- 升级动作
- pack 挂载后的续跑

如果只把最终 usage 混成一个总数，后续无法观测：

- 升级动作本身是否划算
- 哪种 pack 最耗
- 哪个 provider 在升级链路上缓存命中最好

所以第五版要求把 upgrade 成本单独记出来。

### 5.2 usage 字段建议

建议把单条 assistant 消息的 usage 扩成：

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

### 5.3 UI 展示

token 面板至少拆成三栏：

| 指标 | 含义 |
| --- | --- |
| `main usage` | 最终回复主链路消耗 |
| `upgrade overhead` | 升级动作和续跑额外成本 |
| `cache hit` | provider 命中的缓存 token |

这样才能知道：

- 本次多花的钱是不是值得
- pack 挂载是不是有效
- prompt caching 有没有真的起作用

### 5.4 对话累计口径

建议累计面板同时显示：

- `conversation total`
- `conversation total (excluding upgrade overhead)`

因为后续比较时常常会想看：

- 如果没有升级机制，主链路本身要花多少
- 升级本身多花了多少

## 6. 第五版实施清单

### Phase 0

- 固定 `request_context_upgrade` schema
- 固定 `P0` 只挂一个元工具
- 固定 `seed_status` / `seedInputFingerprint`

### Phase 1

- `UAPIs` 极简目录化
- provider 缓存接入
- `base-read-pack`
- `repo-pack`
- `search-pack`

### Phase 2

- SSE 升级事件
- 单轮升级次数限制
- packs 长度限制
- abort 语义落地

### Phase 3

- 老会话同步 seed
- 脱敏规则
- usage 面板拆出 `upgrade overhead`

### Phase 4

- `memory-pack`
- `skill-pack`
- `plan-pack`
- `data-pack`
- `channel-pack`

### Phase 5

- 编排日志 -> SOP -> 候选 Skill
- Skill 晋升
- 批量迁移

## 7. 第五版最终锁定项

如果后面继续和 Claude 讨论，我建议只讨论下面这些是否要微调，不再改总框架：

1. `terminal-readonly` 白名单是否再收紧  
2. `packs.length <= 2` 是否还要叠加 token 估算阈值  
3. `seed` 慢路径默认用哪一个便宜模型  
4. `upgrade overhead` 面板的 UI 具体长什么样

方向层面到第五版为止已经够了。

---

## 参考

- Anthropic Prompt Caching：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Anthropic Tool Use With Prompt Caching：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching>
- DeepSeek Context Caching：<https://api-docs.deepseek.com/guides/kv_cache/>
- MiniMax Prompt Caching：<https://platform.minimax.io/docs/api-reference/text-prompt-caching>
- MiniMax Explicit Prompt Caching (Anthropic API)：<https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache>
