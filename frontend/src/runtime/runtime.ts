import { runtimeEventSchema, type RuntimeEventPayload, type TokenUsage } from '../contracts/schemas'
import { ApiFault } from '../data/client'

export type RuntimeStatus = 'idle' | 'running' | 'waiting-approval' | 'completed' | 'cancelled' | 'error'

export type RuntimeTrace = {
  id: string
  kind: 'turn' | 'step' | 'tool' | 'approval' | 'context' | 'compact' | 'system'
  title: string
  detail?: string
  status: 'running' | 'success' | 'warning' | 'error' | 'neutral'
  timestamp: number
  contentOffset?: number
  callId?: string
  approvalId?: string
  expiresAt?: number
  raw?: RuntimeEventPayload
}

export type RuntimeState = {
  status: RuntimeStatus
  assistantText: string
  traces: RuntimeTrace[]
  usage?: TokenUsage
  mountedPacks: string[]
  startedAt?: number
  finishedAt?: number
  error?: string
}

export type RuntimeAction =
  | { type: 'start'; timestamp?: number }
  | { type: 'event'; event: RuntimeEventPayload; timestamp?: number }
  | { type: 'cancel'; timestamp?: number }
  | { type: 'fail'; message: string; timestamp?: number }
  | { type: 'reset' }

export const initialRuntimeState: RuntimeState = {
  status: 'idle',
  assistantText: '',
  traces: [],
  mountedPacks: [],
}

function traceId(event: RuntimeEventPayload, timestamp: number) {
  return `${event.type}:${event.callId ?? event.approvalId ?? event.step ?? timestamp}:${timestamp}`
}

function addTrace(state: RuntimeState, trace: RuntimeTrace) {
  return { ...state, traces: [...state.traces, trace].slice(-160) }
}

function formatNumber(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN')
    : undefined
}

function compactDetail(event: RuntimeEventPayload) {
  return [
    event.reason === 'token-limit'
      ? '达到 token 自动线'
      : event.reason === 'message-window'
        ? '消息窗口过长'
        : event.reason === 'model-error'
          ? '摘要失败后保留尾部'
          : undefined,
    event.beforeTokens !== undefined && event.afterTokens !== undefined
      ? `${formatNumber(event.beforeTokens)} -> ${formatNumber(event.afterTokens)} tokens`
      : undefined,
    event.beforeMessages !== undefined && event.afterMessages !== undefined
      ? `${event.beforeMessages} -> ${event.afterMessages} 条消息`
      : undefined,
    event.windowNumber !== undefined ? `窗口 ${event.windowNumber}` : undefined,
  ].filter(Boolean).join(' · ')
}

function settleTool(traces: RuntimeTrace[], event: RuntimeEventPayload, timestamp: number, contentOffset: number) {
  const index = event.callId
    ? traces.findLastIndex((trace) => trace.callId === event.callId && trace.kind === 'tool')
    : traces.findLastIndex((trace) => trace.kind === 'tool' && trace.title.includes(event.name ?? ''))
  const next = [...traces]
  const replacement: RuntimeTrace = {
    id: index >= 0 ? next[index].id : traceId(event, timestamp),
    kind: 'tool',
    title: event.ok ? `${event.name ?? '工具'} 已完成` : `${event.name ?? '工具'} 执行失败`,
    detail: event.error || event.resultPreview || event.resultContent,
    status: event.ok ? 'success' : 'error',
    timestamp,
    contentOffset: index >= 0 ? next[index].contentOffset : contentOffset,
    callId: event.callId,
    raw: event,
  }
  if (index >= 0) next[index] = replacement
  else next.push(replacement)
  return next.slice(-160)
}

