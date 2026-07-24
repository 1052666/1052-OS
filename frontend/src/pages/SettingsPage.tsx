import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, Clock3, Cloud, Download, Gauge, LoaderCircle, MonitorCog, Palette, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Sunrise, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation } from 'react-router-dom'
import { z } from 'zod'
import { navSections } from '../app/navigation'
import { agentApi, appearanceApi, healthApi, settingsApi, updatesApi } from '../data/api'
import type { AppearanceReviewReport, AppearanceThemeProfile } from '../contracts/schemas'
import { useShellStore } from '../state/shell'
import { AsyncState, Badge, Button, Dialog, Field, Input, Select, Surface, Switch, Textarea } from '../components/ui'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'
import pageStyles from './pages.module.css'
import styles from './settings.module.css'

const modelFormSchema = z.object({
  baseUrl: z.string().min(1, '请输入 API 地址'),
  modelId: z.string().min(1, '请输入模型 ID'),
  apiFormat: z.enum(['openai-compatible', 'anthropic', 'gemini']),
  apiKey: z.string().optional(),
  imageBaseUrl: z.string().optional(),
  imageModelId: z.string().optional(),
  imageApiKey: z.string().optional(),
  ocrProvider: z.enum(['uapis', 'custom-model']),
  ocrBaseUrl: z.string().optional(),
  ocrModelId: z.string().optional(),
  ocrApiKey: z.string().optional(),
})

type ModelForm = z.infer<typeof modelFormSchema>

function ModelsSettings() {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const [discovery, setDiscovery] = useState<Record<string, unknown> | null>(null)
  const form = useForm<ModelForm>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: { baseUrl: '', modelId: '', apiFormat: 'openai-compatible', apiKey: '', imageBaseUrl: '', imageModelId: '', imageApiKey: '', ocrProvider: 'uapis', ocrBaseUrl: '', ocrModelId: '', ocrApiKey: '' },
  })

  useEffect(() => {
    if (!settings.data) return
    const image = settings.data.imageGeneration as Record<string, unknown>
    const ocr = settings.data.ocr as Record<string, unknown>
    form.reset({
      baseUrl: settings.data.llm.baseUrl,
      modelId: settings.data.llm.modelId,
      apiFormat: settings.data.llm.apiFormat,
      apiKey: '',
      imageBaseUrl: String(image.baseUrl ?? ''),
      imageModelId: String(image.modelId ?? ''),
      imageApiKey: '',
      ocrProvider: ocr.provider === 'custom-model' ? 'custom-model' : 'uapis',
      ocrBaseUrl: String(ocr.customBaseUrl ?? ''),
      ocrModelId: String(ocr.customModelId ?? ''),
      ocrApiKey: '',
    })
  }, [form, settings.data])

  const save = useMutation({
    mutationFn: (value: ModelForm) => settingsApi.update({
      llm: { baseUrl: value.baseUrl, modelId: value.modelId, apiFormat: value.apiFormat, ...(value.apiKey ? { apiKey: value.apiKey } : {}) },
      imageGeneration: { baseUrl: value.imageBaseUrl, modelId: value.imageModelId, ...(value.imageApiKey ? { apiKey: value.imageApiKey } : {}) },
      ocr: { provider: value.ocrProvider, customBaseUrl: value.ocrBaseUrl, customModelId: value.ocrModelId, ...(value.ocrApiKey ? { customApiKey: value.ocrApiKey } : {}) },
    }),
    onSuccess: (data) => client.setQueryData(['settings'], data),
  })
  const discover = useMutation({
    mutationFn: settingsApi.discoverModels,
    onSuccess: setDiscovery,
  })
  const activate = useMutation({
    mutationFn: settingsApi.activateProfile,
    onSuccess: (data) => client.setQueryData(['settings'], data),
  })

  return (
    <AsyncState loading={settings.isLoading} error={settings.error}>
      <form className={styles.settingsStack} onSubmit={form.handleSubmit((value) => save.mutate(value))}>
        <Surface title="主模型" action={<Badge tone={settings.data?.llm.hasApiKey ? 'success' : 'warning'}>{settings.data?.llm.hasApiKey ? '凭证已配置' : '等待 API Key'}</Badge>}>
          <div className={pageStyles.formGrid}>
            <Field label="API 地址"><Input {...form.register('baseUrl')} placeholder="https://api.openai.com/v1" /></Field>
            <Field label="模型 ID"><Input {...form.register('modelId')} placeholder="gpt-4.1-mini" /></Field>
            <Field label="接口格式"><Select {...form.register('apiFormat')}><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></Select></Field>
            <Field label={`API Key${settings.data?.llm.apiKeyMask ? ` · ${settings.data.llm.apiKeyMask}` : ''}`}><Input {...form.register('apiKey')} type="password" placeholder="留空则不修改" autoComplete="off" /></Field>
          </div>
          <div className={styles.formActions}><Button onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending ? <LoaderCircle className={styles.spin} size={15} /> : <MonitorCog size={15} />}发现本地模型</Button><Button variant="primary" type="submit" disabled={save.isPending}>{save.isPending ? <LoaderCircle className={styles.spin} size={15} /> : <Check size={15} />}保存模型配置</Button></div>
        </Surface>

        {settings.data?.llm.profiles.length ? (
          <Surface title="模型配置档案">
            <div className={styles.profileList}>
              {settings.data.llm.profiles.map((profile) => (
                <div key={profile.id}>
                  <span className={styles.profileIcon}>{profile.kind === 'local' ? <MonitorCog size={16} /> : <Cloud size={16} />}</span>
                  <span><strong>{profile.name}</strong><small>{profile.modelId} · {profile.baseUrl}</small></span>
                  {profile.id === settings.data.llm.activeProfileId ? <Badge tone="success">当前使用</Badge> : <Button size="small" onClick={() => activate.mutate(profile.id)}>切换</Button>}
                </div>
              ))}
            </div>
          </Surface>
        ) : null}

        {discovery ? <Surface title="本地发现结果"><pre className={pageStyles.codeBlock}>{JSON.stringify(discovery, null, 2)}</pre></Surface> : null}

        <div className={pageStyles.grid2}>
          <Surface title="图像生成">
            <div className={styles.compactForm}>
              <Field label="API 地址"><Input {...form.register('imageBaseUrl')} /></Field>
              <Field label="模型 ID"><Input {...form.register('imageModelId')} /></Field>
              <Field label="API Key"><Input {...form.register('imageApiKey')} type="password" placeholder="留空则不修改" /></Field>
            </div>
          </Surface>
          <Surface title="OCR 文字识别">
            <div className={styles.compactForm}>
              <Field label="提供方式"><Select {...form.register('ocrProvider')}><option value="uapis">UAPIs</option><option value="custom-model">自定义模型</option></Select></Field>
              <Field label="API 地址"><Input {...form.register('ocrBaseUrl')} /></Field>
              <Field label="模型 ID"><Input {...form.register('ocrModelId')} /></Field>
            </div>
          </Surface>
        </div>
      </form>
    </AsyncState>
  )
}

