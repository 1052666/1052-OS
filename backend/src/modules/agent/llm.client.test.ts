import { describe, expect, it } from 'vitest'
import {
  normalizeMessagesForMiniMax,
  type LLMConversationMessage,
} from './llm.client.js'

describe('normalizeMessagesForMiniMax', () => {
  it('merges multiple system messages into a single system prefix', () => {
    const messages: LLMConversationMessage[] = [
      { role: 'system', content: 'System A' },
      { role: 'system', content: 'System B' },
      { role: 'user', content: 'User asks' },
      { role: 'assistant', content: 'Assistant answers' },
    ]

    expect(normalizeMessagesForMiniMax(messages)).toEqual([
      { role: 'system', content: 'System A\n\nSystem B' },
      { role: 'user', content: 'User asks' },
      { role: 'assistant', content: 'Assistant answers' },
    ])
  })

  it('keeps the original message list when system message count is already compatible', () => {
    const messages: LLMConversationMessage[] = [
      { role: 'system', content: 'System A' },
      { role: 'user', content: 'User asks' },
    ]

    expect(normalizeMessagesForMiniMax(messages)).toBe(messages)
  })
})
