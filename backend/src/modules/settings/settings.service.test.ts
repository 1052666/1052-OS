import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-settings-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('settings llm profiles', () => {
  it('migrates legacy llm config into an active cloud profile', async () => {
    await fs.writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({
        llm: {
          baseUrl: 'https://api.openai.com/v1',
          modelId: 'gpt-4.1-mini',
          apiKey: 'cloud-key',
        },
      }),
      'utf-8',
    )

    const service = await import('./settings.service.js')
    const settings = await service.getSettings()
    const publicSettings = await service.getPublicSettings()

    expect(settings.llm.activeProfileId).toBeTruthy()
    expect(settings.llm.profiles).toHaveLength(1)
    expect(settings.llm.profiles[0]).toMatchObject({
      kind: 'cloud',
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4.1-mini',
      apiKey: 'cloud-key',
    })
    expect(publicSettings.llm.profiles[0].hasApiKey).toBe(true)
    expect('apiKey' in (publicSettings.llm.profiles[0] as Record<string, unknown>)).toBe(false)
  })

  it('can save and activate a local profile without leaking a cloud api key', async () => {
    const service = await import('./settings.service.js')

    await service.updateSettings({
      llm: {
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4.1-mini',
        apiKey: 'cloud-key',
      },
    })
    await service.upsertLlmProfile(
      {
        id: 'ollama-llama3',
        name: 'Ollama llama3',
        kind: 'local',
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'llama3',
        enabled: true,
      },
      { activate: true },
    )

    const settings = await service.getSettings()

    expect(settings.llm.activeProfileId).toBe('ollama-llama3')
    expect(settings.llm.kind).toBe('local')
    expect(settings.llm.provider).toBe('ollama')
    expect(settings.llm.modelId).toBe('llama3')
    expect(settings.llm.apiKey).toBe('')
  })

  it('resolves task routes before falling back to the active profile', async () => {
    const service = await import('./settings.service.js')

    await service.upsertLlmProfile(
      {
        id: 'cloud-default',
        name: 'Cloud default',
        kind: 'cloud',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4.1-mini',
        apiKey: 'cloud-key',
        enabled: true,
      },
      { activate: true },
    )
    await service.upsertLlmProfile({
      id: 'local-pdf',
      name: 'Local PDF',
      kind: 'local',
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen2.5',
      enabled: true,
    })
    await service.updateLlmTaskRoutes([{ task: 'pdf-to-markdown', profileId: 'local-pdf' }])

    const settings = await service.getSettings()

    expect(service.resolveLlmConfigForTask(settings.llm, 'pdf-to-markdown').modelId).toBe('qwen2.5')
    expect(service.resolveLlmConfigForTask(settings.llm, 'agent-chat').modelId).toBe(
      'gpt-4.1-mini',
    )
  })
})
