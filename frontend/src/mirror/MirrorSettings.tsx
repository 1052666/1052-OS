import { useTheme } from '../theme-context'
import { useSettingsPageModel } from '../hooks/useSettingsPageModel'
import { useTokenUsage } from '../hooks/useTokenUsage'
import type { LlmTaskKind } from '../api/settings'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import {
  MirrorButton,
  MirrorCard,
  MirrorCollapsible,
  MirrorInput,
  MirrorPresetCard,
  MirrorProgressBar,
  MirrorStatCard,
  MirrorText,
} from './primitives'

function pctOf(part: number | undefined, total: number | undefined): number {
  if (!part || !total) return 0
  return Math.min(100, Math.max(0, (part / total) * 100))
}

/**
 * IU-9: 2-column console shell + save chip in the page header.
 * IU-10: LEFT column — LLM 接入 card + 9-preset 2-col grid + sub-sections
 *   (模型 Profile / 本地模型扫描 / 任务级推理路由)
 * Right column (IU-11): Token 可视化 + Cache 与升级开销 + 来源与时间窗口
 *
 * Render-only discipline: state lives in useSettingsPageModel.
 * Features that depend on classic-Settings ephemeral state (local scan results,
 * profile-name input + save/activate/delete, full task-route table) are rendered
 * as safe stubs until the hook surface grows in a future IU.
 */

const LLM_PRESETS: ReadonlyArray<{ id: string; name: string; baseUrl: string; modelId: string }> = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1-mini' },
  { id: 'minimax-global', name: 'MiniMax Global', baseUrl: 'https://api.minimax.io/v1', modelId: 'MiniMax-M2.7' },
  { id: 'minimax-cn', name: 'MiniMax 中国区', baseUrl: 'https://api.minimaxi.com/v1', modelId: 'MiniMax-M2.7' },
  { id: 'gemini', name: 'Gemini OpenAI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelId: 'gemini-2.5-flash' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', modelId: 'kimi-k2-0711-preview' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'openai/gpt-4.1-mini' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelId: 'Qwen/Qwen3-32B' },
  { id: 'zhipu', name: '智谱', baseUrl: '', modelId: '3 个端点' },
]

const LLM_TASKS: ReadonlyArray<{ task: LlmTaskKind; label: string; description: string }> = [
  { task: 'agent-chat', label: 'Agent 对话', description: '默认对话、工具调用和多轮协作' },
  { task: 'pdf-to-markdown', label: 'PDF 转 Markdown', description: '后续 PDF 解析链路的本地优先任务' },
  { task: 'coding', label: '代码任务', description: '代码阅读、修改和解释类任务' },
  { task: 'summarization', label: '摘要压缩', description: 'checkpoint seed 和上下文压缩' },
  { task: 'vision', label: '视觉任务', description: '预留给多模态识别链路' },
]

