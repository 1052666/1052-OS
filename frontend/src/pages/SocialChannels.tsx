import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  SocialChannelsApi,
  type WechatAccountSummary,
  type WechatDeliveryTarget,
  type WechatLoginStart,
  type WechatStatus,
  type WecomStatus,
  type WecomWebhookSummary,
} from '../api/social-channels'
import { IconChevron, IconRefresh, IconSocial, IconTrash } from '../components/Icons'

type Notice = {
  type: 'success' | 'error' | 'info'
  message: string
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

function accountState(account: WechatAccountSummary) {
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

export default function SocialChannels() {
  const navigate = useNavigate()
  const { channel } = useParams<{ channel?: string }>()
  const [status, setStatus] = useState<WechatStatus | null>(null)
  const [deliveryTargets, setDeliveryTargets] = useState<WechatDeliveryTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [login, setLogin] = useState<WechatLoginStart | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loginPolling, setLoginPolling] = useState(false)
  const [busyAccount, setBusyAccount] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const pollingCancelled = useRef(false)

  const [, setWecomStatus] = useState<WecomStatus | null>(null)
  const [wecomWebhooks, setWecomWebhooks] = useState<WecomWebhookSummary[]>([])
  const [wecomFormName, setWecomFormName] = useState('')
  const [wecomFormUrl, setWecomFormUrl] = useState('')
  const [wecomSaving, setWecomSaving] = useState(false)
  const [wecomTesting, setWecomTesting] = useState<string | null>(null)
  const [wecomPendingDelete, setWecomPendingDelete] = useState('')

  const accounts = status?.accounts ?? []
  const runningCount = useMemo(
    () => accounts.filter((account) => account.running).length,
    [accounts],
  )
  const activeChannel = channel === 'wechat' ? 'wechat' : channel === 'wecom' ? 'wecom' : null
  const isUnknownChannel = Boolean(channel && channel !== 'wechat' && channel !== 'wecom')
  const wechatState = runningCount > 0 ? '接收中' : accounts.length > 0 ? '已接入' : '未接入'
  const wechatStateClass = runningCount > 0 ? ' running' : accounts.length > 0 ? ' connected' : ''
  const wecomState = wecomWebhooks.length > 0 ? '已接入' : '未接入'
  const wecomStateClass = wecomWebhooks.length > 0 ? ' connected' : ''

  const showNotice = (message: string, type: Notice['type'] = 'info') => {
    setNotice({ message, type })
    window.setTimeout(() => setNotice(null), 4000)
  }

  const loadStatus = async () => {
    try {
      const [nextStatus, targets, wecom] = await Promise.all([
        SocialChannelsApi.wechatStatus(),
        SocialChannelsApi.wechatDeliveryTargets(),
        SocialChannelsApi.wecomStatus(),
      ])
      setStatus(nextStatus)
      setDeliveryTargets(targets)
      setWecomStatus(wecom)
      setWecomWebhooks(wecom.webhooks ?? [])
    } catch (error) {
      showNotice(getErrorMessage(error, '社交通道状态加载失败'), 'error')
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

  const startLogin = async () => {
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
      void pollLogin(result.sessionKey)
    } catch (error) {
      showNotice(getErrorMessage(error, '微信二维码生成失败'), 'error')
    }
  }

  const pollLogin = async (sessionKey: string) => {
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

  const startAccount = async (accountId: string) => {
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

  const stopAccount = async (accountId: string) => {
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

  const deleteAccount = async (accountId: string) => {
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

  const createWecomWebhook = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wecomFormName.trim() || !wecomFormUrl.trim()) {
      showNotice('请填写名称和 Webhook URL。', 'error')
      return
    }
    setWecomSaving(true)
    try {
      await SocialChannelsApi.wecomCreateWebhook({ name: wecomFormName, webhookUrl: wecomFormUrl })
      setWecomFormName('')
      setWecomFormUrl('')
      const ws = await SocialChannelsApi.wecomStatus()
      setWecomStatus(ws)
      setWecomWebhooks(ws.webhooks ?? [])
      showNotice('Webhook 创建成功。', 'success')
    } catch (error) {
      showNotice(getErrorMessage(error, '创建 Webhook 失败'), 'error')
    } finally {
      setWecomSaving(false)
    }
  }

  const testWecomWebhook = async (id: string) => {
    setWecomTesting(id)
    try {
      const result = await SocialChannelsApi.wecomTestWebhook(id)
      showNotice(result.message || '测试消息已发送。', 'success')
    } catch (error) {
      showNotice(getErrorMessage(error, 'Webhook 测试失败'), 'error')
    } finally {
      setWecomTesting(null)
    }
  }

  const deleteWecomWebhook = async (id: string) => {
    try {
      await SocialChannelsApi.wecomDeleteWebhook(id)
      showNotice('Webhook 已删除。', 'success')
      setWecomPendingDelete('')
      const ws = await SocialChannelsApi.wecomStatus()
      setWecomStatus(ws)
      setWecomWebhooks(ws.webhooks ?? [])
    } catch (error) {
      showNotice(getErrorMessage(error, 'Webhook 删除失败'), 'error')
    }
  }

  const toggleWecomWebhook = async (id: string, enabled: boolean) => {
    try {
      await SocialChannelsApi.wecomUpdateWebhook(id, { enabled })
      showNotice(enabled ? 'Webhook 已启用。' : 'Webhook 已禁用。', 'success')
      const ws = await SocialChannelsApi.wecomStatus()
      setWecomStatus(ws)
      setWecomWebhooks(ws.webhooks ?? [])
    } catch (error) {
      showNotice(getErrorMessage(error, 'Webhook 状态切换失败'), 'error')
    }
  }

  return (
    <div className="page social-page">
      <div className="page-head social-head">
        <div>
          <div className="eyebrow">Social Channels</div>
          <h1>{activeChannel === 'wechat' ? '微信通道' : activeChannel === 'wecom' ? '企业微信通道' : '社交通道'}</h1>
          <p>
            {activeChannel === 'wechat'
              ? '管理微信扫码接入、账号启停、媒体收发和定时任务推送目标。'
              : activeChannel === 'wecom'
              ? '管理企业微信群机器人 Webhook，支持创建、编辑、测试和删除。'
              : '把微信等外部平台接入同一个 Agent 聊天流。每个平台会进入独立二级页面，避免配置混在一起。'}
          </p>
        </div>
        <button className="icon-btn" type="button" onClick={() => void loadStatus()} title="刷新状态">
          <IconRefresh size={16} />
        </button>
      </div>

      {notice ? <div className={'banner' + (notice.type === 'error' ? ' error' : '')}>{notice.message}</div> : null}

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
                <small>扫码登录后接入同一 Agent 聊天流，支持文本、图片、文件、视频和语音。</small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className={'social-platform-status' + wechatStateClass}>{wechatState}</span>
              <span>{accounts.length} 个账号 / {runningCount} 个接收中</span>
              <IconChevron size={16} />
            </div>
          </button>

          <button
            className="social-platform-card wecom"
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
                <small>Webhook 群机器人推送，支持文本和 Markdown 消息格式。</small>
              </div>
            </div>
            <div className="social-platform-foot">
              <span className={'social-platform-status' + wecomStateClass}>{wecomState}</span>
              <span>{wecomWebhooks.length} 个 Webhook</span>
              <IconChevron size={16} />
            </div>
          </button>

          <div className="social-platform-card disabled" aria-disabled="true">
            <div className="social-platform-main">
              <div className="social-platform-mark muted">+</div>
              <div>
                <span className="social-platform-kicker">Next</span>
                <strong>更多平台</strong>
                <small>后续可在这里继续接入飞书、QQ、Telegram、邮件等通道。</small>
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
              <p>在这个通道卡片里完成微信扫码接入、账号启停、定时任务推送目标管理。</p>
            </div>
            <div className="social-channel-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => navigate('/social-channels')}
              >
                返回通道列表
              </button>
              <span className={'social-platform-status' + wechatStateClass}>{wechatState}</span>
            </div>
          </div>

          <section className="social-overview">
            <div className="social-metric">
              <span>微信账号</span>
              <strong>{accounts.length}</strong>
              <small>{runningCount} 个接收中</small>
            </div>
            <div className="social-metric">
              <span>统一回显</span>
              <strong>已启用</strong>
              <small>消息写入 data/chat-history.json</small>
            </div>
            <div className="social-metric">
              <span>当前能力</span>
              <strong>文本 + 媒体</strong>
              <small>支持图片、文件、视频、语音接收与 Agent 媒体回传</small>
            </div>
            <div className="social-metric">
              <span>定时推送</span>
              <strong>{deliveryTargets.length}</strong>
              <small>最近微信会话可作为任务触达目标</small>
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

              <button className="primary-btn" type="button" onClick={() => void startLogin()}>
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
                  <h2>定时任务推送目标</h2>
                  <p>定时任务默认会推送到最近的微信会话；也可以在日历任务里固定账号和会话 ID。</p>
                </div>
              </div>

              {deliveryTargets.length === 0 ? (
                <div className="social-empty-note">
                  还没有可用会话。先从微信给 Agent 发一条消息，系统会记录最近会话用于后续提醒推送。
                </div>
              ) : (
                <div className="social-target-list">
                  {deliveryTargets.map((target) => (
                    <div
                      className={'social-target-item' + (target.running ? ' running' : '')}
                      key={`${target.accountId}:${target.peerId}`}
                    >
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
                  <p>每个账号独立保存 token、同步游标和 context_token，但所有消息共用 1052 OS 聊天历史。</p>
                </div>
              </div>

              {loading ? <div className="empty-state">社交通道加载中...</div> : null}
              {!loading && accounts.length === 0 ? (
                <div className="empty-state">还没有接入微信账号。先生成二维码并扫码登录。</div>
              ) : null}

              <div className="social-account-list">
                {accounts.map((account) => (
                  <article className="social-account-card" key={account.accountId}>
                    <div className="social-account-main">
                      <div>
                        <div className="social-account-title">
                          {account.name || account.userId || account.accountId}
                        </div>
                        <div className="social-account-id">{account.accountId}</div>
                      </div>
                      <span className={'social-status' + (account.running ? ' running' : '')}>
                        {accountState(account)}
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
                          onClick={() => void stopAccount(account.accountId)}
                        >
                          暂停接收
                        </button>
                      ) : (
                        <button
                          className="primary-btn"
                          type="button"
                          disabled={busyAccount === account.accountId}
                          onClick={() => void startAccount(account.accountId)}
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
                            onClick={() => void deleteAccount(account.accountId)}
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
      ) : activeChannel === 'wecom' ? (
        <section className="social-channel-detail">
          <div className="social-channel-detail-head">
            <div>
              <div className="eyebrow">Active Channel</div>
              <h2>企业微信通道</h2>
              <p>管理企业微信群机器人 Webhook，支持创建、编辑、测试和删除。</p>
            </div>
            <div className="social-channel-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => navigate('/social-channels')}
              >
                返回通道列表
              </button>
              <span className="social-platform-status">{wecomWebhooks.length} 个 Webhook</span>
            </div>
          </div>

          <section className="social-layout">
            <div className="social-card">
              <div className="social-card-head">
                <div>
                  <h2>Webhook 列表</h2>
                  <p>已配置的企业微信群机器人 Webhook。</p>
                </div>
              </div>

              {wecomWebhooks.length === 0 ? (
                <div className="social-empty-note">还没有 Webhook。在右侧添加一个新的群机器人。</div>
              ) : (
                <div className="social-account-list">
                  {wecomWebhooks.map((wh) => (
                    <article className="social-account-card" key={wh.id}>
                      <div className="social-account-main">
                        <div>
                          <div className="social-account-title">{wh.name}</div>
                          <div className="social-account-id">{wh.webhookKey}</div>
                        </div>
                        <span className={'social-status' + (wh.enabled ? ' running' : '')}>
                          {wh.enabled ? '已启用' : '已禁用'}
                        </span>
                      </div>
                      <div className="social-account-grid">
                        <span>保存时间：{formatTime(wh.savedAt)}</span>
                        <span>最近发送：{formatTime(wh.lastSentAt)}</span>
                      </div>
                      {wh.lastError ? <div className="social-error">{wh.lastError}</div> : null}
                      <div className="social-account-actions">
                        <button
                          className={wh.enabled ? 'secondary-btn' : 'primary-btn'}
                          type="button"
                          onClick={() => void toggleWecomWebhook(wh.id, !wh.enabled)}
                        >
                          {wh.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          disabled={wecomTesting === wh.id || !wh.enabled}
                          onClick={() => void testWecomWebhook(wh.id)}
                        >
                          {wecomTesting === wh.id ? '发送中...' : '测试'}
                        </button>
                        {wecomPendingDelete === wh.id ? (
                          <>
                            <button
                              className="danger-btn"
                              type="button"
                              onClick={() => void deleteWecomWebhook(wh.id)}
                            >
                              确认删除
                            </button>
                            <button className="secondary-btn" type="button" onClick={() => setWecomPendingDelete('')}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            className="icon-btn danger-ghost"
                            type="button"
                            title="删除 Webhook"
                            onClick={() => setWecomPendingDelete(wh.id)}
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
                  <h2>添加 Webhook</h2>
                  <p>输入企业微信群机器人的 Webhook URL 来创建新的推送通道。</p>
                </div>
              </div>
              <form onSubmit={(e) => void createWecomWebhook(e)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    className="social-wecom-input"
                    placeholder="名称"
                    value={wecomFormName}
                    onChange={(e) => setWecomFormName(e.target.value)}
                  />
                  <input
                    className="social-wecom-input"
                    placeholder="Webhook URL"
                    value={wecomFormUrl}
                    onChange={(e) => setWecomFormUrl(e.target.value)}
                  />
                  <button className="primary-btn" type="submit" disabled={wecomSaving}>
                    {wecomSaving ? '保存中...' : '添加'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </section>
      ) : isUnknownChannel ? (
        <section className="social-channel-detail empty">
          <div className="social-empty-note">
            未找到这个社交通道。请返回通道列表选择已接入的平台。
            <div className="social-empty-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => navigate('/social-channels')}
              >
                返回通道列表
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="social-channel-hint">
          <div className="social-empty-note">选择一个平台卡片，进入对应的二级页面完成接入和管理。</div>
        </section>
      )}
    </div>
  )
}
