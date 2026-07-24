import { describe, expect, it } from 'vitest'
import { applyRuntimeTraceEvent } from './agent.runtime-traces.js'

describe('agent runtime traces', () => {
  it('keeps the original content offset when a tool trace finishes', () => {
    const started = applyRuntimeTraceEvent(
      undefined,
      {
        type: 'tool-started',
        name: 'memory_search',
        callId: 'call-1',
        argsPreview: '{"query":"长期记忆"}',
      },
      12,
      1000,
    )

    const finished = applyRuntimeTraceEvent(
      started,
      {
        type: 'tool-finished',
        name: 'memory_search',
        callId: 'call-1',
        ok: true,
        resultPreview: '3 records',
      },
      48,
      2000,
    )

    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({
      kind: 'tool',
      status: 'success',
      contentOffset: 12,
      callId: 'call-1',
    })
  })
})
