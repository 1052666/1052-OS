import { randomUUID } from 'node:crypto'
import { HttpError } from '../../../http-error.js'
import {
  appendChatMessage,
  getChatHistory,
  updateChatMessage,
} from '../../agent/agent.history.service.js'
import { resolveAgentCommand } from '../../agent/agent.command.service.js'
import { sendMessageStream } from '../../agent/agent.service.js'
import type { ChatMessage, StoredChatMessage, TokenUsage } from '../../agent/agent.types.js'
import {
  WECHAT_DEFAULT_BASE_URL,
  fetchWechatQrCode,
  getWechatUpdates,
  pollWechatQrStatus,
  sendWechatText,
} from './wechat.api.js'
import {
  getWechatContextToken,
  hasSeenWechatMessage,
  listWechatAccounts,
  listWechatContextTokens,
  loadWechatAccount,
  loadWechatSyncBuf,
  markSeenWechatMessage,
  normalizeAccountId,
  removeWechatAccount,
  saveWechatAccount,
  saveWechatSyncBuf,
  setWechatContextToken,
} from './wechat.store.js'
import {
  buildWechatMediaMarkdown,
  downloadWechatMediaAttachment,
  extractOutboundWechatMedia,
  sendWechatMediaFile,
} from './wechat.media.js'
import type {
  WechatAccountRecord,
  WechatAccountSummary,
  WechatLoginStart,
  WechatLoginWait,
  WechatMessage,
} from './wechat.types.js'
import { scheduleReconnect } from './reconnect.js'
import type { ReconnectHandle } from './reconnect.js'

const LOGIN_TTL_MS = 5 * 60_000
const LOGIN_WAIT_TIMEOUT_MS = 35_000
const MONITOR_RETRY_MS = 2_000
const MONITOR_BACKOFF_MS = 30_000
const WECHAT_TEXT_LIMIT = 3900

type ActiveLogin = {
  sessionKey: string
  qrcode: string
  qrcodeUrl?: string
  startedAt: number
  currentBaseUrl: string
}

type MonitorRuntime = {
  controller: AbortController
  running: boolean
  startedAt: number
  lastInboundAt?: number
  lastOutboundAt?: number
  lastError?: string
}

export type WechatDeliveryTarget = {
  accountId: string
  peerId: string
  label: string
  accountName?: string
  running: boolean
  configured: boolean
  lastMessageAt?: number
}

const activeLogins = new Map<string, ActiveLogin>()
const monitors = new Map<string, MonitorRuntime>()
const reconnectHandles = new Map<string, ReconnectHandle>()
let inboundQueue: Promise<void> = Promise.resolve()

function isLoginFresh(login: ActiveLogin) {
  return Date.now() - login.startedAt < LOGIN_TTL_MS
}

