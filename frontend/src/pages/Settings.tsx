import { useEffect, useState, type ReactNode } from 'react'
import { SettingsApi, type PublicSettings, type SettingsPatch } from '../api/settings'
import { AgentApi, type AgentMigrationPreview, type AgentMigrationResult } from '../api/agent'
import { UpdatesApi, type UpdateRun, type UpdateStatus } from '../api/updates'
import MemorySummaryPanel from '../components/MemorySummaryPanel'
import TokenUsagePanel from '../components/TokenUsagePanel'
import { useTheme } from '../theme-context'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function isUpdateRunActive(run: UpdateRun | null): boolean {
  return run?.status === 'queued' || run?.status === 'running'
}

function formatUpdateTime(value: string | null | undefined): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

type LlmPreset = { name: string; baseUrl: string; modelId: string }
type LlmPresetGroup = { name: string; children: LlmPreset[] }

const ZHIPU_PRESETS: LlmPresetGroup = {
  name: '智谱',
  children: [
    { name: '智谱 API', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-5.1' },
    { name: '智谱 Coding API', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', modelId: 'glm-5.1' },
    { name: '智谱 Coding Claude API', baseUrl: 'https://open.bigmodel.cn/api/anthropic', modelId: 'glm-5.1' },
  ],
}

const LLM_ENDPOINT_PRESETS: readonly LlmPreset[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1-mini' },
  { name: 'MiniMax Global', baseUrl: 'https://api.minimax.io/v1', modelId: 'MiniMax-M2.7' },
  { name: 'MiniMax 中国区', baseUrl: 'https://api.minimaxi.com/v1', modelId: 'MiniMax-M2.7' },
  { name: 'Gemini OpenAI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelId: 'gemini-2.5-flash' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat' },
  { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', modelId: 'kimi-k2-0711-preview' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'openai/gpt-4.1-mini' },
  { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelId: 'Qwen/Qwen3-32B' },
]

const IMAGE_ENDPOINT_PRESETS = [
  {
    name: 'OpenAI Image',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-image-1',
  },
  {
    name: 'Gemini 原生图片',
    apiFormat: 'gemini-native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-2.5-flash-image',
  },
  {
    name: 'Gemini OpenAI 图片',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'imagen-4.0-generate-001',
  },
] as const

type LlmProviderKey =
  | 'openai'
  | 'minimax'
  | 'gemini'
  | 'deepseek'
  | 'moonshot'
  | 'openrouter'
  | 'siliconflow'
  | 'zhipu'

const LLM_API_KEY_PORTALS: Record<LlmProviderKey, { name: string; url: string }> = {
  openai: { name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
  minimax: { name: 'MiniMax', url: 'https://platform.minimaxi.com/' },
  gemini: { name: 'Gemini', url: 'https://aistudio.google.com/app/apikey' },
  deepseek: { name: 'DeepSeek', url: 'https://platform.deepseek.com/' },
  moonshot: { name: 'Moonshot', url: 'https://platform.moonshot.cn/' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/' },
  siliconflow: { name: 'SiliconFlow', url: 'https://cloud.siliconflow.cn/i/QOxdzxkd' },
  zhipu: { name: '智谱', url: 'https://open.bigmodel.cn/' },
}

function detectLlmProvider(baseUrl: string, modelId: string): LlmProviderKey {
  const value = `${baseUrl} ${modelId}`.toLowerCase()
  if (value.includes('openrouter')) return 'openrouter'
  if (value.includes('bigmodel.cn')) return 'zhipu'
  if (value.includes('minimax') || value.includes('minimaxi')) return 'minimax'
  if (value.includes('googleapis.com') || value.includes('gemini')) return 'gemini'
  if (value.includes('deepseek')) return 'deepseek'
  if (value.includes('moonshot') || value.includes('kimi')) return 'moonshot'
  if (value.includes('siliconflow')) return 'siliconflow'
  return 'openai'
}

function SettingsFoldout({
  title,
  defaultOpen = false,
  collapseLabel = '收起',
  expandLabel = '展开',
  children,
}: {
  title: string
  defaultOpen?: boolean
  collapseLabel?: string
  expandLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={'settings-section settings-foldout' + (open ? ' open' : '')}>
      <button
        className="settings-section-title"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <small>{open ? collapseLabel : expandLabel}</small>
      </button>
      {open ? <div className="settings-foldout-body">{children}</div> : null}
    </section>
  )
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const [uiLanguage, setUiLanguage] = useState<PublicSettings['appearance']['language']>('zh-CN')
  const t = (zh: string, en: string) => (uiLanguage === 'en-US' ? en : zh)
  const foldoutLabels = { collapseLabel: t('收起', 'Collapse'), expandLabel: t('展开', 'Expand') }
  const [loaded, setLoaded] = useState<PublicSettings | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [imageApiFormat, setImageApiFormat] =
    useState<PublicSettings['imageGeneration']['apiFormat']>('openai-compatible')
  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [imageModelId, setImageModelId] = useState('')
  const [imageApiKey, setImageApiKey] = useState('')
  const [imageSize, setImageSize] = useState<PublicSettings['imageGeneration']['size']>('auto')
  const [imageQuality, setImageQuality] =
    useState<PublicSettings['imageGeneration']['quality']>('auto')
  const [imageBackground, setImageBackground] =
    useState<PublicSettings['imageGeneration']['background']>('auto')
  const [imageOutputFormat, setImageOutputFormat] =
    useState<PublicSettings['imageGeneration']['outputFormat']>('png')
  const [imageOutputCompression, setImageOutputCompression] = useState(80)
  const [uapisApiKey, setUapisApiKey] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [fullAccess, setFullAccess] = useState(false)
  const [contextMessageLimit, setContextMessageLimit] = useState(50)
  const [progressiveDisclosureEnabled, setProgressiveDisclosureEnabled] = useState(true)
  const [providerCachingEnabled, setProviderCachingEnabled] = useState(true)
  const [checkpointEnabled, setCheckpointEnabled] = useState(true)
  const [seedOnResumeEnabled, setSeedOnResumeEnabled] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  const [upgradeDebugEventsEnabled, setUpgradeDebugEventsEnabled] = useState(true)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState('')
  const [migrationSourcePath, setMigrationSourcePath] = useState('')
  const [migrationPreview, setMigrationPreview] = useState<AgentMigrationPreview | null>(null)
  const [migrationResult, setMigrationResult] = useState<AgentMigrationResult | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationError, setMigrationError] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [updateRun, setUpdateRun] = useState<UpdateRun | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [restartMessage, setRestartMessage] = useState('')
  const llmProvider = detectLlmProvider(baseUrl, modelId)
  const llmApiKeyPortal = LLM_API_KEY_PORTALS[llmProvider]
  const updateRunActive = isUpdateRunActive(updateRun)
  const canInstallSystemUpdate = Boolean(
    updateStatus?.canInstall &&
      (updateStatus.updateAvailable || (updateStatus.mode === 'archive' && updateStatus.latest)),
  )

  useEffect(() => {
    SettingsApi.get()
      .then((settings) => {
        setLoaded(settings)
        setBaseUrl(settings.llm.baseUrl)
        setModelId(settings.llm.modelId)
        setImageApiFormat(settings.imageGeneration.apiFormat)
        setImageBaseUrl(settings.imageGeneration.baseUrl)
        setImageModelId(settings.imageGeneration.modelId)
        setImageSize(settings.imageGeneration.size)
        setImageQuality(settings.imageGeneration.quality)
        setImageBackground(settings.imageGeneration.background)
        setImageOutputFormat(settings.imageGeneration.outputFormat)
        setImageOutputCompression(settings.imageGeneration.outputCompression)
        setUserPrompt(settings.agent.userPrompt)
        setStreaming(settings.agent.streaming)
        setFullAccess(settings.agent.fullAccess)
        setContextMessageLimit(settings.agent.contextMessageLimit)
        setProgressiveDisclosureEnabled(settings.agent.progressiveDisclosureEnabled)
        setProviderCachingEnabled(settings.agent.providerCachingEnabled)
        setCheckpointEnabled(settings.agent.checkpointEnabled)
        setSeedOnResumeEnabled(settings.agent.seedOnResumeEnabled)
        setUpgradeDebugEventsEnabled(settings.agent.upgradeDebugEventsEnabled)
        setTheme(settings.appearance.theme)
        setUiLanguage(settings.appearance.language)
      })
      .catch((err) => setError(err.message ?? '设置加载失败'))
  }, [setTheme])

  useEffect(() => {
    let cancelled = false
    UpdatesApi.status()
      .then((status) => {
        if (!cancelled) setUpdateStatus(status)
      })
      .catch((err) => {
        const errorLike = err as { message?: string }
        if (!cancelled) setUpdateError(errorLike.message ?? '更新状态加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!updateRun || !isUpdateRunActive(updateRun)) return undefined
    const timer = window.setInterval(() => {
      void UpdatesApi.run(updateRun.id)
        .then((nextRun) => {
          setUpdateRun(nextRun)
          if (nextRun.status === 'success' || nextRun.status === 'failed') {
            void UpdatesApi.status().then(setUpdateStatus).catch(() => undefined)
          }
        })
        .catch((err) => {
          const errorLike = err as { message?: string }
          setUpdateError(errorLike.message ?? '更新进度读取失败')
        })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [updateRun])

  const applyLlmPreset = (preset: (typeof LLM_ENDPOINT_PRESETS)[number]) => {
    setBaseUrl(preset.baseUrl)
    setModelId(preset.modelId)
  }

  const applyImagePreset = (preset: (typeof IMAGE_ENDPOINT_PRESETS)[number]) => {
    setImageApiFormat(preset.apiFormat)
    setImageBaseUrl(preset.baseUrl)
    setImageModelId(preset.modelId)
  }

  const save = async () => {
    setState('saving')
    setError('')

    const patch: SettingsPatch = {
      llm: {
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      imageGeneration: {
        apiFormat: imageApiFormat,
        baseUrl: imageBaseUrl.trim(),
        modelId: imageModelId.trim(),
        ...(imageApiKey.trim() ? { apiKey: imageApiKey.trim() } : {}),
        size: imageSize,
        quality: imageQuality,
        background: imageBackground,
        outputFormat: imageOutputFormat,
        outputCompression: imageOutputCompression,
      },
      uapis: {
        ...(uapisApiKey.trim() ? { apiKey: uapisApiKey.trim() } : {}),
      },
      appearance: { theme, language: uiLanguage },
      agent: {
        streaming,
        userPrompt,
        fullAccess,
        contextMessageLimit,
        progressiveDisclosureEnabled,
        providerCachingEnabled,
        checkpointEnabled,
        seedOnResumeEnabled,
        upgradeDebugEventsEnabled,
      },
    }

    try {
      const settings = await SettingsApi.update(patch)
      setLoaded(settings)
      setApiKey('')
      setImageApiKey('')
      setUapisApiKey('')
      setState('saved')
      window.setTimeout(() => setState('idle'), 1500)
    } catch (err) {
      const errorLike = err as { message?: string }
      setError(errorLike.message ?? t('设置保存失败', 'Failed to save settings'))
      setState('error')
    }
  }

  const previewMigration = async () => {
    const sourcePath = migrationSourcePath.trim()
    if (!sourcePath) {
      setMigrationError(t('请先填写旧版本项目目录或 data 目录。', 'Enter the old project or data directory first.'))
      return
    }
    setMigrationBusy(true)
    setMigrationError('')
    setMigrationResult(null)
    try {
      setMigrationPreview(await AgentApi.previewMigration(sourcePath))
    } catch (err) {
      const errorLike = err as { message?: string }
      setMigrationError(errorLike.message ?? t('迁移预览失败', 'Migration preview failed'))
    } finally {
      setMigrationBusy(false)
    }
  }

  const runMigration = async () => {
    const sourcePath = migrationSourcePath.trim()
    if (!sourcePath) {
      setMigrationError(t('请先填写旧版本项目目录或 data 目录。', 'Enter the old project or data directory first.'))
      return
    }
    setMigrationBusy(true)
    setMigrationError('')
    try {
      const result = await AgentApi.runMigration(sourcePath)
      setMigrationResult(result)
      setMigrationPreview(result)
    } catch (err) {
      const errorLike = err as { message?: string }
      setMigrationError(errorLike.message ?? t('迁移执行失败', 'Migration failed'))
    } finally {
      setMigrationBusy(false)
    }
  }

  const checkSystemUpdate = async () => {
    setUpdateBusy(true)
    setUpdateError('')
    setRestartMessage('')
    try {
      setUpdateStatus(await UpdatesApi.check())
    } catch (err) {
      const errorLike = err as { message?: string }
      setUpdateError(errorLike.message ?? '检查更新失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  const installSystemUpdate = async () => {
    setUpdateBusy(true)
    setUpdateError('')
    setRestartMessage('')
    try {
      const response = await UpdatesApi.install()
      setUpdateRun(response.run)
    } catch (err) {
      const errorLike = err as { message?: string }
      setUpdateError(errorLike.message ?? '启动更新失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  const restartSystemServices = async () => {
    setUpdateBusy(true)
    setUpdateError('')
    try {
      const result = await UpdatesApi.restart()
      setRestartMessage(result.message)
    } catch (err) {
      const errorLike = err as { message?: string }
      setUpdateError(errorLike.message ?? '重启服务失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('设置', 'Settings')}</h1>
          <div className="muted">
            {t(
              '左侧管理模型、图像生成、Agent 行为和外观；右侧查看 Token 使用与长期记忆摘要。',
              'Configure models, image generation, agent behavior, and appearance on the left; review token usage and memory summary on the right.',
            )}
          </div>
        </div>
        <div className="toolbar">
          <button className="chip primary" onClick={save} disabled={state === 'saving'} type="button">
            {state === 'saving'
              ? t('保存中...', 'Saving...')
              : state === 'saved'
                ? t('已保存', 'Saved')
                : t('保存设置', 'Save Settings')}
          </button>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="settings-layout">
        <div className="settings-main">
          <div className="settings">
            <SettingsFoldout title={t('LLM 接入', 'LLM Access')} defaultOpen {...foldoutLabels}>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">常用端点预设</div>
                  <div className="settings-row-desc">
                    点击后只填入 Base URL 和 Model ID，不会覆盖 API Key。MiniMax Global 使用官方 OpenAI 兼容端点 `https://api.minimax.io/v1`，中国区可用 `https://api.minimaxi.com/v1`。
                  </div>
                </div>
                <div className="settings-preset-grid">
                  {LLM_ENDPOINT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      className="settings-preset-card"
                      type="button"
                      onClick={() => applyLlmPreset(preset)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.baseUrl}</span>
                      <small>{preset.modelId}</small>
                    </button>
                  ))}
                  <div className="settings-preset-group">
                    <button
                      className={`settings-preset-card${expandedGroups.has(ZHIPU_PRESETS.name) ? ' expanded' : ''}`}
                      type="button"
                      onClick={() => toggleGroup(ZHIPU_PRESETS.name)}
                      aria-expanded={expandedGroups.has(ZHIPU_PRESETS.name)}
                      aria-controls="preset-group-zhipu"
                    >
                      <strong>{ZHIPU_PRESETS.name}</strong>
                      <span>{t(`${ZHIPU_PRESETS.children.length} 个端点`, `${ZHIPU_PRESETS.children.length} endpoints`)}</span>
                      <small>{expandedGroups.has(ZHIPU_PRESETS.name) ? t('点击收起', 'Collapse') : t('点击展开', 'Expand')}</small>
                    </button>
                    {expandedGroups.has(ZHIPU_PRESETS.name) && (
                      <div id="preset-group-zhipu" className="settings-preset-subgrid" role="group" aria-label={t(`${ZHIPU_PRESETS.name} 端点列表`, `${ZHIPU_PRESETS.name} endpoints`)}>
                        {ZHIPU_PRESETS.children.map((child) => (
                          <button
                            key={child.name}
                            className="settings-preset-card settings-preset-sub"
                            type="button"
                            onClick={() => applyLlmPreset(child)}
                          >
                            <strong>{child.name}</strong>
                            <span>{child.baseUrl}</span>
                            <small>{child.modelId}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">Base URL</div>
                  <div className="settings-row-desc">
                    OpenAI 兼容聊天接口的基础地址，后端会自动拼接 `/chat/completions`。
                  </div>
                </div>
                <input
                  className="settings-input"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">Model ID</div>
                  <div className="settings-row-desc">请求体中的 `model` 字段，例如 `gpt-4o-mini`。</div>
                </div>
                <input
                  className="settings-input"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">API Key</div>
                  <div className="settings-row-desc">
                    {loaded?.llm.hasApiKey
                      ? `已配置 (${loaded.llm.apiKeyMask})，留空则保持不变`
                      : (
                        <>
                          尚未配置，点击获取（{llmApiKeyPortal.name}）：
                          <a href={llmApiKeyPortal.url} target="_blank" rel="noreferrer">
                            {llmApiKeyPortal.url}
                          </a>
                        </>
                      )}
                  </div>
                </div>
                <input
                  className="settings-input"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={loaded?.llm.hasApiKey ? '保持不变' : 'sk-...'}
                  autoComplete="off"
                />
              </div>
            </SettingsFoldout>

            <SettingsFoldout title={t('图像生成', 'Image Generation')} {...foldoutLabels}>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">图像端点预设</div>
                  <div className="settings-row-desc">
                    支持 OpenAI 兼容 `/images/generations`，也支持 Gemini 原生 `generateContent` 图片格式。点击预设不会覆盖已保存的 API Key。
                  </div>
                </div>
                <div className="settings-preset-grid">
                  {IMAGE_ENDPOINT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      className="settings-preset-card"
                      type="button"
                      onClick={() => applyImagePreset(preset)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.baseUrl}</span>
                      <small>{preset.modelId}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">API 格式</div>
                  <div className="settings-row-desc">
                    OpenAI 兼容会拼接 `/images/generations`；Gemini 原生会拼接 `/models/{'{model}'}:generateContent` 并解析 `inlineData` 图片。
                  </div>
                </div>
                <select
                  className="settings-input"
                  value={imageApiFormat}
                  onChange={(event) =>
                    setImageApiFormat(
                      event.target.value as PublicSettings['imageGeneration']['apiFormat'],
                    )
                  }
                >
                  <option value="openai-compatible">OpenAI compatible</option>
                  <option value="gemini-native">Gemini native</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">Base URL</div>
                  <div className="settings-row-desc">
                    OpenAI 兼容图像接口的基础地址，后端会自动拼接 `/images/generations`。
                  </div>
                </div>
                <input
                  className="settings-input"
                  value={imageBaseUrl}
                  onChange={(event) => setImageBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">Model ID</div>
                  <div className="settings-row-desc">
                    默认推荐 `gpt-image-1`，配置后 Agent 可在聊天中直接生成图片。
                  </div>
                </div>
                <input
                  className="settings-input"
                  value={imageModelId}
                  onChange={(event) => setImageModelId(event.target.value)}
                  placeholder="gpt-image-1"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">API Key</div>
                  <div className="settings-row-desc">
                    {loaded?.imageGeneration.hasApiKey
                      ? `已配置 (${loaded.imageGeneration.apiKeyMask})，留空则保持不变`
                      : '尚未配置'}
                  </div>
                </div>
                <input
                  className="settings-input"
                  type="password"
                  value={imageApiKey}
                  onChange={(event) => setImageApiKey(event.target.value)}
                  placeholder={loaded?.imageGeneration.hasApiKey ? '保持不变' : 'sk-...'}
                  autoComplete="off"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">默认尺寸</div>
                  <div className="settings-row-desc">模型未明确指定时使用的输出尺寸。</div>
                </div>
                <select
                  className="settings-input"
                  value={imageSize}
                  onChange={(event) =>
                    setImageSize(event.target.value as PublicSettings['imageGeneration']['size'])
                  }
                >
                  <option value="auto">auto</option>
                  <option value="1024x1024">1024x1024</option>
                  <option value="1536x1024">1536x1024</option>
                  <option value="1024x1536">1024x1536</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">默认质量</div>
                  <div className="settings-row-desc">质量越高通常越慢，调用成本也更高。</div>
                </div>
                <select
                  className="settings-input"
                  value={imageQuality}
                  onChange={(event) =>
                    setImageQuality(
                      event.target.value as PublicSettings['imageGeneration']['quality'],
                    )
                  }
                >
                  <option value="auto">auto</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">默认背景</div>
                  <div className="settings-row-desc">
                    透明背景更适合贴图和素材；普通图片通常可以保持 `opaque`。
                  </div>
                </div>
                <select
                  className="settings-input"
                  value={imageBackground}
                  onChange={(event) =>
                    setImageBackground(
                      event.target.value as PublicSettings['imageGeneration']['background'],
                    )
                  }
                >
                  <option value="auto">auto</option>
                  <option value="opaque">opaque</option>
                  <option value="transparent">transparent</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">输出格式</div>
                  <div className="settings-row-desc">用于默认出图格式，后续可按需覆盖。</div>
                </div>
                <select
                  className="settings-input"
                  value={imageOutputFormat}
                  onChange={(event) =>
                    setImageOutputFormat(
                      event.target.value as PublicSettings['imageGeneration']['outputFormat'],
                    )
                  }
                >
                  <option value="png">png</option>
                  <option value="jpeg">jpeg</option>
                  <option value="webp">webp</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">输出压缩率</div>
                  <div className="settings-row-desc">仅对 `jpeg` 和 `webp` 生效，范围 `0-100`。</div>
                </div>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={imageOutputCompression}
                  onChange={(event) =>
                    setImageOutputCompression(Math.max(0, Math.min(100, Number(event.target.value) || 0)))
                  }
                />
              </div>
            </SettingsFoldout>

            <SettingsFoldout title={t('UAPIs 工具箱', 'UAPIs Toolbox')} {...foldoutLabels}>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">调用模式</div>
                  <div className="settings-row-desc">
                    {loaded?.uapis.mode === 'api-key'
                      ? `API Key 模式 (${loaded.uapis.apiKeyMask})，留空则保持不变。`
                      : '免费 IP 额度模式：不登录不注册时，每个 IP 每月约 1500 积分。'}
                  </div>
                </div>
                <input
                  className="settings-input"
                  type="password"
                  value={uapisApiKey}
                  onChange={(event) => setUapisApiKey(event.target.value)}
                  placeholder={loaded?.uapis.hasApiKey ? '保持不变' : '可选，Bearer API Key'}
                  autoComplete="off"
                />
              </div>

              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">额度与官网</div>
                  <div className="settings-row-desc">
                    UAPIs 的 API Key 是可选项。不填写也能使用免费 IP 额度；注册登录后填写免费
                    Key，月额度约提升到 {loaded?.uapis.apiKeyMonthlyCredits ?? 3500} 积分。
                  </div>
                </div>
                <div className="uapis-settings-links">
                  <a href={loaded?.uapis.home || 'https://uapis.cn'} target="_blank" rel="noreferrer">
                    官网
                  </a>
                  <a
                    href={loaded?.uapis.console || 'https://uapis.cn/console'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    控制台
                  </a>
                </div>
              </div>
            </SettingsFoldout>

            <SettingsFoldout title={t('Agent 行为', 'Agent Behavior')} defaultOpen {...foldoutLabels}>

              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">长期偏好提示</div>
                  <div className="settings-row-desc">
                    这段内容会随系统提示一起长期生效，适合放通用输出偏好和协作规则。
                  </div>
                </div>
                <textarea
                  className="settings-input"
                  rows={6}
                  value={userPrompt}
                  onChange={(event) => setUserPrompt(event.target.value)}
                  placeholder="例如：默认使用中文回复；优先给出可执行结论；修改前先说明影响范围。"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">流式输出</div>
                  <div className="settings-row-desc">
                    开启后聊天会通过 SSE 实时返回内容，而不是等待整段生成结束。
                  </div>
                </div>
                <button
                  className={'switch' + (streaming ? ' on' : '')}
                  type="button"
                  onClick={() => setStreaming((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">聊天上下文条数</div>
                  <div className="settings-row-desc">
                    控制每次发给模型的最近聊天消息条数。默认 50 条，范围 1-300 条。
                  </div>
                </div>
                <input
                  className="settings-input"
                  type="number"
                  min={1}
                  max={300}
                  step={1}
                  value={contextMessageLimit}
                  onChange={(event) =>
                    setContextMessageLimit(
                      Math.max(1, Math.min(300, Number(event.target.value) || 1)),
                    )
                  }
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">1052-PD 渐进披露</div>
                  <div className="settings-row-desc">
                    启用单引擎渐进式上下文加载，通过 `request_context_upgrade` 按需挂载工具包，降低首轮 token 消耗。
                  </div>
                </div>
                <button
                  className={'switch' + (progressiveDisclosureEnabled ? ' on' : '')}
                  type="button"
                  onClick={() => setProgressiveDisclosureEnabled((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">模型前缀缓存</div>
                  <div className="settings-row-desc">
                    保持核心提示词前缀稳定，让支持缓存的模型供应商复用前缀，减少重复会话成本。
                  </div>
                </div>
                <button
                  className={'switch' + (providerCachingEnabled ? ' on' : '')}
                  type="button"
                  onClick={() => setProviderCachingEnabled((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">检查点摘要</div>
                  <div className="settings-row-desc">
                    持久化精简工作检查点，后续轮次优先注入摘要，避免每次回放过长历史。
                  </div>
                </div>
                <button
                  className={'switch' + (checkpointEnabled ? ' on' : '')}
                  type="button"
                  onClick={() => setCheckpointEnabled((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">老会话种子检查点</div>
                  <div className="settings-row-desc">
                    老会话续聊且缺少检查点时，自动生成一次种子检查点，尽量保留原有上下文。
                  </div>
                </div>
                <button
                  className={'switch' + (seedOnResumeEnabled ? ' on' : '')}
                  type="button"
                  onClick={() => setSeedOnResumeEnabled((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">升级调试事件</div>
                  <div className="settings-row-desc">
                    在流式聊天中输出工具包申请和挂载事件，便于界面提示、排查升级链路和统计额外开销。
                  </div>
                </div>
                <button
                  className={'switch' + (upgradeDebugEventsEnabled ? ' on' : '')}
                  type="button"
                  onClick={() => setUpgradeDebugEventsEnabled((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">完全权限</div>
                  <div className="settings-row-desc">
                    开启后，Agent 对本地文件、笔记、资源、Skill、终端和长期记忆写入拥有最高权限，不再重复确认。
                  </div>
                </div>
                <button
                  className={'switch' + (fullAccess ? ' on' : '')}
                  type="button"
                  onClick={() => setFullAccess((current) => !current)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </SettingsFoldout>

            <SettingsFoldout title={t('系统更新', 'System Update')} {...foldoutLabels}>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">检查与安装 GitHub 最新版</div>
                  <div className="settings-row-desc">
                    从 1052-OS 的 main 分支读取最新提交，安装时会保留 data、密钥、日志、AGENTS.md 和 CHANGELOG.md，并在构建完成后自动重启前后端。
                  </div>
                </div>

                <div className="update-status-grid">
                  <div className="update-status-card">
                    <span>当前版本</span>
                    <strong>{updateStatus?.current.shortCommit || '未知'}</strong>
                    <small>
                      {updateStatus?.mode === 'git'
                        ? `Git ${updateStatus.current.branch || 'main'}`
                        : updateStatus?.current.source === 'state'
                          ? '源码包基线'
                          : '源码包'}
                    </small>
                  </div>
                  <div className="update-status-card">
                    <span>最新版本</span>
                    <strong>{updateStatus?.latest?.shortCommit || '未检查'}</strong>
                    <small>{updateStatus?.latest ? formatUpdateTime(updateStatus.latest.date) : '点击检查更新'}</small>
                  </div>
                  <div className="update-status-card">
                    <span>状态</span>
                    <strong>
                      {updateRunActive
                        ? '更新中'
                        : updateStatus?.updateAvailable
                          ? '可更新'
                          : updateStatus?.latest
                            ? '已是最新'
                            : '待检查'}
                    </strong>
                    <small>{updateStatus?.lastCheckedAt ? formatUpdateTime(updateStatus.lastCheckedAt) : '尚无记录'}</small>
                  </div>
                </div>

                {updateStatus?.latest ? (
                  <div className="settings-help">
                    <strong>GitHub main</strong>
                    <span>{updateStatus.latest.message}</span>
                    <a href={updateStatus.latest.url} target="_blank" rel="noreferrer">
                      查看提交 {updateStatus.latest.shortCommit}
                    </a>
                  </div>
                ) : null}

                {updateStatus?.warnings.length ? (
                  <div className="settings-help update-warning">
                    <strong>更新提示</strong>
                    {updateStatus.warnings.map((warning) => (
                      <span key={warning}>{warning}</span>
                    ))}
                  </div>
                ) : null}

                {updateError ? <div className="settings-error">{updateError}</div> : null}
                {restartMessage ? <div className="settings-help">{restartMessage}</div> : null}

                <div className="settings-actions update-actions">
                  <button
                    className="chip"
                    type="button"
                    disabled={updateBusy || updateRunActive}
                    onClick={() => void checkSystemUpdate()}
                  >
                    {updateBusy && !updateRunActive ? '处理中...' : '检查更新'}
                  </button>
                  <button
                    className="chip primary"
                    type="button"
                    disabled={
                      updateBusy ||
                      updateRunActive ||
                      !canInstallSystemUpdate
                    }
                    onClick={() => void installSystemUpdate()}
                  >
                    {updateStatus && !updateStatus.updateAvailable && updateStatus.mode === 'archive'
                      ? '重新安装最新版'
                      : '安装更新'}
                  </button>
                  <button
                    className="chip"
                    type="button"
                    disabled={updateBusy || updateRunActive || updateRun?.status !== 'success'}
                    onClick={() => void restartSystemServices()}
                  >
                    再次重启
                  </button>
                </div>

                {updateRun ? (
                  <div className="update-run-panel">
                    <div className="update-run-head">
                      <div>
                        <strong>{updateRun.phaseLabel}</strong>
                        <span>{updateRun.message}</span>
                      </div>
                      <em>{Math.max(0, Math.min(100, Math.round(updateRun.progress)))}%</em>
                    </div>
                    <div className="update-progress" aria-label="更新进度">
                      <div
                        className="update-progress-bar"
                        style={{ width: `${Math.max(0, Math.min(100, updateRun.progress))}%` }}
                      />
                    </div>
                    {updateRun.logTail ? <pre className="update-log">{updateRun.logTail}</pre> : null}
                  </div>
                ) : null}
              </div>
            </SettingsFoldout>

            <SettingsFoldout title={t('历史版本迁移', 'Legacy Migration')} {...foldoutLabels}>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-label">
                  <div className="settings-row-title">一键迁移旧版数据</div>
                  <div className="settings-row-desc">
                    填写旧版 1052 OS 项目根目录或旧 data 目录。迁移工具会先预览可导入项，执行时不会覆盖当前已有数据；冲突内容会放入 `data/1052/migrations/` 归档。
                  </div>
                </div>
                <input
                  className="settings-input"
                  value={migrationSourcePath}
                  onChange={(event) => setMigrationSourcePath(event.target.value)}
                  placeholder="例如：D:\1052os-old 或 D:\1052os-old\data"
                />
                <div className="settings-actions">
                  <button
                    className="chip"
                    type="button"
                    disabled={migrationBusy}
                    onClick={() => void previewMigration()}
                  >
                    {migrationBusy ? '处理中...' : '预览迁移'}
                  </button>
                  <button
                    className="chip primary"
                    type="button"
                    disabled={migrationBusy || !migrationPreview}
                    onClick={() => void runMigration()}
                  >
                    执行迁移
                  </button>
                </div>
                {migrationError && <div className="settings-error">{migrationError}</div>}
                {migrationPreview && (
                  <div className="settings-help">
                    <strong>预览结果</strong>
                    <span>
                      源数据：{migrationPreview.sourceDataDir}；目标数据：{migrationPreview.targetDataDir}
                    </span>
                    <span>
                      可见文件数：{migrationPreview.totalFiles}；总大小：{migrationPreview.totalBytes} bytes
                    </span>
                    <ul>
                      {migrationPreview.entries.map((entry) => (
                        <li key={entry.key}>
                          {entry.key}: {entry.exists ? entry.status : '未找到'}，{entry.fileCount ?? 0} 个文件
                          {entry.reason ? `，${entry.reason}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {migrationResult && (
                  <div className="settings-help">
                    <strong>迁移完成</strong>
                    <span>迁移 ID：{migrationResult.migrationId}</span>
                    <span>清单文件：{migrationResult.manifestPath}</span>
                  </div>
                )}
              </div>
            </SettingsFoldout>
            <SettingsFoldout title={t('外观', 'Appearance')} {...foldoutLabels}>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">{t('界面语言', 'Interface Language')}</div>
                  <div className="settings-row-desc">
                    {t(
                      '设置面板支持中文与英文，保存后即时生效。',
                      'The settings panel supports Chinese and English and applies immediately after saving.',
                    )}
                  </div>
                </div>
                <select
                  className="settings-input"
                  value={uiLanguage}
                  onChange={(event) =>
                    setUiLanguage(event.target.value as PublicSettings['appearance']['language'])
                  }
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">{t('主题模式', 'Theme Mode')}</div>
                  <div className="settings-row-desc">
                    {t('支持深色、浅色和自动跟随系统。', 'Supports dark, light, and system auto mode.')}
                  </div>
                </div>
                <div className="segmented" role="tablist" aria-label={t('主题模式', 'Theme Mode')}>
                  {(['dark', 'light', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={'seg' + (theme === mode ? ' active' : '')}
                      type="button"
                      onClick={() => setTheme(mode)}
                    >
                      {mode === 'dark'
                        ? t('深色', 'Dark')
                        : mode === 'light'
                          ? t('浅色', 'Light')
                          : t('自动', 'Auto')}
                    </button>
                  ))}
                </div>
              </div>
            </SettingsFoldout>
          </div>
        </div>

        <div className="settings-side">
          <TokenUsagePanel />
          <MemorySummaryPanel />
        </div>
      </div>
    </div>
  )
}
