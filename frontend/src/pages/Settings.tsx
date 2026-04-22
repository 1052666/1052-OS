import { useEffect, useState, type ReactNode } from 'react'
import { SettingsApi, type PublicSettings, type SettingsPatch } from '../api/settings'
import MemorySummaryPanel from '../components/MemorySummaryPanel'
import TokenUsagePanel from '../components/TokenUsagePanel'
import { useTheme } from '../theme-context'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const LLM_ENDPOINT_PRESETS = [
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4.1-mini',
  },
  {
    name: 'MiniMax Global',
    baseUrl: 'https://api.minimax.io/v1',
    modelId: 'MiniMax-M2',
  },
  {
    name: 'MiniMax 中国区',
    baseUrl: 'https://api.minimaxi.com/v1',
    modelId: 'MiniMax-M2',
  },
  {
    name: 'Gemini OpenAI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.5-flash',
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
  },
  {
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelId: 'kimi-k2-0711-preview',
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'openai/gpt-4.1-mini',
  },
  {
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelId: 'Qwen/Qwen3-32B',
  },
] as const

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

function SettingsFoldout({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
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
        <small>{open ? '收起' : '展开'}</small>
      </button>
      {open ? <div className="settings-foldout-body">{children}</div> : null}
    </section>
  )
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
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
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

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
        setTheme(settings.appearance.theme)
      })
      .catch((err) => setError(err.message ?? '设置加载失败'))
  }, [setTheme])

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
      appearance: { theme },
      agent: { streaming, userPrompt, fullAccess, contextMessageLimit },
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
      setError(errorLike.message ?? '设置保存失败')
      setState('error')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>设置</h1>
          <div className="muted">
            左侧管理模型、图像生成、Agent 行为和外观；右侧查看 Token 使用与长期记忆摘要。
          </div>
        </div>
        <div className="toolbar">
          <button className="chip primary" onClick={save} disabled={state === 'saving'} type="button">
            {state === 'saving' ? '保存中...' : state === 'saved' ? '已保存' : '保存设置'}
          </button>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="settings-layout">
        <div className="settings-main">
          <div className="settings">
            <SettingsFoldout title="LLM 接入" defaultOpen>
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
                      : '尚未配置'}
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

            <SettingsFoldout title="图像生成">
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

            <SettingsFoldout title="UAPIs 工具箱">

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

            <SettingsFoldout title="Agent 行为" defaultOpen>

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

            <SettingsFoldout title="外观">

              <div className="settings-row">
                <div className="settings-row-label">
                  <div className="settings-row-title">主题模式</div>
                  <div className="settings-row-desc">支持深色、浅色和自动跟随系统。</div>
                </div>
                <div className="segmented" role="tablist" aria-label="主题模式">
                  {(['dark', 'light', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={'seg' + (theme === mode ? ' active' : '')}
                      type="button"
                      onClick={() => setTheme(mode)}
                    >
                      {mode === 'dark' ? '深色' : mode === 'light' ? '浅色' : '自动'}
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
