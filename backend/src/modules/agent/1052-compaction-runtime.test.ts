import { describe, expect, it, vi } from 'vitest'
import {
  compactRuntime1052Conversation,
  type Runtime1052CompactionSummarizer,
} from './1052-compaction-runtime.js'
import type { Runtime1052SessionState } from './1052-context-runtime.js'
import type { LLMConversationMessage } from './llm.client.js'

function conversation(count: number): LLMConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index + 1}`,
  }))
}

function tokenHeavyConversation(count: number): LLMConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index + 1} ${'token-heavy context '.repeat(700)}`,
  }))
}

function state(messages: LLMConversationMessage[], enabled = true): Runtime1052SessionState {
  return {
    conversation: messages,
    options: {},
    settings: {
      agent: {
        autoCompactEnabled: enabled,
        autoCompactThreshold: 20_000,
      },
    },
  } as unknown as Runtime1052SessionState
}

describe('1052 compaction runtime', () => {
  it('replaces long history with recent user messages and a continuation summary', async () => {
    const runtimeState = state(tokenHeavyConversation(20))
    const summarize = vi.fn<Runtime1052CompactionSummarizer>(async () => ({
      summary: 'Goal, completed work, and next action are preserved.',
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    }))

    const result = await compactRuntime1052Conversation(runtimeState, { summarize })

    expect(result).toMatchObject({
      compacted: true,
      fallback: false,
      beforeMessages: 20,
      reason: 'token-limit',
      strategy: 'summary-checkpoint',
      windowNumber: 1,
    })
    expect(result.afterMessages).toBeLessThan(result.beforeMessages)
    expect(result.usage?.totalTokens).toBeGreaterThanOrEqual(50)
    expect(runtimeState.conversation.at(-1)).toMatchObject({ role: 'user' })
    expect(runtimeState.conversation.at(-1)?.content).toContain(
      '[1052 compacted conversation summary]',
    )
    expect(runtimeState.conversation.at(-1)?.content).toContain('next action')
  })

  it('falls back to a bounded valid tail when summarization fails', async () => {
    const runtimeState = state(tokenHeavyConversation(24))
    const summarize: Runtime1052CompactionSummarizer = async () => {
      throw new Error('summary provider unavailable')
    }

    const result = await compactRuntime1052Conversation(runtimeState, { summarize })

    expect(result).toMatchObject({
      compacted: true,
      fallback: true,
      beforeMessages: 24,
      error: 'summary provider unavailable',
    })
    expect(runtimeState.conversation.length).toBeLessThanOrEqual(60)
  })

  it('does not call the compaction model below the configured threshold', async () => {
    const runtimeState = state(conversation(12))
    const summarize = vi.fn<Runtime1052CompactionSummarizer>()

    const result = await compactRuntime1052Conversation(runtimeState, { summarize })

    expect(result.compacted).toBe(false)
    expect(summarize).not.toHaveBeenCalled()
    expect(runtimeState.conversation).toHaveLength(12)
  })

  it('compacts when the automatic message window is exceeded', async () => {
    const runtimeState = state(conversation(170))
    const summarize = vi.fn<Runtime1052CompactionSummarizer>(async () => ({
      summary: 'Window checkpoint summary.',
    }))

    const result = await compactRuntime1052Conversation(runtimeState, { summarize })

    expect(result).toMatchObject({
      compacted: true,
      fallback: false,
      beforeMessages: 170,
      reason: 'message-window',
    })
    expect(summarize).toHaveBeenCalled()
    expect(runtimeState.conversation.length).toBeLessThan(170)
  })
})
