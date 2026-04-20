import { api } from './client'

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
    size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
    quality: 'auto' | 'low' | 'medium' | 'high'
    background: 'auto' | 'opaque' | 'transparent'
    outputFormat: 'png' | 'jpeg' | 'webp'
    outputCompression: number
    hasApiKey: boolean
    apiKeyMask: string
  }
  appearance: { theme: 'dark' | 'light' | 'auto' }
  agent: { streaming: boolean; userPrompt: string; fullAccess: boolean }
}

export type SettingsPatch = {
  llm?: Partial<{ baseUrl: string; modelId: string; apiKey: string }>
  imageGeneration?: Partial<{
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
}

export const SettingsApi = {
  get: () => api.get<PublicSettings>('/settings'),
  update: (patch: SettingsPatch) => api.put<PublicSettings>('/settings', patch),
}
