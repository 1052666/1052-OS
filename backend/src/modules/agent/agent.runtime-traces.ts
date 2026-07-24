import type { AgentStreamEvent } from './agent.runtime.types.js'
import type { StoredRuntimeTrace } from './agent.types.js'

const MAX_STORED_RUNTIME_TRACES = 120

function traceId(event: AgentStreamEvent, timestamp: number) {
  const record = event as Record<string, unknown>
  return `${event.type}:${record.callId ?? record.approvalId ?? record.stage ?? timestamp}:${timestamp}`
}

function eventRecord(event: AgentStreamEvent): Record<string, unknown> {
  return { ...(event as unknown as Record<string, unknown>) }
}

function appendTrace(traces: StoredRuntimeTrace[], trace: StoredRuntimeTrace) {
  return [...traces, trace].slice(-MAX_STORED_RUNTIME_TRACES)
}

function findLastTraceIndex(
  traces: StoredRuntimeTrace[],
  predicate: (trace: StoredRuntimeTrace) => boolean,
) {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    if (predicate(traces[index]!)) return index
  }
  return -1
}

function settleToolTrace(
  traces: StoredRuntimeTrace[],
  event: Extract<AgentStreamEvent, { type: 'tool-finished' }>,
  timestamp: number,
  contentOffset: number,
) {
  const index = event.callId
    ? findLastTraceIndex(traces, (trace) => trace.kind === 'tool' && trace.callId === event.callId)
    : findLastTraceIndex(traces, (trace) => trace.kind === 'tool' && trace.title.includes(event.name))
  const next = [...traces]
  const replacement: StoredRuntimeTrace = {
    id: index >= 0 ? next[index].id : traceId(event, timestamp),
    kind: 'tool',
    title: event.ok ? `${event.name} 已完成` : `${event.name} 执行失败`,
    detail: event.error || event.resultPreview,
    status: event.ok ? 'success' : 'error',
    timestamp,
    contentOffset: index >= 0 ? next[index].contentOffset : contentOffset,
    callId: event.callId,
    raw: eventRecord(event),
  }
  if (index >= 0) next[index] = replacement
  else next.push(replacement)
  return next.slice(-MAX_STORED_RUNTIME_TRACES)
}

export function applyRuntimeTraceEvent(
  traces: StoredRuntimeTrace[] | undefined,
  event: AgentStreamEvent,
  contentOffset: number,
  timestamp = Date.now(),
): StoredRuntimeTrace[] {
  const current = Array.isArray(traces) ? traces : []
  switch (event.type) {
    case 'tool-started':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'tool',
        title: `正在使用 ${event.name}`,
        detail: event.argsPreview,
        status: 'running',
        timestamp,
        contentOffset,
        callId: event.callId,
        raw: eventRecord(event),
      })
    case 'tool-finished':
      return settleToolTrace(current, event, timestamp, contentOffset)
    case 'approval-requested':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'approval',
        title: `${event.name} 等待确认`,
        detail: event.argsPreview,
        status: 'warning',
        timestamp,
        contentOffset,
        callId: event.callId,
        approvalId: event.approvalId,
        expiresAt: event.expiresAt,
        raw: eventRecord(event),
      })
    case 'approval-resolved':
      return current.map((trace) =>
        trace.approvalId === event.approvalId
          ? {
              ...trace,
              title: event.decision === 'approved' ? `${event.name} 已批准` : `${event.name} 未执行`,
              detail: event.decision,
              status: event.decision === 'approved' ? 'success' : 'warning',
              timestamp,
              raw: eventRecord(event),
            }
          : trace,
      )
    case 'context-upgrade-requested':
    case 'context-upgrade-applying':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'context',
        title: '正在扩展上下文',
        detail: 'reason' in event ? event.reason : event.packs.join('、'),
        status: 'running',
        timestamp,
        contentOffset,
        raw: eventRecord(event),
      })
    case 'context-upgrade-applied':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'context',
        title: '上下文已扩展',
        detail: event.packs.join('、'),
        status: 'success',
        timestamp,
        contentOffset,
        raw: eventRecord(event),
      })
    case 'context-upgrade-aborted':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'context',
        title: '上下文扩展已跳过',
        detail: event.stage,
        status: 'warning',
        timestamp,
        contentOffset,
        raw: eventRecord(event),
      })
    case 'conversation-compacted':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'compact',
        title: '上下文已压缩',
        detail: `${event.beforeMessages} -> ${event.afterMessages} 条消息`,
        status: 'success',
        timestamp,
        contentOffset,
        raw: eventRecord(event),
      })
    case 'conversation-compaction-failed':
      return appendTrace(current, {
        id: traceId(event, timestamp),
        kind: 'compact',
        title: '上下文压缩失败',
        detail: event.message,
        status: 'error',
        timestamp,
        contentOffset,
        raw: eventRecord(event),
      })
    default:
      return current
  }
}
