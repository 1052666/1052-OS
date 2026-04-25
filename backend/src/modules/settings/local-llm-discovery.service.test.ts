import { describe, expect, it, vi } from 'vitest'
import { discoverLocalModels } from './local-llm-discovery.service.js'

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('local llm discovery', () => {
  it('discovers Ollama and OpenAI-compatible local model endpoints', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'http://127.0.0.1:11434/api/tags') {
        return jsonResponse({ models: [{ name: 'llama3.2' }] })
      }
      if (url === 'http://127.0.0.1:1234/v1/models') {
        return jsonResponse({ data: [{ id: 'qwen2.5-coder' }] })
      }
      throw new Error('offline')
    })

    const result = await discoverLocalModels({ fetchImpl })

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'local',
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          modelId: 'llama3.2',
        }),
        expect.objectContaining({
          kind: 'local',
          provider: 'lm-studio',
          baseUrl: 'http://127.0.0.1:1234/v1',
          modelId: 'qwen2.5-coder',
        }),
      ]),
    )
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