const agentFormSchema = z.object({
  permissionProfile: z.enum(['read-only', 'default', 'danger-full-access']),
  streaming: z.boolean(),
  userPrompt: z.string(),
  contextMessageLimit: z.coerce.number().min(4).max(200),
  progressiveDisclosureEnabled: z.boolean(),
  providerCachingEnabled: z.boolean(),
  checkpointEnabled: z.boolean(),
  seedOnResumeEnabled: z.boolean(),
  autoCompactEnabled: z.boolean(),
  autoCompactThreshold: z.coerce.number().min(1000),
  morningBriefEnabled: z.boolean(),
  morningBriefTime: z.string(),
})
type AgentForm = z.infer<typeof agentFormSchema>

const AUTO_CONTEXT_MESSAGE_LIMIT = 160
const AUTO_COMPACT_TOKEN_LIMIT = 80_000

function displayedCompactTokenLimit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20_000
    ? value
    : AUTO_COMPACT_TOKEN_LIMIT
}

function AgentSettings() {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const [dangerConfirm, setDangerConfirm] = useState<AgentForm | null>(null)
  const form = useForm<AgentForm>({ resolver: zodResolver(agentFormSchema), defaultValues: { permissionProfile: 'default', streaming: true, userPrompt: '', contextMessageLimit: 30, progressiveDisclosureEnabled: true, providerCachingEnabled: true, checkpointEnabled: true, seedOnResumeEnabled: true, autoCompactEnabled: true, autoCompactThreshold: 80_000, morningBriefEnabled: false, morningBriefTime: '08:30' } })
  useEffect(() => {
    if (!settings.data) return
    form.reset({ ...settings.data.agent, morningBriefEnabled: settings.data.agent.morningBrief.enabled, morningBriefTime: settings.data.agent.morningBrief.time })
  }, [form, settings.data])
  const save = useMutation({
    mutationFn: (value: AgentForm) => settingsApi.update({
      agent: {
        permissionProfile: value.permissionProfile,
        streaming: value.streaming,
        userPrompt: value.userPrompt,
        progressiveDisclosureEnabled: value.progressiveDisclosureEnabled,
        providerCachingEnabled: value.providerCachingEnabled,
        checkpointEnabled: value.checkpointEnabled,
        seedOnResumeEnabled: value.seedOnResumeEnabled,
        autoCompactEnabled: value.autoCompactEnabled,
        morningBrief: { enabled: value.morningBriefEnabled, time: value.morningBriefTime },
      },
    }),
    onSuccess: (data) => { client.setQueryData(['settings'], data); setDangerConfirm(null) },
  })
  const submit = (value: AgentForm) => value.permissionProfile === 'danger-full-access' && settings.data?.agent.permissionProfile !== 'danger-full-access' ? setDangerConfirm(value) : save.mutate(value)
  const switches: Array<[keyof AgentForm, string, string]> = [
    ['streaming', '流式回答', '模型生成时立即显示内容'],
    ['progressiveDisclosureEnabled', '渐进加载能力', '只在需要时挂载相关工具包'],
    ['providerCachingEnabled', '提供商缓存', '复用模型提供商支持的提示缓存'],
    ['checkpointEnabled', '运行检查点', '为长任务保留恢复状态'],
    ['seedOnResumeEnabled', '恢复时补充上下文', '继续任务时重新注入关键状态'],
    ['autoCompactEnabled', '自动上下文维护', '接近 token 线或历史窗口过长时自动生成检查点'],
  ]
  const compactTokenLimit = displayedCompactTokenLimit(settings.data?.agent.autoCompactThreshold)
  return (
    <AsyncState loading={settings.isLoading} error={settings.error}>
      <form className={styles.settingsStack} onSubmit={form.handleSubmit(submit)}>
        <Surface title="权限边界">
          <div className={styles.permissionGrid}>
            {[
              ['read-only', '只读', '只允许查看和分析，所有写入操作都会被阻止。'],
              ['default', '需要确认', '安全读取自动执行，敏感操作由你逐次确认。'],
              ['danger-full-access', '完全访问', '允许 Runtime 直接修改本地与系统状态。'],
            ].map(([value, title, text]) => (
              <label key={value} className={form.watch('permissionProfile') === value ? styles.permissionActive : ''}>
                <input type="radio" value={value} {...form.register('permissionProfile')} />
                <ShieldAlert size={17} /><strong>{title}</strong><small>{text}</small>
              </label>
            ))}
          </div>
        </Surface>

        <Surface title="运行行为">
          <div className={styles.settingRows}>
            {switches.map(([key, title, description]) => (
              <div key={key}><span><strong>{title}</strong><small>{description}</small></span><Switch label={title} checked={Boolean(form.watch(key))} onCheckedChange={(checked) => form.setValue(key, checked as never, { shouldDirty: true })} /></div>
            ))}
          </div>
        </Surface>

        <Surface title="上下文与个性化">
          <div className={pageStyles.formGrid}>
            <div className={styles.contextPolicyGrid}>
              <div><Archive size={16} /><span><strong>自动上下文窗口</strong><small>运行时自动保留最近约 {AUTO_CONTEXT_MESSAGE_LIMIT} 条有效模型消息，旧内容进入检查点摘要。</small></span></div>
              <div><Gauge size={16} /><span><strong>自动压缩线</strong><small>估算上下文达到 {compactTokenLimit.toLocaleString('zh-CN')} tokens 或消息窗口过长时触发。</small></span></div>
              <div><Clock3 size={16} /><span><strong>检查点恢复</strong><small>压缩后生成窗口编号与运行轨迹，继续任务时重新注入关键状态。</small></span></div>
            </div>
            <Field label="晨间简报时间"><Input type="time" {...form.register('morningBriefTime')} /></Field>
            <div className={styles.inlineSwitch}><span><strong>晨间简报</strong><small>按设定时间生成每日 Intel Center 简报，默认只回写 1052 OS 聊天流与通知中心。</small></span><Switch label="晨间简报" checked={form.watch('morningBriefEnabled')} onCheckedChange={(checked) => form.setValue('morningBriefEnabled', checked, { shouldDirty: true })} /></div>
            <p className={styles.briefNote}><Sunrise size={15} />晨间简报会采集新闻、行情和跨板块联动信号，输出中文摘要、异常观察、风险机会和主要来源。外部飞书或微信投递需要在定时任务里单独显式配置。</p>
            <Field label="附加系统指令"><Textarea {...form.register('userPrompt')} placeholder="仅在确有长期需求时添加" /></Field>
          </div>
        </Surface>
        <div className={styles.stickySave}><Button variant="primary" type="submit" disabled={save.isPending}><Check size={15} />保存 Agent 设置</Button></div>
      </form>
      <Dialog open={Boolean(dangerConfirm)} onOpenChange={(open) => !open && setDangerConfirm(null)} title="确认启用完全访问" footer={<><Button onClick={() => setDangerConfirm(null)}>取消</Button><Button variant="danger" onClick={() => dangerConfirm && save.mutate(dangerConfirm)}>确认启用</Button></>}>
        <p className={styles.warningText}>完全访问允许 Agent 在不逐次询问的情况下修改文件、运行命令和改变系统状态。仅在你了解当前模型及工具行为时使用。</p>
      </Dialog>
    </AsyncState>
  )
}

