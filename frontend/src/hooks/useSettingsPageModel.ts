import type {
  LlmApiFormat,
  LlmTaskKind,
  LlmTaskRoute,
  PublicSettings,
  SettingsPatch,
} from '../api/settings'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface UseSettingsPageModelReturn {
  loaded: PublicSettings | null

  // LLM
  baseUrl: string
  setBaseUrl: (value: string) => void
  modelId: string
  setModelId: (value: string) => void
  llmApiFormat: LlmApiFormat
  setLlmApiFormat: (value: LlmApiFormat) => void
  apiKey: string
  setApiKey: (value: string) => void
  llmTaskRoutes: LlmTaskRoute[]
  setLlmTaskRoutes: (value: LlmTaskRoute[]) => void
  updateTaskRoute: (task: LlmTaskKind, profileId: string) => void
  taskRouteProfileId: (task: LlmTaskKind) => string

  // Image generation
  imageApiFormat: PublicSettings['imageGeneration']['apiFormat']
  setImageApiFormat: (value: PublicSettings['imageGeneration']['apiFormat']) => void
  imageBaseUrl: string
  setImageBaseUrl: (value: string) => void
  imageModelId: string
  setImageModelId: (value: string) => void
  imageApiKey: string
  setImageApiKey: (value: string) => void
  imageSize: PublicSettings['imageGeneration']['size']
  setImageSize: (value: PublicSettings['imageGeneration']['size']) => void
  imageQuality: PublicSettings['imageGeneration']['quality']
  setImageQuality: (value: PublicSettings['imageGeneration']['quality']) => void
  imageBackground: PublicSettings['imageGeneration']['background']
  setImageBackground: (value: PublicSettings['imageGeneration']['background']) => void
  imageOutputFormat: PublicSettings['imageGeneration']['outputFormat']
  setImageOutputFormat: (value: PublicSettings['imageGeneration']['outputFormat']) => void
  imageOutputCompression: number
  setImageOutputCompression: (value: number) => void

  // OCR
  ocrProvider: PublicSettings['ocr']['provider']
  setOcrProvider: (value: PublicSettings['ocr']['provider']) => void
  ocrCustomBaseUrl: string
  setOcrCustomBaseUrl: (value: string) => void
  ocrCustomModelId: string
  setOcrCustomModelId: (value: string) => void
  ocrCustomApiKey: string
  setOcrCustomApiKey: (value: string) => void

  // UAPIs
  uapisApiKey: string
  setUapisApiKey: (value: string) => void

  // Appearance (language only — theme lives in ThemeContext)
  uiLanguage: PublicSettings['appearance']['language']
  setUiLanguage: (value: PublicSettings['appearance']['language']) => void

  // Agent
  userPrompt: string
  setUserPrompt: (value: string) => void
  streaming: boolean
  setStreaming: (value: boolean) => void
  fullAccess: boolean
  setFullAccess: (value: boolean) => void
  contextMessageLimit: number
  setContextMessageLimit: (value: number) => void
  progressiveDisclosureEnabled: boolean
  setProgressiveDisclosureEnabled: (value: boolean) => void
  providerCachingEnabled: boolean
  setProviderCachingEnabled: (value: boolean) => void
  checkpointEnabled: boolean
  setCheckpointEnabled: (value: boolean) => void
  seedOnResumeEnabled: boolean
  setSeedOnResumeEnabled: (value: boolean) => void
  upgradeDebugEventsEnabled: boolean
  setUpgradeDebugEventsEnabled: (value: boolean) => void
  autoCompactEnabled: boolean
  setAutoCompactEnabled: (value: boolean) => void
  autoCompactThreshold: number
  setAutoCompactThreshold: (value: number) => void
  morningBriefEnabled: boolean
  setMorningBriefEnabled: (value: boolean) => void
  morningBriefTime: string
  setMorningBriefTime: (value: string) => void

  // Save flow
  saveState: SaveState
  error: string
  save: (theme: PublicSettings['appearance']['theme']) => Promise<void>
  buildPatch: (theme: PublicSettings['appearance']['theme']) => SettingsPatch
  isDirty: boolean

  // Composite helpers
  applyLlmPreset: (preset: { baseUrl: string; modelId: string }) => void
  applyImagePreset: (preset: {
    apiFormat: PublicSettings['imageGeneration']['apiFormat']
    baseUrl: string
    modelId: string
  }) => void

  // External sync (e.g. after LLM profile activate / upsert)
  syncLlmSettings: (settings: PublicSettings) => void
  applyLoaded: (settings: PublicSettings) => void
}

export function useSettingsPageModel(): UseSettingsPageModelReturn {
  throw new Error('useSettingsPageModel: not yet implemented (IU-2 TDD step 1)')
}
