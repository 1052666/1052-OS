/**
 * Google Gemini REST API adapter.
 *
 * Translates 1052 OS internal messages to Gemini's generateContent format:
 *   POST {baseUrl}/v1beta/models/{model}:generateContent
 *   POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse
 *
 * Key differences from OpenAI:
 * - Messages use `contents` with `parts` array (text, functionCall, functionResponse).
 * - System instruction is a top-level `system_instruction` field.
 * - Auth is `?key=` query param or `Authorization: Bearer` for Vertex.
 * - Tools use `function_declarations` inside a `tools` array.
 * - Streaming returns SSE with `data:` lines containing full candidate objects.
 */

import type {
  LLMConversationMessage,
  LLMToolDefinition,
  LLMToolCall,
  LLMAssistantMessage,
  LLMConfig,
  LLMTokenUsage,
} from '../llm.client.js'
import type {
  LLMProviderAdapter,
  AdapterRequestContext,
  AdapterRequest,
  StreamChunkResult,
  StreamParser,
} from './types.js'

// ─── Message conversion ────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: string } } }

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function extractSystemInstruction(messages: LLMConversationMessage[]): {
  systemInstruction: string
  rest: LLMConversationMessage[]
} {
  const parts: string[] = []
  const rest: LLMConversationMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') parts.push(m.content)
    else rest.push(m)
  }
  return { systemInstruction: parts.join('\n\n'), rest }
}

function convertMessages(messages: LLMConversationMessage[]): GeminiContent[] {
  const result: GeminiContent[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      pushOrMerge(result, 'user', [{ text: m.content }])
      continue
    }

    if (m.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (m.content) parts.push({ text: m.content })
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch { /* keep empty */ }
          parts.push({ functionCall: { name: tc.function.name, args } })
        }
      }
      if (parts.length > 0) pushOrMerge(result, 'model', parts)
      continue
    }

    if (m.role === 'tool') {
      pushOrMerge(result, 'user', [{
        functionResponse: {
          name: m.name || 'unknown',
          response: { content: m.content },
        },
      }])
      continue
    }
  }

  return result
}

function pushOrMerge(arr: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]) {
  const last = arr[arr.length - 1]
  if (last?.role === role) {
    last.parts.push(...parts)
  } else {
    arr.push({ role, parts })
  }
}

function convertTools(tools: LLMToolDefinition[]): Array<{
  function_declarations: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }>
}> {
  if (tools.length === 0) return []
  return [{
    function_declarations: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  }]
}

// ─── URL building ──────────────────────────────────────────────────

function buildGeminiUrl(cfg: LLMConfig, stream: boolean): string {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
  const model = encodeURIComponent(cfg.modelId)

  // If baseUrl already ends with /models or /v1beta or /v1, append model + action
  const action = stream ? 'streamGenerateContent' : 'generateContent'
  let url: string

  if (/\/models\/?$/i.test(baseUrl)) {
    url = `${baseUrl}/${model}:${action}`
  } else if (/\/v1(beta)?\/?$/i.test(baseUrl)) {
    url = `${baseUrl}/models/${model}:${action}`
  } else {
    // Full custom URL — assume it already has the right structure, just append action path
    url = `${baseUrl}/v1beta/models/${model}:${action}`
  }

  if (stream) url += '?alt=sse'

  // API key as query param (Gemini AI Studio style)
  if (cfg.apiKey && !cfg.apiKey.startsWith('ya29.') && cfg.apiKey.length < 100) {
    url += `${stream ? '&' : '?'}key=${encodeURIComponent(cfg.apiKey)}`
  }

  return url
}

// ─── Response parsing ──────────────────────────────────────────────

function parseGeminiUsage(data: Record<string, unknown>): LLMTokenUsage | undefined {
  const meta = data.usageMetadata as Record<string, unknown> | undefined
  if (!meta) return undefined
  const inputTokens = typeof meta.promptTokenCount === 'number' ? meta.promptTokenCount : undefined
  const outputTokens = typeof meta.candidatesTokenCount === 'number' ? meta.candidatesTokenCount : undefined
  const totalTokens = typeof meta.totalTokenCount === 'number' ? meta.totalTokenCount : undefined
  const cachedTokens = typeof meta.cachedContentTokenCount === 'number' ? meta.cachedContentTokenCount : undefined
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return { inputTokens, outputTokens, totalTokens, cacheReadTokens: cachedTokens }
}