const sampleThemeJson = JSON.stringify({
  schemaVersion: 1,
  name: '本地主题包',
  mode: 'dark',
  scope: 'all',
  safetyLevel: 'safe',
  coreTokens: {
    bg: '#080b0e',
    surface: '#10171b',
    fg: '#eef5f7',
    accent: '#26d9d0',
    success: '#4ade80',
    danger: '#ff6b6b',
  },
  tokens: {},
}, null, 2)

function parseThemeJson(source: string) {
  try {
    return JSON.parse(source)
  } catch {
    throw new Error('主题 JSON 格式无效，请检查括号、逗号和引号')
  }
}

function safetyTone(level?: string): 'default' | 'success' | 'warning' | 'danger' {
  if (level === 'safe') return 'success'
  if (level === 'experimental') return 'warning'
  if (level === 'rejected') return 'danger'
  return 'default'
}

function formatThemeTime(timestamp?: number) {
  return timestamp ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp) : '未知'
}

function AppearanceThemeRegistry() {
  const client = useQueryClient()
  const themes = useQuery({ queryKey: ['appearance', 'themes'], queryFn: appearanceApi.themes })
  const [draft, setDraft] = useState(sampleThemeJson)
  const [review, setReview] = useState<AppearanceReviewReport | null>(null)
  const [selected, setSelected] = useState<AppearanceThemeProfile | null>(null)
  useEffect(() => {
    if (!selected && themes.data?.activeProfile) setSelected(themes.data.activeProfile)
  }, [selected, themes.data?.activeProfile])
  const refreshThemes = (data: unknown) => {
    client.setQueryData(['appearance', 'themes'], data)
    void client.invalidateQueries({ queryKey: ['appearance', 'themes'] })
  }
  const reviewTheme = useMutation({ mutationFn: () => appearanceApi.reviewTheme(parseThemeJson(draft)), onSuccess: setReview })
  const createTheme = useMutation({
    mutationFn: () => appearanceApi.createTheme(parseThemeJson(draft)),
    onSuccess: (profile) => {
      setSelected(profile)
      setReview(profile.review)
      void client.invalidateQueries({ queryKey: ['appearance', 'themes'] })
    },
  })
  const applyTheme = useMutation({ mutationFn: (profile: AppearanceThemeProfile) => appearanceApi.applyTheme(profile.id, profile.review.safetyLevel === 'experimental'), onSuccess: refreshThemes })
  const resetTheme = useMutation({ mutationFn: appearanceApi.resetTheme, onSuccess: refreshThemes })
  const deleteTheme = useMutation({
    mutationFn: (id: string) => appearanceApi.deleteTheme(id),
    onSuccess: (data) => {
      setSelected(null)
      refreshThemes(data)
    },
  })
  const activeId = themes.data?.activeProfileId
  const report = review ?? selected?.review ?? null
  return (
    <Surface
      title="兼容主题包"
      action={<Button size="small" onClick={() => resetTheme.mutate()} disabled={resetTheme.isPending}><RotateCcw size={14} />重置</Button>}
    >
      <div className={styles.themeRegistry}>
        <AsyncState loading={themes.isLoading} error={themes.error} empty={!themes.data?.profiles.length}>
          <div className={styles.themeList}>
            {themes.data?.profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`${styles.themeRow} ${selected?.id === profile.id ? styles.themeRowSelected : ''}`}
                onClick={() => setSelected(profile)}
              >
                <span><Palette size={15} /><strong>{profile.theme.name}</strong></span>
                <small>{profile.theme.mode} · {profile.theme.scope} · {formatThemeTime(profile.updatedAt)}</small>
                <Badge tone={profile.id === activeId ? 'success' : safetyTone(profile.review.safetyLevel)}>
                  {profile.id === activeId ? '使用中' : profile.review.safetyLevel}
                </Badge>
              </button>
            ))}
          </div>
        </AsyncState>
        <div className={styles.themeEditor}>
          <div className={styles.themeMeta}>
            <span>
              <strong>{selected?.theme.name ?? '新主题包'}</strong>
              <small>用于承接后端主题路由；新版默认视觉仍由设计令牌控制。</small>
            </span>
            {selected ? (
              <div className={styles.formActions}>
                <Button size="small" onClick={() => applyTheme.mutate(selected)} disabled={selected.id === activeId || selected.review.safetyLevel === 'rejected' || applyTheme.isPending}>
                  <Check size={14} />应用
                </Button>
                <Button size="small" variant="danger" onClick={() => deleteTheme.mutate(selected.id)} disabled={selected.source === 'builtin' || deleteTheme.isPending}>
                  <Trash2 size={14} />删除
                </Button>
              </div>
            ) : null}
          </div>
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={10} spellCheck={false} />
          <div className={styles.formActions}>
            <Button onClick={() => reviewTheme.mutate()} disabled={reviewTheme.isPending}>审计 JSON</Button>
            <Button variant="primary" onClick={() => createTheme.mutate()} disabled={createTheme.isPending}>保存主题包</Button>
          </div>
          {reviewTheme.error || createTheme.error ? <p className={styles.warningText}>{(reviewTheme.error || createTheme.error) instanceof Error ? (reviewTheme.error || createTheme.error as Error).message : '主题处理失败'}</p> : null}
          {report ? (
            <div className={styles.reviewPanel}>
              <Badge tone={report.passed ? 'success' : 'danger'}>{report.passed ? '审计通过' : '审计未通过'}</Badge>
              <Badge tone={safetyTone(report.safetyLevel)}>{report.safetyLevel}</Badge>
              {[...report.blockingIssues, ...report.warnings].length ? (
                <div className={styles.issueList}>
                  {[...report.blockingIssues, ...report.warnings].map((issue) => (
                    <p key={`${issue.code}:${issue.path}`}><strong>{issue.path}</strong>{issue.message}；建议：{issue.suggestedFix}</p>
                  ))}
                </div>
              ) : <small>没有阻断问题或警告。</small>}
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  )
}

