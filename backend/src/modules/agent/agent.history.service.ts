import { readJson, writeJson } from '../../storage.js'
import type { ChatHistory, StoredChatMessage } from './agent.types.js'

const FILE = 'chat-history.json'
const historyListeners = new Set<(event: ChatHistoryEvent) => void>()
export type ChatHistorySaveReason =
  | 'replace'
  | 'sync'
  | 'clear'
  | 'compact'
  | 'repair'
  | 'append'
  | 'command-new'

export type ChatHistoryEvent = {
  type: 'history-changed'
  ts: number
  reason?: string
  messageId?: number
}

function normalizeMeta(meta: Record<string, unknown>): StoredChatMessage['meta'] | undefined {
  const delivery =
    meta.delivery && typeof meta.delivery === 'object'
      ? (meta.delivery as Record<string, unknown>)
      : undefined
  const normalized: StoredChatMessage['meta'] = {
    source:
      meta.source === 'web' ||
      meta.source === 'wechat' ||
      meta.source === 'feishu' ||
      meta.source === 'scheduled-task'
        ? meta.source
        : undefined,
    channel:
      meta.channel === 'web' || meta.channel === 'wechat' || meta.channel === 'feishu'
        ? meta.channel
        : undefined,
    accountId: typeof meta.accountId === 'string' ? meta.accountId : undefined,
    peerId: typeof meta.peerId === 'string' ? meta.peerId : undefined,
    externalMessageId:
      typeof meta.externalMessageId === 'string' ? meta.externalMessageId : undefined,
    delivery: delivery
      ? {
          status:
            delivery.status === 'pending' ||
            delivery.status === 'sent' ||
            delivery.status === 'failed'
              ? delivery.status
              : undefined,
          targetChannel:
            delivery.targetChannel === 'wechat' || delivery.targetChannel === 'feishu'
              ? delivery.targetChannel
              : undefined,
          targetPeerId:
            typeof delivery.targetPeerId === 'string' ? delivery.targetPeerId : undefined,
          error: typeof delivery.error === 'string' ? delivery.error : undefined,
        }
      : undefined,
    taskId: typeof meta.taskId === 'string' ? meta.taskId : undefined,
    taskTitle: typeof meta.taskTitle === 'string' ? meta.taskTitle : undefined,
  }

  return Object.values(normalized).some((item) => item !== undefined)
    ? normalized
    : undefined
}

function emitHistoryEvent(event: Omit<ChatHistoryEvent, 'type' | 'ts'> = {}) {
  const payload: ChatHistoryEvent = {
    type: 'history-changed',
    ts: Date.now(),
    ...event,
  }
  for (const listener of historyListeners) {
    try {
      listener(payload)
    } catch {
      // Ignore broken SSE clients.
    }
  }
}

export function subscribeChatHistory(listener: (event: ChatHistoryEvent) => void) {
  historyListeners.add(listener)
  return () => {
    historyListeners.delete(listener)
  }
}

function sanitizeStoredMessage(value: unknown): StoredChatMessage | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const { id, role, content, ts, error, streaming, usage } = record
  const compactSummary =
    typeof record.compactSummary === 'string' ? record.compactSummary : undefined
  const compactBackupPath =
    typeof record.compactBackupPath === 'string'
      ? record.compactBackupPath
      : undefined
  const compactOriginalCount =
    typeof record.compactOriginalCount === 'number' &&
    Number.isFinite(record.compactOriginalCount)
      ? record.compactOriginalCount
      : undefined
  const meta =
    record.meta && typeof record.meta === 'object'
      ? normalizeMeta(record.meta as Record<string, unknown>)
      : undefined
  if (
    typeof id !== 'number' ||
    !Number.isFinite(id) ||
    typeof ts !== 'number' ||
    !Number.isFinite(ts) ||
    typeof role !== 'string' ||
    (role !== 'system' && role !== 'user' && role !== 'assistant') ||
    typeof content !== 'string'
  ) {
    return null
  }

  return {
    id,
    role,
    content,
    ts,
    error: error === true ? true : undefined,
    streaming: streaming === true ? true : undefined,
    usage: sanitizeUsage(usage),
    compactSummary: compactSummary?.trim() ? compactSummary : undefined,
    compactBackupPath: compactBackupPath?.trim() ? compactBackupPath : undefined,
    compactOriginalCount:
      compactOriginalCount && compactOriginalCount > 0
        ? compactOriginalCount
        : undefined,
    meta,
  }
}

