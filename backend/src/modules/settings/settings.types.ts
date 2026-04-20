export type LLMSettings = {
  baseUrl: string
  modelId: string
  apiKey: string
}

export type ImageGenerationSettings = {
  baseUrl: string
  modelId: string
  apiKey: string
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  quality: 'auto' | 'low' | 'medium' | 'high'
  background: 'auto' | 'opaque' | 'transparent'
  outputFormat: 'png' | 'jpeg' | 'webp'
  outputCompression: number
}

export type AppearanceSettings = {
  theme: 'dark' | 'light' | 'auto'
}

export type AgentSettings = {
  streaming: boolean
  userPrompt: string
  fullAccess: boolean
}

export type Settings = {
  llm: LLMSettings
  imageGeneration: ImageGenerationSettings
  appearance: AppearanceSettings
  agent: AgentSettings
}

/** API key 永不出站,用 hasApiKey + 脱敏预览替代 */
export type PublicSettings = {
  llm: {
    baseUrl: string
    modelId: string
    hasApiKey: boolean
    apiKeyMask: string
  }
  imageGeneration: {
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
}

export type SettingsPatch = {
  llm?: Partial<LLMSettings>
  imageGeneration?: Partial<ImageGenerationSettings>
  appearance?: Partial<AppearanceSettings>
  agent?: Partial<AgentSettings>
}
