import { httpError } from '../../http-error.js'
import { isMiniMaxCompatible } from './agent.provider.js'

export type LLMConfig = {
  baseUrl: string
  modelId: string
  apiKey: string
}

export type LLMToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type LLMToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type LLMConversationMessage =
  | {
      role: 'system' | 'user'
      content: string
    }
  | {
      role: 'assistant'
      content: string
      toolCalls?: LLMToolCall[]
    }
  | {
      role: 'tool'
      content: string
      toolCallId: string
      name: string
    }

export type LLMAssistantMessage = {
  role: 'assistant'
  content: string
  toolCalls: LLMToolCall[]
  usage?: LLMTokenUsage
}

export type LLMTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimated?: boolean
}

type ToolCallAccumulator = {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

function joinUrl(base: string, p: string): string {
  return base.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '')
}

function normalizeMiniMaxBaseUrl(cfg: LLMConfig): string {
  const trimmed = cfg.baseUrl.trim()
  if (!isMiniMaxCompatible(cfg)) return trimmed

  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()

    if (host === 'platform.minimax.io') {
      url.hostname = 'api.minimax.io'
      url.pathname = '/v1'
    } else if (host === 'platform.minimaxi.com') {
      url.hostname = 'api.minimaxi.com'
      url.pathname = '/v1'
    }

    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/v1'
    }

    return url.toString().replace(/\/+$/, '')
  } catch {
    if (/^https?:\/\/api\.minimax\.io\/?$/i.test(trimmed)) return 'https://api.minimax.io/v1'
    if (/^https?:\/\/api\.minimaxi\.com\/?$/i.test(trimmed)) return 'https://api.minimaxi.com/v1'
    return trimmed
  }
}

function toApiMessage(message: LLMConversationMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId,
    }
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })),
    }
  }

  return {
    role: message.role,
    content: message.content,
  }
}

function normalizeToolCalls(value: unknown): LLMToolCall[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null

      const toolCall = item as {
        id?: unknown
        type?: unknown
        function?: {
          name?: unknown
          arguments?: unknown
        }
      }

      if (toolCall.type !== 'function') return null
      if (!toolCall.function || typeof toolCall.function !== 'object') return null
      if (typeof toolCall.function.name !== 'string') return null

      return {
        id:
          typeof toolCall.id === 'string' && toolCall.id.length > 0
            ? toolCall.id
            : `tool_call_${index + 1}`,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          arguments:
            typeof toolCall.function.arguments === 'string'
              ? toolCall.function.arguments
              : '{}',
        },
      }
    })
    .filter((toolCall): toolCall is LLMToolCall => toolCall !== null)
}

function buildPayload(
  cfg: LLMConfig,
  messages: LLMConversationMessage[],
  tools: LLMToolDefinition[],
  stream: boolean,
): Record<string, unknown> {
  const miniMaxCompatible = isMiniMaxCompatible(cfg)
  const payload: Record<string, unknown> = {
    model: cfg.modelId,
    messages: messages.map((message) => toApiMessage(message)),
    stream,
  }

  if (stream) {
    payload.stream_options = { include_usage: true }
  }

  if (tools.length > 0) {
    payload.tools = tools
    if (!miniMaxCompatible) {
      payload.tool_choice = 'auto'
    }
  }

  if (miniMaxCompatible) {
    payload.reasoning_split = false
  }

  return payload
}

