import * as Lark from '@larksuiteoapi/node-sdk'
import type { RequestHandler } from 'express'
import { HttpError } from '../../../http-error.js'
import {
  appendChatMessage,
  getChatHistory,
  updateChatMessage,
} from '../../agent/agent.history.service.js'
import { resolveAgentCommand } from '../../agent/agent.command.service.js'
import { sendMessageStream } from '../../agent/agent.service.js'
import type { ChatMessage, TokenUsage } from '../../agent/agent.types.js'
import { markNotificationRead, createNotification } from '../../notifications/notifications.service.js'
import {
  buildCardActionResult,
  buildCardToast,
  buildFeishuMemorySuggestionCard,
  buildFeishuNotificationCard,
  buildFeishuScheduledTaskCard,
  buildFeishuSimpleCard,
  normalizeCardActionValue,
} from './feishu.cards.js'
import {
  createFeishuWsClient,
  isFeishuConfigured,
  sendFeishuCard,
  sendFeishuText,
  updateFeishuMessageCard,
} from './feishu.api.js'
import {
  buildFeishuMediaMarkdown,
  downloadFeishuFileAttachment,
  downloadFeishuImageAttachment,
  extractOutboundFeishuMedia,
  sendFeishuMediaBuffer,
  sendFeishuMediaFile,
  type FeishuOutboundSendMode,
} from './feishu.media.js'
import {
  appendFeishuCardActionLog,
  hasSeenFeishuCardAction,
  hasSeenFeishuMessage,
  listFeishuChats,
  loadFeishuAppConfig,
  loadFeishuWorkspaceConfig,
  markSeenFeishuCardAction,
  markSeenFeishuMessage,
  saveFeishuAppConfig,
  upsertFeishuChat,
} from './feishu.store.js'
import { logFeishuPlatformEvent } from './feishu.workspace.service.js'
import type {
  FeishuAppConfigRecord,
  FeishuAppStatus,
  FeishuCardActionValue,
  FeishuDeliveryTarget,
  FeishuMessageSendResult,
  FeishuReceiveIdType,
} from './feishu.types.js'

const FEISHU_EVENT_WEBHOOK_PATH = '/api/channels/feishu/callbacks/events'
const FEISHU_CARD_WEBHOOK_PATH = '/api/channels/feishu/callbacks/cards'
const FEISHU_TEXT_LIMIT = 3000
const FEISHU_STREAM_UPDATE_INTERVAL_MS = 1200
const FEISHU_STREAM_CARD_TEXT_LIMIT = 12_000

type FeishuRuntime = {
  wsClient: Lark.WSClient
  running: boolean
  startedAt: number
  lastInboundAt?: number
  lastOutboundAt?: number
  lastEventAt?: number
  lastError?: string
}

let runtime: FeishuRuntime | null = null

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***')
}

function maskAppId(appId?: string) {
  if (!appId) return undefined
  if (appId.length <= 8) return appId
  return `${appId.slice(0, 4)}***${appId.slice(-4)}`
}

