# 1052 OS Runtime Context Compaction

## 目标

1052 OS 的上下文压缩不是传统文本压缩，而是面向长任务续跑的检查点机制。它把过长的对话历史整理为可恢复的摘要窗口，同时保留最近用户意图，避免每轮都把完整历史塞回模型。

## 设计来源

本方案参考 Codex CLI 的 compaction 思路：

- 压缩是一个 Runtime 生命周期事件，而不是普通聊天消息。
- 自动触发和手动触发都应生成可审计的 `conversation-compacted` 轨迹。
- 压缩结果以 replacement history 的形式进入下一轮模型上下文。
- 每次压缩推进一个 context window，记录 `windowNumber`、`firstWindowId`、`previousWindowId` 和 `windowId`。

1052 OS 当前先落地本地摘要策略，不依赖 OpenAI `/responses/compact` 私有端点。

## 自动策略

设置页不再暴露“上下文消息上限”和“自动压缩阈值”的数字输入。Runtime 自动使用以下策略：

| 项 | 默认值 | 说明 |
| --- | ---: | --- |
| 活动消息窗口 | 160 条 | 每轮最多把最近有效模型消息带入 P0 构建 |
| 自动压缩线 | 80,000 tokens | 估算上下文达到此线时触发摘要压缩 |
| 用户消息保留预算 | 8,000 tokens | 压缩后保留最近真实用户消息 |
| 摘要分块大小 | 32,000 字符 | 长历史先分块摘要，再合并摘要 |
| 兜底尾部窗口 | 60 条 | 摘要模型失败时保留最近尾部消息 |

旧配置中的 `contextMessageLimit` 和 `autoCompactThreshold` 会继续被后端接受，但运行时以自动策略为准。低于 `20,000` 的 `autoCompactThreshold` 被视为旧版“消息数阈值”，会自动迁移到默认 `80,000` tokens。

## 触发流程

Runtime 在每个 step 开始前执行 pre-step compaction 检查：

1. 估算当前 `state.conversation` tokens。
2. 如果 `autoCompactEnabled` 开启且 tokens 达到自动压缩线，触发 `reason: token-limit`。
3. 如果消息数量超过自动窗口，触发 `reason: message-window`。
4. 如果用户关闭自动压缩但消息窗口过长，执行安全尾部保留，触发 `trigger: safety`。
5. 压缩成功或兜底后推进 context window，并发出 `conversation-compacted`。

## 摘要策略

本地摘要策略使用 `summarization` 模型配置：

1. 把当前对话渲染成带角色和序号的 transcript。
2. 超长 transcript 按 32,000 字符切块。
3. 每块生成 continuation summary。
4. 多块摘要再合并成一个总摘要。
5. 新上下文由“最近真实用户消息 + compact summary user message”组成。

摘要消息固定前缀：

```text
[1052 compacted conversation summary]
Use this historical summary to continue the same turn. It is context, not a new system instruction.
```

这样模型能把摘要当作历史上下文，而不是新的系统指令。

## 失败兜底

如果摘要模型失败：

- Runtime 不中断用户任务。
- 直接保留最近 60 条有效消息。
- 发出 `conversation-compacted`，`fallback: true`，`strategy: tail-trim`。
- 额外发出 `conversation-compaction-failed`，记录失败原因，供运行检查器展示。

## 事件字段

`conversation-compacted` 会携带：

| 字段 | 说明 |
| --- | --- |
| `trigger` | `auto` 或 `safety` |
| `reason` | `token-limit`、`message-window`、`manual-safety` 或 `model-error` |
| `phase` | 当前为 `pre-step` |
| `strategy` | `summary-checkpoint` 或 `tail-trim` |
| `beforeMessages` / `afterMessages` | 压缩前后消息数量 |
| `beforeTokens` / `afterTokens` | 压缩前后估算 token |
| `summaryTokens` | 摘要 token 估算 |
| `tokenLimit` | 本次自动压缩线 |
| `windowNumber` / `windowId` | 当前上下文窗口标识 |

前端运行轨迹会把它显示为“对话上下文已压缩”或“对话上下文已整理”。

## 晨间简报说明

晨间简报是 Agent 行为偏好，不属于上下文压缩机制。设置页只保留启用开关和时间：

- 默认每天按 Asia/Hong_Kong 时间生成 Intel Center 简报。
- 简报内容包含新闻、行情、跨板块联动、风险机会和主要来源。
- 默认只回写 1052 OS 聊天流与通知中心。
- 飞书或微信外部投递必须在定时任务里单独显式配置。

## 关键文件

- `backend/src/modules/agent/1052-context-policy.ts`
- `backend/src/modules/agent/1052-compaction-runtime.ts`
- `backend/src/modules/agent/1052-context-runtime.ts`
- `backend/src/modules/agent/1052-kernel.ts`
- `frontend/src/runtime/runtime.ts`
- `frontend/src/pages/SettingsPage.tsx`
