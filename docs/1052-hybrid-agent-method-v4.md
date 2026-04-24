# 1052-PD 方案（第四版）

状态：Draft v0.4  
日期：2026-04-24  
正式名称：`1052 单核渐进披露法`  
固定简称：`1052-PD`

## 命名先锁死

从第四版开始，方案名不再切换。

- 正式中文名：`1052 单核渐进披露法`
- 固定英文简称：`1052-PD`

后续文档、代码注释、技术讨论统一使用这两个名字，不再在“深融 / PD / v3 方法”之间来回切。

## 1. 先把最大病灶说透：17043 token 的 tools schema 怎么办

V3 里已经确认，当前最大头不是历史，不是 memory，而是：

- 全量 `tools schema`：`17043` token

第四版把这件事明确写死：

`P0 不挂任何业务工具 schema。`

这句话必须成立，否则 `P0 <= 3k` 根本做不到。

### 1.1 P0 允许存在的工具只有一个

P0 只暴露一个元工具：

- `request_context_upgrade`

除此之外：

- 不挂 repository schema
- 不挂 filesystem schema
- 不挂 terminal schema
- 不挂 websearch schema
- 不挂 uapis schema
- 不挂 memory / skills / schedule / sql / channel schema

也就是说：

- `17043` token 的那面工具墙，在 P0 直接消失
- 业务工具只在 pack 挂载后才进入 prompt

### 1.2 P0 的预算拆分

第四版给出一个更明确的硬预算：

| 组成 | 目标上限 |
| --- | ---: |
| `1052.md` 核心规则 | `<= 800` |
| `1052.local.md` | `<= 200` |
| 项目画像摘要 | `<= 500` |
| 检查点注入摘要 | `<= 800` |
| 能力路由提示词 | `<= 400` |
| 元工具 schema | `<= 200` |
| 合计目标 | `<= 2900` |

所以第四版的 `P0 <= 3k`，明确建立在下面这个前提上：

`P0 只带一个元工具，不带任何业务工具 schema。`

### 1.3 pack 挂载后的工具体积也要说清

即使不做完整裁剪，按当前工具前缀分组粗算：

- `repo-pack` 约等于 `repository + filesystem + terminal`  
  约 `3510` token
- `search-pack` 约等于 `websearch + uapis`  
  约 `1346` token

这说明 pack 化本身就有明显收益：

- 从 `17043` 降到 `3510`
- 或从 `17043` 降到 `1346`

所以第四版的逻辑是：

- `P0` 解决“完全不挂业务 tools”
- `pack` 解决“只挂当前这次要用的那一小组 tools”

## 2. 升级动作协议形式

第三版只给了一个 `TS type`，第四版把协议形式定死。

### 2.1 结论

升级动作的主协议采用：

`function/tool call`

工具名固定为：

`request_context_upgrade`

不使用：

- XML tag
- 自定义 message role
- 解析自然语言中的伪指令

原因很简单：

- 当前 `1052` 已经有工具调用链路
- 后端更容易校验和审计
- 前端更容易做中间态展示

### 2.2 P0 元工具定义

P0 只注入这个 schema：

```ts
type RequestContextUpgrade = {
  packs: ('repo-pack' | 'search-pack' | 'memory-pack' | 'skill-pack' | 'plan-pack' | 'data-pack' | 'channel-pack')[]
  reason: string
  scope?: string[]
}
```

控制原则：

- `description` 尽量短
- `schema` 尽量小
- 不给额外示例块

目标是把它控制在 `<= 200` token。

### 2.3 运行时行为

当模型在 `P0` 发出 `request_context_upgrade(search-pack)` 后：

1. 后端拦截该 tool call  
2. 校验 pack 合法性  
3. 挂载对应 pack 的 schema 与最小上下文  
4. 写入检查点  
5. 用同一条用户请求自动继续下一轮推理

也就是说：

- 对用户来说不是“重新发送一遍”
- 而是同一轮请求内部多了一次受控升级

### 2.4 前端 UI 中间态

前端需要新增一个 SSE 中间事件：

```ts
type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applied'; packs: string[] }
```

聊天 UI 的表现建议是：

- 显示一条细状态条：`正在挂载 search-pack`
- 不额外写入正式聊天历史
- 挂载完成后继续流式输出

### 2.5 对体验的影响

需要明确承认一点：

- 简单任务不会多一轮
- 复杂任务会多一次内部升级往返