function extractFromGeminiParts(parts: unknown[]): { content: string; toolCalls: LLMToolCall[] } {
  let content = ''
  const toolCalls: LLMToolCall[] = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if (typeof p.text === 'string') {
      content += p.text
    }
    if (p.functionCall && typeof p.functionCall === 'object') {
      const fc = p.functionCall as Record<string, unknown>
      toolCalls.push({
        id: `tool_call_${toolCalls.length + 1}`,
        type: 'function',
        function: {
          name: typeof fc.name === 'string' ? fc.name : '',
          arguments: typeof fc.args === 'object' ? JSON.stringify(fc.args) : '{}',
        },
      })
    }
  }
  return { content, toolCalls }
}

// ─── Adapter ───────────────────────────────────────────────────────

export class GeminiAdapter implements LLMProviderAdapter {
  readonly format = 'gemini' as const

  buildRequest(ctx: AdapterRequestContext): AdapterRequest {
    const { cfg, messages, tools, stream } = ctx
    const { systemInstruction, rest } = extractSystemInstruction(messages)

    const body: Record<string, unknown> = {
      contents: convertMessages(rest),
    }

    if (systemInstruction) {
      body.system_instruction = { parts: [{ text: systemInstruction }] }
    }

    const geminiTools = convertTools(tools)
    if (geminiTools.length > 0) {
      body.tools = geminiTools
    }

    // Generation config
    body.generationConfig = { maxOutputTokens: 8192 }

    const url = buildGeminiUrl(cfg, stream)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    // Vertex AI uses Bearer token (long token / service account)
    if (cfg.apiKey && (cfg.apiKey.startsWith('ya29.') || cfg.apiKey.length >= 100)) {
      headers.Authorization = `Bearer ${cfg.apiKey}`
    }

    return { url, headers, body }
  }

  parseResponse(json: unknown, _ctx: AdapterRequestContext): LLMAssistantMessage {
    const data = (json ?? {}) as Record<string, unknown>
    const candidates = Array.isArray(data.candidates) ? data.candidates : []
    const candidate = (candidates[0] ?? {}) as Record<string, unknown>
    const contentObj = (candidate.content ?? {}) as Record<string, unknown>
    const parts = Array.isArray(contentObj.parts) ? contentObj.parts : []
    const { content, toolCalls } = extractFromGeminiParts(parts)

    const finishReason = typeof candidate.finishReason === 'string'
      ? candidate.finishReason.toLowerCase() : undefined

    return {
      role: 'assistant',
      content,
      toolCalls,
      usage: parseGeminiUsage(data),
      finishReason: finishReason === 'stop' ? 'stop'
        : finishReason === 'max_tokens' ? 'length'
        : finishReason,
    }
  }

  createStreamParser(_ctx: AdapterRequestContext): StreamParser {
    return new GeminiStreamParser()
  }
}

// ─── SSE Stream Parser ─────────────────────────────────────────────

/**
 * Gemini streaming returns SSE `data:` lines. Each data line is a full
 * JSON object with `candidates[0].content.parts` and `usageMetadata`.
 * Unlike OpenAI, each chunk contains the incremental parts, not deltas
 * to string fields, so we extract content/toolCalls directly.
 */
class GeminiStreamParser implements StreamParser {
  feedLine(line: string): StreamChunkResult[] {
    if (!line.startsWith('data:')) return []
    const raw = line.slice(5).trim()
    if (!raw) return []

    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { return [] }

    const candidates = Array.isArray(data.candidates) ? data.candidates : []
    const candidate = (candidates[0] ?? {}) as Record<string, unknown>
    const contentObj = (candidate.content ?? {}) as Record<string, unknown>
    const parts = Array.isArray(contentObj.parts) ? contentObj.parts : []

    let content = ''
    const toolCallDeltas: unknown[] = []

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (typeof p.text === 'string') content += p.text
      if (p.functionCall && typeof p.functionCall === 'object') {
        const fc = p.functionCall as Record<string, unknown>
        // Convert to OpenAI-compatible delta shape for ToolCallBuffer
        toolCallDeltas.push({
          index: toolCallDeltas.length,
          id: `tool_call_${toolCallDeltas.length + 1}`,
          type: 'function',
          function: {
            name: typeof fc.name === 'string' ? fc.name : '',
            arguments: typeof fc.args === 'object' ? JSON.stringify(fc.args) : '{}',
          },
        })
      }
    }

    const finishReason = typeof candidate.finishReason === 'string'
      ? candidate.finishReason.toLowerCase() : undefined
    const normalizedFinish = finishReason === 'stop' ? 'stop'
      : finishReason === 'max_tokens' ? 'length'
      : finishReason

    const usage = parseGeminiUsage(data)

    return [{
      content,
      reasoning: '',
      toolCallDeltas: toolCallDeltas.length > 0 ? toolCallDeltas : null,
      usage,
      finishReason: normalizedFinish,
      done: false,
    }]
  }

  flush(): StreamChunkResult[] {
    return []
  }
}