function joinUrl(base: string | undefined, pathName: string) {
  if (!base) return undefined
  try {
    return new URL(pathName, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return undefined
  }
}

function trimCardText(value: string, maxLength = 1800) {
  const text = value.trim()
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`
}

function formatFeishuLabel(params: {
  chatType?: string
  chatId?: string
  senderOpenId?: string
  senderName?: string
}) {
  const sender = params.senderName?.trim() || params.senderOpenId?.trim()
  if (params.chatType === 'p2p') {
    return sender ? `Direct / ${sender}` : `Direct / ${params.chatId ?? 'unknown'}`
  }
  return sender ? `Group / ${sender}` : `Group / ${params.chatId ?? 'unknown'}`
}

function stripMarkdown(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function splitFeishuText(text: string) {
  const chunks: string[] = []
  let rest = text
  while (rest.length > FEISHU_TEXT_LIMIT) {
    const slice = rest.slice(0, FEISHU_TEXT_LIMIT)
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'))
    const cut = breakAt > 1200 ? breakAt : FEISHU_TEXT_LIMIT
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

function parseContentJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function extractPostText(params: {
  config: FeishuAppConfigRecord
  messageId: string
  content: Record<string, unknown> | null
}) {
  const content = params.content
  if (!content) return ''
  const locale = Object.values(content).find(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
  ) as Record<string, unknown> | undefined
  if (!locale) return ''

  const lines: string[] = []
  if (typeof locale.title === 'string' && locale.title.trim()) {
    lines.push(locale.title.trim())
  }

  const rows = Array.isArray(locale.content) ? locale.content : []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const parts: string[] = []
    for (const item of row) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const tag = typeof record.tag === 'string' ? record.tag : ''
      if (tag === 'text' && typeof record.text === 'string') {
        parts.push(record.text)
      } else if (tag === 'a' && typeof record.text === 'string') {
        const href = typeof record.href === 'string' ? ` (${record.href})` : ''
        parts.push(`${record.text}${href}`)
      } else if (tag === 'at') {
        const name =
          typeof record.user_name === 'string'
            ? record.user_name
            : typeof record.user_id === 'string'
              ? record.user_id
              : 'member'
        parts.push(`@${name}`)
      } else if (tag === 'img' && typeof record.image_key === 'string') {
        const media = await downloadFeishuImageAttachment({
          config: params.config,
          messageId: params.messageId,
          imageKey: record.image_key,
          fileName: `${record.image_key}.jpg`,
        }).catch(() => null)
        parts.push(
          media
            ? buildFeishuMediaMarkdown(media)
            : `[Feishu image: ${record.image_key}]`,
        )
      } else if (tag === 'media' && typeof record.file_key === 'string') {
        const media = await downloadFeishuFileAttachment({
          config: params.config,
          messageId: params.messageId,
          fileKey: record.file_key,
          kind: 'media',
          fileName:
            typeof record.file_name === 'string'
              ? record.file_name
              : `${record.file_key}.mp4`,
          coverImageKey:
            typeof record.image_key === 'string' ? record.image_key : undefined,
        }).catch(() => null)
        parts.push(
          media
            ? buildFeishuMediaMarkdown(media)
            : `[Feishu media: ${record.file_key}]`,
        )
      } else if (tag === 'emotion' && typeof record.emoji_type === 'string') {
        parts.push(`[Feishu emoji: ${record.emoji_type}]`)
      } else if (typeof record.text === 'string') {
        parts.push(record.text)
      }
    }
    if (parts.length) lines.push(parts.join(''))
  }

  return lines.join('\n').trim()
}

async function buildFeishuInboundContent(config: FeishuAppConfigRecord, message: any) {
  const messageType =
    typeof message?.message_type === 'string' ? message.message_type : ''
  const messageId =
    typeof message?.message_id === 'string' ? message.message_id.trim() : ''
  const content = parseContentJson(
    typeof message?.content === 'string' ? message.content : '',
  )

  if (messageType === 'text') {
    return typeof content?.text === 'string' ? content.text.trim() : ''
  }
  if (messageType === 'post') {
    return extractPostText({
      config,
      messageId,
      content,
    })
  }
  if (messageType === 'image' && typeof content?.image_key === 'string') {
    const media = await downloadFeishuImageAttachment({
      config,
      messageId,
      imageKey: content.image_key,
      fileName: `${content.image_key}.jpg`,
    }).catch(() => null)
    return media ? buildFeishuMediaMarkdown(media) : `[Feishu image: ${content.image_key}]`
  }
  if (messageType === 'file' && typeof content?.file_key === 'string') {
    const fileKey = content.file_key
    const media = await downloadFeishuFileAttachment({
      config,
      messageId,
      fileKey,
      kind: 'file',
      fileName: typeof content?.file_name === 'string' ? content.file_name : `${fileKey}.bin`,
    }).catch(() => null)
    return media
      ? buildFeishuMediaMarkdown(media)
      : `[Feishu file: ${typeof content?.file_name === 'string' ? content.file_name : fileKey}]`
  }
  if (messageType === 'audio' && typeof content?.file_key === 'string') {
    const media = await downloadFeishuFileAttachment({
      config,
      messageId,
      fileKey: content.file_key,
      kind: 'audio',
      fileName:
        typeof content?.file_name === 'string'
          ? content.file_name
          : `${content.file_key}.opus`,
      durationMs: typeof content?.duration === 'number' ? content.duration : undefined,
    }).catch(() => null)
    return media ? buildFeishuMediaMarkdown(media) : '[Feishu audio]'
  }
  if (messageType === 'media' && typeof content?.file_key === 'string') {
    const fileKey = content.file_key
    const media = await downloadFeishuFileAttachment({
      config,
      messageId,
      fileKey,
      kind: 'media',
      fileName:
        typeof content?.file_name === 'string' ? content.file_name : `${fileKey}.mp4`,
      durationMs: typeof content?.duration === 'number' ? content.duration : undefined,
      coverImageKey:
        typeof content?.image_key === 'string' ? content.image_key : undefined,
    }).catch(() => null)
    return media ? buildFeishuMediaMarkdown(media) : `[Feishu media: ${fileKey}]`
  }
  if (messageType === 'interactive') {
    return '[Feishu interactive card]'
  }
  if (messageType === 'sticker') {
    const fileKey =
      typeof content?.file_key === 'string' ? content.file_key : 'sticker'
    return `[Feishu sticker: ${fileKey}]`
  }
  return typeof message?.content === 'string' ? message.content.trim() : ''
}

type PreparedFeishuRichText = {
  plainText: string
  mediaFiles: string[]
  warnings: string[]
}

function buildFeishuStreamingCard(params: {
  title: string
  content: string
  status: 'pending' | 'complete' | 'failed'
  note?: string
}) {
  const template =
    params.status === 'failed'
      ? 'red'
      : params.status === 'complete'
        ? 'green'
        : 'wathet'
  const body = [params.content.trim(), params.note?.trim()].filter(Boolean).join('\n\n')

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template,
      title: {
        tag: 'plain_text',
        content: params.title,
      },
    },
    elements: [
      {
        tag: 'markdown',
        content: body || '...',
      },
    ],
  }
}

async function prepareFeishuRichText(text: string): Promise<PreparedFeishuRichText> {
  const outbound = await extractOutboundFeishuMedia(text)
  const warningText = outbound.warnings.length
    ? `\n\n媒体处理提示：\n${outbound.warnings.map((warning) => `- ${warning}`).join('\n')}`
    : ''
  return {
    plainText: stripMarkdown(`${outbound.text}${warningText}`).trim(),
    mediaFiles: outbound.files,
    warnings: outbound.warnings,
  }
}

async function sendFeishuPreparedRichText(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  prepared: PreparedFeishuRichText
  mediaMode?: FeishuOutboundSendMode
}) {
  const results: FeishuMessageSendResult[] = []
  const warnings = [...params.prepared.warnings]
  const plainText =
    params.prepared.plainText ||
    (params.prepared.mediaFiles.length > 0 ? '' : 'Done.')

  if (plainText) {
    for (const chunk of splitFeishuText(plainText)) {
      results.push(
        await sendFeishuText({
          config: params.config,
          receiveIdType: params.receiveIdType,
          receiveId: params.receiveId,
          text: chunk,
        }),
      )
    }
  }

  for (const filePath of params.prepared.mediaFiles) {
    const sent = await sendFeishuMediaFile({
      config: params.config,
      receiveIdType: params.receiveIdType,
      receiveId: params.receiveId,
      filePath,
      mode: params.mediaMode,
    })
    warnings.push(...sent.warnings)
    results.push(sent.result)
  }

  if (warnings.length > params.prepared.warnings.length) {
    for (const chunk of splitFeishuText(`媒体处理提示：\n${warnings.map((item) => `- ${item}`).join('\n')}`)) {
      results.push(
        await sendFeishuText({
          config: params.config,
          receiveIdType: params.receiveIdType,
          receiveId: params.receiveId,
          text: chunk,
        }),
      )
    }
  }

  return { results, warnings }
}

function toChatMessages(
  messages: Awaited<ReturnType<typeof getChatHistory>>['messages'],
  assistantId?: number,
): ChatMessage[] {
  return messages
    .filter((message) => message.id !== assistantId)
    .filter((message) => !message.streaming)
    .map(({ role, content, compactSummary }) => ({
      role,
      content: compactSummary?.trim() ? `${content}\n\n${compactSummary}` : content,
    }))
}

function runtimeContextForFeishu(params: {
  chatId: string
  chatType: 'p2p' | 'group'
  senderOpenId?: string
}) {
  return {
    source: {
      channel: 'feishu' as const,
      receiveIdType: 'chat_id' as const,
      receiveId: params.chatId,
      chatType: params.chatType,
      senderOpenId: params.senderOpenId,
    },
  }
}

async function loadConfigOrThrow() {
  const app = await loadFeishuAppConfig()
  if (!isFeishuConfigured(app)) {
    throw new HttpError(400, 'Feishu appId and appSecret are not configured.')
  }
  return app
}

function setRuntimeError(error: unknown) {
  if (runtime) runtime.lastError = sanitizeError(error)
}

function currentStatusFromConfig(config: FeishuAppConfigRecord): FeishuAppStatus {
  return {
    available: true,
    configured: isFeishuConfigured(config),
    enabled: config.enabled === true,
    autoReplyEnabled: config.autoReplyEnabled !== false,
    cardCallbackEnabled: config.cardCallbackEnabled !== false,
    appIdMasked: maskAppId(config.appId),
    hasAppSecret: Boolean(config.appSecret?.trim()),
    hasVerificationToken: Boolean(config.verificationToken?.trim()),
    hasEncryptKey: Boolean(config.encryptKey?.trim()),
    callbackBaseUrl: config.callbackBaseUrl,
    eventWebhookPath: FEISHU_EVENT_WEBHOOK_PATH,
    cardWebhookPath: FEISHU_CARD_WEBHOOK_PATH,
    callbackUrls: {
      event: joinUrl(config.callbackBaseUrl, FEISHU_EVENT_WEBHOOK_PATH),
      card: joinUrl(config.callbackBaseUrl, FEISHU_CARD_WEBHOOK_PATH),
    },
    running: runtime?.running === true,
    savedAt: config.savedAt,
    lastInboundAt: runtime?.lastInboundAt,
    lastOutboundAt: runtime?.lastOutboundAt,
    lastEventAt: runtime?.lastEventAt,
    lastError: runtime?.lastError,
  }
}

async function resolveWorkspaceAppUrl(pathName: string) {
  const workspace = await loadFeishuWorkspaceConfig()
  return joinUrl(workspace.webBaseUrl, pathName)
}

async function sendFeishuCardToResolvedTarget(params: {
  card: unknown
  receiveIdType?: FeishuReceiveIdType
  receiveId?: string
}) {
  const target = await resolveFeishuDeliveryTarget({
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
  })
  if (!target) {
    throw new HttpError(404, 'No Feishu delivery target is available.')
  }
  const result = await sendFeishuDirectMessage({
    receiveIdType: target.receiveIdType,
    receiveId: target.receiveId,
    card: params.card,
  })
  return { target, result }
}

export async function getFeishuStatus() {
  return currentStatusFromConfig(await loadFeishuAppConfig())
}

export async function listFeishuDeliveryTargets(): Promise<FeishuDeliveryTarget[]> {
  return (await listFeishuChats()).map<FeishuDeliveryTarget>((chat) => ({
    receiveIdType: 'chat_id',
    receiveId: chat.receiveId,
    label: chat.label,
    chatType: chat.chatType,
    lastMessageAt: chat.lastMessageAt,
  }))
}

export async function resolveFeishuDeliveryTarget(input?: {
  receiveIdType?: FeishuReceiveIdType
  receiveId?: string
}) {
  const receiveIdType =
    typeof input?.receiveIdType === 'string' ? input.receiveIdType : ''
  const receiveId = typeof input?.receiveId === 'string' ? input.receiveId.trim() : ''
  if (receiveIdType && receiveId) {
    return {
      receiveIdType: receiveIdType as FeishuReceiveIdType,
      receiveId,
      label: `${receiveIdType} / ${receiveId}`,
      chatType: 'p2p' as const,
    }
  }
  const targets = await listFeishuDeliveryTargets()
  return targets[0] ?? null
}

export async function saveFeishuChannelConfig(input: {
  appId?: unknown
  appSecret?: unknown
  verificationToken?: unknown
  encryptKey?: unknown
  callbackBaseUrl?: unknown
  enabled?: unknown
  autoReplyEnabled?: unknown
  cardCallbackEnabled?: unknown
}) {
  const current = await loadFeishuAppConfig()
  const callbackBaseUrl =
    typeof input.callbackBaseUrl === 'string' && input.callbackBaseUrl.trim()
      ? input.callbackBaseUrl.trim()
      : undefined

  if (callbackBaseUrl) {
    try {
      const parsed = new URL(callbackBaseUrl)
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('invalid protocol')
      }
    } catch {
      throw new HttpError(400, 'callbackBaseUrl must be a valid http or https URL.')
    }
  }

  const next = await saveFeishuAppConfig({
    appId: typeof input.appId === 'string' ? input.appId : undefined,
    appSecret: typeof input.appSecret === 'string' ? input.appSecret : undefined,
    verificationToken:
      typeof input.verificationToken === 'string' ? input.verificationToken : undefined,
    encryptKey: typeof input.encryptKey === 'string' ? input.encryptKey : undefined,
    callbackBaseUrl,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
    autoReplyEnabled:
      typeof input.autoReplyEnabled === 'boolean' ? input.autoReplyEnabled : undefined,
    cardCallbackEnabled:
      typeof input.cardCallbackEnabled === 'boolean'
        ? input.cardCallbackEnabled
        : undefined,
  })

  const signatureChanged =
    current.appId !== next.appId || current.appSecret !== next.appSecret

  if (!isFeishuConfigured(next) || next.enabled !== true) {
    stopFeishuChannel({ persist: false })
  } else if (signatureChanged) {
    stopFeishuChannel({ persist: false })
    void startFeishuChannel({ persist: false }).catch(setRuntimeError)
  }

  return currentStatusFromConfig(next)
}

export async function sendFeishuDirectMessage(params: {
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  text?: string
  card?: unknown
}) {
  const config = await loadConfigOrThrow()
  if (!params.receiveId.trim()) {
    throw new HttpError(400, 'Feishu receiveId is required.')
  }

  let result: FeishuMessageSendResult
  if (params.card !== undefined) {
    result = await sendFeishuCard({
      config,
      receiveIdType: params.receiveIdType,
      receiveId: params.receiveId,
      card: params.card,
    })
  } else if (params.text?.trim()) {
    const batch = await sendFeishuPreparedRichText({
      config,
      receiveIdType: params.receiveIdType,
      receiveId: params.receiveId,
      prepared: await prepareFeishuRichText(params.text),
    })
    result = batch.results[batch.results.length - 1]!
  } else {
    throw new HttpError(400, 'Either text or card is required for Feishu send.')
  }

  if (runtime) {
    runtime.lastOutboundAt = Date.now()
    runtime.lastEventAt = Date.now()
    runtime.lastError = undefined
  }

  if (params.receiveIdType === 'chat_id') {
    await upsertFeishuChat({
      receiveIdType: 'chat_id',
      receiveId: params.receiveId,
      chatId: params.receiveId,
      chatType: 'p2p',
      label: `Chat / ${params.receiveId}`,
      lastMessageAt: Date.now(),
      lastMessageId: result.messageId,
    })
  }

  await logFeishuPlatformEvent({
    type: params.card === undefined ? 'message.outbound.text' : 'message.outbound.card',
    title: params.receiveId,
    detail:
      params.text && params.text.trim()
        ? trimCardText(params.text, 600)
        : 'Sent Feishu interactive card',
    source: 'feishu',
  })

  return result
}

export async function sendFeishuDirectMedia(params: {
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  mode?: FeishuOutboundSendMode
  text?: string
}) {
  const config = await loadConfigOrThrow()
  if (!params.receiveId.trim()) {
    throw new HttpError(400, 'Feishu receiveId is required.')
  }

  const results: FeishuMessageSendResult[] = []
  const warnings: string[] = []

  if (params.text?.trim()) {
    const batch = await sendFeishuPreparedRichText({
      config,
      receiveIdType: params.receiveIdType,
      receiveId: params.receiveId,
      prepared: await prepareFeishuRichText(params.text),
    })
    results.push(...batch.results)
    warnings.push(...batch.warnings)
  }

  const media = await sendFeishuMediaBuffer({
    config,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    buffer: params.buffer,
    mode: params.mode,
  })
  results.push(media.result)
  warnings.push(...media.warnings)

  if (runtime) {
    runtime.lastOutboundAt = Date.now()
    runtime.lastEventAt = Date.now()
    runtime.lastError = undefined
  }

  if (params.receiveIdType === 'chat_id') {
    await upsertFeishuChat({
      receiveIdType: 'chat_id',
      receiveId: params.receiveId,
      chatId: params.receiveId,
      chatType: 'p2p',
      label: `Chat / ${params.receiveId}`,
      lastMessageAt: Date.now(),
      lastMessageId: results[results.length - 1]?.messageId,
    })
  }

  await logFeishuPlatformEvent({
    type: 'message.outbound.media',
    title: params.receiveId,
    detail: trimCardText(params.fileName, 600),
    source: 'feishu',
  })

  return {
    ok: true as const,
    result: results[results.length - 1]!,
    results,
    warnings,
  }
}

export async function sendFeishuNotificationCardMessage(params: {
  notificationId: string
  title: string
  message: string
  level: 'info' | 'success' | 'warning' | 'error'
  receiveIdType?: FeishuReceiveIdType
  receiveId?: string
}) {
  const card = buildFeishuNotificationCard({
    title: params.title,
    message: trimCardText(params.message),
    level: params.level,
    notificationId: params.notificationId,
    url: await resolveWorkspaceAppUrl(`/chat?notification=${encodeURIComponent(params.notificationId)}`),
  })
  return sendFeishuCardToResolvedTarget({
    card,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
  })
}

export async function sendFeishuScheduledTaskCardMessage(params: {
  taskId: string
  taskTitle: string
  summary: string
  status: 'success' | 'failed'
  enabled: boolean
  notificationId?: string
  receiveIdType?: FeishuReceiveIdType
  receiveId?: string
}) {
  const card = buildFeishuScheduledTaskCard({
    taskId: params.taskId,
    taskTitle: params.taskTitle,
    summary: trimCardText(params.summary),
    status: params.status,
    enabled: params.enabled,
    notificationId: params.notificationId,
    url: await resolveWorkspaceAppUrl('/calendar'),
  })
  return sendFeishuCardToResolvedTarget({
    card,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
  })
}

export async function sendFeishuMemorySuggestionCardMessage(params: {
  suggestionId: string
  title: string
  content: string
  tags?: string[]
  receiveIdType?: FeishuReceiveIdType
  receiveId?: string
}) {
  const card = buildFeishuMemorySuggestionCard({
    suggestionId: params.suggestionId,
    title: params.title,
    content: trimCardText(params.content),
    tags: params.tags,
    url: await resolveWorkspaceAppUrl('/memory'),
  })
  return sendFeishuCardToResolvedTarget({
    card,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
  })
}

async function handleInboundFeishuMessage(event: any) {
  const message = event?.message
  const sender = event?.sender
  const messageId =
    typeof message?.message_id === 'string' ? message.message_id.trim() : ''
  if (!messageId) return
  if (await hasSeenFeishuMessage(messageId)) return
  await markSeenFeishuMessage(messageId)

  const senderType =
    typeof sender?.sender_type === 'string' ? sender.sender_type.trim() : ''
  if (senderType === 'bot' || senderType === 'app') return

  const chatId = typeof message?.chat_id === 'string' ? message.chat_id.trim() : ''
  const chatType = message?.chat_type === 'group' ? 'group' : 'p2p'
  if (!chatId) return

  const senderOpenId =
    typeof sender?.sender_id?.open_id === 'string' ? sender.sender_id.open_id.trim() : undefined
  const createdAt = Number(message?.create_time)
  const ts = Number.isFinite(createdAt) ? createdAt : Date.now()
  const config = await loadFeishuAppConfig()
  const content = await buildFeishuInboundContent(config, message)
  if (!content) return
  const command = await resolveAgentCommand(content)
  const effectiveContent = command?.mode === 'prompt' ? command.promptText : content

  await upsertFeishuChat({
    receiveIdType: 'chat_id',
    receiveId: chatId,
    chatId,
    chatType,
    label: formatFeishuLabel({
      chatType,
      chatId,
      senderOpenId,
    }),
    lastMessageAt: ts,
    lastMessageId: messageId,
    lastSenderOpenId: senderOpenId,
  })

  if (runtime) {
    runtime.lastInboundAt = ts
    runtime.lastEventAt = Date.now()
    runtime.lastError = undefined
  }

  await logFeishuPlatformEvent({
    type: 'message.inbound',
    title: chatId,
    detail: trimCardText(effectiveContent, 600),
    source: 'feishu',
  })

  if (command?.mode === 'action') {
    await sendFeishuDirectMessage({
      receiveIdType: 'chat_id',
      receiveId: chatId,
      text: command.responseText,
    })
    return
  }

  const userMessage = await appendChatMessage({
    role: 'user',
    content: effectiveContent,
    ts,
    meta: {
      source: 'feishu',
      channel: 'feishu',
      peerId: chatId,
      externalMessageId: messageId,
    },
  })

  if (config.autoReplyEnabled === false) {
    await createNotification({
      title: 'Feishu message',
      message: effectiveContent.slice(0, 2000),
      level: 'info',
      taskTitle: 'Feishu inbound',
      chatMessageId: userMessage.id,
      chatMessageTs: userMessage.ts,
    })
    return
  }

  const assistantMessage = await appendChatMessage({
    role: 'assistant',
    content: '',
    streaming: true,
    meta: {
      source: 'feishu',
      channel: 'feishu',
      peerId: chatId,
      delivery: {
        status: 'pending',
        targetChannel: 'feishu',
        targetPeerId: chatId,
      },
    },
  })

  let finalText = ''
  let usage: TokenUsage | undefined
  let streamCardMessageId: string | undefined
  let streamCardFailed = false
  let lastStreamCardText = ''
  let lastStreamCardUpdateAt = 0

  try {
    try {
      const pendingCard = await sendFeishuCard({
        config,
        receiveIdType: 'chat_id',
        receiveId: chatId,
        card: buildFeishuStreamingCard({
          title: '1052 OS 正在处理中',
          content: 'Agent 已收到消息，正在生成回复。',
          status: 'pending',
          note: '此卡片会持续刷新，直到回复完成。',
        }),
      })
      streamCardMessageId = pendingCard.messageId
    } catch (error) {
      streamCardFailed = true
      setRuntimeError(error)
    }

    const history = await getChatHistory()
    const chatMessages = toChatMessages(history.messages, assistantMessage.id)
    for await (const streamEvent of sendMessageStream(chatMessages, {
      runtimeContext: runtimeContextForFeishu({
        chatId,
        chatType,
        senderOpenId,
      }),
    })) {
      if (streamEvent.type === 'delta') {
        finalText += streamEvent.content
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, content: current.content + streamEvent.content }),
          'feishu-agent-delta',
        )
        const visible = stripMarkdown(finalText)
        const shouldUpdateCard =
          streamCardMessageId &&
          !streamCardFailed &&
          visible &&
          visible !== lastStreamCardText &&
          Date.now() - lastStreamCardUpdateAt >= FEISHU_STREAM_UPDATE_INTERVAL_MS
        if (shouldUpdateCard) {
          const currentStreamCardMessageId = streamCardMessageId!
          try {
            await updateFeishuMessageCard({
              config,
              messageId: currentStreamCardMessageId,
              card: buildFeishuStreamingCard({
                title: '1052 OS 正在处理中',
                content: trimCardText(visible, FEISHU_STREAM_CARD_TEXT_LIMIT),
                status: 'pending',
                note:
                  visible.length > FEISHU_STREAM_CARD_TEXT_LIMIT
                    ? '内容过长，卡片中仅展示最新摘要，完整结果会在结束后补全。'
                    : '实时刷新中…',
              }),
            })
            lastStreamCardText = visible
            lastStreamCardUpdateAt = Date.now()
          } catch (error) {
            streamCardFailed = true
            setRuntimeError(error)
          }
        }
      } else if (streamEvent.type === 'usage') {
        usage = streamEvent.usage
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, usage }),
          'feishu-agent-usage',
        )
      }
    }

    const prepared = await prepareFeishuRichText(finalText || 'Done.')
    const finalCardText =
      prepared.plainText ||
      (prepared.mediaFiles.length > 0
        ? `已生成并准备发送 ${prepared.mediaFiles.length} 个媒体附件。`
        : 'Done.')

    if (streamCardMessageId && !streamCardFailed) {
      const overflow =
        finalCardText.length > FEISHU_STREAM_CARD_TEXT_LIMIT
          ? finalCardText.slice(FEISHU_STREAM_CARD_TEXT_LIMIT).trim()
          : ''
      await updateFeishuMessageCard({
        config,
        messageId: streamCardMessageId,
        card: buildFeishuStreamingCard({
          title: '1052 OS 回复完成',
          content: trimCardText(finalCardText, FEISHU_STREAM_CARD_TEXT_LIMIT),
          status: 'complete',
          note: overflow
            ? '完整内容较长，剩余文本会作为后续消息继续发送。'
            : prepared.mediaFiles.length > 0
              ? `随后还会补发 ${prepared.mediaFiles.length} 个媒体附件。`
              : '本次回复已完成。',
        }),
      })

      if (overflow) {
        await sendFeishuPreparedRichText({
          config,
          receiveIdType: 'chat_id',
          receiveId: chatId,
          prepared: {
            plainText: overflow,
            mediaFiles: prepared.mediaFiles,
            warnings: prepared.warnings,
          },
        })
      } else if (prepared.mediaFiles.length > 0 || prepared.warnings.length > 0) {
        await sendFeishuPreparedRichText({
          config,
          receiveIdType: 'chat_id',
          receiveId: chatId,
          prepared: {
            plainText: '',
            mediaFiles: prepared.mediaFiles,
            warnings: prepared.warnings,
          },
        })
      }
    } else {
      await sendFeishuPreparedRichText({
        config,
        receiveIdType: 'chat_id',
        receiveId: chatId,
        prepared,
      })
    }

    if (runtime) runtime.lastOutboundAt = Date.now()

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
            targetChannel: 'feishu',
            targetPeerId: chatId,
          },
        },
      }),
      'feishu-agent-done',
    )
  } catch (error) {
    const messageText = sanitizeError(error)
    if (streamCardMessageId && !streamCardFailed) {
      try {
        await updateFeishuMessageCard({
          config,
          messageId: streamCardMessageId,
          card: buildFeishuStreamingCard({
            title: '1052 OS 处理失败',
            content: trimCardText(finalText || '当前回复未能完整生成。', FEISHU_STREAM_CARD_TEXT_LIMIT),
            status: 'failed',
            note: messageText,
          }),
        })
      } catch {
        // Ignore card patch failures during error reporting.
      }
    }
    await updateChatMessage(
      assistantMessage.id,
      (current) => ({
        ...current,
        streaming: false,
        error: true,
        content: current.content || `Feishu channel failed: ${messageText}`,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'feishu',
            targetPeerId: chatId,
            error: messageText,
          },
        },
      }),
      'feishu-agent-error',
    )
    throw error
  }
}

function buildEventDispatcher(config: FeishuAppConfigRecord) {
  return new Lark.EventDispatcher({
    verificationToken: config.verificationToken,
    encryptKey: config.encryptKey,
    loggerLevel: Lark.LoggerLevel.info,
  }).register({
    'im.message.receive_v1': async (data: any) => {
      await handleInboundFeishuMessage(data)
      return 'success'
    },
  })
}

async function handleFeishuCardAction(data: any) {
  const actionId =
    typeof data?.open_message_id === 'string'
      ? `${data.open_message_id}:${JSON.stringify(data?.action?.value ?? {})}`
      : JSON.stringify(data ?? {})
  if (await hasSeenFeishuCardAction(actionId)) {
    return buildCardToast('This card action has already been processed.')
  }
  await markSeenFeishuCardAction(actionId)

  const action = normalizeCardActionValue(data?.action?.value)
  await appendFeishuCardActionLog({
    id: actionId,
    receivedAt: Date.now(),
    action,
    operatorOpenId:
      typeof data?.operator?.open_id === 'string' ? data.operator.open_id : undefined,
    openMessageId:
      typeof data?.open_message_id === 'string' ? data.open_message_id : undefined,
    openChatId: typeof data?.open_chat_id === 'string' ? data.open_chat_id : undefined,
  })

  if (runtime) runtime.lastEventAt = Date.now()

  await logFeishuPlatformEvent({
    type: 'card.action',
    title: action.actionType,
    detail: JSON.stringify({
      notificationId: action.notificationId,
      taskId: action.taskId,
      entityId: action.entityId,
      enabled: action.enabled,
    }).slice(0, 1000),
    source: 'feishu',
  })

  try {
    if (action.actionType === 'test_acknowledge') {
      return buildCardActionResult({
        title: 'Feishu Test Card',
        content: 'The callback pipeline is working normally.',
        status: 'Acknowledged',
      })
    }

    if (action.actionType === 'notification_mark_read' && action.notificationId) {
      await markNotificationRead(action.notificationId, true)
      const openUrl = await resolveWorkspaceAppUrl(
        `/chat?notification=${encodeURIComponent(action.notificationId)}`,
      )
      return buildCardActionResult({
        title: 'Notification Updated',
        content: 'This notification has been marked as read.',
        status: 'Read',
        actions: openUrl
          ? [
              {
                text: 'Open',
                url: openUrl,
              },
            ]
          : undefined,
      })
    }

    if (action.actionType === 'task_run_now' && action.taskId) {
      const { triggerScheduledTaskNow } = await import('../../calendar/calendar.schedule.service.js')
      const task = await triggerScheduledTaskNow(action.taskId)
      const openUrl = await resolveWorkspaceAppUrl('/calendar')
      return buildCardActionResult({
        title: task.title,
        content: trimCardText(task.lastRunSummary || 'The task has been triggered.'),
        status: 'Triggered',
        actions: [
          {
            text: task.enabled ? 'Pause Task' : 'Resume Task',
            value: {
              actionType: 'task_toggle_enabled',
              taskId: task.id,
              enabled: !task.enabled,
              version: 1,
            } satisfies FeishuCardActionValue,
          },
          ...(openUrl
            ? [
                {
                  text: 'Open Schedule',
                  url: openUrl,
                },
              ]
            : []),
        ],
      })
    }

    if (action.actionType === 'task_toggle_enabled' && action.taskId) {
      const { getScheduledTask, setScheduledTaskEnabled } = await import(
        '../../calendar/calendar.schedule.service.js'
      )
      const current = await getScheduledTask(action.taskId)
      const enabled = typeof action.enabled === 'boolean' ? action.enabled : !current.enabled
      const task = await setScheduledTaskEnabled(action.taskId, enabled)
      const openUrl = await resolveWorkspaceAppUrl('/calendar')
      return buildCardActionResult({
        title: task.title,
        content: trimCardText(
          task.lastRunSummary ||
            `The task is now ${task.enabled ? 'enabled' : 'paused'}.`,
        ),
        status: task.enabled ? 'Enabled' : 'Paused',
        actions: [
          {
            text: 'Run Again',
            style: 'primary',
            value: {
              actionType: 'task_run_now',
              taskId: task.id,
              version: 1,
            } satisfies FeishuCardActionValue,
          },
          ...(openUrl
            ? [
                {
                  text: 'Open Schedule',
                  url: openUrl,
                },
              ]
            : []),
        ],
      })
    }

    if (action.actionType === 'memory_confirm_suggestion' && action.entityId) {
      const { confirmMemorySuggestion } = await import('../../memory/memory.service.js')
      const memory = await confirmMemorySuggestion(action.entityId)
      const openUrl = await resolveWorkspaceAppUrl('/memory')
      return buildCardActionResult({
        title: memory.title,
        content: trimCardText(memory.content),
        status: 'Saved To Memory',
        actions: openUrl
          ? [
              {
                text: 'Open Memory',
                url: openUrl,
              },
            ]
          : undefined,
      })
    }

    if (action.actionType === 'memory_reject_suggestion' && action.entityId) {
      const { rejectMemorySuggestion } = await import('../../memory/memory.service.js')
      await rejectMemorySuggestion(action.entityId)
      return buildCardActionResult({
        title: 'Memory Suggestion Rejected',
        content: 'The suggestion was discarded and will not be added to long-term memory.',
        status: 'Rejected',
      })
    }

    return buildCardToast('Card action received, but no handler is registered for it.', 'warning')
  } catch (error) {
    return buildCardToast(sanitizeError(error), 'error')
  }
}

function buildCardActionHandler(config: FeishuAppConfigRecord) {
  return new Lark.CardActionHandler(
    {
      verificationToken: config.verificationToken,
      encryptKey: config.encryptKey,
      loggerLevel: Lark.LoggerLevel.info,
    },
    async (data: any) => handleFeishuCardAction(data),
  )
}

export async function getFeishuEventWebhookHandler(): Promise<RequestHandler> {
  const config = await loadFeishuAppConfig()
  const dispatcher = buildEventDispatcher(config)
  return Lark.adaptExpress(dispatcher, {
    autoChallenge: true,
  }) as RequestHandler
}

export async function getFeishuCardWebhookHandler(): Promise<RequestHandler> {
  const config = await loadFeishuAppConfig()
  const handler = buildCardActionHandler(config)
  return Lark.adaptExpress(handler) as RequestHandler
}

export async function startFeishuChannel(options?: { persist?: boolean }) {
  const config = await loadConfigOrThrow()
  if (runtime?.running) return currentStatusFromConfig(config)

  const wsClient = createFeishuWsClient(config)
  runtime = {
    wsClient,
    running: true,
    startedAt: Date.now(),
    lastError: undefined,
  }

  if (options?.persist !== false && config.enabled !== true) {
    await saveFeishuAppConfig({ enabled: true })
  }

  void wsClient
    .start({
      eventDispatcher: buildEventDispatcher(config),
    })
    .catch((error) => {
      if (runtime) {
        runtime.running = false
        runtime.lastError = sanitizeError(error)
      }
    })

  return currentStatusFromConfig({
    ...config,
    enabled: true,
  })
}

export function stopFeishuChannel(options?: { persist?: boolean }) {
  runtime?.wsClient.close({ force: true })
  if (runtime) runtime.running = false
  runtime = null

  if (options?.persist !== false) {
    void saveFeishuAppConfig({ enabled: false })
  }
}

export async function stopFeishuChannelAndReport() {
  stopFeishuChannel()
  return getFeishuStatus()
}

export async function startAllEnabledFeishuChannels() {
  const config = await loadFeishuAppConfig()
  if (config.enabled && isFeishuConfigured(config)) {
    void startFeishuChannel({ persist: false }).catch(setRuntimeError)
  }
}

export function createFeishuTestCard(params: {
  title: string
  content: string
}) {
  return buildFeishuSimpleCard({
    title: params.title,
    content: params.content,
    status: 'Waiting For Action',
    actions: [
      {
        text: 'Acknowledge',
        style: 'primary',
        value: {
          actionType: 'test_acknowledge',
          source: 'manual-test',
          version: 1,
        } satisfies FeishuCardActionValue,
      },
    ],
    note:
      'Interactive card callbacks still require a public callback URL in the Feishu developer console.',
  })
}
