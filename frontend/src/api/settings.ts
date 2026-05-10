import { api } from './client'

export type LlmApiFormat = 'openai-compatible' | 'anthropic' | 'gemini'

export type AppearanceWaterEffectIntensity = 'low' | 'medium' | 'high'

export type AppearanceWaterEffectSettings = {
  enabled: boolean
  intensity?: AppearanceWaterEffectIntensity
  hoverRipple?: boolean
  clickWave?: boolean
}

export type AppearanceEffects = {
  water?: AppearanceWaterEffectSettings
}

export type AppearanceSettings = {
  theme: 'dark' | 'light' | 'auto'
  language: 'zh-CN' | 'en-US'
  /**
   * 用户「降低动效」偏好（覆盖系统检测）：
   * - null/undefined = 跟随 prefers-reduced-motion 系统检测
   * - true / false = 用户偏好覆盖系统检测
   * 与 effects.water.enabled 语义解耦。
   */
  reduceMotion?: boolean | null
  effects?: AppearanceEffects
}

export type PublicSettings = {
  llm: {
    baseUrl: string
    modelId: string
    kind: 'cloud' | 'local'
    provider: 'openai-compatible' | 'ollama' | 'lm-studio' | 'localai' | 'custom'
    apiFormat: LlmApiFormat
    activeProfileId: string
    profiles: PublicLlmProfile[]
    taskRoutes: LlmTaskRoute[]
    hasApiKey: boolean
    apiKeyMask: string
  }
  imageGeneration: {
    apiFormat: 'openai-compatible' | 'gemini-native'
    baseUrl: string
    modelId: string
    size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
    quality: 'auto' | 'low' | 'medium' | 'high'
    background: 'auto' | 'opaque' | 'transparent'
    outputFormat: 'png' | 'jpeg' | 'webp'
    outputCompression: number
    hasApiKey: boolean
    apiKeyMask: string
  }
  appearance: AppearanceSettings
  agent: {
    streaming: boolean
    userPrompt: string
    fullAccess: boolean
    contextMessageLimit: number
    progressiveDisclosureEnabled: boolean
    providerCachingEnabled: boolean
    checkpointEnabled: boolean
    seedOnResumeEnabled: boolean
    upgradeDebugEventsEnabled: boolean
    autoCompactEnabled: boolean
    autoCompactThreshold: number
    morningBrief: {
      enabled: boolean
      time: string
    }
  }
  ocr: {
    provider: 'uapis' | 'custom-model'
    customBaseUrl: string
    customModelId: string
    hasCustomApiKey: boolean
    customApiKeyMask: string
  }
  uapis: {
    hasApiKey: boolean
    apiKeyMask: string
    mode: 'free-ip-quota' | 'api-key'
    home: string
    console: string
    anonymousMonthlyCredits: number
    apiKeyMonthlyCredits: number
  }
}

export type LlmTaskKind =
  | 'agent-chat'
  | 'pdf-to-markdown'
  | 'coding'
  | 'summarization'
  | 'vision'

export type LlmTaskRoute = {
  task: LlmTaskKind
  profileId: string
}

export type PublicLlmProfile = {
  id: string
  name: string
  kind: PublicSettings['llm']['kind']
  provider: PublicSettings['llm']['provider']
  apiFormat: LlmApiFormat
  baseUrl: string
  modelId: string
  enabled: boolean
  detected?: boolean
  source?: string
  lastSeenAt?: number
  hasApiKey: boolean
  apiKeyMask: string
}

export type LocalModelDiscoveryResult = {
  scannedAt: number
  candidates: PublicLlmProfile[]
  errors: { source: string; baseUrl: string; message: string }[]
}

export type SettingsPatch = {
  llm?: Partial<{
    baseUrl: string
    modelId: string
    apiKey: string
    apiFormat: LlmApiFormat
    activeProfileId: string
    taskRoutes: LlmTaskRoute[]
  }>
  imageGeneration?: Partial<{
    apiFormat: PublicSettings['imageGeneration']['apiFormat']
    baseUrl: string
    modelId: string
    apiKey: string
    size: PublicSettings['imageGeneration']['size']
    quality: PublicSettings['imageGeneration']['quality']
    background: PublicSettings['imageGeneration']['background']
    outputFormat: PublicSettings['imageGeneration']['outputFormat']
    outputCompression: number
  }>
  appearance?: Partial<PublicSettings['appearance']>
  agent?: Partial<PublicSettings['agent']>
  ocr?: Partial<{
    provider: PublicSettings['ocr']['provider']
    customBaseUrl: string
    customModelId: string
    customApiKey: string
  }>
  uapis?: Partial<{ apiKey: string }>
}

export const SettingsApi = {
  get: () => api.get<PublicSettings>('/settings'),
  update: (patch: SettingsPatch) => api.put<PublicSettings>('/settings', patch),
  discoverLocalModels: () =>
    api.get<LocalModelDiscoveryResult>('/settings/llm/local-discovery'),
  upsertLlmProfile: (profile: PublicLlmProfile, activate = false) =>
    api.post<PublicSettings>('/settings/llm/profiles', { profile, activate }),
  activateLlmProfile: (profileId: string) =>
    api.post<PublicSettings>(`/settings/llm/profiles/${encodeURIComponent(profileId)}/activate`, {}),
  updateLlmTaskRoutes: (routes: LlmTaskRoute[]) =>
    api.put<PublicSettings>('/settings/llm/task-routes', { routes }),
}
