import { HttpError } from '../../http-error.js'
import type {
  LLMConversationMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.client.js'
import { getSettings } from '../settings/settings.service.js'
import {
  canAutoConfirm1052Tool,
  is1052ToolSideEffecting,
  type ToolRuntime1052Snapshot,
} from './1052-tool-runtime.js'
import { resolve1052PermissionProfile } from './1052-permission-profile.js'
import { runtime1052ToolRegistry } from './1052-tool-registry.js'

/**
 * Maximum size, in characters, that a single tool result JSON is allowed to
 * occupy when injected back into the LLM conversation. Hit this and the
 * content is replaced with a truncated preview plus a `_hint` that nudges
 * the model to re-issue a narrower query. Without this cap a single
 * `sql_query`, `websearch_read_page`, or unbounded list dump can push the
 * next turn's prompt past the model's context window — typically surfacing
 * as either `413`/`context_length_exceeded` errors or silent information
 * loss on the model's side.
 *
 * 80_000 chars ≈ 20K tokens at a 4:1 char:token ratio for English and closer
 * to 40K tokens for CJK — both comfortably under the 128K/200K context of
 * mainstream models while still being generous for legitimate file reads.
 */
export const MAX_TOOL_RESULT_CHARS = 80_000

/** Safe upper bound on tool-event preview strings sent to the frontend. */
const MAX_PREVIEW_CHARS = 240

export type AgentToolRuntimeContext = {
  source?:
    | {
        channel: 'wechat'
        accountId: string
        peerId: string
      }
    | {
        channel: 'feishu'
        receiveIdType: 'chat_id'
        receiveId: string
        chatType: 'p2p' | 'group'
        senderOpenId?: string
      }
}

function stringifyResult(result: unknown) {
  return JSON.stringify(result, null, 2)
}

function parseArguments(value: string) {
  if (!value.trim()) return {}
  return JSON.parse(value) as unknown
}

/**
 * Wrap a successful tool result as the canonical `{ ok: true, data }` envelope,
 * truncating the serialized form when it exceeds {@link MAX_TOOL_RESULT_CHARS}.
 *
 * The truncated form preserves the head of the original payload as
 * `data_preview_head` and attaches explicit `_truncated`, `_originalSize`,
 * `_limit`, and `_hint` fields so the model gets an actionable signal to
 * narrow its next query rather than silently losing tail data.
 */
function buildTruncatedResultContent(result: unknown): string {
  const fullJson = stringifyResult({ ok: true, data: result })
  if (fullJson.length <= MAX_TOOL_RESULT_CHARS) return fullJson

  // Leave a small safety margin for the JSON envelope + hint metadata.
  const previewBudget = Math.max(0, MAX_TOOL_RESULT_CHARS - 2_000)
  const preview = fullJson.slice(0, previewBudget)
  return stringifyResult({
    ok: true,
    _truncated: true,
    _originalSize: fullJson.length,
    _limit: MAX_TOOL_RESULT_CHARS,
    _hint:
      `工具输出已从 ${fullJson.length} 字符截断至约 ${previewBudget} 字符。` +
      '请收窄查询范围（例如增加 limit/offset、过滤字段、缩短时间窗、按路径/ID 定位），' +
      '或直接告知用户原始输出过大、让用户选择下一步。',
    data_preview_head: preview,
  })
}

function truncatePreview(input: string, maxLen = MAX_PREVIEW_CHARS): string {
  const trimmed = input.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen - 1) + '…'
}

/**
 * Short human-readable summary of tool_call arguments, suitable for showing
 * directly in the UI beside the tool name. Handles three cases:
 *
 *   - valid JSON object → renders the top-level keys as `key=value` pairs
 *     (values truncated individually), stripping internal fields like
 *     `confirmed` and `__runtimeContext`
 *   - valid JSON but not an object → `JSON.stringify` truncated
 *   - malformed JSON → raw string truncated (we deliberately do not try to
 *     auto-repair here — that belongs in a future Zod/json5 phase)
 */
export function buildArgsPreview(rawArgs: string): string {
  const trimmed = rawArgs.trim()
  if (!trimmed) return ''

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return truncatePreview(trimmed)
  }

  if (parsed === null || parsed === undefined) return ''
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return truncatePreview(JSON.stringify(parsed))
  }

  const record = parsed as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record)) {
    if (key === 'confirmed' || key === '__runtimeContext') continue
    parts.push(renderArgPair(key, record[key]))
    if (parts.join(', ').length >= MAX_PREVIEW_CHARS) break
  }
  return truncatePreview(parts.join(', '))
}

function renderArgPair(key: string, value: unknown): string {
  if (value === null || value === undefined) return `${key}=null`
  if (typeof value === 'string') {
    const short = value.length <= 48 ? value : value.slice(0, 47) + '…'
    return `${key}="${short}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}=${value}`
  }
  if (Array.isArray(value)) {
    return `${key}=[${value.length} items]`
  }
  return `${key}={…}`
}

interface ToolResultEnvelope {
  ok?: unknown
  error?: unknown
  data?: unknown
  _truncated?: unknown
}

