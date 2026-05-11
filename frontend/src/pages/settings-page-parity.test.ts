// @vitest-environment jsdom
//
// Parity test: assert the SettingsPatch produced by useSettingsPageModel
// matches the payload shape Settings.tsx historically sent to SettingsApi.update.
//
// Why this lives in pages/ (not hooks/): it documents the page-level contract.
// If someone later bypasses the hook and goes back to direct SettingsApi.update,
// this test catches the divergence.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicSettings, SettingsPatch } from '../api/settings'
import { useSettingsPageModel } from '../hooks/useSettingsPageModel'

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

describe('settings-page parity: hook → SettingsApi.update', () => {
  beforeEach(async () => {
    const api = await getSettingsApi()
    api.get.mockReset()
    api.update.mockReset()
  })

  it('case 1 — single field update produces patch with that field changed and others mirrored from loaded', async () => {
    const api = await getSettingsApi()
    const loaded = makeSettings()
    api.get.mockResolvedValueOnce(loaded)

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setModelId('gpt-4o')
    })

    const patch = result.current.buildPatch('dark')
    expect(patch.llm).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o',
      apiFormat: 'openai-compatible',
      taskRoutes: [],
    })
    // apiKey omitted (transient field empty); other sections preserved.
    expect(patch.llm).not.toHaveProperty('apiKey')
    expect(patch.appearance).toEqual({ theme: 'dark', language: 'zh-CN' })
  })

  it('case 2 — multiple field updates across sections produce a coherent multi-section patch', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setModelId('deepseek-chat')
      result.current.setBaseUrl('https://api.deepseek.com/v1')
      result.current.setStreaming(false)
      result.current.setAutoCompactThreshold(200)
      result.current.setUiLanguage('en-US')
    })

    const patch = result.current.buildPatch('light')
    expect(patch.llm?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(patch.llm?.modelId).toBe('deepseek-chat')
    expect(patch.agent?.streaming).toBe(false)
    expect(patch.agent?.autoCompactThreshold).toBe(200)
    expect(patch.appearance).toEqual({ theme: 'light', language: 'en-US' })
  })

  it('case 3 — applyLlmPreset reflects all preset fields in patch and preserves api key when typed', async () => {
    const api = await getSettingsApi()
    api.get.mockResolvedValueOnce(makeSettings())

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    act(() => {
      result.current.setApiKey('sk-typed-by-user')
      result.current.applyLlmPreset({
        baseUrl: 'https://api.moonshot.cn/v1',
        modelId: 'kimi-k2-0711-preview',
      })
    })

    const patch = result.current.buildPatch('dark')
    expect(patch.llm).toEqual({
      baseUrl: 'https://api.moonshot.cn/v1',
      modelId: 'kimi-k2-0711-preview',
      apiFormat: 'openai-compatible',
      taskRoutes: [],
      apiKey: 'sk-typed-by-user',
    })
  })

  it('case 4 — save then dispatch the same value → isDirty stays false (idempotent setter contract)', async () => {
    const api = await getSettingsApi()
    const initial = makeSettings({
      llm: {
        ...makeSettings().llm,
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o-mini',
      },
    })
    api.get.mockResolvedValueOnce(initial)
    api.update.mockImplementation(async (_patch) => initial)

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())
    expect(result.current.isDirty).toBe(false)

    await act(async () => {
      await result.current.save('dark')
    })
    expect(result.current.isDirty).toBe(false)

    act(() => {
      result.current.setModelId('gpt-4o-mini') // same value as loaded
    })
    expect(result.current.isDirty).toBe(false)

    act(() => {
      result.current.setStreaming(true) // same value as loaded
    })
    expect(result.current.isDirty).toBe(false)
  })

  it('case 5 — full patch shape matches the historical Settings.tsx payload (no missing/extra fields)', async () => {
    const api = await getSettingsApi()
    const loaded = makeSettings()
    api.get.mockResolvedValueOnce(loaded)

    const { result } = renderHook(() => useSettingsPageModel())
    await waitFor(() => expect(result.current.loaded).not.toBeNull())

    const patch: SettingsPatch = result.current.buildPatch('dark')

    // Top-level keys mirror what Settings.tsx historically sent.
    expect(Object.keys(patch).sort()).toEqual(
      ['agent', 'appearance', 'imageGeneration', 'llm', 'ocr', 'uapis'].sort(),
    )

    // Snapshot of agent block matches loaded.agent (no morningBrief drift).
    expect(patch.agent).toEqual({
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
    })
    // OCR: trimmed strings + customApiKey omitted when blank.
    expect(patch.ocr).toEqual({
      provider: 'uapis',
      customBaseUrl: '',
      customModelId: '',
    })
    expect(patch.uapis).toEqual({}) // no key typed, no apiKey field
  })
})
