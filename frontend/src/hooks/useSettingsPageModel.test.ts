// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicSettings } from '../api/settings'
import { useSettingsPageModel } from './useSettingsPageModel'

// Mock SettingsApi — hook must call get() on mount, update() on save().
vi.mock('../api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/settings')>()
  return {
    ...actual,
    SettingsApi: {
      get: vi.fn(),
      update: vi.fn(),
      discoverLocalModels: vi.fn(),
      upsertLlmProfile: vi.fn(),
      activateLlmProfile: vi.fn(),
      updateLlmTaskRoutes: vi.fn(),
    },
  }
})

// Lazy import the mocked module after vi.mock above.
async function getSettingsApi() {
  const mod = await import('../api/settings')
  return mod.SettingsApi as unknown as {
    get: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

function makeSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  const base: PublicSettings = {
    llm: {
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      kind: 'cloud',
      provider: 'openai-compatible',
      apiFormat: 'openai-compatible',
      activeProfileId: 'profile-1',
      profiles: [],
      taskRoutes: [],
      hasApiKey: true,
      apiKeyMask: 'sk-***',
    },
    imageGeneration: {
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-image-1',
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 80,
      hasApiKey: false,
      apiKeyMask: '',
    },
    appearance: { theme: 'dark', language: 'zh-CN' },
    agent: {
      streaming: true,
      userPrompt: '',
      fullAccess: false,
      contextMessageLimit: 50,
      progressiveDisclosureEnabled: true,
      providerCachingEnabled: true,
      checkpointEnabled: true,
      seedOnResumeEnabled: true,
      upgradeDebugEventsEnabled: true,
      autoCompactEnabled: true,
      autoCompactThreshold: 100,
      morningBrief: { enabled: false, time: '09:30' },
    },
    ocr: {
      provider: 'uapis',
      customBaseUrl: '',
      customModelId: '',
      hasCustomApiKey: false,
      customApiKeyMask: '',
    },
    uapis: {
      hasApiKey: false,
      apiKeyMask: '',
      mode: 'free-ip-quota',
      home: 'https://uapis.cn',
      console: 'https://uapis.cn/console',
      anonymousMonthlyCredits: 1500,
      apiKeyMonthlyCredits: 3500,
    },
  }
  return { ...base, ...overrides }
}

describe('useSettingsPageModel', () => {
  beforeEach(async () => {
    const api = await getSettingsApi()
    api.get.mockReset()
    api.update.mockReset()
  })

  it('exposes initial defaults before settings load', () => {
    const { result } = renderHook(() => useSettingsPageModel())
    expect(result.current.loaded).toBeNull()
    expect(result.current.baseUrl).toBe('')
    expect(result.current.modelId).toBe('')
    expect(result.current.uiLanguage).toBe('zh-CN')
    expect(result.current.saveState).toBe('idle')
  })

  it('loads settings on mount and hydrates fields', async () => {
    const api = await getSettingsApi()
    const settings = makeSettings()
    api.get.mockResolvedValueOnce(settings)

    const { result } = renderHook(() => useSettingsPageModel())

    await waitFor(() => {
      expect(result.current.loaded).not.toBeNull()
    })

    expect(result.current.baseUrl).toBe('https://api.openai.com/v1')
    expect(result.current.modelId).toBe('gpt-4o-mini')
    expect(result.current.llmApiFormat).toBe('openai-compatible')
    expect(result.current.uiLanguage).toBe('zh-CN')
    expect(result.current.streaming).toBe(true)
    expect(result.current.contextMessageLimit).toBe(50)
  })

  it('updates fields via setters and reflects in buildPatch()', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => {
      expect(result.current.loaded).not.toBeNull()
    })

    act(() => {
      result.current.setBaseUrl('https://api.deepseek.com/v1')
      result.current.setModelId('deepseek-chat')
    })

    const patch = result.current.buildPatch('dark')
    expect(patch.llm?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(patch.llm?.modelId).toBe('deepseek-chat')
  })

  it('applyLlmPreset sets baseUrl + modelId without touching apiKey', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setApiKey('sk-preserve-me')
      result.current.applyLlmPreset({
        baseUrl: 'https://api.moonshot.cn/v1',
        modelId: 'kimi-k2-0711-preview',
      })
    })

    expect(result.current.baseUrl).toBe('https://api.moonshot.cn/v1')
    expect(result.current.modelId).toBe('kimi-k2-0711-preview')
    expect(result.current.apiKey).toBe('sk-preserve-me')
  })

  it('save() calls SettingsApi.update with full patch and resets transient keys', async () => {
    const api = await getSettingsApi()
    const initial = makeSettings()
    api.get.mockResolvedValueOnce(initial)
    api.update.mockImplementation(async (_patch) => initial)

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setApiKey('sk-new-key')
      result.current.setBaseUrl('https://api.openai.com/v1')
    })

    await act(async () => {
      await result.current.save('dark')
    })

    expect(api.update).toHaveBeenCalledTimes(1)
    const patch = api.update.mock.calls[0][0]
    expect(patch.llm.apiKey).toBe('sk-new-key')
    expect(patch.appearance.theme).toBe('dark')
    // After save, transient api keys are cleared.
    expect(result.current.apiKey).toBe('')
  })

  it('save() omits empty api keys (does not blank out existing server key)', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())
    api.update.mockImplementation(async (_patch) => makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    await act(async () => {
      await result.current.save('dark')
    })

    const patch = api.update.mock.calls[0][0]
    expect(patch.llm.apiKey).toBeUndefined()
    expect(patch.imageGeneration.apiKey).toBeUndefined()
    expect(patch.ocr.customApiKey).toBeUndefined()
    expect(patch.uapis.apiKey).toBeUndefined()
  })

  it('save() transitions through states: idle → saving → saved', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())
    let resolveUpdate: ((v: PublicSettings) => void) | null = null
    api.update.mockImplementation(
      () =>
        new Promise<PublicSettings>((resolve) => {
          resolveUpdate = resolve
        }),
    )

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    let savePromise: Promise<void> | null = null
    act(() => {
      savePromise = result.current.save('dark')
    })
    await waitFor(() => expect(result.current.saveState).toBe('saving'))

    await act(async () => {
      resolveUpdate?.(makeSettings())
      await savePromise
    })

    expect(result.current.saveState).toBe('saved')
  })

  it('save() captures error message and sets state to error', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())
    api.update.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    await act(async () => {
      await result.current.save('dark')
    })

    expect(result.current.saveState).toBe('error')
    expect(result.current.error).toBe('boom')
  })

  it('updateTaskRoute adds / replaces / removes entries', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.updateTaskRoute('coding', 'profile-x')
    })
    expect(result.current.taskRouteProfileId('coding')).toBe('profile-x')

    act(() => {
      result.current.updateTaskRoute('coding', 'profile-y')
    })
    expect(result.current.taskRouteProfileId('coding')).toBe('profile-y')

    act(() => {
      result.current.updateTaskRoute('coding', '')
    })
    expect(result.current.taskRouteProfileId('coding')).toBe('')
  })

  it('syncLlmSettings rehydrates LLM fields without clobbering image/agent state', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setStreaming(false)
    })

    const newSettings = makeSettings({
      llm: {
        ...makeSettings().llm,
        baseUrl: 'https://api.minimax.io/v1',
        modelId: 'MiniMax-M2.7',
        apiFormat: 'openai-compatible',
        taskRoutes: [{ task: 'coding', profileId: 'profile-z' }],
      },
    })

    act(() => {
      result.current.syncLlmSettings(newSettings)
    })

    expect(result.current.baseUrl).toBe('https://api.minimax.io/v1')
    expect(result.current.modelId).toBe('MiniMax-M2.7')
    expect(result.current.taskRouteProfileId('coding')).toBe('profile-z')
    // Untouched streaming flag preserved.
    expect(result.current.streaming).toBe(false)
    // setApiKey was reset by sync.
    expect(result.current.apiKey).toBe('')
  })

  it('isDirty reflects unsaved divergence from loaded', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())
    api.update.mockImplementation(async (_patch) => makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    expect(result.current.isDirty).toBe(false)

    act(() => {
      result.current.setModelId('gpt-4o')
    })
    expect(result.current.isDirty).toBe(true)

    act(() => {
      result.current.setModelId('gpt-4o-mini') // back to original
    })
    expect(result.current.isDirty).toBe(false)
  })
})
