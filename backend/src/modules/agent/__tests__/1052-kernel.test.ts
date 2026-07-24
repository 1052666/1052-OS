import { describe, expect, it, vi } from 'vitest'
import {
  agentEventFromRuntime1052Event,
  createRuntime1052TurnInput,
  runRuntime1052Loop,
  runtime1052EventFromAgentEvent,
  shouldExposeRuntime1052Event,
  type Runtime1052LoopDriver,
} from '../1052-kernel.js'
import type { Runtime1052SessionState } from '../1052-context-runtime.js'
import type { Runtime1052Event } from '../1052-kernel.types.js'

async function collect(
  stream: AsyncGenerator<Runtime1052Event, unknown, void>,
) {
  const events: Runtime1052Event[] = []
  let item = await stream.next()
  while (!item.done) {
    events.push(item.value)
    item = await stream.next()
  }
  return { events, result: item.value }
}

function createState(): Runtime1052SessionState {
  return {
    turn: {
      turnId: 'turn-1',
      history: [{ role: 'user', content: 'go' }],
      source: { channel: 'web' },
    },
    options: { maxSteps: 4 },
    mode: 'progressive',
    conversation: [{ role: 'user', content: 'go' }],
    mountedPacks: [],
    usage: {},
  } as unknown as Runtime1052SessionState
}