这是有成本的，但这个成本比起“所有请求默认多花 2 万 token”要小得多。

## 3. Provider 级缓存断点策略

第四版把三家的差异单独列成表，不再只写“固定前缀”这类泛话。

| Provider | 官方机制 | 触发方式 | 缓存断点/匹配粒度 | pack 挂载后的影响 | `1052-PD` 策略 |
| --- | --- | --- | --- | --- | --- |
| Anthropic | Prompt Caching | 显式 `cache_control` | `tools -> system -> messages`，可显式打断点 | 修改 `tools` 会使 `tools/system/messages` 这一层级的后续缓存失效；仅在断点前稳定的前缀可复用 | `P0` 固定一份缓存前缀；每种 pack 组合视为新前缀版本；Phase 1 不频繁切换 `tool_choice`/并行开关 |
| DeepSeek | Context Caching / KV Cache | 默认开启，自动前缀匹配 | 重复前缀自动命中 | 不变前缀仍可命中，新加 pack 形成新的未命中尾部 | 保持 `P0` 完全稳定；pack 内容始终按固定顺序追加 |
| MiniMax Text/OpenAI | Prompt Caching | 自动前缀匹配 | 前缀顺序为 `tool list -> system -> user messages` | 新加 pack 会形成更长前缀；原有稳定前缀仍有机会命中 | OpenAI 兼容链路先利用自动缓存；记录 `cached_tokens` 观测命中率 |
| MiniMax Anthropic 兼容 | Explicit Prompt Caching | 显式 `cache_control` | 与 Anthropic 兼容语义一致 | 新 pack 组合会写入新的缓存前缀 | 如果后续接 Anthropic 兼容适配器，再复用 Anthropic 策略 |

### 3.1 这一节的工程结论

第四版把缓存策略改成两个硬规则：

1. `P0` 前缀必须完全稳定  
2. pack 挂载顺序必须确定，不能同义不同序

否则：

- DeepSeek 的前缀匹配效果会变差
- Anthropic / MiniMax 的显式或半显式前缀也会频繁重写

### 3.2 Anthropic 需要额外注意的点

官方文档还明确提到：

- tool definitions 的缓存断点通常放在 `tools` 数组末尾
- `disable_parallel_tool_use` 这类设置变化会影响后续缓存层

所以 `1052-PD` 在 Anthropic 上的第一阶段策略是：

- 先把 `tool_choice`、并发策略做成稳定默认值
- 不在一个会话里频繁切换这些开关

来源：

- <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching>

## 4. 检查点注入上限

第四版把这个约束明确成硬规则。

### 4.1 注入上限

`P0` 中注入的检查点摘要上限固定为 `800 token`。

超过即压缩，不允许自然膨胀。

### 4.2 注入结构

建议固定为：

| 字段 | 上限 |
| --- | ---: |
| `goal` | `120` token |
| `phase` | `60` token |
| `facts` | 最近 `4` 条 |
| `done` | 最近 `4` 条 |
| `failed_attempts` | 最近 `3` 条 |
| `next_step` | `120` token |
| `mounted_packs` | 全量，但只存 pack 名称 |

### 4.3 超限策略

如果估算超过 `800 token`：

1. 先压缩 `facts/done/failed_attempts` 的最旧条目  
2. 仍超限时生成一条阶段摘要，替换更旧明细  
3. 永远保留：
   - 当前 `goal`
   - 当前 `next_step`
   - 当前已挂载 `packs`

一句话：

`检查点可以增长，但注入版不能无限增长。`

## 5. 检查点和历史的关系再锁死一次

第四版保持第三版的结论，但补一个工程实现句式：

- `chat-history.json`：完整对话时间线、UI 恢复、审计
- `checkpoint.json`：稀疏执行状态、下轮注入

更准确地说：

`checkpoint 替代的是“模型输入里的大段历史回放”，不是替代历史存储。`

## 6. 老会话怎么过渡

这是第四版新增的用户侧过渡机制。

### 6.1 结论

V4 上线后，旧 `chat-history.json` 中仍在进行中的会话，不会直接失联。

策略是：

`首次续聊时懒生成种子检查点。`

### 6.2 种子检查点生成逻辑

当检测到：

- 这个会话存在聊天历史
- 但不存在 `checkpoint`

后端会在首次读取时做一次 seed：