export function MirrorSettings() {
  const { theme } = useTheme()
  const model = useSettingsPageModel()
  const usage = useTokenUsage()

  const profiles = model.loaded?.llm.profiles ?? []
  const activeProfileId = model.loaded?.llm.activeProfileId ?? ''
  const activeProfileName =
    profiles.find((p) => p.id === activeProfileId)?.name ?? '云端·未配置'

  // Token usage data — pulled from the same `/agent/stats/usage` endpoint as
  // the classic TokenUsagePanel. Fields are null/undefined when the request
  // hasn't returned yet; MirrorStatCard renders `null` as an em-dash.
  const totals = usage.stats?.totals
  const totalTokens = totals?.totalTokens
  const coverage = totals && totals.assistantMessages > 0
    ? (totals.messagesWithUsage / totals.assistantMessages) * 100
    : 0
  const current = usage.stats?.current
  const archived = usage.stats?.archived
  const recent7 = usage.stats?.recent7Days

  return (
    <MirrorPageWrapper
      header={
        <MirrorPageHeader
          title="设置"
          subtitle="左侧管理模型、图像生成、Agent 行为和外观；右侧查看 Token 使用与长期记忆摘要。"
          actions={
            <MirrorButton
              disabled={!model.isDirty || model.saveState === 'saving'}
              onClick={() => void model.save(theme)}
            >
              {model.saveState === 'saving' ? '保存中…' : '保存设置'}
            </MirrorButton>
          }
        />
      }
    >
      <div className="mr-settings-grid">
        <div className="mr-settings-col mr-settings-col-left">
          <MirrorCard level={1} pad="form">
            <MirrorCollapsible title="LLM 接入" defaultOpen>
              {/* 当前配置 — Base URL / Model ID / API Key */}
              <section className="mr-settings-sub">
                <MirrorText role="title" as="h4">当前配置</MirrorText>
                <div className="mr-settings-field">
                  <MirrorText role="label" as="label">BASE URL</MirrorText>
                  <MirrorInput
                    value={model.baseUrl}
                    onChange={(e) => model.setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="mr-settings-field">
                  <MirrorText role="label" as="label">MODEL ID</MirrorText>
                  <MirrorInput
                    value={model.modelId}
                    onChange={(e) => model.setModelId(e.target.value)}
                    placeholder="gpt-4.1-mini"
                  />
                </div>
                <div className="mr-settings-field">
                  <MirrorText role="label" as="label">API KEY</MirrorText>
                  <MirrorInput
                    type="password"
                    value={model.apiKey}
                    onChange={(e) => model.setApiKey(e.target.value)}
                    placeholder="留空保持现有 key 不变"
                  />
                </div>
              </section>

              {/* 常用端点预设 — 2-col grid */}
              <section className="mr-settings-sub">
                <MirrorText role="title" as="h4">常用端点预设</MirrorText>
                <MirrorText role="body" as="p" className="mr-settings-sub-desc">
                  点击后只填入 Base URL 和 Model ID，不会覆盖 API Key。MiniMax Global 使用官方 OpenAI 兼容端点 "https://api.minimax.io/v1"，中国区可用 "https://api.minimaxi.com/v1"。
                </MirrorText>
                <div className="mr-preset-grid">
                  {LLM_PRESETS.map((p) => (
                    <MirrorPresetCard
                      key={p.id}
                      name={p.name}
                      url={p.baseUrl || undefined}
                      modelId={p.modelId}
                      onClick={p.baseUrl ? () => model.applyLlmPreset({ baseUrl: p.baseUrl, modelId: p.modelId }) : undefined}
                      selected={
                        !!p.baseUrl &&
                        model.baseUrl === p.baseUrl &&
                        model.modelId === p.modelId
                      }
                    />
                  ))}
                </div>
              </section>

              {/* 模型 Profile */}
              <section className="mr-settings-sub">
                <MirrorText role="title" as="h4">模型 Profile</MirrorText>
                <MirrorText role="body" as="p" className="mr-settings-sub-desc">
                  当前激活：{activeProfileName}
                </MirrorText>
                {profiles.length > 0 ? (
                  <div className="mr-profile-chip-row">
                    {profiles.map((profile) => (
                      <span
                        key={profile.id}
                        className={`mr-chip${profile.id === activeProfileId ? ' is-active' : ''}`}
                      >
                        {profile.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <MirrorText role="meta" as="p" className="mr-settings-sub-stub">
                    保存一次当前 Base URL 和 Model ID 后会生成默认 Profile。
                  </MirrorText>
                )}
                <MirrorText role="meta" as="p" className="mr-settings-sub-stub">
                  Profile 保存 / 激活 / 删除入口暂在经典设置页（待 hook 扩展后接入）。
                </MirrorText>
              </section>

              {/* 本地模型扫描 */}
              <section className="mr-settings-sub">
                <MirrorText role="title" as="h4">本地模型扫描</MirrorText>
                <MirrorText role="body" as="p" className="mr-settings-sub-desc">
                  扫描 Ollama、LM Studio、LocalAI、vLLM、llama.cpp 和常见 OpenAI 兼容本地端口。
                </MirrorText>
                <MirrorButton disabled>扫描本地模型</MirrorButton>
                <MirrorText role="meta" as="p" className="mr-settings-sub-stub">
                  扫描动作暂在经典设置页（待 hook 扩展后接入）。
                </MirrorText>
              </section>

              {/* 任务级推理路由 */}
              <section className="mr-settings-sub">
                <MirrorText role="title" as="h4">任务级推理路由</MirrorText>
                <MirrorText role="body" as="p" className="mr-settings-sub-desc">
                  为不同任务选择最佳模型，自动均衡成本与效果。
                </MirrorText>
                <div className="mr-task-route-list">
                  {LLM_TASKS.map(({ task, label, description }) => (
                    <div key={task} className="mr-task-route-row">
                      <div className="mr-task-route-meta">
                        <MirrorText role="title" as="div">{label}</MirrorText>
                        <MirrorText role="meta" as="div">{description}</MirrorText>
                      </div>
                      <select
                        className="mr-input mr-task-route-select"
                        value={model.taskRouteProfileId(task)}
                        onChange={(e) => model.updateTaskRoute(task, e.target.value)}
                      >
                        <option value="">跟随当前激活</option>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            </MirrorCollapsible>
          </MirrorCard>
        </div>
        <div className="mr-settings-col mr-settings-col-right">
          {/* Card 1: Token 可视化面板 */}
          <MirrorCard level={1} pad="form">
            <header className="mr-card-header">
              <div>
                <MirrorText role="title" as="h3">Token 可视化面板</MirrorText>
                <MirrorText role="body" as="p" className="mr-settings-sub-desc">
                  重点观察总量、上下文开销、cache 命中和升级动作额外成本。
                </MirrorText>
              </div>
              <MirrorButton
                variant="subtle"
                disabled={usage.refreshing || usage.loading}
                onClick={() => void usage.refresh()}
              >
                {usage.refreshing ? '刷新中…' : '刷新统计'}
              </MirrorButton>
            </header>
            <div className="mr-stat-grid">
              <MirrorStatCard label="累计总量" value={totalTokens ?? null} />
              <MirrorStatCard
                label="用户输入"
                value={totals?.userTokens ?? null}
                delta={totals ? { value: `覆盖率 ${coverage.toFixed(1)}%` } : undefined}
              />
              <MirrorStatCard label="AI 输出" value={totals?.outputTokens ?? null} />
              <MirrorStatCard label="上下文开销" value={totals?.contextTokens ?? null} />
            </div>
          </MirrorCard>

          {/* Card 2: Cache 与升级开销 */}
          <MirrorCard level={1} pad="form">
            <MirrorText role="title" as="h3">Cache 与升级开销</MirrorText>
            <MirrorText role="body" as="p" className="mr-settings-sub-desc">
              这里单独拆出 provider cache 与 request_context_upgrade 造成的额外 token。
            </MirrorText>
            <div className="mr-stat-grid">
              <MirrorStatCard label="CACHE READ" value={totals?.cacheReadTokens ?? null} />
              <MirrorStatCard label="CACHE WRITE" value={totals?.cacheWriteTokens ?? null} />
              <MirrorStatCard label="UPGRADE OVERHEAD" value={totals?.upgradeOverheadTotalTokens ?? null} />
              <MirrorStatCard
                label="有 USAGE 的回填"
                value={totals?.messagesWithUsage ?? null}
                delta={totals ? { value: `${totals.assistantMessages} 条 assistant 消息` } : undefined}
              />
            </div>
          </MirrorCard>

          {/* Card 3: 来源与时间窗口 */}
          <MirrorCard level={1} pad="form">
            <MirrorText role="title" as="h3">来源与时间窗口</MirrorText>
            <MirrorText role="body" as="p" className="mr-settings-sub-desc">
              区分当前聊天、历史归档和最近时间窗口的 token 规模。
            </MirrorText>
            <div className="mr-progress-list">
              <MirrorProgressBar
                label="当前聊天"
                detail={current
                  ? `输入 ${current.inputTokens.toLocaleString()} / 输出 ${current.outputTokens.toLocaleString()} / ${current.totalTokens.toLocaleString()}`
                  : '暂无数据'}
                fillPercent={pctOf(current?.totalTokens, totalTokens)}
                totalValue={current?.totalTokens ?? null}
              />
              <MirrorProgressBar
                label="历史归档"
                detail={archived
                  ? `输入 ${archived.inputTokens.toLocaleString()} / 输出 ${archived.outputTokens.toLocaleString()} / ${archived.totalTokens.toLocaleString()}`
                  : '暂无数据'}
                fillPercent={pctOf(archived?.totalTokens, totalTokens)}
                totalValue={archived?.totalTokens ?? null}
              />
              <MirrorProgressBar
                label="时间窗口·7 天"
                detail={recent7
                  ? `输入 ${recent7.inputTokens.toLocaleString()} / 输出 ${recent7.outputTokens.toLocaleString()} / ${recent7.totalTokens.toLocaleString()}`
                  : '暂无数据'}
                fillPercent={pctOf(recent7?.totalTokens, totalTokens)}
                totalValue={recent7?.totalTokens ?? null}
              />
            </div>
          </MirrorCard>
        </div>
      </div>
    </MirrorPageWrapper>
  )
}
