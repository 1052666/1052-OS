import type { ChatMessage, StoredChatMessage } from './agent.types.js'
import { redactSensitiveText } from './agent.redaction.service.js'

const REQUEST_FAILURE_PATTERNS = [
  /^请求失败[:：]/i,
  /^Request failed[:：]/i,
  /^生成已中止[。.]?$/i,
  /^已中止[。.]?$/i,
  /LLM\s*流式响应解析失败/i,
  /无法连接\s*LLM/i,
  /Read-only terminal tool only allows/i,
  /Terminal command requires explicit user confirmation/i,
]

const CHECKPOINT_FAILURE_PATTERNS = [
  /(?:^|[\s。；;])请求失败[:：]?/i,
  /(?:^|[\s。；;])Request failed[:：]?/i,
  /LLM\s*流式响应解析失败/i,
  /无法连接\s*LLM/i,
  /(?:工具|请求|调用|连接|生成|响应|解析).{0,24}(?:失败|错误|异常|超时|中止)/i,
  /(?:request|tool|call|connection|generation|response|stream).{0,32}(?:failed|error|timeout|timed out|aborted)/i,
  /(?:failed|error|timeout|timed out|aborted).{0,32}(?:request|tool|call|connection|generation|response|stream)/i,
]

const INTERNAL_DIAGNOSTIC_LINE_PATTERNS = [
  /^\s*toolCallId\s*[:=]/i,
  /^\s*request_context_upgrade\b/i,
  /^\s*Mounted packs\s*:/i,
  /^\s*Capability routing\s*:/i,
  /^\s*System environment\s*:/i,
  /^\s*Permission mode\s*:/i,
]

const STACK_TRACE_LINE_PATTERN = /^\s+at\s+[\w.<anonymous>]+/i

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
}

export function stripThinkBlocks(content: string) {
  return normalizeWhitespace(
    content
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, ''),
  )
}