export function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  const timestamp = 'timestamp' in action && action.timestamp ? action.timestamp : Date.now()
  if (action.type === 'reset') return initialRuntimeState
  if (action.type === 'start') {
    return {
      status: 'running',
      assistantText: '',
      traces: [{ id: `turn:${timestamp}`, kind: 'turn', title: '开始处理', status: 'running', timestamp }],
      mountedPacks: [],
      startedAt: timestamp,
    }
  }
  if (action.type === 'cancel') {
    return addTrace(
      { ...state, status: 'cancelled', finishedAt: timestamp },
      { id: `cancel:${timestamp}`, kind: 'system', title: '已停止本轮运行', status: 'warning', timestamp },
    )
  }
  if (action.type === 'fail') {
    return addTrace(
      { ...state, status: 'error', error: action.message, finishedAt: timestamp },
      { id: `error:${timestamp}`, kind: 'system', title: '运行失败', detail: action.message, status: 'error', timestamp },
    )
  }

  const event = action.event
  switch (event.type) {
    case 'delta':
    case 'assistant-delta':
      return { ...state, assistantText: state.assistantText + (event.content ?? '') }
    case 'usage':
    case 'usage-recorded':
      return event.usage ? { ...state, usage: event.usage } : state
    case 'turn-started':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'turn',
        title: 'Runtime 已接管请求',
        status: 'running',
        timestamp,
        raw: event,
      })
    case 'step-started':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'step',
        title: `执行步骤 ${event.step ?? state.traces.filter((item) => item.kind === 'step').length + 1}`,
        detail: event.mode === 'full-toolbox' ? '已加载完整工具集' : '渐进加载能力',
        status: 'running',
        timestamp,
        raw: event,
      })
    case 'tool-started':
    case 'tool-call-started':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'tool',
        title: `正在使用 ${event.name ?? '工具'}`,
        detail: event.argsPreview,
        status: 'running',
        timestamp,
        contentOffset: state.assistantText.length,
        callId: event.callId,
        raw: event,
      })
    case 'tool-finished':
    case 'tool-call-finished':
      return { ...state, traces: settleTool(state.traces, event, timestamp, state.assistantText.length) }
    case 'approval-requested':
      return addTrace(
        { ...state, status: 'waiting-approval' },
        {
          id: traceId(event, timestamp),
          kind: 'approval',
          title: `${event.name ?? '操作'} 等待确认`,
          detail: event.argsPreview,
          status: 'warning',
          timestamp,
          contentOffset: state.assistantText.length,
          callId: event.callId,
          approvalId: event.approvalId,
          expiresAt: event.expiresAt,
          raw: event,
        },
      )
    case 'approval-resolved': {
      const traces = state.traces.map((trace) =>
        trace.approvalId === event.approvalId
          ? {
              ...trace,
              title: event.decision === 'approved' ? `${event.name ?? '操作'} 已批准` : `${event.name ?? '操作'} 未执行`,
              status: event.decision === 'approved' ? ('success' as const) : ('warning' as const),
              detail: event.decision,
              raw: event,
            }
          : trace,
      )
      return { ...state, status: 'running', traces }
    }
    case 'context-upgrade-requested':
    case 'context-upgrade-applying':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'context',
        title: '正在扩展上下文',
        detail: event.packs?.join('、') || event.reason,
        status: 'running',
        timestamp,
        contentOffset: state.assistantText.length,
        raw: event,
      })
    case 'context-upgrade-applied':
      return addTrace(
        { ...state, mountedPacks: Array.from(new Set([...state.mountedPacks, ...(event.packs ?? [])])) },
        {
          id: traceId(event, timestamp),
          kind: 'context',
          title: '上下文已扩展',
          detail: event.packs?.join('、'),
          status: 'success',
          timestamp,
          contentOffset: state.assistantText.length,
          raw: event,
        },
      )
    case 'context-upgrade-aborted':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'context',
        title: '上下文扩展已停止',
        detail: event.stage,
        status: 'warning',
        timestamp,
        contentOffset: state.assistantText.length,
        raw: event,
      })
    case 'conversation-compacted':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'compact',
        title: event.fallback ? '对话上下文已整理' : '对话上下文已压缩',
        detail: compactDetail(event),
        status: event.fallback ? 'warning' : 'success',
        timestamp,
        contentOffset: state.assistantText.length,
        raw: event,
      })
    case 'conversation-compaction-failed':
      return addTrace(state, {
        id: traceId(event, timestamp),
        kind: 'compact',
        title: '上下文压缩改用兜底',
        detail: event.message,
        status: 'warning',
        timestamp,
        contentOffset: state.assistantText.length,
        raw: event,
      })
    case 'turn-completed':
    case 'done':
      return addTrace(
        { ...state, status: 'completed', finishedAt: timestamp },
        { id: traceId(event, timestamp), kind: 'turn', title: '本轮处理完成', status: 'success', timestamp, raw: event },
      )
    case 'turn-aborted':
      return runtimeReducer(state, { type: 'cancel', timestamp })
    case 'model-error':
    case 'error':
      return runtimeReducer(state, { type: 'fail', message: event.message || event.error || '模型运行失败', timestamp })
    default:
      return state
  }
}

type StreamInput = {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  signal?: AbortSignal
  onEvent: (event: RuntimeEventPayload) => void
}

function parseEventBlock(block: string, onEvent: (event: RuntimeEventPayload) => void) {
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw) continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    const parsed = runtimeEventSchema.safeParse(value)
    if (parsed.success) onEvent(parsed.data)
  }
}

export async function streamChat({ messages, signal, onEvent }: StreamInput) {
  let response: Response
  try {
    response = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiFault(0, error instanceof Error ? error.message : '无法连接到 Runtime')
  }
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    let message = body || response.statusText
    try {
      const parsed = JSON.parse(body) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      // Keep plain-text body.
    }
    throw new ApiFault(response.status, message || `Runtime 请求失败 (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false
  try {
    while (!terminal) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        parseEventBlock(block, (event) => {
          if (event.type === 'done' || event.type === 'error' || event.type === 'turn-completed') terminal = true
          onEvent(event)
        })
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) parseEventBlock(buffer, onEvent)
  } finally {
    reader.releaseLock()
  }
}
