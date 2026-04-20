import { readJson, writeJson } from '../../storage.js'
import type {
  AgentSettings,
  ImageGenerationSettings,
  Settings,
  PublicSettings,
  SettingsPatch,
} from './settings.types.js'

const FILE = 'settings.json'

const DEFAULT_SETTINGS: Settings = {
  llm: {
    baseUrl: '',
    modelId: '',
    apiKey: '',
  },
  imageGeneration: {
    baseUrl: '',
    modelId: 'gpt-image-1',
    apiKey: '',
    size: 'auto',
    quality: 'auto',
    background: 'auto',
    outputFormat: 'png',
    outputCompression: 80,
  },
  appearance: {
    theme: 'dark',
  },
  agent: {
    streaming: true,
    userPrompt: '',
    fullAccess: false,
  },
}

type LegacyAgentSettings = Partial<AgentSettings> & {
  systemPrompt?: string
}

type LegacySettings = Omit<Partial<Settings>, 'agent'> & {
  agent?: LegacyAgentSettings
}

function normalizeImageGenerationSettings(
  imageGeneration: Partial<ImageGenerationSettings> | undefined,
): ImageGenerationSettings {
  const current = imageGeneration ?? {}
  return {
    baseUrl:
      typeof current.baseUrl === 'string'
        ? current.baseUrl
        : DEFAULT_SETTINGS.imageGeneration.baseUrl,
    modelId:
      typeof current.modelId === 'string' && current.modelId.trim()
        ? current.modelId.trim()
        : DEFAULT_SETTINGS.imageGeneration.modelId,
    apiKey:
      typeof current.apiKey === 'string'
        ? current.apiKey
        : DEFAULT_SETTINGS.imageGeneration.apiKey,
    size:
      current.size === '1024x1024' ||
      current.size === '1536x1024' ||
      current.size === '1024x1536' ||
      current.size === 'auto'
        ? current.size
        : DEFAULT_SETTINGS.imageGeneration.size,
    quality:
      current.quality === 'low' ||
      current.quality === 'medium' ||
      current.quality === 'high' ||
      current.quality === 'auto'
        ? current.quality
        : DEFAULT_SETTINGS.imageGeneration.quality,
    background:
      current.background === 'opaque' ||
      current.background === 'transparent' ||
      current.background === 'auto'
        ? current.background
        : DEFAULT_SETTINGS.imageGeneration.background,
    outputFormat:
      current.outputFormat === 'jpeg' ||
      current.outputFormat === 'webp' ||
      current.outputFormat === 'png'
        ? current.outputFormat
        : DEFAULT_SETTINGS.imageGeneration.outputFormat,
    outputCompression:
      typeof current.outputCompression === 'number' && Number.isFinite(current.outputCompression)
        ? Math.min(Math.max(Math.round(current.outputCompression), 0), 100)
        : DEFAULT_SETTINGS.imageGeneration.outputCompression,
  }
}

function mergeSettings(base: Settings, partial: Partial<Settings>): Settings {
  return {
    llm: { ...base.llm, ...(partial.llm ?? {}) },
    imageGeneration: {
      ...base.imageGeneration,
      ...(partial.imageGeneration ?? {}),
    },
    appearance: { ...base.appearance, ...(partial.appearance ?? {}) },
    agent: { ...base.agent, ...(partial.agent ?? {}) },
  }
}

function normalizeAgentSettings(agent: LegacyAgentSettings | undefined): AgentSettings {
  if (!agent) return DEFAULT_SETTINGS.agent

  return {
    streaming:
      typeof agent.streaming === 'boolean'
        ? agent.streaming
        : DEFAULT_SETTINGS.agent.streaming,
    userPrompt:
      typeof agent.userPrompt === 'string'
        ? agent.userPrompt
        : typeof agent.systemPrompt === 'string'
          ? agent.systemPrompt
          : DEFAULT_SETTINGS.agent.userPrompt,
    fullAccess:
      typeof (agent as { fullAccess?: unknown }).fullAccess === 'boolean'
        ? Boolean((agent as { fullAccess?: unknown }).fullAccess)
        : DEFAULT_SETTINGS.agent.fullAccess,
  }
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}

function toPublic(settings: Settings): PublicSettings {
  return {
    llm: {
      baseUrl: settings.llm.baseUrl,
      modelId: settings.llm.modelId,
      hasApiKey: settings.llm.apiKey.length > 0,
      apiKeyMask: maskKey(settings.llm.apiKey),
    },
    imageGeneration: {
      baseUrl: settings.imageGeneration.baseUrl,
      modelId: settings.imageGeneration.modelId,
      size: settings.imageGeneration.size,
      quality: settings.imageGeneration.quality,
      background: settings.imageGeneration.background,
      outputFormat: settings.imageGeneration.outputFormat,
      outputCompression: settings.imageGeneration.outputCompression,
      hasApiKey: settings.imageGeneration.apiKey.length > 0,
      apiKeyMask: maskKey(settings.imageGeneration.apiKey),
    },
    appearance: settings.appearance,
    agent: settings.agent,
  }
}

export async function getSettings(): Promise<Settings> {
  const raw = await readJson<LegacySettings>(FILE, {})
  return mergeSettings(DEFAULT_SETTINGS, {
    ...raw,
    imageGeneration: normalizeImageGenerationSettings(raw.imageGeneration),
    agent: normalizeAgentSettings(raw.agent),
  })
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return toPublic(await getSettings())
}

export async function updateSettings(patch: SettingsPatch): Promise<PublicSettings> {
  const current = await getSettings()
  const next: Settings = {
    ...current,
    llm: {
      ...current.llm,
      baseUrl: patch.llm?.baseUrl ?? current.llm.baseUrl,
      modelId: patch.llm?.modelId ?? current.llm.modelId,
      apiKey:
        typeof patch.llm?.apiKey === 'string' && patch.llm.apiKey.trim().length > 0
          ? patch.llm.apiKey.trim()
          : current.llm.apiKey,
    },
    imageGeneration: {
      ...current.imageGeneration,
      ...(patch.imageGeneration
        ? normalizeImageGenerationSettings({
            ...current.imageGeneration,
            ...patch.imageGeneration,
            apiKey: current.imageGeneration.apiKey,
          })
        : {}),
      apiKey:
        typeof patch.imageGeneration?.apiKey === 'string' &&
        patch.imageGeneration.apiKey.trim().length > 0
          ? patch.imageGeneration.apiKey.trim()
          : current.imageGeneration.apiKey,
    },
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    agent: { ...current.agent, ...(patch.agent ?? {}) },
  }

  await writeJson(FILE, next)
  return toPublic(next)
}