function purgeExpiredLogins() {
  for (const [key, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(key)
  }
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***')
}

function summarizeAccount(account: WechatAccountRecord): WechatAccountSummary {
  const runtime = monitors.get(account.accountId)
  return {
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    userId: account.userId,
    name: account.name,
    enabled: account.enabled,
    savedAt: account.savedAt,
    configured: Boolean(account.token),
    running: runtime?.running === true,
    lastInboundAt: runtime?.lastInboundAt,
    lastOutboundAt: runtime?.lastOutboundAt,
    lastError: runtime?.lastError,
  }
}

function toChatMessages(messages: StoredChatMessage[], assistantId?: number): ChatMessage[] {
  return messages
    .filter((message) => message.id !== assistantId)
    .filter((message) => !message.streaming)
    .map(({ role, content, compactSummary }) => ({
      role,
      content: compactSummary?.trim() ? `${content}\n\n${compactSummary}` : content,
    }))
}

function buildSeenKey(accountId: string, message: WechatMessage) {
  const externalId =
    message.message_id !== undefined
      ? String(message.message_id)
      : `${message.seq ?? 'no-seq'}:${message.from_user_id ?? 'unknown'}:${message.create_time_ms ?? 0}`
  return `${accountId}:${externalId}`
}

function externalMessageId(message: WechatMessage) {
  if (message.message_id !== undefined) return String(message.message_id)
  return `${message.seq ?? 'no-seq'}:${message.create_time_ms ?? 0}`
}

function hasSupportedWechatItem(item: NonNullable<WechatMessage['item_list']>[number]): boolean {
  if (item.type === 1 && item.text_item?.text?.trim()) return true
  if (item.type === 2 || item.image_item) return true
  if (item.type === 3 || item.voice_item) return true
  if (item.type === 4 || item.file_item) return true
  if (item.type === 5 || item.video_item) return true
  return (item.ref_msg?.message_item ?? []).some(hasSupportedWechatItem)
}

function hasSupportedWechatMessage(message: WechatMessage) {
  return (message.item_list ?? []).some(hasSupportedWechatItem)
}

async function buildWechatInboundContent(message: WechatMessage) {
  const parts: string[] = []
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text)
      continue
    }

    if (item.ref_msg?.message_item?.length) {
      const quoted = await buildWechatInboundContent({ item_list: item.ref_msg.message_item })
      if (quoted) parts.push(`引用消息：\n${quoted}`)
    }

    if (item.voice_item?.text?.trim()) {
      parts.push(`语音转写：\n${item.voice_item.text.trim()}`)
    }

    if (
      item.type === 2 ||
      item.type === 3 ||
      item.type === 4 ||
      item.type === 5 ||
      item.image_item ||
      item.voice_item ||
      item.file_item ||
      item.video_item
    ) {
      try {
        const media = await downloadWechatMediaAttachment(item)
        if (media) {
          parts.push(buildWechatMediaMarkdown(media))
        } else if (item.type === 2 || item.image_item) {
          parts.push('[微信图片：无法获取下载参数]')
        } else if (item.type === 3 || item.voice_item) {
          parts.push('[微信语音：无法获取下载参数]')
        } else if (item.type === 4 || item.file_item) {
          parts.push('[微信文件：无法获取下载参数]')
        } else if (item.type === 5 || item.video_item) {
          parts.push('[微信视频：无法获取下载参数]')
        }
      } catch (error) {
        const messageText = sanitizeError(error)
        if (item.type === 2 || item.image_item) {
          parts.push(`[微信图片接收失败：${messageText}]`)
        } else if (item.type === 3 || item.voice_item) {
          parts.push(`[微信语音接收失败：${messageText}]`)
        } else if (item.type === 4 || item.file_item) {
          parts.push(`[微信文件接收失败：${messageText}]`)
        } else if (item.type === 5 || item.video_item) {
          parts.push(`[微信视频接收失败：${messageText}]`)
        }
      }
    }
  }
  return parts.join('\n\n').trim()
}

