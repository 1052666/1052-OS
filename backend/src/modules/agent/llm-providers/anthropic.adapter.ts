/**
 * Anthropic Messages API adapter.
 *
 * Translates 1052 OS internal messages to Anthropic's native format:
 *   POST {baseUrl}/v1/messages
 *
 * Key differences from OpenAI:
 * - System prompt is a top-level `system` param, not a message.
 * - Tool results use `tool_result` content blocks, not `role: tool`.
 * - Tool calls use `tool_use` content blocks inside assistant messages.
 * - Auth is `x-api-key` header, not `Authorization: Bearer`.
 * - Streaming uses SSE with typed `event:` lines.
 */

import type {
  LLMConversationMessage,
  LLMToolDefinition,
  LLMToolCall,
  LLMAssistantMessage,
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

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function extractSystemPrompt(messages: LLMConversationMessage[]): {
  system: string
  rest: LLMConversationMessage[]
} {
  const systemParts: string[] = []
  const rest: LLMConversationMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content)
    else rest.push(m)
  }
  return { system: systemParts.join('\n\n'), rest }
}

function convertMessages(messages: LLMConversationMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content })
      continue
    }

    if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        const blocks: AnthropicContentBlock[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls) {
          let input: Record<string, unknown> = {}
          try { input = JSON.parse(tc.function.arguments) } catch { /* keep empty */ }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
        }
        result.push({ role: 'assistant', content: blocks })
      } else {
        result.push({ role: 'assistant', content: m.content })
      }
      continue
    }

    if (m.role === 'tool') {
      // Anthropic expects tool_result as a user message content block
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      }
      // Merge into the last user message if it's already a content-block array,
      // otherwise create a new user message
      const last = result[result.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content)) {
        ;(last.content as AnthropicContentBlock[]).push(block)
      } else {
        result.push({ role: 'user', content: [block] })
      }
      continue
    }
  }

  // Anthropic requires messages to alternate user/assistant.
  // Merge consecutive same-role messages.
  return mergeConsecutive(result)
}

function mergeConsecutive(messages: AnthropicMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = []
  for (const m of messages) {
    const last = result[result.length - 1]
    if (last && last.role === m.role) {
      // Merge content
      const lastBlocks = toBlocks(last.content)
      const newBlocks = toBlocks(m.content)
      last.content = [...lastBlocks, ...newBlocks]
    } else {
      result.push({ ...m })
    }
  }
  return result
}

function toBlocks(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

function convertTools(tools: LLMToolDefinition[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))
}

// ─── Response parsing ──────────────────────────────────────────────

function parseAnthropicUsage(data: Record<string, unknown>): LLMTokenUsage | undefined {
  const usage = data.usage as Record<string, unknown> | undefined
  if (!usage) return undefined
  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
  const cacheReadTokens = typeof usage.cache_read_input_tokens === 'number'
    ? usage.cache_read_input_tokens : undefined
  const cacheWriteTokens = typeof usage.cache_creation_input_tokens === 'number'
    ? usage.cache_creation_input_tokens : undefined
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens : undefined,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

function extractFromContentBlocks(blocks: unknown[]): { content: string; toolCalls: LLMToolCall[] } {
  let content = ''
  const toolCalls: LLMToolCall[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      content += b.text
    } else if (b.type === 'tool_use') {
      toolCalls.push({
        id: typeof b.id === 'string' ? b.id : `tool_call_${toolCalls.length + 1}`,
        type: 'function',
        function: {
          name: typeof b.name === 'string' ? b.name : '',
          arguments: typeof b.input === 'object' ? JSON.stringify(b.input) : '{}',
        },
      })
    }
  }
  return { content, toolCalls }
}

// ─── Adapter ───────────────────────────────────────────────────────

export class AnthropicAdapter implements LLMProviderAdapter {
  readonly format = 'anthropic' as const

  buildRequest(ctx: AdapterRequestContext): AdapterRequest {
    const { cfg, messages, tools, stream } = ctx
    const { system, rest } = extractSystemPrompt(messages)

    const body: Record<string, unknown> = {
      model: cfg.modelId,
      messages: convertMessages(rest),
      max_tokens: 8192,
      stream,
    }

    if (system) body.system = system
    if (tools.length > 0) body.tools = convertTools(tools)

    const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (cfg.apiKey) {
      headers['x-api-key'] = cfg.apiKey
    }

    return {
      url: `${baseUrl}/v1/messages`,
      headers,
      body,
    }
  }