describe('1052 runtime kernel adapter', () => {
  it('creates a 1052 turn for web requests by default', () => {
    const turn = createRuntime1052TurnInput([{ role: 'user', content: 'hello' }])

    expect(turn.turnId).toMatch(/^turn-/)
    expect(turn.source).toEqual({ channel: 'web' })
    expect(turn.history).toHaveLength(1)
  })

  it('maps legacy agent stream events into 1052 runtime events and back', () => {
    const started = runtime1052EventFromAgentEvent('turn-1', {
      type: 'tool-started',
      name: 'terminal_run',
      callId: 'call-1',
      argsPreview: 'command="npm test"',
      dangerous: true,
    })

    expect(started).toMatchObject({
      type: 'tool-call-started',
      turnId: 'turn-1',
      name: 'terminal_run',
      callId: 'call-1',
      dangerous: true,
    })

    expect(agentEventFromRuntime1052Event(started!)).toMatchObject({
      type: 'tool-started',
      name: 'terminal_run',
      callId: 'call-1',
      dangerous: true,
    })

    const compacted = runtime1052EventFromAgentEvent('turn-1', {
      type: 'conversation-compacted',
      beforeMessages: 170,
      afterMessages: 42,
      beforeTokens: 82_000,
      afterTokens: 18_000,
      reason: 'token-limit',
      strategy: 'summary-checkpoint',
      windowNumber: 2,
      windowId: 'window-2',
    })

    expect(compacted).toMatchObject({
      type: 'conversation-compacted',
      turnId: 'turn-1',
      reason: 'token-limit',
      strategy: 'summary-checkpoint',
      windowNumber: 2,
    })
    expect(agentEventFromRuntime1052Event(compacted!)).toMatchObject({
      type: 'conversation-compacted',
      beforeMessages: 170,
      afterMessages: 42,
      windowId: 'window-2',
    })
  })

  it('keeps upgrade events in the runtime only when debug streaming is enabled', () => {
    const event: Runtime1052Event = {
      type: 'context-upgrade-applied',
      turnId: 'turn-1',
      packs: ['repo-pack'],
    }

    expect(shouldExposeRuntime1052Event(event, false)).toBe(false)
    expect(shouldExposeRuntime1052Event(event, true)).toBe(true)
    expect(
      shouldExposeRuntime1052Event(
        { type: 'assistant-delta', turnId: 'turn-1', content: 'visible' },
        false,
      ),
    ).toBe(true)
  })

  it('finishes a native 1052 loop when the model no longer needs follow-up', async () => {
    const complete = vi.fn(async () => undefined)
    const driver: Runtime1052LoopDriver = {
      prepareStep: async () => ({
        messages: [],
        tools: [],
        mountedPacks: [],
        budgetTokens: 10,
        budgetLimitTokens: 100,
      }),
      async *sampleStep() {
        yield 'done'
        return {
          role: 'assistant',
          content: 'done',
          toolCalls: [],
          usage: { totalTokens: 12 },
          finishReason: 'stop',
        }
      },
      async *routeToolCalls() {
        return []
      },
      applyContextUpgrade: async () => {
        throw new Error('not expected')
      },
      recordToolResults: async () => undefined,
      complete,
    }

    const { events, result } = await collect(runRuntime1052Loop(createState(), driver))

    expect(events.map((event) => event.type)).toEqual([
      'step-started',
      'assistant-delta',
      'model-response',
      'usage-recorded',
    ])
    expect(result).toMatchObject({ status: 'completed', steps: 1 })
    expect(complete).toHaveBeenCalledWith(expect.anything(), 'done')
  })

  it('feeds tool output back into the next native model step', async () => {
    let sampleCount = 0
    const driver: Runtime1052LoopDriver = {
      prepareStep: async () => ({
        messages: [],
        tools: [],
        mountedPacks: ['base-read-pack'],
        budgetTokens: 10,
        budgetLimitTokens: 100,
      }),
      async *sampleStep() {
        sampleCount += 1
        if (sampleCount === 1) {
          return {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'filesystem_read_file', arguments: '{"path":"a.txt"}' },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          role: 'assistant',
          content: 'finished after tool',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
      async *routeToolCalls() {
        yield {
          type: 'tool-call-started',
          turnId: 'turn-1',
          name: 'filesystem_read_file',
          callId: 'call-1',
        }
        yield {
          type: 'tool-call-finished',
          turnId: 'turn-1',
          name: 'filesystem_read_file',
          callId: 'call-1',
          ok: true,
        }
        return [
          {
            role: 'tool',
            toolCallId: 'call-1',
            name: 'filesystem_read_file',
            content: '{"ok":true,"data":"file"}',
          },
        ]
      },
      applyContextUpgrade: async () => {
        throw new Error('not expected')
      },
      recordToolResults: async () => undefined,
      complete: async () => undefined,
    }
    const state = createState()

    const { events, result } = await collect(runRuntime1052Loop(state, driver))

    expect(sampleCount).toBe(2)
    expect(events.filter((event) => event.type === 'step-started')).toHaveLength(2)
    expect(events.map((event) => event.type)).toContain('tool-call-finished')
    expect(state.conversation.some((message) => message.role === 'tool')).toBe(true)
    expect(result).toMatchObject({ status: 'completed', steps: 2 })
  })

  it('does not enforce a wall-clock turn limit by default', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(0).mockReturnValue(60 * 60_000)

    const driver: Runtime1052LoopDriver = {
      prepareStep: async () => ({
        messages: [],
        tools: [],
        mountedPacks: [],
        budgetTokens: 10,
        budgetLimitTokens: 100,
      }),
      async *sampleStep() {
        return {
          role: 'assistant',
          content: 'still completes',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
      async *routeToolCalls() {
        return []
      },
      applyContextUpgrade: async () => {
        throw new Error('not expected')
      },
      recordToolResults: async () => undefined,
      complete: async () => undefined,
    }

    try {
      const { result } = await collect(runRuntime1052Loop(createState(), driver))

      expect(result).toMatchObject({ status: 'completed', steps: 1 })
    } finally {
      now.mockRestore()
    }
  })

  it('honors an explicit wall-clock turn limit when provided', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(0).mockReturnValue(2_000)
    const state = createState()
    state.options.maxDurationMs = 1_000
    const prepareStep = vi.fn(async () => ({
      messages: [],
      tools: [],
      mountedPacks: [],
      budgetTokens: 10,
      budgetLimitTokens: 100,
    }))

    const driver: Runtime1052LoopDriver = {
      prepareStep,
      async *sampleStep() {
        throw new Error('not expected')
      },
      async *routeToolCalls() {
        return []
      },
      applyContextUpgrade: async () => {
        throw new Error('not expected')
      },
      recordToolResults: async () => undefined,
      complete: async () => undefined,
    }

    try {
      const { events, result } = await collect(runRuntime1052Loop(state, driver))

      expect(result).toMatchObject({ status: 'time-limit', steps: 0 })
      expect(events.map((event) => event.type)).toEqual(['assistant-delta', 'usage-recorded'])
      expect(prepareStep).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
    }
  })
})
