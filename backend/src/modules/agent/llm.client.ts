import { httpError } from '../../http-error.js'
import {
  buildProviderCachingPayloadFields,
  normalizeCacheUsage,
} from './agent.cache-policy.service.js'
import { isMiniMaxCompatible } from './agent.provider.js'
import type { LLMProfileKind, LLMProviderKind } from '../settings/settings.types.js'

export type LLMConfig = {
  baseUrl: string
  modelId: string
  apiKey: string
  kind?: LLMProfileKind
  provider?: LLMProviderKind
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

export type LLMTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  estimated?: boolean
}

export type LLMAssistantMessage = {
  role: 'assistant'
  content: string
  toolCalls: LLMToolCall[]
  usage?: LLMTokenUsage
  finishReason?: string
}

/**
 * Tool selection strategy. Mirrors OpenAI / Anthropic / Gemini conventions:
 * - 'auto':     model decides freely (default)
 * - 'none':     forbid tool use this turn
 * - 'required': force at least one tool call
 * - { type: 'function', function: { name } }: force a specific tool
 */
export type LLMToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

export type LLMRequestOptions = {
  abortSignal?: AbortSignal
  providerCachingEnabled?: boolean
  toolChoice?: LLMToolChoice
  /**
   * Abort the streaming response if no chunk arrives for this duration (ms).
   * Set to 0 or omit to disable. Disabled by default to support long-thinking
   * reasoning models (DeepSeek-R1, MiniMax M2 etc.).
   */
  streamIdleTimeoutMs?: number
}

