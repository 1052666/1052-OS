import { createHash } from 'node:crypto'
import { httpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import {
  createScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from '../calendar/calendar.schedule.service.js'
import type {
  AgentSettings,
  AppearanceSettings,
  ImageGenerationSettings,
  LLMProfile,
  LLMProfileKind,
  LLMProviderKind,
  LLMSettings,
  LLMTaskKind,
  LLMTaskRoute,
  MorningBriefSettings,
  PublicLLMProfile,
  Settings,
  PublicSettings,
  SettingsPatch,
  UapisSettings,
} from './settings.types.js'

const FILE = 'settings.json'
const MORNING_BRIEF_TASK_MARKER = '[managed:agent-morning-brief]'
const MORNING_BRIEF_TASK_TITLE = '每日 Intel Center 早报'

const DEFAULT_SETTINGS: Settings = {
  llm: {
    baseUrl: '',
    modelId: '',
    apiKey: '',
    kind: 'cloud',
    provider: 'openai-compatible',
    activeProfileId: '',
    profiles: [],
    taskRoutes: [],
  },
  imageGeneration: {
    apiFormat: 'openai-compatible',
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
    language: 'zh-CN',
  },
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
    morningBrief: {
      enabled: false,
      time: '09:30',
    },
  },
  uapis: {
    apiKey: '',
  },
}

type LegacyAgentSettings = Partial<Omit<AgentSettings, 'morningBrief'>> & {
  systemPrompt?: string
  morningBrief?: Partial<MorningBriefSettings>
}

type LegacySettings = Omit<Partial<Settings>, 'agent'> & {
  agent?: LegacyAgentSettings
}

const VALID_LLM_KINDS = new Set<LLMProfileKind>(['cloud', 'local'])
const VALID_LLM_PROVIDERS = new Set<LLMProviderKind>([
  'openai-compatible',
  'ollama',
  'lm-studio',
  'localai',
  'custom',
])
const VALID_LLM_TASKS = new Set<LLMTaskKind>([
  'agent-chat',
  'pdf-to-markdown',
  'coding',
  'summarization',
  'vision',
])

function hashId(prefix: string, parts: string[]) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\n')
  return `${prefix}_${hash.digest('hex').slice(0, 16)}`
}

function inferLlmProvider(baseUrl: string, modelId: string): LLMProviderKind {
  const signature = `${baseUrl} ${modelId}`.toLowerCase()
  if (signature.includes('ollama')) return 'ollama'
  if (signature.includes('lmstudio') || signature.includes('lm-studio')) return 'lm-studio'
  if (signature.includes('localai')) return 'localai'
  return 'openai-compatible'
}

function inferLlmKind(baseUrl: string, provider: LLMProviderKind): LLMProfileKind {
  if (provider === 'ollama' || provider === 'lm-studio' || provider === 'localai') return 'local'
  try {
    const host = new URL(baseUrl).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local'
  } catch {
    // Keep remote-safe default when the URL cannot be parsed.
  }
  return 'cloud'
}

function normalizeLlmProfile(input: unknown, fallbackIndex = 0): LLMProfile | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<LLMProfile>
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : ''
  if (!baseUrl || !modelId) return null

  const provider = VALID_LLM_PROVIDERS.has(raw.provider as LLMProviderKind)
    ? (raw.provider as LLMProviderKind)
    : inferLlmProvider(baseUrl, modelId)
  const kind = VALID_LLM_KINDS.has(raw.kind as LLMProfileKind)
    ? (raw.kind as LLMProfileKind)
    : inferLlmKind(baseUrl, provider)
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim().replace(/[^A-Za-z0-9_-]/g, '_')
      : hashId('llm', [kind, provider, baseUrl, modelId, String(fallbackIndex)])

  return {
    id,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : `${kind === 'local' ? '本地模型' : '云端模型'} · ${modelId}`,
    kind,
    provider,
    baseUrl,
    modelId,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    detected: raw.detected === true,
    source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : undefined,
    lastSeenAt:
      typeof raw.lastSeenAt === 'number' && Number.isFinite(raw.lastSeenAt)
        ? raw.lastSeenAt
        : undefined,
  }
}

