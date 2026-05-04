import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatCompletion,
  chatCompletionStream,
  normalizeUsage,
  normalizeMessagesForMiniMax,
  type LLMConversationMessage,
  type LLMToolDefinition,
} from './llm.client.js'

function streamResponseFromSseChunks(chunks: readonly string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function sseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function consumeStream(
  generator: AsyncGenerator<string, unknown, void>,
): Promise<{ deltas: string[]; result: unknown }> {
  const deltas: string[] = []
  let step = await generator.next()
  while (!step.done) {
    deltas.push(step.value)
    step = await generator.next()
  }
  return { deltas, result: step.value }
}

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

  it('allows local OpenAI-compatible profiles without an API key', async () => {
    const fetchMock = vi.fn(async () => mockChatCompletionResponse())
    vi.stubGlobal('fetch', fetchMock)

    await chatCompletion(
      {
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'llama3.2',
        apiKey: '',
        kind: 'local',
        provider: 'ollama',
      },
      [{ role: 'user', content: 'hello' }],
    )

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]
    const init = calls[0]?.[1]
    expect(init?.headers).not.toHaveProperty('Authorization')
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

describe('chatCompletionStream', () => {
  const baseConfig = {
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4.1-mini',
    apiKey: 'test-key',
  }

  it('emits reasoning chunks wrapped in <think> blocks even when tools are present', async () => {
    // Regression for the red-box bug: reasoning-only stream output used to be
    // silently dropped when the request carried any tools, leaving content
    // and tool_calls both empty and triggering the 502 "未找到有效的回复
    // 内容或工具调用" error in the UI.
    const fetchMock = vi.fn(async () =>
      streamResponseFromSseChunks([
        sseLine({ choices: [{ delta: { reasoning_content: 'thinking step one' } }] }),
        sseLine({ choices: [{ delta: { reasoning_content: ' and step two' } }] }),
        sseLine({ choices: [{ finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const tools: LLMToolDefinition[] = [
      {
        type: 'function',
        function: { name: 'noop', description: 'noop', parameters: {} },
      },
    ]
    const stream = chatCompletionStream(
      baseConfig,
      [{ role: 'user', content: 'hi' }],
      tools,
    )
    const { deltas, result } = await consumeStream(stream)
    const message = result as {
      content: string
      toolCalls: unknown[]
      finishReason?: string
    }

    expect(deltas.join('')).toContain('<think>')
    expect(deltas.join('')).toContain('thinking step one and step two')
    expect(deltas.join('')).toContain('</think>')
    expect(message.content).toContain('<think>')
    expect(message.content).toContain('</think>')
    expect(message.toolCalls).toEqual([])
    expect(message.finishReason).toBe('stop')
  })

  it('merges tool_calls deltas that omit index after the first chunk', async () => {
    // Regression for the legacy bug: when a delta omitted `index`,
    // mergeToolCallDelta used `toolCalls.size` as the fallback, which caused
    // every continuation chunk to spawn a new tool-call entry instead of
    // appending to the in-flight one. Result: malformed JSON arguments.
    const fetchMock = vi.fn(async () =>
      streamResponseFromSseChunks([
        sseLine({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"q":' },
                  },
                ],
              },
            },
          ],
        }),
        // Continuation chunk without index/id — must append to call_abc.
        sseLine({
          choices: [
            { delta: { tool_calls: [{ function: { arguments: '"hello"' } }] } },
          ],
        }),
        sseLine({
          choices: [
            { delta: { tool_calls: [{ function: { arguments: '}' } }] } },
          ],
        }),
        sseLine({ choices: [{ finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const stream = chatCompletionStream(
      baseConfig,
      [{ role: 'user', content: 'lookup hello' }],
      [
        {
          type: 'function',
          function: { name: 'lookup', description: 'lookup', parameters: {} },
        },
      ],
    )
    const { result } = await consumeStream(stream)
    const message = result as {
      toolCalls: { id: string; function: { name: string; arguments: string } }[]
      finishReason?: string
    }

    expect(message.toolCalls).toHaveLength(1)
    expect(message.toolCalls[0]).toMatchObject({
      id: 'call_abc',
      function: { name: 'lookup', arguments: '{"q":"hello"}' },
    })
    expect(message.finishReason).toBe('tool_calls')
  })

  it('keeps two parallel tool_calls separate when emitted in a single delta array', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponseFromSseChunks([
        sseLine({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_a',
                    type: 'function',
                    function: { name: 'foo', arguments: '{"x":' },
                  },
                  {
                    index: 1,
                    id: 'call_b',
                    type: 'function',
                    function: { name: 'bar', arguments: '{"y":' },
                  },
                ],
              },
            },
          ],
        }),
        sseLine({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '1}' } },
                  { index: 1, function: { arguments: '2}' } },
                ],
              },
            },
          ],
        }),
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const stream = chatCompletionStream(
      baseConfig,
      [{ role: 'user', content: 'parallel' }],
      [
        { type: 'function', function: { name: 'foo', description: 'foo', parameters: {} } },
        { type: 'function', function: { name: 'bar', description: 'bar', parameters: {} } },
      ],
    )
    const { result } = await consumeStream(stream)
    const message = result as {
      toolCalls: { id: string; function: { name: string; arguments: string } }[]
    }

    expect(message.toolCalls).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'foo', arguments: '{"x":1}' } },
      { id: 'call_b', type: 'function', function: { name: 'bar', arguments: '{"y":2}' } },
    ])
  })
})