function AppearanceSettings() {
  const theme = useShellStore((state) => state.theme)
  const setTheme = useShellStore((state) => state.setTheme)
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => { setReduceMotion(settings.data?.appearance.reduceMotion === true) }, [settings.data])
  const save = useMutation({ mutationFn: () => settingsApi.update({ appearance: { theme, language: 'zh-CN', reduceMotion } }), onSuccess: (data) => client.setQueryData(['settings'], data) })
  return (
    <div className={styles.settingsStack}>
      <Surface title="主题模式">
        <div className={styles.themeGrid}>
          <button type="button" className={theme === 'dark' ? styles.themeActive : ''} onClick={() => setTheme('dark')}><span className={styles.darkPreview}><i /><i /><i /></span><strong>曜石深色</strong><small>1052 OS 默认视觉</small></button>
          <button type="button" className={theme === 'light' ? styles.themeActive : ''} onClick={() => setTheme('light')}><span className={styles.lightPreview}><i /><i /><i /></span><strong>钛白浅色</strong><small>完整高对比浅色界面</small></button>
        </div>
      </Surface>
      <Surface title="动态与可访问性">
        <div className={styles.settingRows}><div><span><strong>减少动态</strong><small>停止系统场动画并简化界面转场</small></span><Switch label="减少动态" checked={reduceMotion} onCheckedChange={setReduceMotion} /></div></div>
      </Surface>
      <AppearanceThemeRegistry />
      <div className={styles.stickySave}><Button variant="primary" onClick={() => save.mutate()}><Check size={15} />保存外观设置</Button></div>
    </div>
  )
}

