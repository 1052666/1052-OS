import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationSettings, Settings } from '../../settings/settings.types.js'

vi.mock('../../settings/settings.service.js', () => ({
  getSettings: vi.fn(),
}))

let tempDir = ''

const baseImageSettings: ImageGenerationSettings = {
  apiFormat: 'openai-compatible',
  baseUrl: 'https://api.minimaxi.com',
  modelId: 'image-01',
  apiKey: 'test-key',
  size: '1024x1536',
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  outputCompression: 80,
}

async function loadService(imageGeneration: ImageGenerationSettings) {
  vi.resetModules()
  const settingsModule = await import('../../settings/settings.service.js')
  vi.mocked(settingsModule.getSettings).mockResolvedValue({
    imageGeneration,
  } as Settings)
  return import('../image-generation.service.js')
}

function stubMiniMaxFetch(expectedUrl: string) {
  const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const requestUrl = String(url)
    if (requestUrl === expectedUrl) {
      return new Response(
        JSON.stringify({
          data: { image_urls: ['https://image.example/generated.jpg'] },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (requestUrl === 'https://image.example/generated.jpg') {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    }

    return new Response('unexpected url: ' + requestUrl, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-image-generation-'))
  process.env.DATA_DIR = tempDir
})

afterEach(async () => {
  delete process.env.DATA_DIR
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('image generation service MiniMax support', () => {
  it('detects MiniMax image endpoints even when baseUrl includes /v1', async () => {
    const service = await loadService({
      ...baseImageSettings,
      baseUrl: 'https://api.minimaxi.com/v1',
    })

    expect(service.isMiniMaxImageProvider('minimax', 'https://api.minimax.com/v1')).toBe(true)
    expect(service.isMiniMaxImageProvider('minimaxi', 'https://api.minimaxi.com/v1')).toBe(true)
  })

  it('uses the MiniMax native image endpoint and persists the downloaded image', async () => {
    const fetchMock = stubMiniMaxFetch('https://api.minimaxi.com/v1/image_generation')
    const service = await loadService(baseImageSettings)

    const result = await service.generateImages({ prompt: '一只猫在窗边看雨', count: 1 })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.minimaxi.com/v1/image_generation')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'image-01',
      prompt: '一只猫在窗边看雨',
      n: 1,
      response_format: 'url',
      aspect_ratio: '2:3',
    })
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatchObject({ format: 'jpeg', sizeBytes: 3 })
    await expect(
      fs.stat(path.join(tempDir, 'generated-images', result.images[0]!.relativePath)),
    ).resolves.toBeTruthy()
  })

  it('does not duplicate /v1 when MiniMax baseUrl already includes it', async () => {
    const fetchMock = stubMiniMaxFetch('https://api.minimaxi.com/v1/image_generation')
    const service = await loadService({
      ...baseImageSettings,
      baseUrl: 'https://api.minimaxi.com/v1',
    })

    await service.generateImages({ prompt: 'minimal logo' })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.minimaxi.com/v1/image_generation')
  })
})