async function postChatCompletion(
  cfg: LLMConfig,
  payload: Record<string, unknown>,
  tools: LLMToolDefinition[],
): Promise<Response> {
  if (!cfg.baseUrl) throw httpError(400, 'LLM baseUrl 未配置，请前往设置页')
  if (!cfg.modelId) throw httpError(400, 'LLM modelId 未配置，请前往设置页')
  if (!cfg.apiKey) throw httpError(400, 'LLM apiKey 未配置，请前往设置页')

  let res: Response
  try {
    const requestBaseUrl = normalizeMiniMaxBaseUrl(cfg)
    res = await fetch(joinUrl(requestBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw httpError(502, `无法连接 LLM: ${(e as Error).message}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (
      payload.stream_options &&
      /stream_options|include_usage/i.test(body) &&
      /unsupported|invalid|unknown|not support|extra/i.test(body)
    ) {
      const retryPayload = { ...payload }
      delete retryPayload.stream_options
      return postChatCompletion(cfg, retryPayload, tools)
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, 'reasoning_split') &&
      /reasoning_split/i.test(body) &&
      /unsupported|invalid|unknown|not support|extra/i.test(body)
    ) {
      const retryPayload = { ...payload }
      delete retryPayload.reasoning_split
      return postChatCompletion(cfg, retryPayload, tools)
    }

    const maybeToolError =
      tools.length > 0 &&
      /tool|function/i.test(body) &&
      /unsupported|invalid|unknown|not support/i.test(body)

    throw httpError(
      res.status,
      maybeToolError
        ? '当前模型或网关不支持 Agent 工具调用，请更换支持 function calling 的模型或兼容网关。'
        : `LLM 返回 ${res.status}: ${body.slice(0, 500) || res.statusText}`,
    )
  }

  return res
}

function mergeToolCallDelta(
  toolCalls: Map<number, ToolCallAccumulator>,
  value: unknown,
) {
  if (!Array.isArray(value)) return

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const delta = item as {
      index?: unknown
      id?: unknown
      type?: unknown
      function?: {
        name?: unknown
        arguments?: unknown
      }
    }
    const index =
      typeof delta.index === 'number' && Number.isFinite(delta.index)
        ? delta.index
        : toolCalls.size
    const current = toolCalls.get(index) ?? {}

    if (typeof delta.id === 'string') current.id = delta.id
    if (typeof delta.type === 'string') current.type = delta.type
    if (delta.function && typeof delta.function === 'object') {
      current.function = current.function ?? {}
      if (typeof delta.function.name === 'string') {
        current.function.name = delta.function.name
      }
      if (typeof delta.function.arguments === 'string') {
        current.function.arguments =
          (current.function.arguments ?? '') + delta.function.arguments
      }
    }

    toolCalls.set(index, current)
  }
}

function normalizeAccumulatedToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
): LLMToolCall[] {
  return [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, toolCall]) => {
      if (toolCall.type && toolCall.type !== 'function') return null
      if (!toolCall.function?.name) return null

      return {
        id:
          typeof toolCall.id === 'string' && toolCall.id.length > 0
            ? toolCall.id
            : `tool_call_${index + 1}`,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? '{}',
        },
      }
    })
    .filter((toolCall): toolCall is LLMToolCall => toolCall !== null)
}

function getStringField(
  value: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string' && item.length > 0) return item
  }
  return ''
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const item = value[key]
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined
}

export function estimateTokenCount(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g)?.length ?? 0
  const cjkChars = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const symbols = text.match(/[^\sA-Za-z0-9_\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  return Math.max(1, Math.ceil(asciiWords * 1.25 + cjkChars + symbols * 0.5))
}

function estimateMessagesTokens(messages: LLMConversationMessage[]): number {
  return messages.reduce((sum, message) => {
    const toolTokens =
      message.role === 'assistant' && message.toolCalls?.length
        ? estimateTokenCount(JSON.stringify(message.toolCalls))
        : 0
    return sum + estimateTokenCount(message.content) + toolTokens + 4
  }, 0)
}

function normalizeUsage(value: unknown): LLMTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  const inputTokens =
    numberField(usage, 'prompt_tokens') ?? numberField(usage, 'input_tokens')
  const outputTokens =
    numberField(usage, 'completion_tokens') ?? numberField(usage, 'output_tokens')
  const totalTokens = numberField(usage, 'total_tokens')

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
  }
}

function fallbackUsage(
  messages: LLMConversationMessage[],
  content: string,
): LLMTokenUsage {
  const inputTokens = estimateMessagesTokens(messages)
  const outputTokens = estimateTokenCount(content)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
  }
}

export async function chatCompletion(
  cfg: LLMConfig,
  messages: LLMConversationMessage[],
  tools: LLMToolDefinition[] = [],
): Promise<LLMAssistantMessage> {
  const res = await postChatCompletion(
    cfg,
    buildPayload(cfg, messages, tools, false),
    tools,
  )

  const data = (await res.json().catch(() => null)) as {
    usage?: unknown
    choices?: {
      message?: {
        role?: string
        content?: string | null
        tool_calls?: unknown
      }
    }[]
  } | null

  const message = data?.choices?.[0]?.message
  const toolCalls = normalizeToolCalls(message?.tool_calls)
  const content = typeof message?.content === 'string' ? message.content : ''

  if (content.length === 0 && toolCalls.length === 0) {
    throw httpError(502, 'LLM 响应格式异常: 未找到有效的回复内容或工具调用')
  }

  return {
    role: 'assistant',
    content,
    toolCalls,
    usage: normalizeUsage(data?.usage) ?? fallbackUsage(messages, content),
  }
}

export async function* chatCompletionStream(
  cfg: LLMConfig,
  messages: LLMConversationMessage[],
  tools: LLMToolDefinition[] = [],
): AsyncGenerator<string, LLMAssistantMessage, void> {
  const res = await postChatCompletion(
    cfg,
    buildPayload(cfg, messages, tools, true),
    tools,
  )
  if (!res.body) {
    throw httpError(502, 'LLM 流式响应格式异常: 缺少 body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const toolCalls = new Map<number, ToolCallAccumulator>()
  let buffer = ''
  let content = ''
  let done = false
  let reasoningOpen = false
  let usage: LLMTokenUsage | undefined

  const emitContent = function* (chunk: string): Generator<string, void, void> {
    if (!chunk) return
    if (reasoningOpen) {
      const close = '\n</think>\n\n'
      reasoningOpen = false
      content += close
      yield close
    }
    content += chunk
    yield chunk
  }

  const emitReasoning = function* (
    chunk: string,
  ): Generator<string, void, void> {
    if (!chunk) return
    if (!reasoningOpen) {
      const open = '<think>\n'
      reasoningOpen = true
      content += open
      yield open
    }
    content += chunk
    yield chunk
  }

  const handleEvent = function* (event: string): Generator<string, void, void> {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') {
        done = true
        continue
      }

      const obj = JSON.parse(data) as {
        usage?: unknown
        choices?: {
          delta?: Record<string, unknown> & {
            content?: unknown
            tool_calls?: unknown
          }
        }[]
      }
      usage = normalizeUsage(obj.usage) ?? usage
      const delta = obj.choices?.[0]?.delta
      if (!delta) continue

      const reasoning = getStringField(delta, [
        'reasoning_content',
        'reasoning',
        'thinking',
      ])
      yield* emitReasoning(reasoning)

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield* emitContent(delta.content)
      }
      mergeToolCallDelta(toolCalls, delta.tool_calls)
    }
  }

  try {
    while (!done) {
      const { value, done: readDone } = await reader.read()
      if (readDone) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''

      for (const event of events) {
        yield* handleEvent(event)
        if (done) break
      }
    }

    const rest = decoder.decode()
    if (rest) buffer += rest
    if (buffer.trim() && !done) {
      yield* handleEvent(buffer)
    }
  } catch (e) {
    throw httpError(502, `LLM 流式响应解析失败: ${(e as Error).message}`)
  } finally {
    reader.releaseLock()
  }

  const normalizedToolCalls = normalizeAccumulatedToolCalls(toolCalls)
  if (reasoningOpen) {
    const close = '\n</think>\n\n'
    reasoningOpen = false
    content += close
    yield close
  }
  if (content.length === 0 && normalizedToolCalls.length === 0) {
    throw httpError(502, 'LLM 响应格式异常: 未找到有效的回复内容或工具调用')
  }

  return {
    role: 'assistant',
    content,
    toolCalls: normalizedToolCalls,
    usage: usage ?? fallbackUsage(messages, content),
  }
}
