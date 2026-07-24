import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as QRCode from 'qrcode'
import { Bot, Cable, CheckCircle2, ExternalLink, LoaderCircle, PackagePlus, Plus, QrCode, RefreshCw, Search, Sparkles, Trash2, Wrench, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { channelsApi, searchApi, skillsApi, uapisApi } from '../../data/api'
import { AsyncState, Badge, Button, Dialog, Field, Input, Surface, Switch, Textarea, uiStyles } from '../../components/ui'
import pageStyles from '../../pages/pages.module.css'
import styles from './capabilities.module.css'

type SkillForm = {
  id: string
  name: string
  description: string
  body: string
}

type MarketplaceItem = {
  id: string
  name: string
  source?: string
  downloads?: string
  url?: string
  installCommand?: string
}

type WechatLoginState = {
  sessionKey: string
  qrcodeImage: string
  message: string
  expiresAt?: number
  connected?: boolean
}

type FeishuWizardState = {
  sessionId: string
  qrUrl: string
  status: 'pending' | 'approved' | 'failed' | 'cancelled'
  message: string
  expiresAt?: number
  error?: string
}

type FeishuWizardEvent = {
  status?: FeishuWizardState['status']
  message?: string
  error?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function bool(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

const qrRenderOptions = {
  margin: 1,
  width: 224,
  color: {
    dark: '#0b1417',
    light: '#ffffff',
  },
} as const

function directQrImageSource(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^data:image\//i.test(trimmed)) return trimmed
  if (/^<svg[\s>]/i.test(trimmed)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`
  }

  const compact = trimmed.replace(/\s/g, '')
  const mime = compact.startsWith('iVBORw0KGgo')
    ? 'png'
    : compact.startsWith('/9j/')
      ? 'jpeg'
      : compact.startsWith('R0lGOD')
        ? 'gif'
        : compact.startsWith('UklGR')
          ? 'webp'
          : compact.startsWith('PHN2Zy')
            ? 'svg+xml'
            : ''

  return mime ? `data:image/${mime};base64,${compact}` : ''
}

function expiresText(value?: number) {
  if (!value) return ''
  const ms = value > 10_000_000_000 ? value : value * 1000
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function marketplaceItems(value: unknown): MarketplaceItem[] {
  return asArray(asRecord(value).items).map((item) => {
    const record = asRecord(item)
    return {
      id: text(record.id),
      name: text(record.name, text(record.id, '未命名 Skill')),
      source: text(record.source),
      downloads: text(record.downloads),
      url: text(record.url),
      installCommand: text(record.installCommand),
    }
  }).filter((item) => item.id)
}

function statusTone(value: unknown): 'default' | 'success' | 'warning' | 'danger' {
  const status = text(value).toLowerCase()
  if (['running', 'connected', 'ready', 'success', 'online', 'stable'].includes(status)) return 'success'
  if (['needs_work', 'warning', 'pass'].includes(status)) return 'warning'
  if (['failed', 'error', 'offline'].includes(status)) return 'danger'
  return 'default'
}

function sourceGroups(value: unknown) {
  return asArray(value).map((group) => {
    const record = asRecord(group)
    return {
      id: text(record.id),
      title: text(record.title, text(record.id, '搜索源')),
      description: text(record.description),
      items: asArray(record.items).map((item) => asRecord(item)),
    }
  }).filter((group) => group.id)
}

export function SkillsView() {
  const client = useQueryClient()
  const skills = useQuery({ queryKey: ['skills'], queryFn: skillsApi.list })
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<SkillForm>({ id: '', name: '', description: '', body: '' })
  const [marketQuery, setMarketQuery] = useState('')
  const [marketResult, setMarketResult] = useState<unknown>(null)
  const selected = skills.data?.find((skill) => skill.id === selectedId) ?? skills.data?.[0] ?? null
  const detail = useQuery({ queryKey: ['skills', selected?.id], queryFn: () => skillsApi.detail(selected!.id), enabled: Boolean(selected?.id) })
  useEffect(() => { setSelectedId((current) => current || skills.data?.[0]?.id || '') }, [skills.data])
  const refresh = () => void client.invalidateQueries({ queryKey: ['skills'] })
  const create = useMutation({
    mutationFn: () => skillsApi.create(form),
    onSuccess: (skill) => { setSelectedId(skill.id); setCreateOpen(false); setForm({ id: '', name: '', description: '', body: '' }); refresh() },
  })
  const remove = useMutation({ mutationFn: (id: string) => skillsApi.remove(id), onSuccess: () => { setSelectedId(''); refresh() } })
  const searchMarket = useMutation({ mutationFn: () => skillsApi.search(marketQuery), onSuccess: setMarketResult })
  const install = useMutation({ mutationFn: (id: string) => skillsApi.install(id), onSuccess: (skill) => { setSelectedId(skill.id); refresh() } })
  const items = marketplaceItems(marketResult)
  return (
    <>
      <div className={styles.capabilityGrid}>
        <Surface title="已安装 Skills" action={<Button size="small" variant="primary" onClick={() => setCreateOpen(true)}><Plus size={14} />新建</Button>}>
          <AsyncState loading={skills.isLoading} error={skills.error} empty={!skills.data?.length}>
            <div className={pageStyles.list}>
              {skills.data?.map((skill) => (
                <button key={skill.id} type="button" className={`${pageStyles.listItem} ${selected?.id === skill.id ? pageStyles.listItemActive : ''}`} onClick={() => setSelectedId(skill.id)}>
                  <span><strong>{skill.name}</strong><small>{skill.description || skill.path}</small></span>
                  <Badge tone={skill.enabled ? 'success' : 'default'}>{skill.enabled ? '启用' : '停用'}</Badge>
                </button>
              ))}
            </div>
          </AsyncState>
        </Surface>
        <div className={styles.skillDetail}>
          <Surface
            title={selected?.name ?? 'Skill 详情'}
            action={selected ? <Button size="small" variant="danger" onClick={() => remove.mutate(selected.id)}><Trash2 size={13} /></Button> : null}
          >
            <AsyncState loading={detail.isLoading} error={detail.error} empty={!selected}>
              <div className={styles.skillDetail}>
                <div className={styles.skillHeader}>
                  <span><Sparkles size={18} /></span>
                  <div><strong>{detail.data?.name}</strong><small>{detail.data?.description}</small></div>
                  <Badge>{detail.data?.size ?? 0} 字符</Badge>
                </div>
                <div className={styles.pathLine}>{detail.data?.path}</div>
                <pre className={styles.resultBox}>{text(asRecord(detail.data).body, '没有可预览内容')}</pre>
              </div>
            </AsyncState>
          </Surface>
          <Surface title="Marketplace" action={<Button size="small" onClick={() => searchMarket.mutate()} disabled={searchMarket.isPending}>{searchMarket.isPending ? <LoaderCircle className={styles.spin} size={14} /> : <Search size={14} />}搜索</Button>}>
            <div className={styles.marketplace}>
              <Input value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchMarket.mutate()} placeholder="搜索可安装 Skill" />
              <AsyncState loading={searchMarket.isPending} error={searchMarket.error} empty={Boolean(marketResult) && !items.length}>
                {items.map((item) => (
                  <article key={item.id} className={styles.marketItem}>
                    <div className={styles.skillHeader}>
                      <span><PackagePlus size={17} /></span>
                      <div><strong>{item.name}</strong><small>{item.id}</small></div>
                      <Badge>{item.source || 'skills.sh'}</Badge>
                    </div>
                    <p className={styles.detailText}>{item.installCommand || item.url || item.downloads || '来自公开 Skill 市场。'}</p>
                    <div className={styles.channelActions}><Button size="small" variant="primary" onClick={() => install.mutate(item.id)} disabled={install.isPending}>安装</Button></div>
                  </article>
                ))}
              </AsyncState>
            </div>
          </Surface>
        </div>
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="新建 Skill" footer={<Button variant="primary" onClick={() => create.mutate()} disabled={!form.name.trim() || !form.body.trim()}>创建</Button>}>
        <div className={pageStyles.formGrid}>
          <Field label="ID"><Input value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="可留空自动生成" /></Field>
          <Field label="名称"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="描述"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label="正文"><Textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="# Skill 名称" /></Field>
        </div>
      </Dialog>
    </>
  )
}

export function ToolsView() {
  const client = useQueryClient()
  const catalog = useQuery({ queryKey: ['uapis', 'catalog'], queryFn: uapisApi.catalog })
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [params, setParams] = useState('{}')
  const [body, setBody] = useState('{}')
  const [result, setResult] = useState<unknown>(null)
  const apis = useMemo(() => {
    const textQuery = query.trim().toLowerCase()
    const list = catalog.data?.apis ?? []
    return textQuery ? list.filter((api) => `${api.name} ${api.description} ${api.path} ${api.categoryName}`.toLowerCase().includes(textQuery)) : list
  }, [catalog.data?.apis, query])
  const selected = apis.find((api) => api.id === selectedId) ?? catalog.data?.apis.find((api) => api.id === selectedId) ?? apis[0] ?? null
  useEffect(() => { setSelectedId((current) => current || catalog.data?.apis[0]?.id || '') }, [catalog.data?.apis])
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => uapisApi.setEnabled(id, enabled),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['uapis', 'catalog'] }),
  })
  const call = useMutation({
    mutationFn: () => {
      const parsedParams = params.trim() ? JSON.parse(params) : {}
      const parsedBody = body.trim() ? JSON.parse(body) : {}
      return uapisApi.call({ apiId: selected?.id, params: parsedParams, body: parsedBody })
    },
    onSuccess: setResult,
  })
  return (
    <div className={styles.capabilityGrid}>
      <Surface title="UAPIs 工具箱" action={<Badge tone={bool(asRecord(catalog.data?.provider).hasApiKey) ? 'success' : 'warning'}>{text(asRecord(catalog.data?.provider).apiKeyMode, 'free-ip-quota')}</Badge>}>
        <div className={styles.marketplace}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具、分类或路径" />
          <AsyncState loading={catalog.isLoading} error={catalog.error} empty={!apis.length}>
            <div className={pageStyles.list}>
              {apis.slice(0, 120).map((api) => (
                <button key={api.id} type="button" className={`${pageStyles.listItem} ${selected?.id === api.id ? pageStyles.listItemActive : ''}`} onClick={() => setSelectedId(api.id)}>
                  <span><strong>{api.name}</strong><small>{api.method} {api.path}</small></span>
                  <Badge tone={api.enabled ? 'success' : 'default'}>{api.categoryName}</Badge>
                </button>
              ))}
            </div>
          </AsyncState>
        </div>
      </Surface>
      <Surface title={selected?.name ?? '工具详情'} action={selected ? <Switch checked={selected.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: selected.id, enabled })} label="启用工具" /> : null}>
        <AsyncState empty={!selected}>
          <div className={styles.callBox}>
            <div className={styles.toolHeader}>
              <span><Wrench size={17} /></span>
              <div><strong>{selected?.description}</strong><small>{selected?.method} {selected?.path}</small></div>
              <Badge tone={selected?.enabled ? 'success' : 'default'}>{selected?.enabled ? '可用' : '关闭'}</Badge>
            </div>
            <div className={styles.toolMeta}><Badge>{selected?.categoryName}</Badge><Badge>{catalog.data?.counts.enabled ?? 0}/{catalog.data?.counts.total ?? 0} 已启用</Badge></div>
            <Field label="Query Params JSON"><Textarea value={params} onChange={(event) => setParams(event.target.value)} /></Field>
            <Field label="Body JSON"><Textarea value={body} onChange={(event) => setBody(event.target.value)} /></Field>
            <Button variant="primary" onClick={() => call.mutate()} disabled={!selected || !selected.enabled || call.isPending}>{call.isPending ? <LoaderCircle className={styles.spin} size={14} /> : <CheckCircle2 size={14} />}调用</Button>
            {call.error ? <div className={uiStyles.error}>{call.error instanceof Error ? call.error.message : '调用失败'}</div> : null}
            {result ? <pre className={styles.resultBox}>{jsonText(result)}</pre> : null}
          </div>
        </AsyncState>
      </Surface>
    </div>
  )
}

export function SearchSourcesView() {
  const client = useQueryClient()
  const sources = useQuery({ queryKey: ['search', 'sources'], queryFn: searchApi.sources })
  const toggle = useMutation({
    mutationFn: ({ family, id, enabled }: { family: string; id: string; enabled: boolean }) => searchApi.toggle(family, id, enabled),
    onSuccess: (data) => client.setQueryData(['search', 'sources'], data),
  })
  const groups = sourceGroups(sources.data?.sourceGroups)
  return (
    <div className={styles.sourceMatrix}>
      <div className={pageStyles.statStrip}>
        <div><strong>{groups.reduce((total, group) => total + group.items.length, 0)}</strong><span>来源总数</span></div>
        <div><strong>{groups.reduce((total, group) => total + group.items.filter((item) => bool(item.enabled)).length, 0)}</strong><span>启用来源</span></div>
        <div><strong>{sources.data?.engines.length ?? 0}</strong><span>搜索引擎</span></div>
        <div><strong>{groups.length}</strong><span>来源分组</span></div>
      </div>
      <AsyncState loading={sources.isLoading} error={sources.error} empty={!groups.length}>
        <div className={pageStyles.grid2}>
          {groups.map((group) => (
            <section key={group.id} className={styles.searchGroup}>
              <header className={styles.toolHeader}><span><Search size={17} /></span><div><strong>{group.title}</strong><small>{group.description}</small></div><Badge>{group.items.length}</Badge></header>
              <div className={styles.sourceList}>
                {group.items.map((item) => {
                  const id = text(item.id)
                  return (
                    <div key={`${group.id}:${id}`} className={styles.sourceRow}>
                      <span><strong>{text(item.name, id)}</strong><small>{text(item.statusReason, text(item.homepage))}</small></span>
                      <div className={styles.sourceLine}>
                        <Badge tone={statusTone(item.status)}>{text(item.status, 'status')}</Badge>
                        <Switch checked={bool(item.enabled)} onCheckedChange={(enabled) => toggle.mutate({ family: group.id, id, enabled })} label={`启用 ${text(item.name, id)}`} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </AsyncState>
    </div>
  )
}

export function ChannelsView() {
  const client = useQueryClient()
  const wechat = useQuery({ queryKey: ['channels', 'wechat'], queryFn: channelsApi.wechat })
  const wechatAccounts = useQuery({ queryKey: ['channels', 'wechat', 'accounts'], queryFn: channelsApi.wechatAccounts })
  const feishu = useQuery({ queryKey: ['channels', 'feishu'], queryFn: channelsApi.feishu })
  const feishuWorkspace = useQuery({ queryKey: ['channels', 'feishu', 'workspace'], queryFn: channelsApi.feishuWorkspace })
  const wecom = useQuery({ queryKey: ['channels', 'wecom'], queryFn: channelsApi.wecom })
  const webhooks = useQuery({ queryKey: ['channels', 'wecom', 'webhooks'], queryFn: channelsApi.wecomWebhooks })
  const [wechatLogin, setWechatLogin] = useState<WechatLoginState | null>(null)
  const [wechatQrImage, setWechatQrImage] = useState('')
  const [feishuWizard, setFeishuWizard] = useState<FeishuWizardState | null>(null)
  const [feishuQrImage, setFeishuQrImage] = useState('')
  const [feishuForm, setFeishuForm] = useState({ appId: '', appSecret: '', encryptKey: '', verificationToken: '' })
  const [wecomForm, setWecomForm] = useState({ name: '', webhookUrl: '', secret: '' })
  const invalidateChannels = () => void client.invalidateQueries({ queryKey: ['channels'] })
  const startWechat = useMutation({
    mutationFn: channelsApi.startWechatLogin,
    onSuccess: (data) => {
      const record = asRecord(data)
      setWechatLogin({
        sessionKey: text(record.sessionKey),
        qrcodeImage: text(record.qrcodeUrl),
        message: text(record.message, '二维码已生成，请使用微信扫码确认登录。'),
        expiresAt: num(record.expiresAt),
        connected: bool(record.connected),
      })
      invalidateChannels()
    },
  })
  const startWechatAccount = useMutation({ mutationFn: channelsApi.startWechatAccount, onSuccess: invalidateChannels })
  const stopWechatAccount = useMutation({ mutationFn: channelsApi.stopWechatAccount, onSuccess: invalidateChannels })
  const deleteWechatAccount = useMutation({ mutationFn: channelsApi.deleteWechatAccount, onSuccess: invalidateChannels })
  const startFeishuWizard = useMutation({
    mutationFn: () => channelsApi.startFeishuSetupWizard('feishu'),
    onSuccess: (data) => {
      const record = asRecord(data)
      setFeishuWizard({
        sessionId: text(record.sessionId),
        qrUrl: text(record.qrUrl),
        expiresAt: num(record.expiresAt),
        status: 'pending',
        message: text(record.warning, '请使用飞书移动端扫码授权 Bot 接入。'),
      })
      invalidateChannels()
    },
  })
  const cancelFeishuWizard = useMutation({
    mutationFn: (sessionId: string) => channelsApi.cancelFeishuSetupWizard(sessionId),
    onSuccess: () => setFeishuWizard((current) => current ? { ...current, status: 'cancelled', message: '已取消飞书扫码接入。' } : current),
  })
  const saveFeishu = useMutation({ mutationFn: () => channelsApi.saveFeishu(feishuForm), onSuccess: invalidateChannels })
  const connectFeishu = useMutation({ mutationFn: channelsApi.connectFeishu, onSuccess: invalidateChannels })
  const disconnectFeishu = useMutation({ mutationFn: channelsApi.disconnectFeishu, onSuccess: invalidateChannels })
  const createWecom = useMutation({ mutationFn: () => channelsApi.createWecomWebhook(wecomForm), onSuccess: () => { setWecomForm({ name: '', webhookUrl: '', secret: '' }); invalidateChannels() } })
  const testWecom = useMutation({ mutationFn: (id: string) => channelsApi.testWecomWebhook(id), onSuccess: invalidateChannels })
  const accountCount = wechatAccounts.data?.length ?? 0
  const accountRows = asArray(wechatAccounts.data).map((item) => asRecord(item))
  const hooks = asArray(webhooks.data).map((item) => asRecord(item))

  useEffect(() => {
    if (!wechatLogin?.sessionKey || wechatLogin.connected) return
    let cancelled = false
    const sessionKey = wechatLogin.sessionKey

    async function poll() {
      while (!cancelled) {
        try {
          const data = await channelsApi.waitWechatLogin(sessionKey, 4000)
          if (cancelled) return
          const record = asRecord(data)
          const connected = bool(record.connected)
          setWechatLogin((current) =>
            current?.sessionKey === sessionKey
              ? {
                  ...current,
                  message: text(record.message, current.message),
                  connected,
                }
              : current,
          )
          if (connected) {
            invalidateChannels()
            return
          }
        } catch (error) {
          if (cancelled) return
          setWechatLogin((current) =>
            current?.sessionKey === sessionKey
              ? {
                  ...current,
                  message: error instanceof Error ? error.message : '微信登录轮询失败，请重新生成二维码。',
                }
              : current,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
    }

    void poll()
    return () => {
      cancelled = true
    }
  }, [wechatLogin?.sessionKey, wechatLogin?.connected])

  useEffect(() => {
    let cancelled = false
    setWechatQrImage('')
    if (!wechatLogin) return

    const directImage = directQrImageSource(wechatLogin.qrcodeImage)
    if (directImage) {
      setWechatQrImage(directImage)
      return
    }

    const payload = text(wechatLogin.qrcodeImage)
    if (!payload) return

    void QRCode.toDataURL(payload, qrRenderOptions).then((dataUrl) => {
      if (!cancelled) setWechatQrImage(dataUrl)
    }).catch(() => {
      if (!cancelled) setWechatQrImage('')
    })

    return () => {
      cancelled = true
    }
  }, [wechatLogin?.qrcodeImage])

  useEffect(() => {
    let cancelled = false
    setFeishuQrImage('')
    if (!feishuWizard?.qrUrl) return

    void QRCode.toDataURL(feishuWizard.qrUrl, qrRenderOptions).then((dataUrl) => {
      if (!cancelled) setFeishuQrImage(dataUrl)
    }).catch(() => {
      if (!cancelled) setFeishuQrImage('')
    })

    return () => {
      cancelled = true
    }
  }, [feishuWizard?.qrUrl])

  useEffect(() => {
    if (!feishuWizard?.sessionId || feishuWizard.status !== 'pending') return
    const source = new EventSource(channelsApi.feishuSetupWizardStreamUrl(feishuWizard.sessionId))

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as FeishuWizardEvent
        setFeishuWizard((current) => {
          if (!current || current.sessionId !== feishuWizard.sessionId) return current
          const status = data.status ?? current.status
          return {
            ...current,
            status,
            message: data.message ?? current.message,
            error: data.error,
          }
        })
        if (data.status === 'approved' || data.status === 'failed' || data.status === 'cancelled') {
          source.close()
          invalidateChannels()
        }
      } catch {
        setFeishuWizard((current) =>
          current?.sessionId === feishuWizard.sessionId
            ? { ...current, message: '飞书扫码状态解析失败。', status: 'failed', error: 'PARSE_ERROR' }
            : current,
        )
        source.close()
      }
    }
    source.onerror = () => {
      setFeishuWizard((current) =>
        current?.sessionId === feishuWizard.sessionId && current.status === 'pending'
          ? { ...current, message: '飞书扫码连接中断，请重新开始。', status: 'failed', error: 'STREAM_ERROR' }
          : current,
      )
      source.close()
    }

    return () => source.close()
  }, [feishuWizard?.sessionId, feishuWizard?.status])

  return (
    <div className={styles.channelGrid}>
      <Surface title="微信 Bot 扫码" action={<Badge tone={bool(asRecord(wechat.data).running) ? 'success' : 'default'}>{bool(asRecord(wechat.data).running) ? '运行中' : '未运行'}</Badge>}>
        <div className={styles.channelBody}>
          <div className={styles.channelHeader}>
            <span><Cable size={17} /></span>
            <div><strong>官方 Bot 通道</strong><small>{accountCount} 个账号，入站消息自动回写对话</small></div>
            <Button size="small" onClick={() => startWechat.mutate()} disabled={startWechat.isPending}>
              {startWechat.isPending ? <LoaderCircle className={styles.spin} size={14} /> : <QrCode size={14} />}
              生成二维码
            </Button>
          </div>
          {startWechat.error ? <div className={uiStyles.error}>{startWechat.error instanceof Error ? startWechat.error.message : '微信登录启动失败'}</div> : null}
          {wechatLogin ? (
            <div className={styles.qrPanel}>
              <div className={styles.qrFrame}>
                {wechatQrImage ? <img src={wechatQrImage} alt="微信 Bot 登录二维码" /> : <QrCode size={42} />}
              </div>
              <div className={styles.qrMeta}>
                <strong>{wechatLogin.connected ? '微信登录完成' : '等待微信扫码确认'}</strong>
                <span>{wechatLogin.message}</span>
                {wechatLogin.expiresAt ? <small>有效期至 {expiresText(wechatLogin.expiresAt)}</small> : null}
              </div>
            </div>
          ) : null}
          <div className={styles.sourceList}>
            {accountRows.length ? accountRows.map((account, index) => {
              const accountId = text(account.accountId, text(account.id, String(index)))
              const displayName = text(account.nickname, text(account.name, accountId))
              const running = bool(account.running)
              return (
                <div key={accountId} className={styles.sourceRow}>
                  <span><strong>{displayName}</strong><small>{accountId}</small></span>
                  <div className={styles.channelActions}>
                    <Badge tone={running ? 'success' : 'default'}>{running ? '运行中' : '已保存'}</Badge>
                    <Button size="small" onClick={() => startWechatAccount.mutate(accountId)} disabled={running || startWechatAccount.isPending}>启动</Button>
                    <Button size="small" onClick={() => stopWechatAccount.mutate(accountId)} disabled={!running || stopWechatAccount.isPending}>停止</Button>
                    <Button size="small" variant="danger" onClick={() => deleteWechatAccount.mutate(accountId)} disabled={deleteWechatAccount.isPending}>删除</Button>
                  </div>
                </div>
              )
            }) : <div className={styles.emptyHint}>还没有绑定微信 Bot 账号。</div>}
          </div>
          <pre className={styles.resultBox}>{jsonText(wechat.data ?? {})}</pre>
        </div>
      </Surface>
      <Surface title="飞书 Bot 扫码" action={<Badge tone={statusTone(asRecord(feishu.data).status ?? asRecord(feishu.data).connected)}>{bool(asRecord(feishu.data).connected) || bool(asRecord(feishu.data).running) ? '已连接' : '未连接'}</Badge>}>
        <div className={styles.formStack}>
          <div className={styles.channelHeader}>
            <span><Bot size={17} /></span>
            <div><strong>扫码接入向导</strong><small>自动获取并保存 App ID 与 App Secret</small></div>
            <Button size="small" onClick={() => startFeishuWizard.mutate()} disabled={startFeishuWizard.isPending || feishuWizard?.status === 'pending'}>
              {startFeishuWizard.isPending ? <LoaderCircle className={styles.spin} size={14} /> : <QrCode size={14} />}
              开始扫码
            </Button>
          </div>
          {startFeishuWizard.error ? <div className={uiStyles.error}>{startFeishuWizard.error instanceof Error ? startFeishuWizard.error.message : '飞书扫码启动失败'}</div> : null}
          {feishuWizard ? (
            <div className={styles.qrPanel}>
              <div className={styles.qrFrame}>
                {feishuQrImage ? <img src={feishuQrImage} alt="飞书 Bot 授权二维码" /> : <QrCode size={42} />}
              </div>
              <div className={styles.qrMeta}>
                <strong>{feishuWizard.status === 'approved' ? '飞书接入完成' : feishuWizard.status === 'pending' ? '等待飞书扫码授权' : '飞书扫码未完成'}</strong>
                <span>{feishuWizard.message}</span>
                {feishuWizard.expiresAt ? <small>有效期至 {expiresText(feishuWizard.expiresAt)}</small> : null}
                {feishuWizard.error ? <small>错误码：{feishuWizard.error}</small> : null}
                <div className={styles.channelActions}>
                  <Button size="small" onClick={() => window.open(feishuWizard.qrUrl, '_blank', 'noopener,noreferrer')} disabled={!feishuWizard.qrUrl}>
                    <ExternalLink size={14} />
                    打开二维码
                  </Button>
                  {feishuWizard.status === 'pending' ? (
                    <Button size="small" onClick={() => cancelFeishuWizard.mutate(feishuWizard.sessionId)} disabled={cancelFeishuWizard.isPending}>
                      <XCircle size={14} />
                      取消
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => startFeishuWizard.mutate()} disabled={startFeishuWizard.isPending}>
                      <RefreshCw size={14} />
                      重新开始
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <Field label="App ID"><Input value={feishuForm.appId} onChange={(event) => setFeishuForm({ ...feishuForm, appId: event.target.value })} /></Field>
          <Field label="App Secret"><Input type="password" value={feishuForm.appSecret} onChange={(event) => setFeishuForm({ ...feishuForm, appSecret: event.target.value })} /></Field>
          <Field label="Encrypt Key"><Input value={feishuForm.encryptKey} onChange={(event) => setFeishuForm({ ...feishuForm, encryptKey: event.target.value })} /></Field>
          <Field label="Verification Token"><Input value={feishuForm.verificationToken} onChange={(event) => setFeishuForm({ ...feishuForm, verificationToken: event.target.value })} /></Field>
          <div className={styles.channelActions}><Button size="small" onClick={() => saveFeishu.mutate()} disabled={saveFeishu.isPending}>保存</Button><Button size="small" onClick={() => connectFeishu.mutate()} disabled={connectFeishu.isPending}>连接</Button><Button size="small" onClick={() => disconnectFeishu.mutate()} disabled={disconnectFeishu.isPending}>断开</Button></div>
          <pre className={styles.resultBox}>{jsonText({ status: feishu.data ?? {}, workspace: feishuWorkspace.data ?? {} })}</pre>
        </div>
      </Surface>
      <Surface title="企业微信 Webhook" action={<Badge tone={bool(asRecord(wecom.data).available, true) ? 'success' : 'danger'}>{hooks.length} 个 Webhook</Badge>}>
        <div className={styles.formStack}>
          <div className={styles.inlineForm}><Input value={wecomForm.name} onChange={(event) => setWecomForm({ ...wecomForm, name: event.target.value })} placeholder="名称" /><Button size="small" onClick={() => createWecom.mutate()} disabled={!wecomForm.name.trim() || !wecomForm.webhookUrl.trim()}>新增</Button></div>
          <Input value={wecomForm.webhookUrl} onChange={(event) => setWecomForm({ ...wecomForm, webhookUrl: event.target.value })} placeholder="Webhook URL" />
          <Input value={wecomForm.secret} onChange={(event) => setWecomForm({ ...wecomForm, secret: event.target.value })} placeholder="Secret，可选" />
          <div className={styles.sourceList}>
            {hooks.map((hook, index) => (
              <div key={text(hook.id, String(index))} className={styles.sourceRow}>
                <span><strong>{text(hook.name, '未命名 Webhook')}</strong><small>{text(hook.webhookUrl ?? hook.url, '未配置 URL')}</small></span>
                <Button size="small" onClick={() => testWecom.mutate(text(hook.id))}>测试</Button>
              </div>
            ))}
          </div>
          <pre className={styles.resultBox}>{jsonText(wecom.data ?? {})}</pre>
        </div>
      </Surface>
    </div>
  )
}
