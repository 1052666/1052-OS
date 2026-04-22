import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../../config.js'
import type {
  FeishuAppConfigRecord,
  FeishuCardActionValue,
  FeishuChatRecord,
  FeishuEventLogRecord,
  FeishuSyncJobRecord,
  FeishuWorkspaceConfigRecord,
} from './feishu.types.js'

const CHANNEL_DIR = path.join('channels', 'feishu')
const APP_FILE = 'app.json'
const WORKSPACE_FILE = 'workspace.json'
const CHATS_FILE = 'chats.json'
const SEEN_MESSAGES_FILE = 'seen-messages.json'
const SEEN_CARD_ACTIONS_FILE = 'seen-card-actions.json'
const CARD_ACTIONS_FILE = 'card-actions.json'
const SYNC_JOBS_FILE = 'sync-jobs.json'
const EVENTS_FILE = 'events.json'
const MAX_SEEN_IDS = 3000
const MAX_CARD_ACTIONS = 300
const MAX_SYNC_JOBS = 200
const MAX_EVENTS = 300

function rootDir() {
  return path.join(config.dataDir, CHANNEL_DIR)
}

function appPath() {
  return path.join(rootDir(), APP_FILE)
}

function chatsPath() {
  return path.join(rootDir(), CHATS_FILE)
}

function workspacePath() {
  return path.join(rootDir(), WORKSPACE_FILE)
}

function seenMessagesPath() {
  return path.join(rootDir(), SEEN_MESSAGES_FILE)
}

function seenCardActionsPath() {
  return path.join(rootDir(), SEEN_CARD_ACTIONS_FILE)
}

function cardActionsPath() {
  return path.join(rootDir(), CARD_ACTIONS_FILE)
}

function syncJobsPath() {
  return path.join(rootDir(), SYNC_JOBS_FILE)
}

function eventsPath() {
  return path.join(rootDir(), EVENTS_FILE)
}