function SystemSettings() {
  const health = useQuery({ queryKey: ['health'], queryFn: healthApi.status, refetchInterval: 30_000 })
  const status = useQuery({ queryKey: ['updates', 'status'], queryFn: updatesApi.status })
  const client = useQueryClient()
  const check = useMutation({ mutationFn: updatesApi.check, onSuccess: (data) => client.setQueryData(['updates', 'status'], data) })
  const install = useMutation({ mutationFn: () => updatesApi.install(false) })
  const [sourcePath, setSourcePath] = useState('')
  const [migration, setMigration] = useState<Record<string, unknown> | null>(null)
  const preview = useMutation({ mutationFn: () => agentApi.previewMigration(sourcePath), onSuccess: setMigration })
  const run = useMutation({ mutationFn: () => agentApi.runMigration(sourcePath, false), onSuccess: setMigration })
  return (
    <div className={styles.settingsStack}>
      <Surface title="本地服务健康" action={<Badge tone={health.data?.ok ? 'success' : 'danger'}>{health.data?.ok ? '在线' : '未确认'}</Badge>}>
        <AsyncState loading={health.isLoading} error={health.error}>
          <div className={styles.updateStatus}>
            <MonitorCog size={22} />
            <span>
              <strong>后端 API 已响应</strong>
              <small>最后响应 {health.data?.ts ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(health.data.ts) : '尚未确认'}</small>
            </span>
            <Button onClick={() => void health.refetch()}><RefreshCw size={15} className={health.isFetching ? styles.spin : ''} />刷新</Button>
          </div>
        </AsyncState>
      </Surface>
      <Surface title="系统更新" action={status.data?.updateAvailable ? <Badge tone="warning">有新版本</Badge> : <Badge tone="success">当前已是最新</Badge>}>
        <AsyncState loading={status.isLoading} error={status.error}>
          <div className={styles.updateStatus}>
            <Sparkles size={22} />
            <span><strong>当前版本 {(status.data?.current as { shortCommit?: string } | undefined)?.shortCommit || 'unknown'}</strong><small>安装方式：{status.data?.mode || 'unknown'} · 上次检查 {status.data?.lastCheckedAt || '尚未检查'}</small></span>
            <Button onClick={() => check.mutate()} disabled={check.isPending}><RefreshCw size={15} className={check.isPending ? styles.spin : ''} />检查更新</Button>
            <Button variant="primary" onClick={() => install.mutate()} disabled={!status.data?.updateAvailable || !status.data?.canInstall || install.isPending}><Download size={15} />安装更新</Button>
          </div>
          {status.data?.warnings.length ? <div className={styles.warningList}>{status.data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        </AsyncState>
      </Surface>
      <Surface title="历史数据迁移">
        <div className={styles.migrationForm}><Field label="旧版数据目录"><Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="C:\path\to\old\data" /></Field><Button onClick={() => preview.mutate()} disabled={!sourcePath.trim()}>预览</Button><Button variant="primary" onClick={() => run.mutate()} disabled={!migration || run.isPending}>执行迁移</Button></div>
        {migration ? <pre className={pageStyles.codeBlock}>{JSON.stringify(migration, null, 2)}</pre> : null}
      </Surface>
    </div>
  )
}

export default function SettingsPage() {
  const location = useLocation()
  const mode = location.pathname.split('/').filter(Boolean)[1] ?? 'models'
  const title = mode === 'agent' ? 'Agent 与权限' : mode === 'appearance' ? '外观与动态' : mode === 'system' ? '系统维护' : '模型接入'
  return (
    <PageBody>
      <PageHeader eyebrow="System" title={title} description="配置 1052 OS 的模型、运行边界和本地系统行为。" />
      <MobileTabs items={navSections.find((section) => section.id === 'settings')!.items} />
      {mode === 'agent' ? <AgentSettings /> : mode === 'appearance' ? <AppearanceSettings /> : mode === 'system' ? <SystemSettings /> : <ModelsSettings />}
    </PageBody>
  )
}