  parseResponse(json: unknown, _ctx: AdapterRequestContext): LLMAssistantMessage {
    const data = (json ?? {}) as Record<string, unknown>
    const contentBlocks = Array.isArray(data.content) ? data.content : []
    const { content, toolCalls } = extractFromContentBlocks(contentBlocks)
    const stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : undefined

    return {
      role: 'assistant',
      content,
      toolCalls,
      usage: parseAnthropicUsage(data),
      finishReason: stopReason === 'end_turn' ? 'stop'
        : stopReason === 'tool_use' ? 'tool_calls'
        : stopReason ?? undefined,
    }
  }

  createStreamParser(_ctx: AdapterRequestContext): StreamParser {
    return new AnthropicStreamParser()
  }
}

// ─── SSE Stream Parser ─────────────────────────────────────────────

/**
 * Anthropic streaming uses typed SSE events:
 *   event: message_start       → contains message-level metadata + usage
 *   event: content_block_start → new content block (text or tool_use)
 *   event: content_block_delta → incremental text or tool input JSON
 *   event: content_block_stop  → block done
 *   event: message_delta       → stop_reason + output usage
 *   event: message_stop        → stream done
 */
class AnthropicStreamParser implements StreamParser {
  private currentEventType = ''
  private currentToolUseId = ''
  private currentToolName = ''

  feedLine(line: string): StreamChunkResult[] {
    // Track event type
    if (line.startsWith('event:')) {
      this.currentEventType = line.slice(6).trim()
      return []
    }
    if (!line.startsWith('data:')) return []

    const raw = line.slice(5).trim()
    if (!raw) return []

    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { return [] }

    switch (this.currentEventType) {
      case 'message_start': {
        const usage = parseAnthropicUsage(
          (data.message as Record<string, unknown>) ?? data,
        )
        return [{ content: '', reasoning: '', toolCallDeltas: null, usage, finishReason: undefined, done: false }]
      }

      case 'content_block_start': {
        const block = data.content_block as Record<string, unknown> | undefined
        if (block?.type === 'tool_use') {
          this.currentToolUseId = typeof block.id === 'string' ? block.id : ''
          this.currentToolName = typeof block.name === 'string' ? block.name : ''
          // Emit a tool_call start delta (OpenAI-compatible shape for ToolCallBuffer)
          const delta = [{
            index: typeof data.index === 'number' ? data.index : 0,
            id: this.currentToolUseId,
            type: 'function',
            function: { name: this.currentToolName, arguments: '' },
          }]
          return [{ content: '', reasoning: '', toolCallDeltas: delta, usage: undefined, finishReason: undefined, done: false }]
        }
        if (block?.type === 'thinking') {
          const text = typeof block.thinking === 'string' ? block.thinking : ''
          return [{ content: '', reasoning: text, toolCallDeltas: null, usage: undefined, finishReason: undefined, done: false }]
        }
        return []
      }

      case 'content_block_delta': {
        const delta = data.delta as Record<string, unknown> | undefined
        if (!delta) return []

        if (delta.type === 'text_delta') {
          const text = typeof delta.text === 'string' ? delta.text : ''
          return [{ content: text, reasoning: '', toolCallDeltas: null, usage: undefined, finishReason: undefined, done: false }]
        }
        if (delta.type === 'thinking_delta') {
          const text = typeof delta.thinking === 'string' ? delta.thinking : ''
          return [{ content: '', reasoning: text, toolCallDeltas: null, usage: undefined, finishReason: undefined, done: false }]
        }
        if (delta.type === 'input_json_delta') {
          const partial = typeof delta.partial_json === 'string' ? delta.partial_json : ''
          const tcDelta = [{
            index: typeof data.index === 'number' ? data.index : 0,
            function: { arguments: partial },
          }]
          return [{ content: '', reasoning: '', toolCallDeltas: tcDelta, usage: undefined, finishReason: undefined, done: false }]
        }
        return []
      }

      case 'message_delta': {
        const md = data.delta as Record<string, unknown> | undefined
        const stopReason = typeof md?.stop_reason === 'string' ? md.stop_reason : undefined
        const finishReason = stopReason === 'end_turn' ? 'stop'
          : stopReason === 'tool_use' ? 'tool_calls'
          : stopReason ?? undefined
        const usage = parseAnthropicUsage(data)
        return [{ content: '', reasoning: '', toolCallDeltas: null, usage, finishReason, done: false }]
      }

      case 'message_stop':
        return [{ content: '', reasoning: '', toolCallDeltas: null, usage: undefined, finishReason: undefined, done: true }]

      default:
        return []
    }
  }

  flush(): StreamChunkResult[] {
    return []
  }
}