async function ensureDirs() {
  await fs.mkdir(path.join(rootDir(), 'tokens'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'users'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'cards'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'media'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'checkpoints'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'sync'), { recursive: true })
  await fs.mkdir(path.join(rootDir(), 'logs'), { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeJson<T>(filePath: string, data: T) {
  await ensureDirs()
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function toCleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export async function loadFeishuAppConfig(): Promise<FeishuAppConfigRecord> {
  const raw = await readJson<Partial<FeishuAppConfigRecord>>(appPath(), {})
  return {
    appId: toCleanString(raw.appId, 120) || undefined,
    appSecret: toCleanString(raw.appSecret, 240) || undefined,
    verificationToken: toCleanString(raw.verificationToken, 240) || undefined,
    encryptKey: toCleanString(raw.encryptKey, 240) || undefined,
    callbackBaseUrl: toCleanString(raw.callbackBaseUrl, 240) || undefined,
    enabled: raw.enabled === true,
    autoReplyEnabled: raw.autoReplyEnabled !== false,
    cardCallbackEnabled: raw.cardCallbackEnabled !== false,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : undefined,
  }
}

export async function saveFeishuAppConfig(
  update: Partial<FeishuAppConfigRecord>,
): Promise<FeishuAppConfigRecord> {
  const existing = await loadFeishuAppConfig()
  const next: FeishuAppConfigRecord = {
    appId: toCleanString(update.appId, 120) || existing.appId,
    appSecret: toCleanString(update.appSecret, 240) || existing.appSecret,
    verificationToken:
      toCleanString(update.verificationToken, 240) || existing.verificationToken,
    encryptKey: toCleanString(update.encryptKey, 240) || existing.encryptKey,
    callbackBaseUrl:
      toCleanString(update.callbackBaseUrl, 240) || existing.callbackBaseUrl,
    enabled: update.enabled ?? existing.enabled ?? false,
    autoReplyEnabled: update.autoReplyEnabled ?? existing.autoReplyEnabled ?? true,
    cardCallbackEnabled:
      update.cardCallbackEnabled ?? existing.cardCallbackEnabled ?? true,
    savedAt: new Date().toISOString(),
  }

  await writeJson(appPath(), next)
  try {
    await fs.chmod(appPath(), 0o600)
  } catch {
    // Windows may ignore chmod. The file still stays under the private data dir.
  }
  return next
}

export async function loadFeishuWorkspaceConfig(): Promise<FeishuWorkspaceConfigRecord> {
  const raw = await readJson<Partial<FeishuWorkspaceConfigRecord>>(workspacePath(), {})
  return {
    webBaseUrl: toCleanString(raw.webBaseUrl, 240) || undefined,
    driveFolderToken: toCleanString(raw.driveFolderToken, 240) || undefined,
    wikiSpaceId: toCleanString(raw.wikiSpaceId, 240) || undefined,
    wikiParentNodeToken: toCleanString(raw.wikiParentNodeToken, 240) || undefined,
    bitableAppToken: toCleanString(raw.bitableAppToken, 240) || undefined,
    bitableTableId: toCleanString(raw.bitableTableId, 240) || undefined,
    searchDataSourceId: toCleanString(raw.searchDataSourceId, 240) || undefined,
    approvalCode: toCleanString(raw.approvalCode, 240) || undefined,
    calendarId: toCleanString(raw.calendarId, 240) || undefined,
    enableNotificationCards: raw.enableNotificationCards !== false,
    enableMemoryCards: raw.enableMemoryCards !== false,
    enableScheduledTaskCards: raw.enableScheduledTaskCards !== false,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : undefined,
  }
}

export async function saveFeishuWorkspaceConfig(
  update: Partial<FeishuWorkspaceConfigRecord>,
): Promise<FeishuWorkspaceConfigRecord> {
  const existing = await loadFeishuWorkspaceConfig()
  const next: FeishuWorkspaceConfigRecord = {
    webBaseUrl: toCleanString(update.webBaseUrl, 240) || existing.webBaseUrl,
    driveFolderToken:
      toCleanString(update.driveFolderToken, 240) || existing.driveFolderToken,
    wikiSpaceId: toCleanString(update.wikiSpaceId, 240) || existing.wikiSpaceId,
    wikiParentNodeToken:
      toCleanString(update.wikiParentNodeToken, 240) || existing.wikiParentNodeToken,
    bitableAppToken:
      toCleanString(update.bitableAppToken, 240) || existing.bitableAppToken,
    bitableTableId: toCleanString(update.bitableTableId, 240) || existing.bitableTableId,
    searchDataSourceId:
      toCleanString(update.searchDataSourceId, 240) || existing.searchDataSourceId,
    approvalCode: toCleanString(update.approvalCode, 240) || existing.approvalCode,
    calendarId: toCleanString(update.calendarId, 240) || existing.calendarId,
    enableNotificationCards:
      update.enableNotificationCards ?? existing.enableNotificationCards ?? true,
    enableMemoryCards: update.enableMemoryCards ?? existing.enableMemoryCards ?? true,
    enableScheduledTaskCards:
      update.enableScheduledTaskCards ?? existing.enableScheduledTaskCards ?? true,
    savedAt: new Date().toISOString(),
  }

  await writeJson(workspacePath(), next)
  return next
}

export async function listFeishuChats() {
  const chats = await readJson<FeishuChatRecord[]>(chatsPath(), [])
  return chats
    .filter(
      (chat) =>
        chat &&
        typeof chat.chatId === 'string' &&
        typeof chat.receiveId === 'string' &&
        typeof chat.label === 'string',
    )
    .map<FeishuChatRecord>((chat) => ({
      receiveIdType: 'chat_id' as const,
      receiveId: toCleanString(chat.receiveId, 200),
      chatId: toCleanString(chat.chatId, 200),
      chatType: chat.chatType === 'group' ? 'group' : 'p2p',
      label: toCleanString(chat.label, 240) || 'Feishu Chat',
      lastMessageAt:
        typeof chat.lastMessageAt === 'number' && Number.isFinite(chat.lastMessageAt)
          ? chat.lastMessageAt
          : undefined,
      lastMessageId: toCleanString(chat.lastMessageId, 200) || undefined,
      lastSenderOpenId: toCleanString(chat.lastSenderOpenId, 200) || undefined,
      lastSenderName: toCleanString(chat.lastSenderName, 120) || undefined,
    }))
    .filter((chat) => chat.chatId && chat.receiveId)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}

export async function upsertFeishuChat(chat: FeishuChatRecord) {
  const chats: FeishuChatRecord[] = await listFeishuChats()
  const key = chat.chatId.trim()
  const index = chats.findIndex((item) => item.chatId === key)
  const next: FeishuChatRecord = {
    receiveIdType: 'chat_id',
    receiveId: chat.receiveId.trim(),
    chatId: key,
    chatType: chat.chatType === 'group' ? 'group' : 'p2p',
    label: chat.label.trim() || 'Feishu Chat',
    lastMessageAt: chat.lastMessageAt,
    lastMessageId: chat.lastMessageId?.trim() || undefined,
    lastSenderOpenId: chat.lastSenderOpenId?.trim() || undefined,
    lastSenderName: chat.lastSenderName?.trim() || undefined,
  }
  if (index >= 0) {
    const merged: FeishuChatRecord = {
      ...chats[index],
      ...next,
      lastMessageAt: Math.max(chats[index].lastMessageAt ?? 0, next.lastMessageAt ?? 0) || undefined,
    }
    chats[index] = merged
  } else {
    chats.push(next)
  }
  await writeJson(chatsPath(), chats)
  return next
}

async function readSeenIds(filePath: string) {
  return readJson<string[]>(filePath, [])
}

async function appendSeenId(filePath: string, value: string) {
  const ids = await readSeenIds(filePath)
  if (ids.includes(value)) return
  await writeJson(filePath, [...ids, value].slice(-MAX_SEEN_IDS))
}

export async function hasSeenFeishuMessage(messageId: string) {
  const ids = await readSeenIds(seenMessagesPath())
  return ids.includes(messageId)
}

export async function markSeenFeishuMessage(messageId: string) {
  await appendSeenId(seenMessagesPath(), messageId)
}

export async function hasSeenFeishuCardAction(actionId: string) {
  const ids = await readSeenIds(seenCardActionsPath())
  return ids.includes(actionId)
}

export async function markSeenFeishuCardAction(actionId: string) {
  await appendSeenId(seenCardActionsPath(), actionId)
}

export async function appendFeishuCardActionLog(entry: {
  id: string
  receivedAt: number
  action: FeishuCardActionValue
  operatorOpenId?: string
  openMessageId?: string
  openChatId?: string
}) {
  const current = await readJson<
    Array<{
      id: string
      receivedAt: number
      action: FeishuCardActionValue
      operatorOpenId?: string
      openMessageId?: string
      openChatId?: string
    }>
  >(cardActionsPath(), [])
  await writeJson(cardActionsPath(), [entry, ...current].slice(0, MAX_CARD_ACTIONS))
}

export async function listFeishuSyncJobs() {
  const items = await readJson<FeishuSyncJobRecord[]>(syncJobsPath(), [])
  return items
    .filter((item) => item && typeof item.id === 'string' && typeof item.type === 'string')
    .sort((a, b) => b.startedAt - a.startedAt)
}

export async function upsertFeishuSyncJob(entry: FeishuSyncJobRecord) {
  const items = await listFeishuSyncJobs()
  const index = items.findIndex((item) => item.id === entry.id)
  if (index >= 0) {
    items[index] = entry
  } else {
    items.unshift(entry)
  }
  await writeJson(syncJobsPath(), items.slice(0, MAX_SYNC_JOBS))
}

export async function appendFeishuEventLog(entry: FeishuEventLogRecord) {
  const items = await readJson<FeishuEventLogRecord[]>(eventsPath(), [])
  await writeJson(eventsPath(), [entry, ...items].slice(0, MAX_EVENTS))
}

export async function listFeishuEventLogs() {
  const items = await readJson<FeishuEventLogRecord[]>(eventsPath(), [])
  return items
    .filter((item) => item && typeof item.id === 'string' && typeof item.type === 'string')
    .sort((a, b) => b.createdAt - a.createdAt)
}
