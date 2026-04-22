import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  SocialChannelsApi,
  type FeishuConfigInput,
  type FeishuDeliveryTarget,
  type FeishuStatus,
  type WechatAccountSummary,
  type WechatDeliveryTarget,
  type WechatLoginStart,
  type WechatStatus,
  type WecomStatus,
  type WecomWebhookSummary,
} from '../api/social-channels'
import { FeishuWorkspacePanel } from '../components/FeishuWorkspacePanel'
import { IconChevron, IconRefresh, IconSocial, IconTrash } from '../components/Icons'

type Notice = {
  type: 'success' | 'error' | 'info'
  message: string
}

type FeishuFormState = {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  callbackBaseUrl: string
  enabled: boolean
  autoReplyEnabled: boolean
  cardCallbackEnabled: boolean
}

function formatTime(value?: number | string) {
  if (!value) return '暂无'
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function wechatAccountState(account: WechatAccountSummary) {
  if (!account.configured) return '未登录'
  if (account.running) return '接收中'
  if (account.enabled) return '已启用，等待启动'
  return '已暂停'
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '')
    if (message) return message
  }
  return fallback
}

function toFeishuForm(status?: FeishuStatus | null): FeishuFormState {
  return {
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: '',
    callbackBaseUrl: status?.callbackBaseUrl ?? '',
    enabled: status?.enabled ?? false,
    autoReplyEnabled: status?.autoReplyEnabled ?? true,
    cardCallbackEnabled: status?.cardCallbackEnabled ?? true,
  }
}