function sanitizeUsage(value: unknown): StoredChatMessage['usage'] {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  const pick = (key: string) =>
    typeof usage[key] === 'number' && Number.isFinite(usage[key])
      ? (usage[key] as number)
      : undefined
  const normalized: StoredChatMessage['usage'] = {
    userTokens: pick('userTokens'),
    inputTokens: pick('inputTokens'),
    outputTokens: pick('outputTokens'),
    totalTokens: pick('totalTokens'),
    cacheReadTokens: pick('cacheReadTokens'),
    cacheWriteTokens: pick('cacheWriteTokens'),
    upgradeOverheadInputTokens: pick('upgradeOverheadInputTokens'),
    upgradeOverheadOutputTokens: pick('upgradeOverheadOutputTokens'),
    upgradeOverheadTotalTokens: pick('upgradeOverheadTotalTokens'),
    estimated: usage.estimated === true ? true : undefined,
  }

  return Object.values(normalized).some((item) => item !== undefined)
    ? normalized
    : undefined
}

function sanitizeStoredMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => sanitizeStoredMessage(item))
    .filter((item): item is StoredChatMessage => item !== null)
}

export async function getChatHistory(): Promise<ChatHistory> {
  const raw = await readJson<unknown>(FILE, { messages: [] })
  if (Array.isArray(raw)) {
    return { messages: sanitizeStoredMessages(raw) }
  }

  if (!raw || typeof raw !== 'object') {
    return { messages: [] }
  }

  return {
    messages: sanitizeStoredMessages((raw as { messages?: unknown }).messages),
  }
}

export async function saveChatHistory(
  messages: StoredChatMessage[],
  reason: ChatHistorySaveReason = 'replace',
): Promise<ChatHistory> {
  if (reason === 'sync' && messages.length === 0) {
    const current = await getChatHistory()
    if (current.messages.length > 0) {
      console.warn(
        `[agent-history] ignored suspicious empty sync overwrite; current=${current.messages.length}`,
      )
      return current
    }
  }

  const history: ChatHistory = { messages }
  await writeJson(FILE, history)
  emitHistoryEvent({ reason })
  return history
}

export async function appendChatMessage(
  message: Omit<StoredChatMessage, 'id' | 'ts'> & { ts?: number },
): Promise<StoredChatMessage> {
  const history = await getChatHistory()
  const nextId =
    history.messages.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1
  const record: StoredChatMessage = {
    id: nextId,
    ts: typeof message.ts === 'number' && Number.isFinite(message.ts) ? message.ts : Date.now(),
    role: message.role,
    content: message.content,
    error: message.error === true ? true : undefined,
    streaming: message.streaming === true ? true : undefined,
    usage: message.usage,
    compactSummary: message.compactSummary,
    compactBackupPath: message.compactBackupPath,
    compactOriginalCount: message.compactOriginalCount,
    meta: message.meta,
  }
  await saveChatHistory([...history.messages, record], 'append')
  return record
}

export async function updateChatMessage(
  id: number,
  updater: (message: StoredChatMessage) => StoredChatMessage,
  reason = 'update',
): Promise<StoredChatMessage | null> {
  const history = await getChatHistory()
  const index = history.messages.findIndex((message) => message.id === id)
  if (index === -1) return null

  const next = updater(history.messages[index]!)
  const messages = [...history.messages]
  messages[index] = next
  await writeJson(FILE, { messages })
  emitHistoryEvent({ reason, messageId: id })
  return next
}

export { sanitizeStoredMessages }