function normalizeRequestOptions(input?: AbortSignal | LLMRequestOptions): LLMRequestOptions {
  if (!input) return {}
  if ('aborted' in input && typeof input.addEventListener === 'function') {
    return { abortSignal: input }
  }
  return input as LLMRequestOptions
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

function requiresApiKey(cfg: LLMConfig): boolean {
  if (cfg.kind === 'local') return false
  if (cfg.provider === 'ollama' || cfg.provider === 'lm-studio' || cfg.provider === 'localai') {
    return false
  }
  return true
}

export function normalizeMessagesForMiniMax(
  messages: LLMConversationMessage[],
): LLMConversationMessage[] {
  const systemMessages = messages.filter((message) => message.role === 'system')
  if (systemMessages.length <= 1) return messages

  const mergedSystemContent = systemMessages.map((message) => message.content).join('\n\n')
  const nonSystemMessages = messages.filter((message) => message.role !== 'system')
  return [{ role: 'system', content: mergedSystemContent }, ...nonSystemMessages]
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
        type: 'function',
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

function toApiToolChoice(choice: LLMToolChoice | undefined): unknown {
  if (!choice) return 'auto'
  return choice
}

function buildPayload(
  cfg: LLMConfig,
  messages: LLMConversationMessage[],
  tools: LLMToolDefinition[],
  stream: boolean,
  options: LLMRequestOptions = {},
): Record<string, unknown> {
  const miniMaxCompatible = isMiniMaxCompatible(cfg)
  const normalizedMessages = miniMaxCompatible
    ? normalizeMessagesForMiniMax(messages)
    : messages

  const payload: Record<string, unknown> = {
    model: cfg.modelId,
    messages: normalizedMessages.map((message) => toApiMessage(message)),
    stream,
    ...buildProviderCachingPayloadFields({
      config: cfg,
      enabled: options.providerCachingEnabled === true,
      messages: normalizedMessages,
      tools,
    }),
  }

  if (stream) {
    payload.stream_options = { include_usage: true }
  }

  if (tools.length > 0) {
    payload.tools = tools
    payload.tool_choice = toApiToolChoice(options.toolChoice)
  }

  if (miniMaxCompatible) {
    payload.reasoning_split = false
  }

  return payload
}

const REMOVABLE_PARAMS_ON_400: { key: string; pattern: RegExp }[] = [
  { key: 'stream_options', pattern: /stream_options|include_usage/i },
  { key: 'prompt_cache_key', pattern: /prompt_cache_key|cache/i },
  { key: 'reasoning_split', pattern: /reasoning_split/i },
]

const PARAM_REJECT_PATTERN =
  /unsupported|invalid|unknown|not support|extra|unrecognized|unexpected/i

async function postChatCompletion(
  cfg: LLMConfig,
  payload: Record<string, unknown>,
  tools: LLMToolDefinition[],
  abortSignal?: AbortSignal,
): Promise<Response> {
  if (!cfg.baseUrl) throw httpError(400, 'LLM baseUrl 未配置，请前往设置页填写')
  if (!cfg.modelId) throw httpError(400, 'LLM modelId 未配置，请前往设置页填写')
  if (requiresApiKey(cfg) && !cfg.apiKey) {
    throw httpError(400, 'LLM apiKey 未配置，请前往设置页填写')
  }

  let res: Response
  try {
    const requestBaseUrl = normalizeMiniMaxBaseUrl(cfg)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`
    }
    res = await fetch(joinUrl(requestBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: abortSignal,
    })
  } catch (error) {
    if (abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw httpError(499, 'LLM request aborted')
    }
    throw httpError(502, `无法连接 LLM: ${(error as Error).message}`)
  }

  if (res.ok) return res

  const body = await res.text().catch(() => '')

  // Drop unsupported optional params and retry — covers OpenAI-compatible
  // gateways that reject newer fields (prompt_cache_key, stream_options,
  // reasoning_split) without surfacing a hard error to the caller.
  for (const { key, pattern } of REMOVABLE_PARAMS_ON_400) {
    if (
      Object.prototype.hasOwnProperty.call(payload, key) &&
      pattern.test(body) &&
      PARAM_REJECT_PATTERN.test(body)
    ) {
      const retryPayload = { ...payload }
      delete retryPayload[key]
      return postChatCompletion(cfg, retryPayload, tools, abortSignal)
    }
  }

  const isToolError =
    tools.length > 0 && /tool|function/i.test(body) && PARAM_REJECT_PATTERN.test(body)

  throw httpError(
    res.status,
    isToolError
      ? '当前模型或网关不支持 Agent 工具调用，请切换到支持 function calling 的模型或兼容网关。'
      : `LLM 返回 ${res.status}: ${body.slice(0, 500) || res.statusText}`,
  )
}

// Streaming tool_calls deltas come in three shapes across providers:
//
// 1. OpenAI / Anthropic compatible: every delta carries `index`.
// 2. Some MiniMax / DeepSeek modes: name + id only on first chunk; subsequent
//    arguments chunks omit `index` and `id`.
// 3. Multi tool_calls in a single delta array: positional within the array.
//
// The previous implementation used `toolCalls.size` as fallback index, which
// split a single tool call across many entries and dropped its arguments.
// ToolCallBuffer below resolves the bucket via, in order:
//   a) explicit `index`;
//   b) recognised `id` mapped to a previously created bucket;
//   c) array position within the same delta event (when multiple items);
//   d) the most recently touched bucket (continuation of a single call).

type ToolCallBucket = {
  id?: string
  type?: string
  name: string
  arguments: string
}

class ToolCallBuffer {
  private byIndex = new Map<number, ToolCallBucket>()
  private indexById = new Map<string, number>()
  private lastIndex: number | null = null
  private orderCounter = 0

  ingest(deltaCalls: unknown): void {
    if (!Array.isArray(deltaCalls)) return

    for (let arrayPos = 0; arrayPos < deltaCalls.length; arrayPos += 1) {
      const item = deltaCalls[arrayPos]
      if (!item || typeof item !== 'object') continue
      const delta = item as {
        index?: unknown
        id?: unknown
        type?: unknown
        function?: { name?: unknown; arguments?: unknown }
      }

      const id = typeof delta.id === 'string' && delta.id.length > 0 ? delta.id : null
      let resolvedIndex: number | null =
        typeof delta.index === 'number' && Number.isFinite(delta.index)
          ? Math.floor(delta.index)
          : null

      if (resolvedIndex === null && id !== null && this.indexById.has(id)) {
        resolvedIndex = this.indexById.get(id)!
      }

      if (resolvedIndex === null) {
        if (deltaCalls.length > 1) {
          resolvedIndex = arrayPos
        } else if (this.lastIndex !== null) {
          resolvedIndex = this.lastIndex
        } else {
          resolvedIndex = this.orderCounter
        }
      }

      let bucket = this.byIndex.get(resolvedIndex)
      if (!bucket) {
        bucket = { name: '', arguments: '' }
        this.byIndex.set(resolvedIndex, bucket)
      }

      this.lastIndex = resolvedIndex
      if (resolvedIndex >= this.orderCounter) {
        this.orderCounter = resolvedIndex + 1
      }

      if (id) {
        bucket.id = id
        this.indexById.set(id, resolvedIndex)
      }
      if (typeof delta.type === 'string') bucket.type = delta.type

      const fn = delta.function && typeof delta.function === 'object' ? delta.function : null
      if (fn) {
        if (typeof fn.name === 'string' && fn.name.length > 0) {
          bucket.name = bucket.name + fn.name
        }
        if (typeof fn.arguments === 'string') {
          bucket.arguments = bucket.arguments + fn.arguments
        }
      }
    }
  }

  finalize(): LLMToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, bucket]) => {
        if (!bucket.name) return null
        if (bucket.type && bucket.type !== 'function') return null
        return {
          id: bucket.id && bucket.id.length > 0 ? bucket.id : `tool_call_${index + 1}`,
          type: 'function' as const,
          function: {
            name: bucket.name,
            arguments: bucket.arguments || '{}',
          },
        }
      })
      .filter((toolCall): toolCall is LLMToolCall => toolCall !== null)
  }
}

function getStringField(value: Record<string, unknown>, keys: string[]): string {
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

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key]
  return item && typeof item === 'object' && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : {}
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

export function normalizeUsage(value: unknown): LLMTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  const promptDetails = objectField(usage, 'prompt_tokens_details')
  const inputDetails = objectField(usage, 'input_tokens_details')
  const inputTokens =
    numberField(usage, 'prompt_tokens') ?? numberField(usage, 'input_tokens')
  const outputTokens =
    numberField(usage, 'completion_tokens') ?? numberField(usage, 'output_tokens')
  const totalTokens = numberField(usage, 'total_tokens')
  const cacheReadTokens =
    numberField(usage, 'cache_read_input_tokens') ??
    numberField(usage, 'prompt_cache_hit_tokens') ??
    numberField(usage, 'cached_tokens') ??
    numberField(usage, 'input_cached_tokens') ??
    numberField(usage, 'cache_hit_tokens') ??
    numberField(promptDetails, 'cached_tokens') ??
    numberField(inputDetails, 'cached_tokens')
  const cacheWriteTokens =
    numberField(usage, 'cache_write_tokens') ??
    numberField(usage, 'cache_creation_input_tokens') ??
    numberField(usage, 'prompt_cache_miss_tokens') ??
    numberField(usage, 'cache_creation_tokens') ??
    numberField(promptDetails, 'cache_creation_tokens') ??
    numberField(inputDetails, 'cache_creation_tokens')

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined
  ) {
    return undefined
  }

  return normalizeCacheUsage({
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
    cacheReadTokens,
    cacheWriteTokens,
  })
}

function fallbackUsage(messages: LLMConversationMessage[], content: string): LLMTokenUsage {
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
  requestOptions?: AbortSignal | LLMRequestOptions,
): Promise<LLMAssistantMessage> {
  const options = normalizeRequestOptions(requestOptions)
  const res = await postChatCompletion(
    cfg,
    buildPayload(cfg, messages, tools, false, options),
    tools,
    options.abortSignal,
  )

  const data = (await res.json().catch(() => null)) as {
    usage?: unknown
    choices?: Array<{
      message?: {
        role?: string
        content?: string | null
        tool_calls?: unknown
      }
      finish_reason?: string
    }>
  } | null

  const choice = data?.choices?.[0]
  const message = choice?.message
  const toolCalls = normalizeToolCalls(message?.tool_calls)
  const content = typeof message?.content === 'string' ? message.content : ''

  if (content.length === 0 && toolCalls.length === 0) {
    throw httpError(502, 'LLM 响应格式异常：未找到有效的回复内容或工具调用')
  }

  return {
    role: 'assistant',
    content,
    toolCalls,
    usage: normalizeUsage(data?.usage) ?? fallbackUsage(messages, content),
    finishReason:
      typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0
        ? choice.finish_reason
        : undefined,
  }
}

export async function* chatCompletionStream(
  cfg: LLMConfig,
  messages: LLMConversationMessage[],
  tools: LLMToolDefinition[] = [],
  requestOptions?: AbortSignal | LLMRequestOptions,
): AsyncGenerator<string, LLMAssistantMessage, void> {
  const options = normalizeRequestOptions(requestOptions)
  const externalSignal = options.abortSignal
  const idleTimeoutMs =
    typeof options.streamIdleTimeoutMs === 'number' && options.streamIdleTimeoutMs > 0
      ? options.streamIdleTimeoutMs
      : 0

  // Compose external abort signal with optional idle-timeout abort.
  const composite = new AbortController()
  let idleAborted = false
  const onExternalAbort = () => composite.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) composite.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdleTimer = () => {
    if (idleTimeoutMs <= 0) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleAborted = true
      composite.abort(new Error('idle timeout'))
    }, idleTimeoutMs)
  }
  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }
  const detachExternal = () => {
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }

  let res: Response
  try {
    armIdleTimer()
    res = await postChatCompletion(
      cfg,
      buildPayload(cfg, messages, tools, true, options),
      tools,
      composite.signal,
    )
  } catch (error) {
    clearIdleTimer()
    detachExternal()
    if (idleAborted) {
      throw httpError(504, `LLM 流式响应空闲超时（${Math.floor(idleTimeoutMs / 1000)}s）`)
    }
    throw error
  }

  if (!res.body) {
    clearIdleTimer()
    detachExternal()
    throw httpError(502, 'LLM 流式响应格式异常：缺少 body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const toolCallBuffer = new ToolCallBuffer()
  let buffer = ''
  let content = ''
  let reasoningOpen = false
  let done = false
  let usage: LLMTokenUsage | undefined
  let finishReason: string | undefined

  // Reasoning chunks are now ALWAYS streamed wrapped in <think>...</think>
  // blocks. Frontend Chat.tsx renders them as collapsible "思考过程" panels;
  // feishu/wechat/wechat-desktop services strip them before delivery. The
  // previous suppressReasoning=true (when tools were present) caused
  // reasoning-only model turns to be reported as empty and surfaced as red
  // "未找到有效的回复内容或工具调用" errors in the UI.
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

  const emitReasoning = function* (chunk: string): Generator<string, void, void> {
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

      let obj: {
        usage?: unknown
        choices?: Array<{
          delta?: Record<string, unknown> & {
            content?: unknown
            tool_calls?: unknown
          }
          finish_reason?: string
        }>
      }
      try {
        obj = JSON.parse(data)
      } catch {
        // Tolerate malformed fragments emitted by some gateways.
        continue
      }

      usage = normalizeUsage(obj.usage) ?? usage
      const choice = obj.choices?.[0]
      if (!choice) continue
      if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
        finishReason = choice.finish_reason
      }

      const delta = choice.delta
      if (!delta) continue

      const reasoning = getStringField(delta, ['reasoning_content', 'reasoning', 'thinking'])
      yield* emitReasoning(reasoning)

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield* emitContent(delta.content)
      }

      toolCallBuffer.ingest(delta.tool_calls)
    }
  }

  try {
    while (!done) {
      const { value, done: readDone } = await reader.read()
      armIdleTimer()
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
  } catch (error) {
    if (externalSignal?.aborted) {
      throw httpError(499, 'LLM stream aborted')
    }
    if (idleAborted) {
      throw httpError(
        504,
        `LLM 流式响应空闲超时（${Math.floor(idleTimeoutMs / 1000)}s 内未收到任何数据）`,
      )
    }
    throw httpError(502, `LLM 流式响应解析失败: ${(error as Error).message}`)
  } finally {
    clearIdleTimer()
    detachExternal()
    reader.releaseLock()
  }

  if (reasoningOpen) {
    const close = '\n</think>\n\n'
    reasoningOpen = false
    content += close
    yield close
  }

  const normalizedToolCalls = toolCallBuffer.finalize()

  // Reasoning is now part of `content` (wrapped in <think>...</think>), so
  // a reasoning-only turn no longer trips this check.
  if (content.length === 0 && normalizedToolCalls.length === 0) {
    throw httpError(502, 'LLM 响应格式异常：未找到有效的回复内容或工具调用')
  }

  return {
    role: 'assistant',
    content,
    toolCalls: normalizedToolCalls,
    usage: usage ?? fallbackUsage(messages, content),
    finishReason,
  }
}