function normalizeLlmTaskRoutes(input: unknown, profiles: readonly LLMProfile[]): LLMTaskRoute[] {
  if (!Array.isArray(input)) return []
  const profileIds = new Set(
    profiles.filter((profile) => profile.enabled).map((profile) => profile.id),
  )
  const routes: LLMTaskRoute[] = []
  const seen = new Set<LLMTaskKind>()

  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const route = item as Partial<LLMTaskRoute>
    if (!VALID_LLM_TASKS.has(route.task as LLMTaskKind)) continue
    if (typeof route.profileId !== 'string' || !profileIds.has(route.profileId)) continue
    if (seen.has(route.task as LLMTaskKind)) continue
    seen.add(route.task as LLMTaskKind)
    routes.push({
      task: route.task as LLMTaskKind,
      profileId: route.profileId,
    })
  }

  return routes
}

function createLegacyLlmProfile(llm: Partial<LLMSettings>): LLMProfile | null {
  const baseUrl = typeof llm.baseUrl === 'string' ? llm.baseUrl.trim() : ''
  const modelId = typeof llm.modelId === 'string' ? llm.modelId.trim() : ''
  const apiKey = typeof llm.apiKey === 'string' ? llm.apiKey.trim() : ''
  if (!baseUrl && !modelId && !apiKey) return null
  if (!baseUrl || !modelId) return null

  const provider = VALID_LLM_PROVIDERS.has(llm.provider as LLMProviderKind)
    ? (llm.provider as LLMProviderKind)
    : inferLlmProvider(baseUrl, modelId)
  const kind = VALID_LLM_KINDS.has(llm.kind as LLMProfileKind)
    ? (llm.kind as LLMProfileKind)
    : inferLlmKind(baseUrl, provider)

  return {
    id: hashId('llm', ['legacy', kind, provider, baseUrl, modelId]),
    name: '当前模型',
    kind,
    provider,
    baseUrl,
    modelId,
    apiKey,
    enabled: true,
  }
}

function mirrorActiveLlmProfile(llm: Omit<LLMSettings, 'baseUrl' | 'modelId' | 'apiKey'>): LLMSettings {
  const activeProfile =
    llm.profiles.find((profile) => profile.id === llm.activeProfileId && profile.enabled) ??
    llm.profiles.find((profile) => profile.enabled)

  return {
    ...llm,
    activeProfileId: activeProfile?.id ?? '',
    baseUrl: activeProfile?.baseUrl ?? '',
    modelId: activeProfile?.modelId ?? '',
    apiKey: activeProfile?.apiKey ?? '',
    kind: activeProfile?.kind ?? llm.kind,
    provider: activeProfile?.provider ?? llm.provider,
  }
}

function normalizeLlmSettings(llm: Partial<LLMSettings> | undefined): LLMSettings {
  const current = llm ?? {}
  const profiles = Array.isArray(current.profiles)
    ? current.profiles
        .map((profile, index) => normalizeLlmProfile(profile, index))
        .filter((profile): profile is LLMProfile => profile !== null)
    : []
  const legacyProfile = createLegacyLlmProfile(current)
  const normalizedProfiles = profiles.length > 0 ? profiles : legacyProfile ? [legacyProfile] : []
  const activeProfileId =
    typeof current.activeProfileId === 'string' &&
    normalizedProfiles.some((profile) => profile.id === current.activeProfileId)
      ? current.activeProfileId
      : legacyProfile?.id ?? normalizedProfiles[0]?.id ?? ''

  return mirrorActiveLlmProfile({
    kind: VALID_LLM_KINDS.has(current.kind as LLMProfileKind)
      ? (current.kind as LLMProfileKind)
      : DEFAULT_SETTINGS.llm.kind,
    provider: VALID_LLM_PROVIDERS.has(current.provider as LLMProviderKind)
      ? (current.provider as LLMProviderKind)
      : DEFAULT_SETTINGS.llm.provider,
    activeProfileId,
    profiles: normalizedProfiles,
    taskRoutes: normalizeLlmTaskRoutes(current.taskRoutes, normalizedProfiles),
  })
}

