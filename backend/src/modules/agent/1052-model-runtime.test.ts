import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../http-error.js'
import {
  sampleRuntime1052Model,
  type Runtime1052ModelStreamFactory,
} from './1052-model-runtime.js'

const request = {
  llm: { baseUrl: 'https://example.test', modelId: 'model', apiKey: 'key' },
  messages: [{ role: 'user' as const, content: 'hello' }],
  tools: [],
}

async function collect(stream: ReturnType<typeof sampleRuntime1052Model>) {
  const deltas: string[] = []
  let item = await stream.next()
  while (!item.done) {
    deltas.push(item.value)
    item = await stream.next()
  }
  return { deltas, response: item.value }
}

describe('1052 model runtime', () => {
  it('returns streamed deltas and the completed model response', async () => {
    const stream = (() =>
      (async function* () {
        yield 'hello '
        yield 'world'
        return {
          role: 'assistant' as const,
          content: 'hello world',
          toolCalls: [],
          finishReason: 'stop',
        }
      })()) as Runtime1052ModelStreamFactory

    const result = await collect(sampleRuntime1052Model(request, { stream }))

    expect(result.deltas).toEqual(['hello ', 'world'])
    expect(result.response.content).toBe('hello world')
  })

  it('retries transient failures only before visible output is emitted', async () => {
    let attempt = 0
    const sleep = vi.fn(async () => undefined)
    const stream = (() => {
      attempt += 1
      return (async function* () {
        if (attempt === 1) throw new HttpError(502, 'temporary gateway failure')
        return {
          role: 'assistant' as const,
          content: 'recovered',
          toolCalls: [],
          finishReason: 'stop',
        }
      })()
    }) as Runtime1052ModelStreamFactory

    const result = await collect(sampleRuntime1052Model(request, { stream, sleep }))

    expect(attempt).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(result.response.content).toBe('recovered')
  })

  it('does not retry a failed stream after user-visible output', async () => {
    let attempt = 0
    const stream = (() => {
      attempt += 1
      return (async function* () {
        yield 'partial'
        throw new HttpError(502, 'stream broke')
      })()
    }) as Runtime1052ModelStreamFactory

    await expect(collect(sampleRuntime1052Model(request, { stream }))).rejects.toThrow(
      'stream broke',
    )
    expect(attempt).toBe(1)
  })
})
