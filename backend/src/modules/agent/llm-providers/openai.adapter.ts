/**
 * OpenAI-compatible provider adapter.
 *
 * Covers OpenAI, Azure OpenAI, DeepSeek, MiniMax, Ollama, LM Studio,
 * LocalAI, vLLM, llama.cpp, OpenRouter, SiliconFlow, and any other
 * gateway that exposes /chat/completions with the OpenAI message schema.
 */

import type {
  LLMConversationMessage,
  LLMToolCall,
  LLMAssistantMessage,
  LLMRequestOptions,
  LLMConfig,
} from '../llm.client.js'
import { normalizeUsage } from '../llm.client.js'
import { isMiniMaxCompatible } from '../agent.provider.js'
import {
  buildProviderCachingPayloadFields,
} from '../agent.cache-policy.service.js'
import type {
  LLMProviderAdapter,
  AdapterRequestContext,
  AdapterRequest,
  StreamChunkResult,
  StreamParser,
} from './types.js'

// ─── Helpers shared with the old monolith ──────────────────────────

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

function normalizeMessagesForMiniMax(
  messages: LLMConversationMessage[],
): LLMConversationMessage[] {
  const systemMessages = messages.filter((m) => m.role === 'system')
  if (systemMessages.length <= 1) return messages
  const merged = systemMessages.map((m) => m.content).join('\n\n')
  const rest = messages.filter((m) => m.role !== 'system')
  return [{ role: 'system', content: merged }, ...rest]
}

function toApiMessage(message: LLMConversationMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

function toApiToolChoice(choice: LLMRequestOptions['toolChoice']): unknown {
  return choice ?? 'auto'
}

function normalizeToolCalls(value: unknown): LLMToolCall[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const tc = item as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
      if (tc.type !== 'function') return null
      if (!tc.function || typeof tc.function !== 'object') return null
      if (typeof tc.function.name !== 'string') return null
      return {
        id: typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : `tool_call_${index + 1}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : '{}',
        },
      }
    })
    .filter((tc): tc is LLMToolCall => tc !== null)
}

function getStringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = value[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return ''
}

// ─── OpenAI Adapter ────────────────────────────────────────────────

export class OpenAIAdapter implements LLMProviderAdapter {
  readonly format = 'openai-compatible' as const

  buildRequest(ctx: AdapterRequestContext): AdapterRequest {
    const { cfg, messages, tools, stream, options } = ctx
    const miniMaxCompat = isMiniMaxCompatible(cfg)
    const normalized = miniMaxCompat ? normalizeMessagesForMiniMax(messages) : messages

    const body: Record<string, unknown> = {
      model: cfg.modelId,
      messages: normalized.map(toApiMessage),
      stream,
      ...buildProviderCachingPayloadFields({
        config: cfg,
        enabled: options.providerCachingEnabled === true,
        messages: normalized,
        tools,
      }),
    }

    if (stream) {
      body.stream_options = { include_usage: true }
    }
    if (tools.length > 0) {
      body.tools = tools
      body.tool_choice = toApiToolChoice(options.toolChoice)
    }
    if (miniMaxCompat) {
      body.reasoning_split = false
    }

    const requestBaseUrl = normalizeMiniMaxBaseUrl(cfg)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`
    }

    return {
      url: joinUrl(requestBaseUrl, 'chat/completions'),
      headers,
      body,
    }
  }

  parseResponse(json: unknown, _ctx: AdapterRequestContext): LLMAssistantMessage {
    const data = json as {
      usage?: unknown
      choices?: Array<{
        message?: { role?: string; content?: string | null; tool_calls?: unknown }
        finish_reason?: string
      }>
    } | null

    const choice = data?.choices?.[0]
    const message = choice?.message
    const toolCalls = normalizeToolCalls(message?.tool_calls)
    const content = typeof message?.content === 'string' ? message.content : ''

    return {
      role: 'assistant',
      content,
      toolCalls,
      usage: normalizeUsage(data?.usage),
      finishReason:
        typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0
          ? choice.finish_reason
          : undefined,
    }
  }

  createStreamParser(_ctx: AdapterRequestContext): StreamParser {
    return new OpenAIStreamParser()
  }
}

// ─── SSE Stream Parser ─────────────────────────────────────────────

class OpenAIStreamParser implements StreamParser {
  feedLine(line: string): StreamChunkResult[] {
    if (!line.startsWith('data:')) return []
    const data = line.slice(5).trim()
    if (!data) return []
    if (data === '[DONE]') {
      return [{ content: '', reasoning: '', toolCallDeltas: null, usage: undefined, finishReason: undefined, done: true }]
    }

    let obj: {
      usage?: unknown
      choices?: Array<{
        delta?: Record<string, unknown> & { content?: unknown; tool_calls?: unknown }
        finish_reason?: string
      }>
    }
    try {
      obj = JSON.parse(data)
    } catch {
      return []
    }

    const usage = normalizeUsage(obj.usage)
    const choice = obj.choices?.[0]
    if (!choice) {
      return usage ? [{ content: '', reasoning: '', toolCallDeltas: null, usage, finishReason: undefined, done: false }] : []
    }

    const finishReason =
      typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0
        ? choice.finish_reason
        : undefined

    const delta = choice.delta
    if (!delta) {
      return [{ content: '', reasoning: '', toolCallDeltas: null, usage, finishReason, done: false }]
    }

    const reasoning = getStringField(delta, ['reasoning_content', 'reasoning', 'thinking'])
    const content = typeof delta.content === 'string' ? delta.content : ''
    const toolCallDeltas = Array.isArray(delta.tool_calls) ? (delta.tool_calls as unknown[]) : null

    return [{ content, reasoning, toolCallDeltas, usage, finishReason, done: false }]
  }

  flush(): StreamChunkResult[] {
    return []
  }
}