function normalizeImageGenerationSettings(
  imageGeneration: Partial<ImageGenerationSettings> | undefined,
): ImageGenerationSettings {
  const current = imageGeneration ?? {}
  return {
    apiFormat:
      current.apiFormat === 'gemini-native' || current.apiFormat === 'openai-compatible'
        ? current.apiFormat
        : DEFAULT_SETTINGS.imageGeneration.apiFormat,
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
    llm: normalizeLlmSettings({ ...base.llm, ...(partial.llm ?? {}) }),
    imageGeneration: {
      ...base.imageGeneration,
      ...(partial.imageGeneration ?? {}),
    },
    appearance: { ...base.appearance, ...(partial.appearance ?? {}) },
    agent: { ...base.agent, ...(partial.agent ?? {}) },
    uapis: { ...base.uapis, ...(partial.uapis ?? {}) },
  }
}

function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
}

function normalizeMorningBriefSettings(
  input: unknown,
  fallback: MorningBriefSettings = DEFAULT_SETTINGS.agent.morningBrief,
): MorningBriefSettings {
  if (!input || typeof input !== 'object') return fallback
  const raw = input as Partial<MorningBriefSettings>

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    time: isTimeString(raw.time) ? raw.time.trim() : fallback.time,
  }
}

function todayInHongKong() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function buildMorningBriefPrompt() {
  return [
    '请生成今天的 Intel Center 早报。',
    '',
    '执行要求：',
    '- 优先读取并使用已安装的 intel-center Skill。',
    '- 使用 intel_center_collect 采集原始情报；不要用终端手动猜测 Skill 脚本路径。',
    '- 按 Skill 工作流采集新闻、行情与跨政治/金融/科技板块的联动信号。',
    '- 如果需要把结果发往外部通道，必须遵守当前权限和投递配置；本托管任务默认只回写 1052 OS 聊天流与通知中心。',
    '- 输出中文简报，包含核心摘要、分板块观察、市场异常、传导链、风险/机会和主要来源。',
  ].join('\n')
}

async function syncMorningBriefScheduledTask(settings: MorningBriefSettings) {
  const tasks = await listScheduledTasks({ target: 'agent', limit: 200 })
  const existing = tasks.find(
    (task) => task.notes.includes(MORNING_BRIEF_TASK_MARKER),
  )
  const input = {
    title: MORNING_BRIEF_TASK_TITLE,
    notes: `${MORNING_BRIEF_TASK_MARKER}\n由 Agent 行为设置管理。外部通道投递默认关闭；需要飞书/微信投递时，请在定时任务中显式配置目标。`,
    target: 'agent' as const,
    mode: 'ongoing' as const,
    startDate: existing?.startDate ?? todayInHongKong(),
    time: settings.time,
    repeatUnit: 'day' as const,
    repeatInterval: 1,
    repeatWeekdays: [],
    endDate: '',
    prompt: buildMorningBriefPrompt(),
    command: '',
    enabled: settings.enabled,
    delivery: existing?.delivery ?? {
      wechat: { mode: 'off' as const, accountId: '', peerId: '' },
      feishu: { mode: 'off' as const, receiveIdType: 'chat_id' as const, receiveId: '' },
    },
  }

  if (existing) {
    await updateScheduledTask(existing.id, input)
  } else if (settings.enabled) {
    await createScheduledTask(input)
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
    contextMessageLimit:
      typeof (agent as { contextMessageLimit?: unknown }).contextMessageLimit === 'number' &&
      Number.isFinite((agent as { contextMessageLimit?: unknown }).contextMessageLimit)
        ? Math.min(
            Math.max(
              Math.round((agent as { contextMessageLimit?: number }).contextMessageLimit ?? 50),
              1,
            ),
            300,
          )
        : DEFAULT_SETTINGS.agent.contextMessageLimit,
    progressiveDisclosureEnabled:
      typeof (agent as { progressiveDisclosureEnabled?: unknown }).progressiveDisclosureEnabled ===
      'boolean'
        ? Boolean((agent as { progressiveDisclosureEnabled?: unknown }).progressiveDisclosureEnabled)
        : DEFAULT_SETTINGS.agent.progressiveDisclosureEnabled,
    providerCachingEnabled:
      typeof (agent as { providerCachingEnabled?: unknown }).providerCachingEnabled === 'boolean'
        ? Boolean((agent as { providerCachingEnabled?: unknown }).providerCachingEnabled)
        : DEFAULT_SETTINGS.agent.providerCachingEnabled,
    checkpointEnabled:
      typeof (agent as { checkpointEnabled?: unknown }).checkpointEnabled === 'boolean'
        ? Boolean((agent as { checkpointEnabled?: unknown }).checkpointEnabled)
        : DEFAULT_SETTINGS.agent.checkpointEnabled,
    seedOnResumeEnabled:
      typeof (agent as { seedOnResumeEnabled?: unknown }).seedOnResumeEnabled === 'boolean'
        ? Boolean((agent as { seedOnResumeEnabled?: unknown }).seedOnResumeEnabled)
        : DEFAULT_SETTINGS.agent.seedOnResumeEnabled,
    upgradeDebugEventsEnabled:
      typeof (agent as { upgradeDebugEventsEnabled?: unknown }).upgradeDebugEventsEnabled ===
      'boolean'
        ? Boolean((agent as { upgradeDebugEventsEnabled?: unknown }).upgradeDebugEventsEnabled)
        : DEFAULT_SETTINGS.agent.upgradeDebugEventsEnabled,
    morningBrief: normalizeMorningBriefSettings(
      (agent as { morningBrief?: unknown }).morningBrief,
      DEFAULT_SETTINGS.agent.morningBrief,
    ),
  }
}

