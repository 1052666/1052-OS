import { HttpError } from '../../http-error.js'
import type {
  LLMConversationMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.client.js'
import type { AgentTool } from './agent.tool.types.js'
import { agentRuntimeTools } from './tools/agent-runtime.tools.js'
import { calendarTools } from './tools/calendar.tools.js'
import { claudeCodeTools } from './tools/claude-code.tools.js'
import { filesystemTools } from './tools/filesystem.tools.js'
import { feishuTools } from './tools/feishu.tools.js'
import { imageTools } from './tools/image.tools.js'
import { intelTools } from './tools/intel.tools.js'
import { memoryTools } from './tools/memory.tools.js'
import { notesTools } from './tools/notes.tools.js'
import { orchestrationTools } from './tools/orchestration.tools.js'
import { outputProfileTools } from './tools/output-profile.tools.js'
import { repositoryTools } from './tools/repository.tools.js'
import { resourcesTools } from './tools/resources.tools.js'
import { scheduleTools } from './tools/schedule.tools.js'
import { skillsTools } from './tools/skills.tools.js'
import { sqlTools } from './tools/sql.tools.js'
import { terminalTools } from './tools/terminal.tools.js'
import { uapisTools } from './tools/uapis.tools.js'
import { wechatDesktopTools } from './tools/wechat-desktop.tools.js'
import { websearchTools } from './tools/websearch.tools.js'
import { wikiTools } from './tools/wiki.tools.js'
import { pkmTools } from './tools/pkm.tools.js'
import { getSettings } from '../settings/settings.service.js'

const TOOL_EXECUTION_TIMEOUT_MS = 120_000

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

const AGENT_TOOLS: AgentTool[] = [
  ...agentRuntimeTools,
  ...calendarTools,
  ...claudeCodeTools,
  ...imageTools,
  ...memoryTools,
  ...outputProfileTools,
  ...repositoryTools,
  ...notesTools,
  ...resourcesTools,
  ...skillsTools,
  ...scheduleTools,
  ...websearchTools,
  ...wikiTools,
  ...pkmTools,
  ...uapisTools,
  ...filesystemTools,
  ...feishuTools,
  ...intelTools,
  ...wechatDesktopTools,
  ...sqlTools,
  ...orchestrationTools,
  ...terminalTools,
]
const TOOL_MAP = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]))

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
    | {
        channel: 'wechat_desktop'
        sessionId: string
        sessionName: string
        sessionType: 'direct' | 'group'
        groupId?: string
        senderName?: string
        mentionedBot?: boolean
        allowTools?: boolean
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

function buildToolDefinition(tool: AgentTool): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
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

function toolTimeoutMessage(name: string, ms: number) {
  return `Tool timed out: ${name} exceeded ${Math.floor(ms / 1000)}s`
}

async function withToolTimeout<T>(
  promise: Promise<T>,
  name: string,
  ms = TOOL_EXECUTION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new HttpError(504, toolTimeoutMessage(name, ms)))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function getAgentToolDefinitions(): LLMToolDefinition[] {
  return AGENT_TOOLS.map((tool) => buildToolDefinition(tool))
}

export function hasAgentTool(name: string) {
  return TOOL_MAP.has(name)
}

export function getAgentToolDefinitionsForNames(names: readonly string[]): LLMToolDefinition[] {
  const seen = new Set<string>()
  const tools: LLMToolDefinition[] = []

  for (const name of names) {
    if (seen.has(name)) continue
    const tool = TOOL_MAP.get(name)
    if (!tool) continue
    seen.add(name)
    tools.push(buildToolDefinition(tool))
  }

  return tools
}

export async function executeToolCall(
  toolCall: LLMToolCall,
  runtimeContext?: AgentToolRuntimeContext,
): Promise<LLMConversationMessage> {
  const settings = await getSettings()
  const fullAccess = settings.agent.fullAccess === true
  const tool = TOOL_MAP.get(toolCall.function.name)

  if (!tool) {
    return buildToolFailureMessage(
      toolCall,
      toolCall.function.name,
      `未找到工具: ${toolCall.function.name}`,
    )
  }

  try {
    const parsedArgs = parseArguments(toolCall.function.arguments)
    const confirmedArgs =
      fullAccess && parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
        ? { ...(parsedArgs as Record<string, unknown>), confirmed: true }
        : parsedArgs
    const args =
      runtimeContext &&
      confirmedArgs &&
      typeof confirmedArgs === 'object' &&
      !Array.isArray(confirmedArgs)
        ? { ...(confirmedArgs as Record<string, unknown>), __runtimeContext: runtimeContext }
        : confirmedArgs
    const result = await withToolTimeout(tool.execute(args), tool.name)

    return {
      role: 'tool',
      toolCallId: toolCall.id,
      name: tool.name,
      content: buildTruncatedResultContent(result),
    }
  } catch (error) {
    const message =
      error instanceof HttpError || error instanceof Error
        ? error.message
        : '工具调用失败'

    return buildToolFailureMessage(toolCall, tool.name, message)
  }
}

/**
 * Execute every tool call from a single assistant turn in parallel.
 *
 * When a model emits multiple tool_calls in one turn it is explicitly
 * signalling that the calls are independent and may be dispatched
 * concurrently (this is OpenAI's documented contract for parallel tool use).
 * `Promise.all` preserves the input order in its results, which we must keep
 * because OpenAI requires the subsequent tool messages to be ordered by
 * `tool_call_id` matching the assistant turn's tool_calls array.
 *
 * Each `executeToolCall` already wraps its body in try/catch and produces a
 * tool message regardless of success or failure, so `Promise.all` cannot
 * reject here.
 */
export async function executeToolCalls(
  toolCalls: LLMToolCall[],
  runtimeContext?: AgentToolRuntimeContext,
): Promise<LLMConversationMessage[]> {
  if (toolCalls.length === 0) return []
  if (toolCalls.length === 1) {
    return [await executeToolCall(toolCalls[0], runtimeContext)]
  }
  return Promise.all(toolCalls.map((toolCall) => executeToolCall(toolCall, runtimeContext)))
}
