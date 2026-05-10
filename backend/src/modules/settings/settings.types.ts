export type LLMProfileKind = 'cloud' | 'local'

export type LLMApiFormat =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

export type LLMProviderKind =
  | 'openai-compatible'
  | 'ollama'
  | 'lm-studio'
  | 'localai'
  | 'custom'

export type LLMTaskKind =
  | 'agent-chat'
  | 'pdf-to-markdown'
  | 'coding'
  | 'summarization'
  | 'vision'
  | 'pkm-index'

export type LLMProfile = {
  id: string
  name: string
  kind: LLMProfileKind
  provider: LLMProviderKind
  apiFormat: LLMApiFormat
  baseUrl: string
  modelId: string
  apiKey: string
  enabled: boolean
  detected?: boolean
  source?: string
  lastSeenAt?: number
}

export type PublicLLMProfile = Omit<LLMProfile, 'apiKey'> & {
  hasApiKey: boolean
  apiKeyMask: string
}

export type LLMTaskRoute = {
  task: LLMTaskKind
  profileId: string
}

export type LLMSettings = {
  baseUrl: string
  modelId: string
  apiKey: string
  kind: LLMProfileKind
  provider: LLMProviderKind
  apiFormat: LLMApiFormat
  activeProfileId: string
  profiles: LLMProfile[]
  taskRoutes: LLMTaskRoute[]
}

export type ImageGenerationSettings = {
  apiFormat: 'openai-compatible' | 'gemini-native'
  baseUrl: string
  modelId: string
  apiKey: string
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  quality: 'auto' | 'low' | 'medium' | 'high'
  background: 'auto' | 'opaque' | 'transparent'
  outputFormat: 'png' | 'jpeg' | 'webp'
  outputCompression: number
}

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
   * 用户「降低动效」偏好。
   * - null = 跟随系统 prefers-reduced-motion 检测
   * - true / false = 用户偏好覆盖系统检测
   * 与 effects.water.enabled 语义解耦：reduceMotion 控制总体动效偏好，effects.water.enabled 是水波特效本身的高级开关。
   */
  reduceMotion?: boolean | null
  effects?: AppearanceEffects
}

export type AgentSettings = {
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
  morningBrief: MorningBriefSettings
}

export type MorningBriefSettings = {
  enabled: boolean
  time: string
}

export type OcrSettings = {
  provider: 'uapis' | 'custom-model'
  customBaseUrl: string
  customModelId: string
  customApiKey: string
}

export type UapisSettings = {
  apiKey: string
}

export type Settings = {
  llm: LLMSettings
  imageGeneration: ImageGenerationSettings
  ocr: OcrSettings
  appearance: AppearanceSettings
  agent: AgentSettings
  uapis: UapisSettings
}

/** API key 永不出站,用 hasApiKey + 脱敏预览替代 */
export type PublicSettings = {
  llm: {
    baseUrl: string
    modelId: string
    kind: LLMProfileKind
    provider: LLMProviderKind
    apiFormat: LLMApiFormat
    activeProfileId: string
    profiles: PublicLLMProfile[]
    taskRoutes: LLMTaskRoute[]
    hasApiKey: boolean
    apiKeyMask: string
  }
  imageGeneration: {
    apiFormat: ImageGenerationSettings['apiFormat']
    baseUrl: string
    modelId: string
    size: ImageGenerationSettings['size']
    quality: ImageGenerationSettings['quality']
    background: ImageGenerationSettings['background']
    outputFormat: ImageGenerationSettings['outputFormat']
    outputCompression: number
    hasApiKey: boolean
    apiKeyMask: string
  }
  appearance: AppearanceSettings
  agent: AgentSettings
  ocr: {
    provider: OcrSettings['provider']
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

export type SettingsPatch = {
  llm?: Partial<LLMSettings>
  imageGeneration?: Partial<ImageGenerationSettings>
  ocr?: Partial<OcrSettings>
  appearance?: Partial<AppearanceSettings>
  agent?: Partial<Omit<AgentSettings, 'morningBrief'>> & {
    morningBrief?: Partial<MorningBriefSettings>
  }
  uapis?: Partial<UapisSettings>
}