function normalizeUapisSettings(uapis: Partial<UapisSettings> | undefined): UapisSettings {
  return {
    apiKey: typeof uapis?.apiKey === 'string' ? uapis.apiKey : DEFAULT_SETTINGS.uapis.apiKey,
  }
}

function normalizeAppearanceSettings(
  appearance: Partial<AppearanceSettings> | undefined,
): AppearanceSettings {
  return {
    theme:
      appearance?.theme === 'dark' || appearance?.theme === 'light' || appearance?.theme === 'auto'
        ? appearance.theme
        : DEFAULT_SETTINGS.appearance.theme,
    language:
      appearance?.language === 'zh-CN' || appearance?.language === 'en-US'
        ? appearance.language
        : DEFAULT_SETTINGS.appearance.language,
  }
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}

function toPublicLlmProfile(profile: LLMProfile): PublicLLMProfile {
  const { apiKey: _apiKey, ...safeProfile } = profile
  return {
    ...safeProfile,
    hasApiKey: profile.apiKey.length > 0,
    apiKeyMask: maskKey(profile.apiKey),
  }
}

function toPublic(settings: Settings): PublicSettings {
  return {
    llm: {
      baseUrl: settings.llm.baseUrl,
      modelId: settings.llm.modelId,
      kind: settings.llm.kind,
      provider: settings.llm.provider,
      activeProfileId: settings.llm.activeProfileId,
      profiles: settings.llm.profiles.map((profile) => toPublicLlmProfile(profile)),
      taskRoutes: settings.llm.taskRoutes,
      hasApiKey: settings.llm.apiKey.length > 0,
      apiKeyMask: maskKey(settings.llm.apiKey),
    },
    imageGeneration: {
      apiFormat: settings.imageGeneration.apiFormat,
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
    uapis: {
      hasApiKey: settings.uapis.apiKey.length > 0,
      apiKeyMask: maskKey(settings.uapis.apiKey),
      mode: settings.uapis.apiKey.length > 0 ? 'api-key' : 'free-ip-quota',
      home: 'https://uapis.cn',
      console: 'https://uapis.cn/console',
      anonymousMonthlyCredits: 1500,
      apiKeyMonthlyCredits: 3500,
    },
  }
}

function replaceProfile(profiles: readonly LLMProfile[], nextProfile: LLMProfile): LLMProfile[] {
  const next: LLMProfile[] = []
  let replaced = false
  for (const profile of profiles) {
    if (profile.id === nextProfile.id) {
      next.push(nextProfile)
      replaced = true
    } else {
      next.push(profile)
    }
  }
  if (!replaced) next.push(nextProfile)
  return next
}

function applyLlmPatch(current: LLMSettings, patch: Partial<LLMSettings> | undefined): LLMSettings {
  if (!patch) return current

  let profiles = current.profiles
  if (Array.isArray(patch.profiles)) {
    profiles = patch.profiles
      .map((profile, index) => normalizeLlmProfile(profile, index))
      .filter((profile): profile is LLMProfile => profile !== null)
  }

  const hasManualConfigPatch =
    typeof patch.baseUrl === 'string' ||
    typeof patch.modelId === 'string' ||
    (typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0) ||
    VALID_LLM_KINDS.has(patch.kind as LLMProfileKind) ||
    VALID_LLM_PROVIDERS.has(patch.provider as LLMProviderKind)

  let activeProfileId =
    typeof patch.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === patch.activeProfileId)
      ? patch.activeProfileId
      : current.activeProfileId

  if (hasManualConfigPatch) {
    const currentActive =
      profiles.find((profile) => profile.id === activeProfileId) ??
      profiles.find((profile) => profile.id === current.activeProfileId)
    const baseUrl =
      typeof patch.baseUrl === 'string' ? patch.baseUrl.trim() : currentActive?.baseUrl ?? ''
    const modelId =
      typeof patch.modelId === 'string' ? patch.modelId.trim() : currentActive?.modelId ?? ''
    const provider = VALID_LLM_PROVIDERS.has(patch.provider as LLMProviderKind)
      ? (patch.provider as LLMProviderKind)
      : currentActive?.provider ?? inferLlmProvider(baseUrl, modelId)
    const kind = VALID_LLM_KINDS.has(patch.kind as LLMProfileKind)
      ? (patch.kind as LLMProfileKind)
      : currentActive?.kind ?? inferLlmKind(baseUrl, provider)
    const apiKey =
      typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0
        ? patch.apiKey.trim()
        : currentActive?.apiKey ?? ''

    if (baseUrl && modelId) {
      const nextProfile: LLMProfile = {
        id: currentActive?.id ?? hashId('llm', ['manual', kind, provider, baseUrl, modelId]),
        name: currentActive?.name ?? '当前模型',
        kind,
        provider,
        baseUrl,
        modelId,
        apiKey,
        enabled: currentActive?.enabled ?? true,
        detected: currentActive?.detected,
        source: currentActive?.source,
        lastSeenAt: currentActive?.lastSeenAt,
      }
      profiles = replaceProfile(profiles, nextProfile)
      activeProfileId = nextProfile.id
    }
  }

  const next = mirrorActiveLlmProfile({
    kind: current.kind,
    provider: current.provider,
    activeProfileId,
    profiles,
    taskRoutes: normalizeLlmTaskRoutes(patch.taskRoutes ?? current.taskRoutes, profiles),
  })
  return normalizeLlmSettings(next)
}