/**
 * Short human-readable summary of a tool's JSON return payload, suitable for
 * showing directly in the UI when a tool call completes. Mirrors the shape
 * produced by {@link executeToolCall}.
 */
export function buildResultPreview(content: string): string {
  let parsed: ToolResultEnvelope | null = null
  try {
    const candidate = JSON.parse(content) as unknown
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as ToolResultEnvelope
    }
  } catch {
    return truncatePreview(content)
  }

  if (!parsed) return truncatePreview(content)
  if (parsed.ok === false && typeof parsed.error === 'string') {
    return truncatePreview(parsed.error)
  }
  if (parsed.ok === true) {
    const prefix = parsed._truncated === true ? '[已截断] ' : ''
    return truncatePreview(prefix + formatResultPayload(parsed.data))
  }
  return truncatePreview(content)
}

function formatResultPayload(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) return '{}'
    return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`
  }
  return ''
}

function buildToolFailureMessage(
  toolCall: Pick<LLMToolCall, 'id' | 'function'>,
  toolName: string,
  error: string,
): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolName,
    content: stringifyResult({
      ok: false,
      error,
    }),
  }
}

export function getAgentToolDefinitions(): LLMToolDefinition[] {
  return runtime1052ToolRegistry.definitions()
}

export type Runtime1052ToolAuthorization = {
  approved: boolean
  approvalId?: string
}

export function getRuntime1052ToolSnapshot(): ToolRuntime1052Snapshot {
  return runtime1052ToolRegistry.snapshot()
}

export function hasAgentTool(name: string) {
  return runtime1052ToolRegistry.has(name)
}

export function getAgentToolDefinitionsForNames(names: readonly string[]): LLMToolDefinition[] {
  return runtime1052ToolRegistry.definitions(names)
}

/** Max retries for transient tool execution errors (network, 502/503/429). */
const MAX_TOOL_RETRIES = 2

/** Returns true if the error is transient and the tool call should be retried. */
function isRetriableToolError(error: unknown): boolean {
  if (error instanceof HttpError) {
    // 502 Bad Gateway, 503 Service Unavailable, 429 Rate Limit — transient
    if (error.status === 502 || error.status === 503 || error.status === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    // Network errors that are typically transient
    if (msg.includes('fetch failed') || msg.includes('econnreset') ||
        msg.includes('econnrefused') || msg.includes('etimedout') ||
        msg.includes('socket hang up') || msg.includes('network')) return true
  }
  return false
}

export async function executeToolCall(
  toolCall: LLMToolCall,
  runtimeContext?: AgentToolRuntimeContext,
  authorization?: Runtime1052ToolAuthorization,
): Promise<LLMConversationMessage> {
  const settings = await getSettings()
  const permissionProfile = resolve1052PermissionProfile(settings.agent)
  const tool = runtime1052ToolRegistry.get(toolCall.function.name)

  if (!tool) {
    return buildToolFailureMessage(
      toolCall,
      toolCall.function.name,
      `未找到工具: ${toolCall.function.name}。请检查工具名称是否正确。`,
    )
  }

  if (
    permissionProfile.sandboxPolicy.type === 'read-only' &&
    is1052ToolSideEffecting(tool.name)
  ) {
    return buildToolFailureMessage(
      toolCall,
      tool.name,
      `Tool ${tool.name} is blocked by the 1052 read-only permission profile.`,
    )
  }

  const sideEffecting = is1052ToolSideEffecting(tool.name)
  if (
    sideEffecting &&
    permissionProfile.approvalPolicy !== 'never' &&
    authorization?.approved !== true
  ) {
    return buildToolFailureMessage(
      toolCall,
      tool.name,
      `Tool ${tool.name} requires approval from the 1052 runtime.`,
    )
  }

  let lastError: Error | HttpError | null = null

  for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt += 1) {
    try {
      const parsedArgs = parseArguments(toolCall.function.arguments)
      const confirmedArgs =
        (canAutoConfirm1052Tool(tool.name, permissionProfile) ||
          (sideEffecting && authorization?.approved === true)) &&
        parsedArgs &&
        typeof parsedArgs === 'object' &&
        !Array.isArray(parsedArgs)
          ? { ...(parsedArgs as Record<string, unknown>), confirmed: true }
          : parsedArgs
      const args =
        runtimeContext &&
        confirmedArgs &&
        typeof confirmedArgs === 'object' &&
        !Array.isArray(confirmedArgs)
          ? { ...(confirmedArgs as Record<string, unknown>), __runtimeContext: runtimeContext }
          : confirmedArgs
      const result = await tool.execute(args)

      return {
        role: 'tool',
        toolCallId: toolCall.id,
        name: tool.name,
        content: buildTruncatedResultContent(result),
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('工具调用失败')

      // Retry on transient errors with backoff
      if (attempt < MAX_TOOL_RETRIES && isRetriableToolError(error)) {
        console.warn(`[tool] ${tool.name} transient error (attempt ${attempt + 1}/${MAX_TOOL_RETRIES + 1}): ${lastError.message}`)
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      break
    }
  }

  const message = lastError?.message ?? '工具调用失败'
  return buildToolFailureMessage(toolCall, tool.name, message)
}
