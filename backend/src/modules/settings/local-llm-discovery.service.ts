import { createHash } from 'node:crypto'
import type { LLMProfile, LLMProviderKind, PublicLLMProfile } from './settings.types.js'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type DiscoverySource = {
  label: string
  provider: LLMProviderKind
  modelsUrl: string
  baseUrl: string
  parser: 'ollama' | 'openai-models'
}

export type LocalModelDiscoveryResult = {
  scannedAt: number
  candidates: PublicLLMProfile[]
  errors: {
    source: string
    baseUrl: string
    message: string
  }[]
}

const LOCAL_DISCOVERY_SOURCES: DiscoverySource[] = [
  {
    label: 'Ollama',
    provider: 'ollama',
    modelsUrl: 'http://127.0.0.1:11434/api/tags',
    baseUrl: 'http://127.0.0.1:11434/v1',
    parser: 'ollama',
  },
  {
    label: 'LM Studio',
    provider: 'lm-studio',
    modelsUrl: 'http://127.0.0.1:1234/v1/models',
    baseUrl: 'http://127.0.0.1:1234/v1',
    parser: 'openai-models',
  },
  {
    label: 'LocalAI',
    provider: 'localai',
    modelsUrl: 'http://127.0.0.1:8080/v1/models',
    baseUrl: 'http://127.0.0.1:8080/v1',
    parser: 'openai-models',
  },
  {
    label: 'vLLM',
    provider: 'openai-compatible',
    modelsUrl: 'http://127.0.0.1:8000/v1/models',
    baseUrl: 'http://127.0.0.1:8000/v1',
    parser: 'openai-models',
  },
  {
    label: 'llama.cpp server',
    provider: 'openai-compatible',
    modelsUrl: 'http://127.0.0.1:8081/v1/models',
    baseUrl: 'http://127.0.0.1:8081/v1',
    parser: 'openai-models',
  },
  {
    label: 'OpenAI compatible :5000',
    provider: 'openai-compatible',
    modelsUrl: 'http://127.0.0.1:5000/v1/models',
    baseUrl: 'http://127.0.0.1:5000/v1',
    parser: 'openai-models',
  },
  {
    label: 'OpenAI compatible :7860',
    provider: 'openai-compatible',
    modelsUrl: 'http://127.0.0.1:7860/v1/models',
    baseUrl: 'http://127.0.0.1:7860/v1',
    parser: 'openai-models',
  },
]

function hashId(parts: string[]) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\n')
  return `llm_${hash.digest('hex').slice(0, 16)}`
}

function toPublic(profile: LLMProfile): PublicLLMProfile {
  const { apiKey: _apiKey, ...safeProfile } = profile
  return {
    ...safeProfile,
    hasApiKey: profile.apiKey.length > 0,
    apiKeyMask: '',
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseOllamaModels(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return readString(record.model) || readString(record.name)
    })
    .filter(Boolean)
}

function parseOpenAiModels(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      return readString((item as Record<string, unknown>).id)
    })
    .filter(Boolean)
}

function createProfile(source: DiscoverySource, modelId: string, now: number): LLMProfile {
  return {
    id: hashId(['local', source.provider, source.baseUrl, modelId]),
    name: `${source.label} · ${modelId}`,
    kind: 'local',
    provider: source.provider,
    apiFormat: 'openai-compatible',
    baseUrl: source.baseUrl,
    modelId,
    apiKey: '',
    enabled: true,
    detected: true,
    source: source.label,
    lastSeenAt: now,
  }
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function discoverLocalModels(options: {
  fetchImpl?: FetchLike
  timeoutMs?: number
} = {}): Promise<LocalModelDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 800
  const scannedAt = Date.now()
  const candidates = new Map<string, PublicLLMProfile>()
  const errors: LocalModelDiscoveryResult['errors'] = []

  await Promise.all(
    LOCAL_DISCOVERY_SOURCES.map(async (source) => {
      try {
        const payload = await fetchJson(fetchImpl, source.modelsUrl, timeoutMs)
        const models =
          source.parser === 'ollama' ? parseOllamaModels(payload) : parseOpenAiModels(payload)
        for (const modelId of models) {
          const profile = createProfile(source, modelId, scannedAt)
          candidates.set(`${profile.baseUrl}\n${profile.modelId}`, toPublic(profile))
        }
      } catch (error) {
        errors.push({
          source: source.label,
          baseUrl: source.baseUrl,
          message: error instanceof Error ? error.message : 'scan failed',
        })
      }
    }),
  )

  return {
    scannedAt,
    candidates: [...candidates.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    ),
    errors,
  }
}