export function resolveLlmConfigForTask(
  llm: LLMSettings,
  task: LLMTaskKind = 'agent-chat',
): LLMSettings {
  const route = llm.taskRoutes.find((item) => item.task === task)
  const routedProfile =
    route ? llm.profiles.find((profile) => profile.id === route.profileId && profile.enabled) : null
  const activeProfile =
    routedProfile ??
    llm.profiles.find((profile) => profile.id === llm.activeProfileId && profile.enabled) ??
    llm.profiles.find((profile) => profile.enabled)

  if (!activeProfile) return llm

  return {
    ...llm,
    activeProfileId: activeProfile.id,
    baseUrl: activeProfile.baseUrl,
    modelId: activeProfile.modelId,
    apiKey: activeProfile.apiKey,
    kind: activeProfile.kind,
    provider: activeProfile.provider,
  }
}

export async function getSettings(): Promise<Settings> {
  const raw = await readJson<LegacySettings>(FILE, {})
  return mergeSettings(DEFAULT_SETTINGS, {
    ...raw,
    llm: normalizeLlmSettings(raw.llm),
    imageGeneration: normalizeImageGenerationSettings(raw.imageGeneration),
    appearance: normalizeAppearanceSettings(raw.appearance),
    agent: normalizeAgentSettings(raw.agent),
    uapis: normalizeUapisSettings(raw.uapis),
  })
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return toPublic(await getSettings())
}