function filterWechatMarkdown(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function splitWechatText(text: string) {
  const chunks: string[] = []
  let rest = text
  while (rest.length > WECHAT_TEXT_LIMIT) {
    const slice = rest.slice(0, WECHAT_TEXT_LIMIT)
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'))
    const cut = breakAt > 1200 ? breakAt : WECHAT_TEXT_LIMIT
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function sendWechatRichMessage(params: {
  account: WechatAccountRecord
  peerId: string
  text: string
  contextToken?: string
}) {
  const outbound = await extractOutboundWechatMedia(params.text)
  const warningText = outbound.warnings.length
    ? `\n\n媒体处理提示：${outbound.warnings.join('；')}`
    : ''
  const text = filterWechatMarkdown(`${outbound.text}${warningText}`)
  const chunks = splitWechatText(text || (outbound.files.length ? '' : '已完成。'))

  for (const chunk of chunks) {
    await sendWechatText({
      baseUrl: params.account.baseUrl,
      token: params.account.token,
      to: params.peerId,
      text: chunk,
      contextToken: params.contextToken,
    })
  }

  for (const filePath of outbound.files) {
    await sendWechatMediaFile({
      baseUrl: params.account.baseUrl,
      token: params.account.token,
      to: params.peerId,
      filePath,
      contextToken: params.contextToken,
    })
  }

  const runtime = monitors.get(params.account.accountId)
  if (runtime) runtime.lastOutboundAt = Date.now()

  return { chunks: chunks.length, media: outbound.files.length }
}

function enqueueInbound(task: () => Promise<void>) {
  inboundQueue = inboundQueue.then(task, task)
  return inboundQueue
}

function targetKey(accountId: string, peerId: string) {
  return `${accountId}:${peerId}`
}

function upsertDeliveryTarget(
  targets: Map<string, WechatDeliveryTarget>,
  target: Omit<WechatDeliveryTarget, 'label'> & { label?: string },
) {
  const key = targetKey(target.accountId, target.peerId)
  const current = targets.get(key)
  const lastMessageAt = Math.max(current?.lastMessageAt ?? 0, target.lastMessageAt ?? 0)
  targets.set(key, {
    ...current,
    ...target,
    label:
      target.label ??
      current?.label ??
      `${target.accountName || target.accountId} / ${target.peerId}`,
    running: target.running || current?.running === true,
    configured: target.configured || current?.configured === true,
    lastMessageAt: lastMessageAt > 0 ? lastMessageAt : undefined,
  })
}

export async function listWechatChannelAccounts() {
  const accounts = await listWechatAccounts()
  return accounts.map(summarizeAccount)
}

export async function listWechatDeliveryTargets() {
  const accounts = await listWechatAccounts()
  const accountMap = new Map(accounts.map((account) => [account.accountId, account]))
  const targets = new Map<string, WechatDeliveryTarget>()

  const history = await getChatHistory()
  for (const message of history.messages) {
    const meta = message.meta
    if (meta?.channel !== 'wechat' || !meta.accountId || !meta.peerId) continue
    const account = accountMap.get(meta.accountId)
    const runtime = monitors.get(meta.accountId)
    upsertDeliveryTarget(targets, {
      accountId: meta.accountId,
      peerId: meta.peerId,
      accountName: account?.name || account?.userId,
      running: runtime?.running === true,
      configured: Boolean(account?.token),
      lastMessageAt: message.ts,
    })
  }

  await Promise.all(
    accounts.map(async (account) => {
      const runtime = monitors.get(account.accountId)
      const tokens = await listWechatContextTokens(account.accountId)
      for (const token of tokens) {
        upsertDeliveryTarget(targets, {
          accountId: account.accountId,
          peerId: token.peerId,
          accountName: account.name || account.userId,
          running: runtime?.running === true,
          configured: Boolean(account.token),
        })
      }
    }),
  )

  return [...targets.values()].sort((a, b) => {
    const byTime = (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
    if (byTime !== 0) return byTime
    if (a.running !== b.running) return a.running ? -1 : 1
    return a.peerId.localeCompare(b.peerId)
  })
}

export async function resolveWechatDeliveryTarget(input?: {
  accountId?: string
  peerId?: string
}) {
  const accountId =
    typeof input?.accountId === 'string' && input.accountId.trim()
      ? normalizeAccountId(input.accountId)
      : ''
  const peerId = typeof input?.peerId === 'string' ? input.peerId.trim() : ''

  if (accountId && peerId) {
    const account = await loadWechatAccount(accountId)
    if (!account?.token) {
      throw new HttpError(404, 'Wechat account is not connected or has no token.')
    }
    const runtime = monitors.get(account.accountId)
    return {
      accountId: account.accountId,
      peerId,
      label: `${account.name || account.userId || account.accountId} / ${peerId}`,
      accountName: account.name || account.userId,
      running: runtime?.running === true,
      configured: true,
    } satisfies WechatDeliveryTarget
  }

  const targets = await listWechatDeliveryTargets()
  return targets.find((target) => target.configured) ?? null
}

export async function sendWechatDirectMessage(params: {
  accountId: string
  peerId: string
  text: string
  contextToken?: string
}) {
  const accountId = normalizeAccountId(params.accountId)
  const peerId = params.peerId.trim()
  const text = params.text.trim()
  if (!accountId || !peerId) throw new HttpError(400, 'Wechat delivery target is required.')
  if (!text) throw new HttpError(400, 'Wechat message text is required.')

  const account = await loadWechatAccount(accountId)
  if (!account?.token) throw new HttpError(404, 'Wechat account is not connected or has no token.')

  const contextToken =
    params.contextToken ?? (await getWechatContextToken(account.accountId, peerId))
  const result = await sendWechatRichMessage({ account, peerId, text, contextToken })
  return { ok: true as const, chunks: result.chunks, media: result.media }
}

export async function startWechatLogin(): Promise<WechatLoginStart> {
  purgeExpiredLogins()
  const sessionKey = randomUUID()
  const result = await fetchWechatQrCode()
  if (!result.qrcode || !result.qrcode_img_content) {
    throw new HttpError(502, '微信二维码获取失败：服务端未返回有效二维码')
  }

  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode: result.qrcode,
    qrcodeUrl: result.qrcode_img_content,
    startedAt: Date.now(),
    currentBaseUrl: WECHAT_DEFAULT_BASE_URL,
  })

  return {
    sessionKey,
    qrcodeUrl: result.qrcode_img_content,
    message: '二维码已生成，请使用微信扫码确认登录。',
    expiresAt: Date.now() + LOGIN_TTL_MS,
  }
}

export async function waitWechatLogin(
  sessionKeyInput: unknown,
  timeoutMsInput?: unknown,
): Promise<WechatLoginWait> {
  const sessionKey = typeof sessionKeyInput === 'string' ? sessionKeyInput.trim() : ''
  if (!sessionKey) throw new HttpError(400, 'sessionKey 不能为空')

  const login = activeLogins.get(sessionKey)
  if (!login) return { connected: false, message: '当前没有进行中的微信登录，请重新生成二维码。' }
  if (!isLoginFresh(login)) {
    activeLogins.delete(sessionKey)
    return { connected: false, message: '二维码已过期，请重新生成。' }
  }

  const timeoutMs =
    typeof timeoutMsInput === 'number' && Number.isFinite(timeoutMsInput)
      ? Math.min(Math.max(timeoutMsInput, 1000), LOGIN_WAIT_TIMEOUT_MS)
      : LOGIN_WAIT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const status = await pollWechatQrStatus(login.currentBaseUrl, login.qrcode)
    if (status.status === 'scaned_but_redirect' && status.redirect_host) {
      login.currentBaseUrl = `https://${status.redirect_host}`
      continue
    }
    if (status.status === 'expired') {
      activeLogins.delete(sessionKey)
      return { connected: false, message: '二维码已过期，请重新生成。' }
    }
    if (status.status === 'scaned') {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      continue
    }
    if (status.status === 'confirmed') {
      if (!status.ilink_bot_id || !status.bot_token) {
        activeLogins.delete(sessionKey)
        return { connected: false, message: '微信确认成功，但服务端没有返回账号凭据。' }
      }
      const accountId = normalizeAccountId(status.ilink_bot_id)
      const account = await saveWechatAccount(accountId, {
        token: status.bot_token,
        baseUrl: status.baseurl || login.currentBaseUrl || WECHAT_DEFAULT_BASE_URL,
        userId: status.ilink_user_id,
        enabled: true,
      })
      activeLogins.delete(sessionKey)
      await startWechatAccount(account.accountId)
      return {
        connected: true,
        message: '微信连接成功。',
        account: summarizeAccount(account),
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return { connected: false, message: '仍在等待扫码确认。' }
}

export async function startWechatAccount(accountIdInput: unknown) {
  const accountId = typeof accountIdInput === 'string' ? normalizeAccountId(accountIdInput) : ''
  if (!accountId) throw new HttpError(400, '微信账号 ID 不能为空')
  const account = await loadWechatAccount(accountId)
  if (!account || !account.token) throw new HttpError(404, '微信账号不存在或尚未登录')

  const existing = monitors.get(account.accountId)
  if (existing?.running) return summarizeAccount(account)

  const controller = new AbortController()
  const runtime: MonitorRuntime = {
    controller,
    running: true,
    startedAt: Date.now(),
  }
  monitors.set(account.accountId, runtime)
  await saveWechatAccount(account.accountId, { enabled: true })

  void monitorWechatAccount(account.accountId, controller.signal).catch((error) => {
    const current = monitors.get(account.accountId)
    if (current) {
      current.running = false
      current.lastError = sanitizeError(error)
    }
    // session-failure hook: schedule reconnect unless explicitly stopped
    if (!controller.signal.aborted) {
      reconnectHandles.get(account.accountId)?.cancel()
      const handle = scheduleReconnect(
        async () => {
          const acc = await loadWechatAccount(account.accountId)
          if (!acc?.token) return false
          if (!acc.enabled) return true // disabled — user stopped it, not a failure
          const existing = monitors.get(acc.accountId)
          if (existing?.running) return true
          await startWechatAccount(acc.accountId)
          return monitors.get(acc.accountId)?.running === true
        },
        {
          onEvent(e) {
            const rt = monitors.get(account.accountId)
            if (rt) {
              rt.lastError = e.type === 'failed'
                ? `断线重连失败 (第 ${e.attempt} 次)${e.error ? `：${e.error}` : ''}`
                : e.type === 'giving-up'
                  ? '已放弃重连'
                  : rt.lastError
            }
          },
        },
      )
      reconnectHandles.set(account.accountId, handle)
    }
  })

  return summarizeAccount({ ...account, enabled: true })
}

export async function stopWechatAccount(accountIdInput: unknown) {
  const accountId = typeof accountIdInput === 'string' ? normalizeAccountId(accountIdInput) : ''
  if (!accountId) throw new HttpError(400, '微信账号 ID 不能为空')
  const runtime = monitors.get(accountId)
  runtime?.controller.abort()
  if (runtime) runtime.running = false
  reconnectHandles.get(accountId)?.cancel()
  reconnectHandles.delete(accountId)
  const account = await loadWechatAccount(accountId)
  if (account) {
    const saved = await saveWechatAccount(accountId, { enabled: false })
    return summarizeAccount(saved)
  }
  throw new HttpError(404, '微信账号不存在')
}

export async function deleteWechatAccount(accountIdInput: unknown) {
  const accountId = typeof accountIdInput === 'string' ? normalizeAccountId(accountIdInput) : ''
  if (!accountId) throw new HttpError(400, '微信账号 ID 不能为空')
  monitors.get(accountId)?.controller.abort()
  monitors.delete(accountId)
  reconnectHandles.get(accountId)?.cancel()
  reconnectHandles.delete(accountId)
  await removeWechatAccount(accountId)
  return { ok: true as const }
}

export async function startAllEnabledWechatAccounts() {
  const accounts = await listWechatAccounts()
  for (const account of accounts) {
    if (account.enabled && account.token) {
      void startWechatAccount(account.accountId).catch(() => {})
    }
  }
}

async function monitorWechatAccount(accountId: string, signal: AbortSignal) {
  let consecutiveFailures = 0
  while (!signal.aborted) {
    const account = await loadWechatAccount(accountId)
    const runtime = monitors.get(accountId)
    if (!account?.token || !runtime) return
    try {
      const getUpdatesBuf = await loadWechatSyncBuf(account.accountId)
      const response = await getWechatUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf,
      })

      const isError =
        (response.ret !== undefined && response.ret !== 0) ||
        (response.errcode !== undefined && response.errcode !== 0)
      if (isError) {
        consecutiveFailures += 1
        runtime.lastError = `微信 getupdates 失败：${response.errmsg ?? response.errcode ?? response.ret}`
        await sleep(consecutiveFailures >= 3 ? MONITOR_BACKOFF_MS : MONITOR_RETRY_MS, signal)
        if (consecutiveFailures >= 3) consecutiveFailures = 0
        continue
      }

      consecutiveFailures = 0
      runtime.lastError = undefined
      if (response.get_updates_buf) {
        await saveWechatSyncBuf(account.accountId, response.get_updates_buf)
      }

      for (const message of response.msgs ?? []) {
        if (signal.aborted) break
        if (message.message_type === 2) continue
        if (!hasSupportedWechatMessage(message)) continue
        runtime.lastInboundAt = Date.now()
        await enqueueInbound(() => handleInboundWechatMessage(account.accountId, message))
      }
    } catch (error) {
      if (signal.aborted) return
      consecutiveFailures += 1
      const runtime = monitors.get(accountId)
      if (runtime) runtime.lastError = sanitizeError(error)
      await sleep(consecutiveFailures >= 3 ? MONITOR_BACKOFF_MS : MONITOR_RETRY_MS, signal)
      if (consecutiveFailures >= 3) consecutiveFailures = 0
    }
  }
}

async function handleInboundWechatMessage(
  accountId: string,
  message: WechatMessage,
) {
  const account = await loadWechatAccount(accountId)
  const peerId = message.from_user_id?.trim()
  if (!account?.token || !peerId) return

  const seenKey = buildSeenKey(account.accountId, message)
  if (await hasSeenWechatMessage(seenKey)) return

  if (message.context_token) {
    await setWechatContextToken(account.accountId, peerId, message.context_token)
  }

  const content = await buildWechatInboundContent(message)
  if (!content) return
  await markSeenWechatMessage(seenKey)

  const command = await resolveAgentCommand(content)
  if (command?.mode === 'action') {
    const contextToken =
      message.context_token ?? (await getWechatContextToken(account.accountId, peerId))
    await sendWechatRichMessage({
      account,
      peerId,
      text: command.responseText,
      contextToken,
    })
    return
  }

  const effectiveContent = command?.mode === 'prompt' ? command.promptText : content

  await markSeenWechatMessage(seenKey)

  const userMessage = await appendChatMessage({
    role: 'user',
    content: effectiveContent,
    ts: message.create_time_ms,
    meta: {
      source: 'wechat',
      channel: 'wechat',
      accountId: account.accountId,
      peerId,
      externalMessageId: externalMessageId(message),
    },
  })

  const assistantMessage = await appendChatMessage({
    role: 'assistant',
    content: '',
    streaming: true,
    meta: {
      source: 'wechat',
      channel: 'wechat',
      accountId: account.accountId,
      peerId,
      delivery: {
        status: 'pending',
        targetChannel: 'wechat',
        targetPeerId: peerId,
      },
    },
  })

  let finalText = ''
  let usage: TokenUsage | undefined
  try {
    const history = await getChatHistory()
    const chatMessages = toChatMessages(history.messages, assistantMessage.id)
    for await (const event of sendMessageStream(chatMessages, {
      runtimeContext: {
        source: {
          channel: 'wechat',
          accountId: account.accountId,
          peerId,
        },
      },
    })) {
      if (event.type === 'delta') {
        finalText += event.content
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, content: current.content + event.content }),
          'wechat-agent-delta',
        )
      } else if (event.type === 'usage') {
        usage = event.usage
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, usage }),
          'wechat-agent-usage',
        )
      }
    }

    const contextToken =
      message.context_token ?? (await getWechatContextToken(account.accountId, peerId))
    await sendWechatRichMessage({
      account,
      peerId,
      text: finalText || '已完成。',
      contextToken,
    })

    await updateChatMessage(
      assistantMessage.id,
      (current) => ({
        ...current,
        streaming: false,
        usage,
        meta: {
          ...current.meta,
          delivery: {
            status: 'sent',
            targetChannel: 'wechat',
            targetPeerId: peerId,
          },
        },
      }),
      'wechat-agent-done',
    )
  } catch (error) {
    const messageText = sanitizeError(error)
    await updateChatMessage(
      assistantMessage.id,
      (current) => ({
        ...current,
        streaming: false,
        error: true,
        content: current.content || `微信通道处理失败：${messageText}`,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'wechat',
            targetPeerId: peerId,
            error: messageText,
          },
        },
      }),
      'wechat-agent-error',
    )
    throw error
  }

  void userMessage
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}