export default function SocialChannels() {
  const navigate = useNavigate()
  const { channel } = useParams<{ channel?: string }>()

  const [wechatStatus, setWechatStatus] = useState<WechatStatus | null>(null)
  const [wechatTargets, setWechatTargets] = useState<WechatDeliveryTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [login, setLogin] = useState<WechatLoginStart | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loginPolling, setLoginPolling] = useState(false)
  const [busyAccount, setBusyAccount] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus | null>(null)
  const [feishuTargets, setFeishuTargets] = useState<FeishuDeliveryTarget[]>([])
  const [feishuForm, setFeishuForm] = useState<FeishuFormState>(toFeishuForm())
  const [feishuSaving, setFeishuSaving] = useState(false)
  const [feishuSending, setFeishuSending] = useState(false)
  const [feishuSendReceiveId, setFeishuSendReceiveId] = useState('')
  const [feishuSendText, setFeishuSendText] = useState('1052 OS 已接入飞书。')
  const [feishuSendMode, setFeishuSendMode] = useState<'text' | 'card' | 'media'>('text')
  const [feishuSendMediaMode, setFeishuSendMediaMode] = useState<
    'auto' | 'image' | 'file' | 'audio' | 'media'
  >('auto')
  const [feishuSendFile, setFeishuSendFile] = useState<File | null>(null)
  const [feishuSendFileKey, setFeishuSendFileKey] = useState(0)

  // One-Shot wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null)
  const [wizardQrUrl, setWizardQrUrl] = useState<string>('')
  const [wizardQrDataUrl, setWizardQrDataUrl] = useState<string>('')
  const [wizardStatus, setWizardStatus] = useState<'idle' | 'starting' | 'pending' | 'approved' | 'failed' | 'cancelled'>('idle')
  const [wizardMessage, setWizardMessage] = useState<string>('')
  const wizardEsRef = useRef<EventSource | null>(null)

  const [wecomStatus, setWecomStatus] = useState<WecomStatus | null>(null)
  const [wecomWebhooks, setWecomWebhooks] = useState<WecomWebhookSummary[]>([])
  const [wecomFormName, setWecomFormName] = useState('')
  const [wecomFormUrl, setWecomFormUrl] = useState('')
  const [wecomSaving, setWecomSaving] = useState(false)
  const [wecomTestingId, setWecomTestingId] = useState('')
  const [wecomPendingDelete, setWecomPendingDelete] = useState('')

  const [notice, setNotice] = useState<Notice | null>(null)
  const pollingCancelled = useRef(false)

  const activeChannel =
    channel === 'wechat' || channel === 'feishu' || channel === 'wecom' ? channel : null
  const isUnknownChannel = Boolean(channel && !activeChannel)

  const wechatAccounts = wechatStatus?.accounts ?? []
  const wechatRunningCount = useMemo(
    () => wechatAccounts.filter((account) => account.running).length,
    [wechatAccounts],
  )
  const wechatState =
    wechatRunningCount > 0 ? '接收中' : wechatAccounts.length > 0 ? '已接入' : '未接入'
  const wechatStateClass =
    wechatRunningCount > 0 ? ' running' : wechatAccounts.length > 0 ? ' connected' : ''

  const feishuState =
    feishuStatus?.running === true
      ? '接收中'
      : feishuStatus?.configured
        ? '已配置'
        : '未配置'
  const feishuStateClass =
    feishuStatus?.running === true ? ' running' : feishuStatus?.configured ? ' connected' : ''
  const wecomState = wecomWebhooks.length > 0 ? '已接入' : '未接入'
  const wecomStateClass = wecomWebhooks.length > 0 ? ' connected' : ''

  const showNotice = (message: string, type: Notice['type'] = 'info') => {
    setNotice({ message, type })
  }

  const syncFeishuStatus = (status: FeishuStatus) => {
    setFeishuStatus(status)
    setFeishuForm((current) => ({
      ...current,
      callbackBaseUrl: current.callbackBaseUrl || status.callbackBaseUrl || '',
      enabled: status.enabled,
      autoReplyEnabled: status.autoReplyEnabled,
      cardCallbackEnabled: status.cardCallbackEnabled,
    }))
  }

  const loadStatus = async () => {
    try {
      const [
        wechatStatusResult,
        wechatTargetsResult,
        feishuStatusResult,
        feishuTargetsResult,
        wecomStatusResult,
      ] = await Promise.allSettled([
        SocialChannelsApi.wechatStatus(),
        SocialChannelsApi.wechatDeliveryTargets(),
        SocialChannelsApi.feishuStatus(),
        SocialChannelsApi.feishuDeliveryTargets(),
        SocialChannelsApi.wecomStatus(),
      ])

      if (wechatStatusResult.status === 'fulfilled') {
        setWechatStatus(wechatStatusResult.value)
      }
      if (wechatTargetsResult.status === 'fulfilled') {
        setWechatTargets(wechatTargetsResult.value)
      }
      if (feishuStatusResult.status === 'fulfilled') {
        syncFeishuStatus(feishuStatusResult.value)
      }
      if (feishuTargetsResult.status === 'fulfilled') {
        setFeishuTargets(feishuTargetsResult.value)
        if (!feishuSendReceiveId && feishuTargetsResult.value.length > 0) {
          setFeishuSendReceiveId(feishuTargetsResult.value[0].receiveId)
        }
      }
      if (wecomStatusResult.status === 'fulfilled') {
        setWecomStatus(wecomStatusResult.value)
        setWecomWebhooks(wecomStatusResult.value.webhooks ?? [])
      }

      const firstError =
        wechatStatusResult.status === 'rejected'
          ? wechatStatusResult.reason
          : wechatTargetsResult.status === 'rejected'
            ? wechatTargetsResult.reason
            : feishuStatusResult.status === 'rejected'
              ? feishuStatusResult.reason
              : feishuTargetsResult.status === 'rejected'
                ? feishuTargetsResult.reason
                : wecomStatusResult.status === 'rejected'
                  ? wecomStatusResult.reason
                : null
      if (firstError) {
        showNotice(getErrorMessage(firstError, '社交通道状态加载失败'), 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => {
      void loadStatus()
    }, 8000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!login?.qrcodeUrl) {
      setQrDataUrl('')
      return
    }
    QRCode.toDataURL(login.qrcodeUrl, {
      margin: 1,
      width: 260,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    })
      .then((value) => {
        if (!cancelled) setQrDataUrl(value)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [login])

  const startWechatLogin = async () => {
    pollingCancelled.current = true
    setLogin(null)
    setQrDataUrl('')
    setLoginPolling(false)
    try {
      const result = await SocialChannelsApi.startWechatLogin()
      setLogin(result)
      setLoginPolling(true)
      showNotice(result.message, 'success')
      pollingCancelled.current = false
      void pollWechatLogin(result.sessionKey)
    } catch (error) {
      showNotice(getErrorMessage(error, '微信二维码生成失败'), 'error')
    }
  }

  const pollWechatLogin = async (sessionKey: string) => {
    while (!pollingCancelled.current) {
      try {
        const result = await SocialChannelsApi.waitWechatLogin(sessionKey, 10_000)
        showNotice(result.message, result.connected ? 'success' : 'info')
        if (result.connected) {
          pollingCancelled.current = true
          setLogin(null)
          setLoginPolling(false)
          await loadStatus()
          return
        }
        if (result.message.includes('过期') || result.message.includes('重新生成')) {
          pollingCancelled.current = true
          setLoginPolling(false)
          return
        }
      } catch (error) {
        pollingCancelled.current = true
        setLoginPolling(false)
        showNotice(getErrorMessage(error, '微信登录状态轮询失败'), 'error')
        return
      }
    }
  }

  const startWechatAccount = async (accountId: string) => {
    setBusyAccount(accountId)
    try {
      await SocialChannelsApi.startWechatAccount(accountId)
      showNotice('微信通道已启动，收到消息后会写入同一聊天流。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '微信通道启动失败'), 'error')
    } finally {
      setBusyAccount('')
    }
  }

  const stopWechatAccount = async (accountId: string) => {
    setBusyAccount(accountId)
    try {
      await SocialChannelsApi.stopWechatAccount(accountId)
      showNotice('微信通道已暂停。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '微信通道暂停失败'), 'error')
    } finally {
      setBusyAccount('')
    }
  }

  const deleteWechatAccount = async (accountId: string) => {
    setBusyAccount(accountId)
    try {
      await SocialChannelsApi.deleteWechatAccount(accountId)
      showNotice('微信账号已删除。', 'success')
      setPendingDelete('')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '微信账号删除失败'), 'error')
    } finally {
      setBusyAccount('')
    }
  }

  const updateFeishuField = <K extends keyof FeishuFormState>(
    key: K,
    value: FeishuFormState[K],
  ) => {
    setFeishuForm((current) => ({ ...current, [key]: value }))
  }

  // ---------------------------------------------------------------------------
  // One-Shot Wizard handlers
  // ---------------------------------------------------------------------------

  const cancelWizardSession = (sessionId: string | null) => {
    if (!sessionId) return
    fetch(`/api/channels/feishu/setup-wizard/cancel/${sessionId}`, {
      method: 'POST',
    }).catch(() => undefined)
  }

  const closeWizard = () => {
    wizardEsRef.current?.close()
    wizardEsRef.current = null
    cancelWizardSession(wizardSessionId)
    setWizardOpen(false)
    setWizardSessionId(null)
    setWizardQrUrl('')
    setWizardQrDataUrl('')
    setWizardStatus('idle')
    setWizardMessage('')
  }

  const handleWizardOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeWizard()
  }

  const startWizard = async () => {
    wizardEsRef.current?.close()
    wizardEsRef.current = null
    cancelWizardSession(wizardSessionId)
    setWizardSessionId(null)
    setWizardQrUrl('')
    setWizardQrDataUrl('')
    setWizardStatus('starting')
    setWizardMessage('正在连接飞书授权服务…')
    setWizardOpen(true)
    try {
      const res = await fetch('/api/channels/feishu/setup-wizard/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'feishu' }),
      })
      const data = await res.json() as { ok: boolean; sessionId?: string; qrUrl?: string; error?: string; warning?: string }
      if (!data.ok || !data.sessionId || !data.qrUrl) {
        throw new Error(data.error ?? 'Failed to start wizard')
      }
      setWizardSessionId(data.sessionId)
      setWizardQrUrl(data.qrUrl)
      setWizardStatus('pending')
      setWizardMessage(data.warning ? `注意：${data.warning}` : '请用飞书 App 扫描下方二维码')

      // Generate QR image
      try {
        const dataUrl = await QRCode.toDataURL(data.qrUrl, { width: 240, margin: 2 })
        setWizardQrDataUrl(dataUrl)
      } catch {
        setWizardQrDataUrl('')
      }

      // Subscribe to SSE stream
      const es = new EventSource(`/api/channels/feishu/setup-wizard/stream/${data.sessionId}`)
      wizardEsRef.current = es

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as { status: string; message: string; credentials?: { appId: string } }
          setWizardMessage(event.message)
          if (event.status === 'approved') {
            setWizardStatus('approved')
            es.close()
            // Reload feishu status
            SocialChannelsApi.feishuStatus().then(syncFeishuStatus).catch(() => undefined)
            showNotice(`飞书 Bot 接入成功！App ID: ${event.credentials?.appId ?? ''}`, 'success')
          } else if (event.status === 'failed' || event.status === 'cancelled') {
            setWizardStatus(event.status as 'failed' | 'cancelled')
            es.close()
          } else {
            setWizardStatus('pending')
          }
        } catch {
          // ignore parse errors
        }
      }
      es.onerror = () => {
        setWizardMessage('SSE 连接中断，请重试')
        setWizardStatus('failed')
        es.close()
      }
    } catch (err) {
      setWizardStatus('failed')
      setWizardMessage(err instanceof Error ? err.message : '启动失败，请重试')
    }
  }

  useEffect(() => {
    if (activeChannel === 'feishu') return
    if (!wizardOpen && !wizardSessionId) return
    closeWizard()
  }, [activeChannel, wizardOpen, wizardSessionId])

  useEffect(() => {
    return () => {
      wizardEsRef.current?.close()
      wizardEsRef.current = null
      cancelWizardSession(wizardSessionId)
    }
  }, [wizardSessionId])

  const saveFeishuConfig = async () => {
    setFeishuSaving(true)
    try {
      const payload: FeishuConfigInput = {
        appId: feishuForm.appId,
        appSecret: feishuForm.appSecret,
        verificationToken: feishuForm.verificationToken,
        encryptKey: feishuForm.encryptKey,
        callbackBaseUrl: feishuForm.callbackBaseUrl,
        enabled: feishuForm.enabled,
        autoReplyEnabled: feishuForm.autoReplyEnabled,
        cardCallbackEnabled: feishuForm.cardCallbackEnabled,
      }
      const status = await SocialChannelsApi.saveFeishuConfig(payload)
      syncFeishuStatus(status)
      showNotice('飞书配置已保存。留空的凭据字段会保留已有值。', 'success')
    } catch (error) {
      showNotice(getErrorMessage(error, '飞书配置保存失败'), 'error')
    } finally {
      setFeishuSaving(false)
    }
  }

  const connectFeishu = async () => {
    setFeishuSaving(true)
    try {
      const status = await SocialChannelsApi.connectFeishu()
      syncFeishuStatus(status)
      showNotice('飞书长连接已启动。请在飞书开发者后台确认订阅了接收消息事件。', 'success')
    } catch (error) {
      showNotice(getErrorMessage(error, '飞书连接启动失败'), 'error')
    } finally {
      setFeishuSaving(false)
    }
  }

  const disconnectFeishu = async () => {
    setFeishuSaving(true)
    try {
      const status = await SocialChannelsApi.disconnectFeishu()
      syncFeishuStatus(status)
      showNotice('飞书长连接已停止。', 'success')
    } catch (error) {
      showNotice(getErrorMessage(error, '飞书连接停止失败'), 'error')
    } finally {
      setFeishuSaving(false)
    }
  }

  const sendFeishuTest = async () => {
    if (!feishuSendReceiveId.trim()) {
      showNotice('请先填写飞书 receive_id，通常可直接使用最近会话里的 chat_id。', 'error')
      return
    }
    setFeishuSending(true)
    try {
      const result = await SocialChannelsApi.sendFeishuMessage({
        receiveIdType: 'chat_id',
        receiveId: feishuSendReceiveId.trim(),
        text: feishuSendText.trim(),
        cardTemplate: feishuSendMode === 'card' ? 'test' : undefined,
      })
      showNotice(
        result.msgType === 'interactive'
          ? '飞书测试卡片已发送。卡片按钮需要在开发者后台配置回调地址后才能真正交互。'
          : '飞书测试消息已发送。',
        'success',
      )
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '飞书测试消息发送失败'), 'error')
    } finally {
      setFeishuSending(false)
    }
  }

  const sendFeishuTestV2 = async () => {
    if (feishuSendMode !== 'media') {
      await sendFeishuTest()
      return
    }
    if (!feishuSendReceiveId.trim()) {
      showNotice('请先填写飞书 receive_id，通常可以直接使用最近会话里的 chat_id。', 'error')
      return
    }
    if (feishuSendMode === 'media' && !feishuSendFile) {
      showNotice('请选择一个要发送到飞书的媒体文件。', 'error')
      return
    }

    setFeishuSending(true)
    try {
      if (feishuSendMode === 'media' && feishuSendFile) {
        const result = await SocialChannelsApi.sendFeishuMedia({
          receiveIdType: 'chat_id',
          receiveId: feishuSendReceiveId.trim(),
          text: feishuSendText.trim(),
          mode: feishuSendMediaMode,
          file: feishuSendFile,
        })
        showNotice(
          result.warnings.length > 0
            ? `飞书媒体已发送，但有 ${result.warnings.length} 条处理提示。`
            : '飞书媒体消息已发送。',
          result.warnings.length > 0 ? 'info' : 'success',
        )
        setFeishuSendFile(null)
        setFeishuSendFileKey((current) => current + 1)
      } else {
        const result = await SocialChannelsApi.sendFeishuMessage({
          receiveIdType: 'chat_id',
          receiveId: feishuSendReceiveId.trim(),
          text: feishuSendText.trim(),
          cardTemplate: undefined,
        })
        showNotice(
          result.msgType === 'interactive'
            ? '飞书测试卡片已发送。卡片按钮需要在开发者后台配置回调地址后才能真正交互。'
            : '飞书测试消息已发送。',
          'success',
        )
      }
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '飞书测试消息发送失败'), 'error')
    } finally {
      setFeishuSending(false)
    }
  }

  const createWecomWebhook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!wecomFormName.trim() || !wecomFormUrl.trim()) {
      showNotice('请先填写企业微信机器人的名称和 Webhook URL。', 'error')
      return
    }

    setWecomSaving(true)
    try {
      await SocialChannelsApi.wecomCreateWebhook({
        name: wecomFormName.trim(),
        webhookUrl: wecomFormUrl.trim(),
      })
      setWecomFormName('')
      setWecomFormUrl('')
      showNotice('企业微信 Webhook 已添加。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '企业微信 Webhook 创建失败'), 'error')
    } finally {
      setWecomSaving(false)
    }
  }

  const toggleWecomWebhook = async (id: string, enabled: boolean) => {
    setWecomTestingId(id)
    try {
      await SocialChannelsApi.wecomUpdateWebhook(id, { enabled })
      showNotice(enabled ? '企业微信 Webhook 已启用。' : '企业微信 Webhook 已停用。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '企业微信 Webhook 状态更新失败'), 'error')
    } finally {
      setWecomTestingId('')
    }
  }

  const testWecomWebhook = async (id: string) => {
    setWecomTestingId(id)
    try {
      const result = await SocialChannelsApi.wecomTestWebhook(id)
      showNotice(result.message || '企业微信测试消息已发送。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '企业微信测试失败'), 'error')
    } finally {
      setWecomTestingId('')
    }
  }

  const deleteWecomWebhook = async (id: string) => {
    setWecomTestingId(id)
    try {
      await SocialChannelsApi.wecomDeleteWebhook(id)
      setWecomPendingDelete('')
      showNotice('企业微信 Webhook 已删除。', 'success')
      await loadStatus()
    } catch (error) {
      showNotice(getErrorMessage(error, '企业微信 Webhook 删除失败'), 'error')
    } finally {
      setWecomTestingId('')
    }
  }

  const feishuCallbackCardUrl = feishuStatus?.callbackUrls.card
  const feishuCallbackEventUrl = feishuStatus?.callbackUrls.event

  return (
    <div className="page social-page">
      <div className="page-head social-head">
        <div>
          <div className="eyebrow">Social Channels</div>
          <h1>
            {activeChannel === 'wechat'
              ? '微信通道'
              : activeChannel === 'feishu'
                ? '飞书通道'
                : activeChannel === 'wecom'
                  ? '企业微信通道'
                : '社交通道'}
          </h1>
          <p>
            {activeChannel === 'wechat'
              ? '管理微信扫码接入、账号启停、媒体收发和定时任务推送目标。'
              : activeChannel === 'feishu'
                ? '管理飞书应用配置、长连接收消息、卡片回调地址和最近会话投递目标。'
                : activeChannel === 'wecom'
                  ? '管理企业微信群机器人 Webhook，补充企业微信消息推送与测试入口。'
                : '把微信、飞书等外部平台接入同一个 Agent 聊天流。每个平台使用独立二级页面，避免配置混在一起。'}
          </p>
        </div>
        <button className="icon-btn" type="button" onClick={() => void loadStatus()} title="刷新状态">
          <IconRefresh size={16} />
        </button>
      </div>

      {notice ? (
        <div className={'banner' + (notice.type === 'error' ? ' error' : '')}>{notice.message}</div>
      ) : null}

      {!channel ? (
        <section className="social-platform-grid" aria-label="社交通道平台">
          <button
            className="social-platform-card wechat"
            type="button"
            onClick={() => navigate('/social-channels/wechat')}
          >
            <div className="social-platform-main">
              <div className="social-platform-mark">
                <IconSocial size={22} />
              </div>
              <div>
                <span className="social-platform-kicker">WeChat</span>
                <strong>微信</strong>
                <small>
                  扫码登录后接入同一 Agent 聊天流，支持文本、图片、文件、视频和语音。
                </small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className={'social-platform-status' + wechatStateClass}>{wechatState}</span>
              <span>
                {wechatAccounts.length} 个账号 / {wechatRunningCount} 个接收中
              </span>
              <IconChevron size={16} />
            </div>
          </button>

          <button
            className="social-platform-card feishu"
            type="button"
            onClick={() => navigate('/social-channels/feishu')}
          >
            <div className="social-platform-main">
              <div className="social-platform-mark feishu">
                <IconSocial size={22} />
              </div>
              <div>
                <span className="social-platform-kicker">Feishu</span>
                <strong>飞书</strong>
                <small>
                  使用官方 SDK 长连接接收消息，支持最近会话投递、测试卡片和后续企业协作扩展。
                </small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className={'social-platform-status' + feishuStateClass}>{feishuState}</span>
              <span>{feishuTargets.length} 个最近会话</span>
              <IconChevron size={16} />
            </div>
          </button>

          <button
            className="social-platform-card"
            type="button"
            onClick={() => navigate('/social-channels/wecom')}
          >
            <div className="social-platform-main">
              <div className="social-platform-mark">
                <IconSocial size={22} />
              </div>
              <div>
                <span className="social-platform-kicker">WeCom</span>
                <strong>企业微信</strong>
                <small>
                  接入企业微信群机器人 Webhook，可用于测试通知、企业群播报和后续自动化推送。
                </small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className={'social-platform-status' + wecomStateClass}>{wecomState}</span>
              <span>{wecomStatus?.webhooks?.length ?? wecomWebhooks.length} 个 Webhook</span>
              <IconChevron size={16} />
            </div>
          </button>

          <div className="social-platform-card disabled" aria-disabled="true">
            <div className="social-platform-main">
              <div className="social-platform-mark muted">+</div>
              <div>
                <span className="social-platform-kicker">Next</span>
                <strong>更多平台</strong>
                <small>后续可继续接入 Telegram、邮件、QQ 等通道，沿用相同结构。</small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className="social-platform-status">预留</span>
              <span>等待接入</span>
            </div>
          </div>
        </section>
      ) : null}

      {activeChannel === 'wechat' ? (
        <section className="social-channel-detail">
          <div className="social-channel-detail-head">
            <div>
              <div className="eyebrow">Active Channel</div>
              <h2>微信通道</h2>
              <p>在这里完成微信扫码接入、账号启停、最近会话查看和定时任务推送目标管理。</p>
            </div>
            <div className="social-channel-actions">
              <button className="secondary-btn" type="button" onClick={() => navigate('/social-channels')}>
                返回通道列表
              </button>
              <span className={'social-platform-status' + wechatStateClass}>{wechatState}</span>
            </div>
          </div>

          <section className="social-overview">
            <div className="social-metric">
              <span>微信账号</span>
              <strong>{wechatAccounts.length}</strong>
              <small>{wechatRunningCount} 个接收中</small>
            </div>
            <div className="social-metric">
              <span>统一回显</span>
              <strong>已启用</strong>
              <small>消息会写入同一个 1052 OS 聊天流</small>
            </div>
            <div className="social-metric">
              <span>当前能力</span>
              <strong>文本 + 媒体</strong>
              <small>支持图片、文件、视频、语音收发</small>
            </div>
            <div className="social-metric">
              <span>最近会话</span>
              <strong>{wechatTargets.length}</strong>
              <small>可作为定时任务推送目标</small>
            </div>
          </section>

          <section className="social-layout">
            <div className="social-card social-login-card">
              <div className="social-card-head">
                <div>
                  <h2>微信扫码接入</h2>
                  <p>扫码后后端会保存账号凭据，并启动长轮询监听。收到微信消息后会自动写入聊天页。</p>
                </div>
              </div>

              <button className="primary-btn" type="button" onClick={() => void startWechatLogin()}>
                生成微信登录二维码
              </button>

              {login ? (
                <div className="wechat-qr-panel">
                  <div className="wechat-qr">
                    {qrDataUrl ? <img src={qrDataUrl} alt="微信登录二维码" /> : <span>二维码生成中</span>}
                  </div>
                  <div className="wechat-qr-meta">
                    <strong>{loginPolling ? '等待扫码确认' : '扫码状态'}</strong>
                    <span>有效期至：{formatTime(login.expiresAt)}</span>
                    {login.qrcodeUrl ? (
                      <a href={login.qrcodeUrl} target="_blank" rel="noreferrer">
                        打开二维码原始链接
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="social-empty-note">还没有进行中的扫码登录。</div>
              )}
            </div>

            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>最近微信会话</h2>
                  <p>定时任务默认会推送到最近微信会话；也可以在日历任务里固定账号与会话。</p>
                </div>
              </div>

              {wechatTargets.length === 0 ? (
                <div className="social-empty-note">
                  还没有可用会话。先从微信给 Agent 发一条消息，系统会记录最近会话用于后续提醒推送。
                </div>
              ) : (
                <div className="social-target-list">
                  {wechatTargets.map((target) => (
                    <div className={'social-target-item' + (target.running ? ' running' : '')} key={`${target.accountId}:${target.peerId}`}>
                      <div>
                        <strong>{target.label}</strong>
                        <span>{target.accountId}</span>
                      </div>
                      <div className="social-target-meta">
                        <span>{target.running ? '接收中' : '未运行'}</span>
                        <span>最近：{formatTime(target.lastMessageAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>微信账号</h2>
                  <p>每个账号独立保存 token、同步游标和 context_token，但所有消息共用统一聊天历史。</p>
                </div>
              </div>

              {loading ? <div className="empty-state">社交通道加载中...</div> : null}
              {!loading && wechatAccounts.length === 0 ? (
                <div className="empty-state">还没有接入微信账号。先生成二维码并扫码登录。</div>
              ) : null}

              <div className="social-account-list">
                {wechatAccounts.map((account) => (
                  <article className="social-account-card" key={account.accountId}>
                    <div className="social-account-main">
                      <div>
                        <div className="social-account-title">
                          {account.name || account.userId || account.accountId}
                        </div>
                        <div className="social-account-id">{account.accountId}</div>
                      </div>
                      <span className={'social-status' + (account.running ? ' running' : '')}>
                        {wechatAccountState(account)}
                      </span>
                    </div>

                    <div className="social-account-grid">
                      <span>最近入站：{formatTime(account.lastInboundAt)}</span>
                      <span>最近出站：{formatTime(account.lastOutboundAt)}</span>
                      <span>保存时间：{formatTime(account.savedAt)}</span>
                      <span>Base URL：{account.baseUrl}</span>
                    </div>

                    {account.lastError ? <div className="social-error">{account.lastError}</div> : null}

                    <div className="social-account-actions">
                      {account.running ? (
                        <button
                          className="secondary-btn"
                          type="button"
                          disabled={busyAccount === account.accountId}
                          onClick={() => void stopWechatAccount(account.accountId)}
                        >
                          暂停接收
                        </button>
                      ) : (
                        <button
                          className="primary-btn"
                          type="button"
                          disabled={busyAccount === account.accountId}
                          onClick={() => void startWechatAccount(account.accountId)}
                        >
                          启动接收
                        </button>
                      )}
                      {pendingDelete === account.accountId ? (
                        <>
                          <button
                            className="danger-btn"
                            type="button"
                            disabled={busyAccount === account.accountId}
                            onClick={() => void deleteWechatAccount(account.accountId)}
                          >
                            确认删除
                          </button>
                          <button className="secondary-btn" type="button" onClick={() => setPendingDelete('')}>
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          className="icon-btn danger-ghost"
                          type="button"
                          title="删除账号"
                          onClick={() => setPendingDelete(account.accountId)}
                        >
                          <IconTrash size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

          </section>
        </section>
      ) : null}

      {activeChannel === 'feishu' ? (
        <section className="social-channel-detail">
          <div className="social-channel-detail-head">
            <div>
              <div className="eyebrow">Active Channel</div>
              <h2>飞书通道</h2>
              <p>消息接收使用飞书官方 Node SDK 长连接；飞书卡片按钮交互使用 Webhook 回调地址。</p>
            </div>
            <div className="social-channel-actions">
              <button className="secondary-btn" type="button" onClick={() => navigate('/social-channels')}>
                返回通道列表
              </button>
              <span className={'social-platform-status' + feishuStateClass}>{feishuState}</span>
            </div>
          </div>

          <section className="social-overview">
            <div className="social-metric">
              <span>长连接状态</span>
              <strong>{feishuStatus?.running ? '运行中' : '未运行'}</strong>
              <small>{feishuStatus?.configured ? '应用已配置' : '请先保存 App ID / Secret'}</small>
            </div>
            <div className="social-metric">
              <span>最近会话</span>
              <strong>{feishuTargets.length}</strong>
              <small>可直接用于消息投递和后续任务推送</small>
            </div>
            <div className="social-metric">
              <span>自动回复</span>
              <strong>{feishuStatus?.autoReplyEnabled ? '已开启' : '已关闭'}</strong>
              <small>关闭后飞书来信仍会写入聊天流，但不会自动回复</small>
            </div>
            <div className="social-metric">
              <span>卡片回调</span>
              <strong>{feishuStatus?.cardCallbackEnabled ? '已准备' : '已关闭'}</strong>
              <small>需要在开发者后台配置可访问的回调地址</small>
            </div>
          </section>

          <section className="social-layout">
            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>飞书应用配置</h2>
                  <p>留空的凭据字段会保留后端已保存值，不会因为这里为空而清掉已有配置。</p>
                </div>
                <div className="social-channel-actions">
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => void startWizard()}
                    title="扫码一键建立飞书 Bot，无需手动填写 App ID / Secret"
                  >
                    ✦ One-Shot 接入
                  </button>
                </div>
              </div>

              {/* One-Shot Wizard Modal */}
              {wizardOpen && (
                <div
                  className="social-wizard-overlay"
                  role="dialog"
                  aria-modal="true"
                  aria-label="飞书一键接入"
                  onClick={handleWizardOverlayClick}
                >
                  <div className="social-wizard-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="social-wizard-head">
                      <h3>飞书 One-Shot 接入</h3>
                      <button
                        className="social-wizard-close"
                        type="button"
                        aria-label="关闭"
                        onClick={closeWizard}
                      >
                        X
                      </button>
                    </div>

                    {wizardStatus === 'starting' && (
                      <div className="social-wizard-body">
                        <div className="social-wizard-spinner" />
                        <p>{wizardMessage}</p>
                        <div className="social-wizard-actions">
                          <button className="secondary-btn" type="button" onClick={closeWizard}>
                            取消
                          </button>
                        </div>
                      </div>
                    )}

                    {wizardStatus === 'pending' && (
                      <div className="social-wizard-body">
                        {wizardQrDataUrl ? (
                          <img src={wizardQrDataUrl} alt="飞书扫码二维码" className="social-wizard-qr" width={240} height={240} />
                        ) : (
                          <div className="social-wizard-qr-fallback">
                            <a href={wizardQrUrl} target="_blank" rel="noopener noreferrer">{wizardQrUrl}</a>
                          </div>
                        )}
                        <p className="social-wizard-hint">用飞书 App 扫描上方二维码，按提示完成机器人创建</p>
                        <p className="social-wizard-status">{wizardMessage}</p>
                        <div className="social-wizard-actions">
                          <button className="secondary-btn" type="button" onClick={closeWizard}>
                            关闭
                          </button>
                        </div>
                      </div>
                    )}

                    {wizardStatus === 'approved' && (
                      <div className="social-wizard-body social-wizard-success">
                        <div className="social-wizard-icon">✓</div>
                        <p>{wizardMessage}</p>
                        <button className="primary-btn" type="button" onClick={closeWizard}>完成</button>
                      </div>
                    )}

                    {(wizardStatus === 'failed' || wizardStatus === 'cancelled') && (
                      <div className="social-wizard-body social-wizard-error">
                        <div className="social-wizard-icon">✕</div>
                        <p>{wizardMessage || '授权失败，请重试'}</p>
                        <div className="social-wizard-actions">
                          <button className="primary-btn" type="button" onClick={() => void startWizard()}>重试</button>
                          <button className="secondary-btn" type="button" onClick={closeWizard}>关闭</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="social-form">
                <label className="social-field">
                  <span>App ID</span>
                  <input
                    value={feishuForm.appId}
                    onChange={(event) => updateFeishuField('appId', event.target.value)}
                    placeholder={feishuStatus?.appIdMasked || 'cli_xxx'}
                  />
                </label>
                <label className="social-field">
                  <span>App Secret</span>
                  <input
                    type="password"
                    value={feishuForm.appSecret}
                    onChange={(event) => updateFeishuField('appSecret', event.target.value)}
                    placeholder={feishuStatus?.hasAppSecret ? '已保存，留空则保持不变' : '填写 App Secret'}
                  />
                </label>
                <label className="social-field">
                  <span>Verification Token</span>
                  <input
                    value={feishuForm.verificationToken}
                    onChange={(event) => updateFeishuField('verificationToken', event.target.value)}
                    placeholder={feishuStatus?.hasVerificationToken ? '已保存，留空则保持不变' : '卡片回调校验可选'}
                  />
                </label>
                <label className="social-field">
                  <span>Encrypt Key</span>
                  <input
                    value={feishuForm.encryptKey}
                    onChange={(event) => updateFeishuField('encryptKey', event.target.value)}
                    placeholder={feishuStatus?.hasEncryptKey ? '已保存，留空则保持不变' : '加密推送可选'}
                  />
                </label>
                <label className="social-field">
                  <span>公网基础地址</span>
                  <input
                    value={feishuForm.callbackBaseUrl}
                    onChange={(event) => updateFeishuField('callbackBaseUrl', event.target.value)}
                    placeholder="https://your-domain.example.com"
                  />
                </label>

                <div className="social-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={feishuForm.enabled}
                      onChange={(event) => updateFeishuField('enabled', event.target.checked)}
                    />
                    <span>保存后允许自动启动长连接</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={feishuForm.autoReplyEnabled}
                      onChange={(event) => updateFeishuField('autoReplyEnabled', event.target.checked)}
                    />
                    <span>收到飞书消息后自动调用 Agent 回复</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={feishuForm.cardCallbackEnabled}
                      onChange={(event) => updateFeishuField('cardCallbackEnabled', event.target.checked)}
                    />
                    <span>允许飞书卡片回调入口</span>
                  </label>
                </div>

                <div className="social-account-actions">
                  <button className="primary-btn" type="button" disabled={feishuSaving} onClick={() => void saveFeishuConfig()}>
                    保存配置
                  </button>
                  {feishuStatus?.running ? (
                    <button className="secondary-btn" type="button" disabled={feishuSaving} onClick={() => void disconnectFeishu()}>
                      停止长连接
                    </button>
                  ) : (
                    <button className="secondary-btn" type="button" disabled={feishuSaving} onClick={() => void connectFeishu()}>
                      启动长连接
                    </button>
                  )}
                </div>
              </div>

              {feishuStatus?.lastError ? <div className="social-error">{feishuStatus.lastError}</div> : null}
            </div>

            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>回调与最近会话</h2>
                  <p>飞书消息接收可直接走长连接；卡片按钮交互仍需要在开发者后台配置 Webhook 回调地址。</p>
                </div>
              </div>

              <div className="social-code-block">
                <strong>事件回调地址</strong>
                <code>{feishuCallbackEventUrl || feishuStatus?.eventWebhookPath || '未生成'}</code>
              </div>
              <div className="social-code-block">
                <strong>卡片回调地址</strong>
                <code>{feishuCallbackCardUrl || feishuStatus?.cardWebhookPath || '未生成'}</code>
              </div>

              <div className="social-mini-grid">
                <span>最近入站：{formatTime(feishuStatus?.lastInboundAt)}</span>
                <span>最近出站：{formatTime(feishuStatus?.lastOutboundAt)}</span>
                <span>最近事件：{formatTime(feishuStatus?.lastEventAt)}</span>
                <span>保存时间：{formatTime(feishuStatus?.savedAt)}</span>
              </div>

              {feishuTargets.length === 0 ? (
                <div className="social-empty-note">
                  还没有记录到飞书会话。先在飞书里给机器人发消息，系统会自动把最近 chat_id 记录到这里。
                </div>
              ) : (
                <div className="social-target-list">
                  {feishuTargets.map((target) => (
                    <button
                      type="button"
                      className={'social-target-item selectable' + (feishuSendReceiveId === target.receiveId ? ' active' : '')}
                      key={target.receiveId}
                      onClick={() => setFeishuSendReceiveId(target.receiveId)}
                    >
                      <div>
                        <strong>{target.label}</strong>
                        <span>{target.receiveId}</span>
                      </div>
                      <div className="social-target-meta">
                        <span>{target.chatType === 'group' ? '群聊' : '单聊'}</span>
                        <span>最近：{formatTime(target.lastMessageAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>飞书发送测试</h2>
                  <p>先选中最近会话，或直接手动填写一个 chat_id。这里可以发送普通文本或测试交互卡片。</p>
                </div>
              </div>

              <div className="social-form">
                <label className="social-field">
                  <span>receive_id (chat_id)</span>
                  <input
                    value={feishuSendReceiveId}
                    onChange={(event) => setFeishuSendReceiveId(event.target.value)}
                    placeholder="oc_xxx"
                  />
                </label>
                <label className="social-field">
                  <span>发送类型</span>
                  <select
                    value={feishuSendMode}
                    onChange={(event) =>
                      setFeishuSendMode(event.target.value as 'text' | 'card' | 'media')
                    }
                  >
                    <option value="text">文本消息</option>
                    <option value="card">测试交互卡片</option>
                    <option value="media">媒体文件</option>
                  </select>
                </label>
                {feishuSendMode === 'media' ? (
                  <>
                    <label className="social-field">
                      <span>媒体模式</span>
                      <select
                        value={feishuSendMediaMode}
                        onChange={(event) =>
                          setFeishuSendMediaMode(
                            event.target.value as 'auto' | 'image' | 'file' | 'audio' | 'media',
                          )
                        }
                      >
                        <option value="auto">自动判断</option>
                        <option value="image">强制图片</option>
                        <option value="file">强制文件</option>
                        <option value="audio">强制音频</option>
                        <option value="media">强制视频</option>
                      </select>
                    </label>
                    <label className="social-field">
                      <span>媒体文件</span>
                      <input
                        key={feishuSendFileKey}
                        type="file"
                        onChange={(event) => setFeishuSendFile(event.target.files?.[0] ?? null)}
                      />
                      {feishuSendFile ? (
                        <small>
                          已选择：{feishuSendFile.name} ·{' '}
                          {Math.max(1, Math.round(feishuSendFile.size / 1024))} KB
                        </small>
                      ) : (
                        <small>支持图片、文档、OPUS 音频、MP4 视频等飞书可接受的媒体。</small>
                      )}
                    </label>
                  </>
                ) : null}
                <label className="social-field">
                  <span>发送内容</span>
                  <textarea
                    rows={5}
                    value={feishuSendText}
                    onChange={(event) => setFeishuSendText(event.target.value)}
                    placeholder="输入要发给飞书会话的内容"
                  />
                </label>
                <div className="social-account-actions">
                  <button className="primary-btn" type="button" disabled={feishuSending} onClick={() => void sendFeishuTestV2()}>
                    发送测试
                  </button>
                </div>
              </div>
            </div>
            <FeishuWorkspacePanel onNotice={showNotice} />
          </section>
        </section>
      ) : null}

      {activeChannel === 'wecom' ? (
        <section className="social-channel-detail">
          <div className="social-channel-detail-head">
            <div>
              <div className="eyebrow">Active Channel</div>
              <h2>企业微信通道</h2>
              <p>在这里管理企业微信群机器人 Webhook，支持新增、启停、测试和删除。</p>
            </div>
            <div className="social-channel-actions">
              <button className="secondary-btn" type="button" onClick={() => navigate('/social-channels')}>
                返回通道列表
              </button>
              <span className={'social-platform-status' + wecomStateClass}>{wecomState}</span>
            </div>
          </div>

          <section className="social-overview">
            <div className="social-metric">
              <span>Webhook 总数</span>
              <strong>{wecomWebhooks.length}</strong>
              <small>每个机器人都可以独立启停和测试</small>
            </div>
            <div className="social-metric">
              <span>已启用</span>
              <strong>{wecomWebhooks.filter((item) => item.enabled).length}</strong>
              <small>停用后不会继续用于企业微信群通知</small>
            </div>
            <div className="social-metric">
              <span>最近发送</span>
              <strong>
                {wecomWebhooks.some((item) => item.lastSentAt)
                  ? formatTime(
                      wecomWebhooks
                        .map((item) => item.lastSentAt ?? 0)
                        .sort((a, b) => b - a)[0],
                    )
                  : '暂无'}
              </strong>
              <small>可快速判断机器人是否已成功发出测试消息</small>
            </div>
            <div className="social-metric">
              <span>当前用途</span>
              <strong>群机器人</strong>
              <small>适合做通知播报、任务结果回写和企业群同步提醒</small>
            </div>
          </section>

          <section className="social-layout">
            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>Webhook 列表</h2>
                  <p>保存在本地 `data/channels/wecom/`，不影响微信和飞书通道。</p>
                </div>
              </div>

              {wecomWebhooks.length === 0 ? (
                <div className="social-empty-note">
                  还没有企业微信机器人。先在企业微信群里添加机器人，然后把 Webhook URL 填到右侧。
                </div>
              ) : (
                <div className="social-account-list">
                  {wecomWebhooks.map((webhook) => (
                    <article className="social-account-card" key={webhook.id}>
                      <div className="social-account-main">
                        <div>
                          <div className="social-account-title">{webhook.name}</div>
                          <div className="social-account-id">{webhook.webhookKey}</div>
                        </div>
                        <span className={'social-status' + (webhook.enabled ? ' running' : '')}>
                          {webhook.enabled ? '已启用' : '已停用'}
                        </span>
                      </div>

                      <div className="social-account-grid">
                        <span>保存时间：{formatTime(webhook.savedAt)}</span>
                        <span>最近发送：{formatTime(webhook.lastSentAt)}</span>
                      </div>

                      {webhook.lastError ? <div className="social-error">{webhook.lastError}</div> : null}

                      <div className="social-account-actions">
                        <button
                          className={webhook.enabled ? 'secondary-btn' : 'primary-btn'}
                          type="button"
                          disabled={wecomTestingId === webhook.id}
                          onClick={() => void toggleWecomWebhook(webhook.id, !webhook.enabled)}
                        >
                          {webhook.enabled ? '停用' : '启用'}
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          disabled={wecomTestingId === webhook.id || !webhook.enabled}
                          onClick={() => void testWecomWebhook(webhook.id)}
                        >
                          {wecomTestingId === webhook.id ? '处理中...' : '发送测试'}
                        </button>
                        {wecomPendingDelete === webhook.id ? (
                          <>
                            <button
                              className="danger-btn"
                              type="button"
                              disabled={wecomTestingId === webhook.id}
                              onClick={() => void deleteWecomWebhook(webhook.id)}
                            >
                              确认删除
                            </button>
                            <button
                              className="secondary-btn"
                              type="button"
                              onClick={() => setWecomPendingDelete('')}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            className="icon-btn danger-ghost"
                            type="button"
                            title="删除 Webhook"
                            onClick={() => setWecomPendingDelete(webhook.id)}
                          >
                            <IconTrash size={15} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>添加机器人</h2>
                  <p>支持多个企业微信群机器人并行接入。URL 需为官方群机器人 Webhook。</p>
                </div>
              </div>

              <form className="social-form" onSubmit={(event) => void createWecomWebhook(event)}>
                <label className="social-field">
                  <span>名称</span>
                  <input
                    className="social-wecom-input"
                    value={wecomFormName}
                    onChange={(event) => setWecomFormName(event.target.value)}
                    placeholder="例如：运营通知群"
                  />
                </label>
                <label className="social-field">
                  <span>Webhook URL</span>
                  <input
                    className="social-wecom-input"
                    value={wecomFormUrl}
                    onChange={(event) => setWecomFormUrl(event.target.value)}
                    placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  />
                </label>
                <div className="social-account-actions">
                  <button className="primary-btn" type="submit" disabled={wecomSaving}>
                    {wecomSaving ? '保存中...' : '保存 Webhook'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </section>
      ) : null}

      {isUnknownChannel ? (
        <section className="social-channel-detail empty">
          <div className="social-empty-note">
            未找到这个社交通道。请返回通道列表，进入已接入的平台。
            <div className="social-empty-actions">
              <button className="secondary-btn" type="button" onClick={() => navigate('/social-channels')}>
                返回通道列表
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!channel ? (
        <section className="social-channel-hint">
          <div className="social-empty-note">选择一个平台卡片，进入对应的二级页面完成接入和管理。</div>
        </section>
      ) : null}
    </div>
  )
}
