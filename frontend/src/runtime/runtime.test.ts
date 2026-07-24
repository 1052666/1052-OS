import { describe, expect, it } from 'vitest'
import { initialRuntimeState, runtimeReducer } from './runtime'

describe('runtimeReducer', () => {
  it('builds a readable tool lifecycle', () => {
    let state = runtimeReducer(initialRuntimeState, { type: 'start', timestamp: 1 })
    state = runtimeReducer(state, {
      type: 'event',
      timestamp: 2,
      event: { type: 'delta', content: '我先检查一下。\n\n' },
    })
    state = runtimeReducer(state, {
      type: 'event',
      timestamp: 2,
      event: { type: 'tool-started', name: 'terminal_exec', callId: 'call-1', argsPreview: 'pwd' },
    })
    state = runtimeReducer(state, {
      type: 'event',
      timestamp: 3,
      event: { type: 'tool-finished', name: 'terminal_exec', callId: 'call-1', ok: true, resultPreview: '/repo' },
    })
    expect(state.traces.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'success',
      callId: 'call-1',
      contentOffset: '我先检查一下。\n\n'.length,
    })
  })

  it('enters and leaves approval state', () => {
    let state = runtimeReducer(initialRuntimeState, { type: 'start', timestamp: 1 })
    state = runtimeReducer(state, {
      type: 'event',
      timestamp: 2,
      event: { type: 'approval-requested', approvalId: 'a1', callId: 'c1', name: 'write_file', expiresAt: 9 },
    })
    expect(state.status).toBe('waiting-approval')
    state = runtimeReducer(state, {
      type: 'event',
      timestamp: 3,
      event: { type: 'approval-resolved', approvalId: 'a1', callId: 'c1', name: 'write_file', decision: 'approved' },
    })
    expect(state.status).toBe('running')
    expect(state.traces.at(-1)?.status).toBe('success')
  })

  it('collects deltas and usage', () => {
    let state = runtimeReducer(initialRuntimeState, { type: 'start', timestamp: 1 })
    state = runtimeReducer(state, { type: 'event', event: { type: 'delta', content: '你好' } })
    state = runtimeReducer(state, { type: 'event', event: { type: 'usage', usage: { totalTokens: 42 } } })
    expect(state.assistantText).toBe('你好')
    expect(state.usage?.totalTokens).toBe(42)
  })

  it('renders automatic compaction metadata', () => {
    const state = runtimeReducer(initialRuntimeState, {
      type: 'event',
      timestamp: 4,
      event: {
        type: 'conversation-compacted',
        beforeMessages: 170,
        afterMessages: 42,
        beforeTokens: 82_000,
        afterTokens: 18_000,
        reason: 'token-limit',
        strategy: 'summary-checkpoint',
        windowNumber: 2,
      },
    })

    expect(state.traces.at(-1)).toMatchObject({
      kind: 'compact',
      status: 'success',
      title: '对话上下文已压缩',
    })
    expect(state.traces.at(-1)?.detail).toContain('82,000 -> 18,000 tokens')
    expect(state.traces.at(-1)?.detail).toContain('窗口 2')
  })
})