1. 优先使用现有 `compactSummary`
2. 没有 `compactSummary` 时，从最近历史中抽取：
   - 最近用户目标
   - 最近完成事项
   - 最近失败事项
   - 最近下一步线索
3. 生成第一份 `checkpoint`

### 6.3 种子失败时怎么办

如果 seed 失败：

- 不直接让用户断会话
- 回退到一次性的“旧历史摘要 -> 生成种子检查点”流程

也就是说：

- 老会话不会强制走旧行为长期兼容
- 但第一次过渡允许使用一次回退逻辑

### 6.4 这件事和迁移的关系

老会话 seed 属于“运行时懒迁移”。  
它和“历史版本一键批量迁移”不是一回事。

## 7. “编排日志反哺技能”到底是前置还是后置

第四版把这件事说透，不再表述打架。

### 7.1 方法论上，它是主线

`1052-PD` 的方法特色之一，就是：

```text
编排日志
-> SOP 草稿
-> 候选 Skill
-> 验证
-> 晋升
```

所以在方案层面，它从现在开始就是主线，不是附属项。

### 7.2 实现时序上，它后置

但工程上，它必须等前面这些先稳定：

- `P0`
- 升级动作
- pack 挂载
- 检查点
- 基础运行日志

否则没有稳定、可信的样本可蒸馏。

所以第四版明确写成：

`它在方法论上前置，在实现时序上后置。`

这两句话不再冲突。

## 8. 迁移线没有砍掉，只是分成两层

第三版里迁移线存在感不够，第四版重新锁死。

### 8.1 第一层：运行时懒迁移

包括：

- 老会话 seed checkpoint
- 旧规则文件转 `1052.md`
- 旧本地偏好转 `1052.local.md`

### 8.2 第二层：批量迁移

仍然保留在后续阶段，包括：

- 历史版本数据目录导入
- 历史压缩包导入
- 技能目录导入
- 编排日志归档与索引重建

所以结论是：

`迁移线没有被砍，只是从“一次性大迁移”拆成了“运行时懒迁移 + 后续批量迁移”。`

## 9. 新的阶段划分

### Phase 0：锁结构

- 固定 `1052-PD` 名称
- 固定 `P0` 预算
- 固定 `request_context_upgrade` 元工具
- 固定 `checkpoint` 注入上限

### Phase 1：两刀瘦身 + 缓存

- `P0` 只挂元工具
- `UAPIs` 从全量索引改为极简目录
- Anthropic / DeepSeek / MiniMax 缓存接入
- 记录 `cached_tokens` / cache hit usage

### Phase 2：升级协议跑通

- `request_context_upgrade`
- 中间态 SSE 事件
- pack 自动挂载并续跑
- 只试点：
  - `repo-pack`
  - `search-pack`

### Phase 3：检查点闭环

- 后端确定性写入
- 检查点摘要压缩
- 老会话 seed checkpoint
- `/compact` 与 checkpoint 联动

### Phase 4：扩 pack

- `memory-pack`
- `skill-pack`
- `plan-pack`
- `data-pack`
- `channel-pack`

### Phase 5：1052 特色闭环 + 批量迁移

- 编排日志 -> SOP -> 候选 Skill
- 候选 Skill 验证
- 正式 Skill 晋升
- 历史版本批量迁移

## 10. 第四版最终结论

第四版把最容易含糊的地方都定死了：

- `P0` 不挂任何业务 tools schema
- 升级动作就是一个元工具 `request_context_upgrade`
- provider 缓存按各家语义分别处理
- 检查点注入版硬上限 `800 token`
- 老会话首次续聊时生成种子检查点
- 编排日志反哺技能是方法主线，但实现后置
- 迁移线没有被砍，只是拆成两层

如果现在继续和 Claude 讨论，我建议后续只盯三个实现问题，不再反复争方向：

1. `request_context_upgrade` 的最小 schema 和续跑链路  
2. `repo-pack / search-pack` 的首批归类边界  
3. `checkpoint seed` 的生成算法

---

## 参考

- Anthropic Prompt Caching：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Anthropic Tool Use With Prompt Caching：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching>
- DeepSeek Context Caching：<https://api-docs.deepseek.com/guides/kv_cache/>
- MiniMax Prompt Caching：<https://platform.minimax.io/docs/api-reference/text-prompt-caching>
- MiniMax Explicit Prompt Caching (Anthropic API)：<https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache>
- GenericAgent README：<https://github.com/lsdefine/GenericAgent>
