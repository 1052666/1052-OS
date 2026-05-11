// Parity test: assert the ChatMessage[] payload produced by toChatMessages
// (pure helper exported from useChatModel) matches the payload shape Chat.tsx
// historically sent to AgentApi.chat / AgentApi.chatStream.
//
// Why this lives in pages/ (not hooks/): it documents the page-level send
// contract. If a future refactor bypasses the hook and constructs payloads
// directly, this test catches the divergence.
//
// Why this targets toChatMessages (not the hook): the payload is a pure
// function of inputs. Asserting on the pure helper keeps the contract test
// free of React renderer churn.
import { describe, expect, it } from 'vitest'
import { toChatMessages, type Msg } from '../hooks/useChatModel'
import { makeMessage } from '../test-utils/chat-fixtures'

describe('chat-page parity: toChatMessages payload shape', () => {
  it('case 1 — emits user + assistant pairs in order, stripping the in-flight assistant id', () => {
    const messages: Msg[] = [
      makeMessage({ id: 1, role: 'user', content: 'hi' }),
      makeMessage({ id: 2, role: 'assistant', content: 'hello' }),
      makeMessage({ id: 3, role: 'user', content: 'how are you?' }),
      // The currently-streaming assistant draft — must be excluded.
      makeMessage({ id: 4, role: 'assistant', content: '', streaming: true }),
    ]

    const payload = toChatMessages(messages, 4)
    expect(payload).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you?' },
    ])
  })

  it('case 2 — filters out messages flagged as error or streaming', () => {
    const messages: Msg[] = [
      makeMessage({ id: 1, role: 'user', content: 'ok' }),
      makeMessage({ id: 2, role: 'assistant', content: 'broken', error: true }),
      makeMessage({ id: 3, role: 'assistant', content: 'live', streaming: true }),
      makeMessage({ id: 4, role: 'user', content: 'next' }),
    ]

    const payload = toChatMessages(messages)
    expect(payload.map((m) => m.content)).toEqual(['ok', 'next'])
  })

  it('case 3 — strips <think> blocks (both closed and unterminated) from content', () => {
    const messages: Msg[] = [
      makeMessage({
        id: 1,
        role: 'assistant',
        content: '<think>internal reasoning</think>visible answer',
      }),
      makeMessage({
        id: 2,
        role: 'assistant',
        content: 'before <think>mid-stream open',
      }),
    ]

    const payload = toChatMessages(messages)
    expect(payload[0].content).toBe('visible answer')
    // Unterminated <think> truncates to whatever preceded it.
    expect(payload[1].content).toBe('before')
  })

  it('case 4 — appends compactSummary after main content with newline separator', () => {
    const messages: Msg[] = [
      makeMessage({
        id: 1,
        role: 'assistant',
        content: 'visible body',
        compactSummary: 'condensed history',
      }),
    ]

    const payload = toChatMessages(messages)
    expect(payload).toEqual([
      { role: 'assistant', content: 'visible body\n\ncondensed history' },
    ])
  })

  it('case 5 — falls back to compactSummary alone when main content is empty', () => {
    const messages: Msg[] = [
      makeMessage({
        id: 1,
        role: 'assistant',
        content: '',
        compactSummary: 'only summary',
      }),
    ]

    const payload = toChatMessages(messages)
    expect(payload).toEqual([{ role: 'assistant', content: 'only summary' }])
  })

  it('case 6 — drops messages whose final content is empty after trim', () => {
    const messages: Msg[] = [
      makeMessage({ id: 1, role: 'user', content: '   ' }),
      makeMessage({ id: 2, role: 'assistant', content: '<think>only thought</think>' }),
      makeMessage({ id: 3, role: 'user', content: 'kept' }),
    ]

    const payload = toChatMessages(messages)
    expect(payload).toEqual([{ role: 'user', content: 'kept' }])
  })

  it('case 7 — output shape contains exactly { role, content } per message (no usage / ids leak)', () => {
    const messages: Msg[] = [
      makeMessage({
        id: 1,
        role: 'assistant',
        content: 'answer',
        usage: { totalTokens: 42 },
      }),
    ]

    const payload = toChatMessages(messages)
    expect(Object.keys(payload[0]).sort()).toEqual(['content', 'role'])
  })
})