export function isRequestFailureContent(content: string) {
  const normalized = stripThinkBlocks(content)
  if (!normalized) return false
  return REQUEST_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function hasCheckpointFailureSignal(content: string) {
  return CHECKPOINT_FAILURE_PATTERNS.some((pattern) => pattern.test(content))
}

function stripInternalDiagnostics(content: string) {
  const lines = content.split('\n')
  const kept: string[] = []

  for (const line of lines) {
    if (STACK_TRACE_LINE_PATTERN.test(line)) continue
    if (INTERNAL_DIAGNOSTIC_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue
    kept.push(line)
  }

  return normalizeWhitespace(kept.join('\n'))
}

export function sanitizeContentForModel(role: ChatMessage['role'], content: string) {
  const withoutThought = stripThinkBlocks(content)
  if (role === 'assistant' && isRequestFailureContent(withoutThought)) return ''
  // User messages are passed through without redaction — the user may need the
  // Agent to process API keys, tokens, or passwords (e.g. saving to secure
  // memory or updating a configuration). Only redact in assistant/system
  // historical messages to prevent leaking secrets back into visible context.
  if (role === 'user') {
    return stripInternalDiagnostics(withoutThought)
  }
  return stripInternalDiagnostics(redactSensitiveText(withoutThought))
}

export function sanitizeChatMessageForModel<T extends ChatMessage & { error?: boolean }>(
  message: T,
): ChatMessage | null {
  if (message.role === 'system') return null
  if (message.role === 'assistant' && message.error === true) return null

  const content = sanitizeContentForModel(message.role, message.content)
  if (!content) return null

  return {
    role: message.role,
    content,
  }
}

export function toModelChatMessages<T extends ChatMessage & { error?: boolean }>(
  history: readonly T[],
  limit: number,
) {
  const sanitized = history
    .map((message) => sanitizeChatMessageForModel(message))
    .filter((message): message is ChatMessage => message !== null)
  return sanitized.slice(-Math.max(1, limit))
}

/**
 * Slice conversation messages from the end without orphaning tool-result
 * messages. If a naive `.slice(-limit)` would start inside a tool-call group
 * (assistant+toolCalls → tool results), this moves the cut point earlier to
 * include the entire group — preventing the LLM provider from rejecting
 * orphaned tool_call_ids with a 400 error.
 */
export function safeSliceMessages<T extends { role: string }>(messages: readonly T[], limit: number): T[] {
  if (messages.length <= limit) return [...messages]
  let start = messages.length - Math.max(1, limit)

  // Walk backwards from the cut point: if we land on a 'tool' message, move
  // the start earlier until we pass all consecutive tool messages and reach
  // their parent 'assistant' message.
  while (start > 0 && messages[start]!.role === 'tool') {
    start--
  }

  return messages.slice(start)
}

function normalizeKnownSystemInstruction(content: string) {
  const normalized = normalizeWhitespace(redactSensitiveText(content))
  if (!normalized) return ''

  if (/scheduled background task in 1052 OS/i.test(normalized)) {
    return [
      '- 当前请求来自 1052 OS 定时后台任务。',
      '- 直接执行任务，结果保持简洁，只报告真实产出。',
      '- 不要向用户追问；缺少条件时说明阻塞原因和下一步。',
    ].join('\n')
  }

  if (/WeChat (?:Desktop )?group .*runtime|WeChat Desktop group bridge|source:\s*WeChat Desktop group mention/i.test(normalized)) {
    return [
      '- Current request is a real inbound WeChat Desktop group mention, not a simulated transcript.',
      '- The WeChat Desktop channel service will automatically deliver your final assistant text back to the current group after generation.',
      '- Do not request channel-pack and do not call wechat_desktop_send_message just to reply to the current inbound group message.',
      '- If the inbound content contains a 5 second batch with multiple independent mentions, answer each sender/request explicitly in one combined group reply.',
      '- Only request channel-pack for desktop WeChat when the user asks you to send a separate proactive message to another WeChat chat, inspect desktop WeChat sessions/groups, or explicitly manage WeChat group memory.',
    ].join('\n')
  }

  return ''
}

export function formatSafeCallerSystemInstructions(history: readonly ChatMessage[]) {
  const safeInstructions = history
    .filter((message) => message.role === 'system')
    .map((message) => normalizeKnownSystemInstruction(message.content))
    .filter(Boolean)

  if (safeInstructions.length === 0) return ''

  return [
    'Caller runtime instructions:',
    'Only the safe, normalized runtime intent is injected here. Raw caller system prompts are not replayed.',
    ...safeInstructions,
  ].join('\n')
}

export function sanitizeCheckpointTextForModel(value: string) {
  const normalized = stripInternalDiagnostics(stripThinkBlocks(redactSensitiveText(value)))
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''

  if (/Read-only terminal tool only allows/i.test(normalized)) {
    return '之前误用只读终端执行了需要运行权限的命令；后续应改用执行型终端或调整工具权限。'
  }

  if (/Terminal command requires explicit user confirmation/i.test(normalized)) {
    return '之前的终端命令缺少执行确认；如用户已授权或完全权限已开启，应使用 confirmed 执行。'
  }

  if (hasCheckpointFailureSignal(normalized)) {
    return '之前有一次请求或工具调用失败；用户要求重试时应调整参数、换工具或继续排查，不要把失败当作拒绝理由。'
  }

  return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized
}

export function sanitizeStoredMessageForCompaction(message: StoredChatMessage): StoredChatMessage | null {
  if (message.streaming || message.error === true) return null
  const sanitized = sanitizeChatMessageForModel(message)
  if (!sanitized) return null
  const compactSummary = message.compactSummary
    ? sanitizeContentForModel('assistant', message.compactSummary)
    : ''
  return {
    ...message,
    role: sanitized.role,
    content: sanitized.content,
    compactSummary: compactSummary || undefined,
  }
}