export async function updateSettings(patch: SettingsPatch): Promise<PublicSettings> {
  const current = await getSettings()
  const agentPatch = patch.agent ?? {}
  const mergedMorningBrief = agentPatch.morningBrief
    ? normalizeMorningBriefSettings(
        { ...current.agent.morningBrief, ...agentPatch.morningBrief },
        current.agent.morningBrief,
      )
    : current.agent.morningBrief
  const mergedAgent: LegacyAgentSettings = {
    ...current.agent,
    ...agentPatch,
    morningBrief: mergedMorningBrief,
  }
  const next: Settings = {
    ...current,
    llm: applyLlmPatch(current.llm, patch.llm),
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
    appearance: normalizeAppearanceSettings({
      ...current.appearance,
      ...(patch.appearance ?? {}),
    }),
    agent: normalizeAgentSettings(mergedAgent),
    uapis: {
      ...current.uapis,
      apiKey:
        typeof patch.uapis?.apiKey === 'string' && patch.uapis.apiKey.trim().length > 0
          ? patch.uapis.apiKey.trim()
          : current.uapis.apiKey,
    },
  }

  await writeJson(FILE, next)
  if (patch.agent?.morningBrief !== undefined) {
    await syncMorningBriefScheduledTask(next.agent.morningBrief)
  }
  return toPublic(next)
}

export function formatMorningBriefRuntimeContext(agent: AgentSettings): string {
  const { enabled, time } = agent.morningBrief
  return [
    'Morning brief settings:',
    `- enabled: ${enabled ? 'true' : 'false'}`,
    `- preferred delivery time: ${time} Asia/Hong_Kong`,
    '- Treat this as the user preference for daily Intel Center briefs. Do not create, modify, or send scheduled external deliveries unless the user asked for that change or the relevant permission mode allows it.',
  ].join('\n')
}

export async function upsertLlmProfile(
  profileInput: unknown,
  options: { activate?: boolean } = {},
): Promise<PublicSettings> {
  const current = await getSettings()
  const profile = normalizeLlmProfile(profileInput)
  if (!profile) throw httpError(400, '无效的 LLM profile：baseUrl 和 modelId 必填')

  const existing = current.llm.profiles.find((item) => item.id === profile.id)
  const nextProfile: LLMProfile = {
    ...existing,
    ...profile,
    apiKey: profile.apiKey || (profile.kind === 'cloud' ? existing?.apiKey ?? '' : ''),
  }
  const profiles = replaceProfile(current.llm.profiles, nextProfile)
  const nextLlm = mirrorActiveLlmProfile({
    ...current.llm,
    activeProfileId: options.activate ? nextProfile.id : current.llm.activeProfileId,
    profiles,
    taskRoutes: normalizeLlmTaskRoutes(current.llm.taskRoutes, profiles),
  })

  const next = { ...current, llm: normalizeLlmSettings(nextLlm) }
  await writeJson(FILE, next)
  return toPublic(next)
}

export async function activateLlmProfile(profileId: string): Promise<PublicSettings> {
  const current = await getSettings()
  const profile = current.llm.profiles.find((item) => item.id === profileId)
  if (!profile) {
    throw httpError(404, '未找到 LLM profile')
  }
  if (!profile.enabled) throw httpError(400, 'LLM profile 已停用，不能激活')

  const next = {
    ...current,
    llm: normalizeLlmSettings({
      ...current.llm,
      activeProfileId: profileId,
    }),
  }
  await writeJson(FILE, next)
  return toPublic(next)
}

export async function updateLlmTaskRoutes(routesInput: unknown): Promise<PublicSettings> {
  const current = await getSettings()
  const next = {
    ...current,
    llm: normalizeLlmSettings({
      ...current.llm,
      taskRoutes: normalizeLlmTaskRoutes(routesInput, current.llm.profiles),
    }),
  }
  await writeJson(FILE, next)
  return toPublic(next)
}
