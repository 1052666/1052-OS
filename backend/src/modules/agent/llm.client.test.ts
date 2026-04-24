import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatCompletion,
  normalizeUsage,
  normalizeMessagesForMiniMax,
  type LLMConversationMessage,
} from './llm.client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('provider prompt caching payload', () => {
  const openAiConfig = {
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4.1-mini',
    apiKey: 'test-key',
  }

  function mockChatCompletionResponse() {
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_tokens_details: {
            cached_tokens: 64,
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  function readFetchBody(fetchMock: ReturnType<typeof vi.fn>) {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  }

  it('adds a stable prompt_cache_key for OpenAI when provider caching is enabled', async () => {
    const fetchMock = vi.fn(async () => mockChatCompletionResponse())
    vi.stubGlobal('fetch', fetchMock)

    const response = await chatCompletion(
      openAiConfig,
      [
        { role: 'system', content: 'Stable system prefix\n\nCheckpoint:\n- dynamic' },
        { role: 'user', content: 'hello' },
      ],
      [],
      { providerCachingEnabled: true },
    )

    const body = readFetchBody(fetchMock)
    expect(body.prompt_cache_key).toMatch(/^1052-[a-f0-9]{32}$/)
    expect(response.usage?.cacheReadTokens).toBe(64)
  })

  it('omits prompt_cache_key when provider caching is disabled', async () => {
    const fetchMock = vi.fn(async () => mockChatCompletionResponse())
    vi.stubGlobal('fetch', fetchMock)

    await chatCompletion(
      openAiConfig,
      [
        { role: 'system', content: 'Stable system prefix' },
        { role: 'user', content: 'hello' },
      ],
      [],
      { providerCachingEnabled: false },
    )

    expect(readFetchBody(fetchMock)).not.toHaveProperty('prompt_cache_key')
  })

  it('retries without prompt_cache_key when a compatible gateway rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('unknown parameter: prompt_cache_key', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(mockChatCompletionResponse())
    vi.stubGlobal('fetch', fetchMock)

    await chatCompletion(
      openAiConfig,
      [
        { role: 'system', content: 'Stable system prefix' },
        { role: 'user', content: 'hello' },
      ],
      [],
      { providerCachingEnabled: true },
    )

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<
      string,
      unknown
    >
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}')) as Record<
      string,
      unknown
    >
    expect(firstBody).toHaveProperty('prompt_cache_key')
    expect(secondBody).not.toHaveProperty('prompt_cache_key')
  })

  it('normalizes nested cached token usage fields', () => {
    expect(
      normalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 32 },
      }),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cacheReadTokens: 32,
    })
  })
})
