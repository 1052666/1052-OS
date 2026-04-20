import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../../config.js'
import { readJson, writeJson } from '../../storage.js'
import { getChatHistory } from '../agent/agent.history.service.js'
import type { StoredChatMessage } from '../agent/agent.types.js'
import type {
  AppNotification,
  NotificationContext,
  NotificationInput,
  NotificationLevel,
} from './notifications.types.js'

const FILE = 'notifications.json'
const MAX_NOTIFICATIONS = 300
const BACKUP_DIR = 'chat-history-backups'

function toCleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeLevel(value: unknown): NotificationLevel {
  return value === 'success' || value === 'warning' || value === 'error' ? value : 'info'
}

async function readNotifications() {
  return readJson<AppNotification[]>(FILE, [])
}

async function saveNotifications(items: AppNotification[]) {
  await writeJson(
    FILE,
    items
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_NOTIFICATIONS),
  )
}

export async function listNotifications(limit = 100) {
  const max = Math.min(Math.max(limit, 1), MAX_NOTIFICATIONS)
  return (await readNotifications()).slice(0, max)
}

export async function getUnreadNotificationCount() {
  const items = await readNotifications()
  return items.filter((item) => item.read !== true).length
}

export async function createNotification(input: NotificationInput) {
  const title = toCleanString(input.title, 120)
  const message = toCleanString(input.message, 2000)
  if (!title || !message) {
    throw new Error('Notification title and message are required')
  }

  const notification: AppNotification = {
    id: randomUUID(),
    title,
    message,
    level: normalizeLevel(input.level),
    read: false,
    createdAt: Date.now(),
    source: 'scheduled-task',
    taskId: toCleanString(input.taskId, 80) || undefined,
    taskTitle: toCleanString(input.taskTitle, 120) || undefined,
    chatMessageId: normalizeNumber(input.chatMessageId),
    chatMessageTs: normalizeNumber(input.chatMessageTs),
  }

  const items = await readNotifications()
  await saveNotifications([notification, ...items])
  return notification
}

async function getNotificationById(id: string) {
  const items = await readNotifications()
  return items.find((item) => item.id === id) ?? null
}

function taskMatchesMessage(message: StoredChatMessage, notification: AppNotification) {
  if (notification.chatMessageId && message.id === notification.chatMessageId) return true
  if (notification.taskId && message.meta?.taskId === notification.taskId) return true
  if (notification.taskTitle && message.meta?.taskTitle === notification.taskTitle) return true
  if (notification.taskTitle && message.content.includes(notification.taskTitle)) return true
  return false
}

function buildExcerpt(value: string, maxLength = 220) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : text.slice(0, maxLength) + '...'
}

async function listBackupFiles() {
  const dir = path.join(config.dataDir, BACKUP_DIR)
  try {
    const names = await fs.readdir(dir)
    return names
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

async function readBackupMessages(filePath: string) {
  try {
    const backupRoot = path.join(config.dataDir, BACKUP_DIR)
    const relative = path.relative(backupRoot, path.resolve(filePath))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return []
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as { messages?: StoredChatMessage[] }
    return Array.isArray(data.messages) ? data.messages : []
  } catch {
    return []
  }
}

async function findBackupMatch(notification: AppNotification) {
  const backupFiles = await listBackupFiles()
  for (const filePath of backupFiles) {
    const messages = await readBackupMessages(filePath)
    const message = messages.find((item) => taskMatchesMessage(item, notification))
    if (message) {
      return { filePath, message }
    }
  }
  return null
}

export async function resolveNotificationContext(id: string): Promise<NotificationContext> {
  const notification = await getNotificationById(id)
  if (!notification) {
    throw new Error('Notification not found')
  }

  const history = await getChatHistory()
  const activeMessage = history.messages.find((message) =>
    taskMatchesMessage(message, notification),
  )
  if (activeMessage) {
    return {
      notificationId: notification.id,
      status: 'active',
      taskId: notification.taskId,
      taskTitle: notification.taskTitle,
      messageId: activeMessage.id,
      excerpt: buildExcerpt(activeMessage.content),
    }
  }

  const backupMatch = await findBackupMatch(notification)
  if (backupMatch) {
    const compactMessage = history.messages.find(
      (message) => message.compactBackupPath === backupMatch.filePath,
    )
    return {
      notificationId: notification.id,
      status: 'compacted',
      taskId: notification.taskId,
      taskTitle: notification.taskTitle,
      compactMessageId: compactMessage?.id,
      backupPath: backupMatch.filePath,
      backupMessageId: backupMatch.message.id,
      excerpt: buildExcerpt(backupMatch.message.content),
    }
  }

  const compactMessage = history.messages.find(
    (message) =>
      Boolean(message.compactSummary?.trim()) &&
      Boolean(notification.taskTitle) &&
      message.compactSummary!.includes(notification.taskTitle!),
  )
  return {
    notificationId: notification.id,
    status: compactMessage ? 'compacted' : 'missing',
    taskId: notification.taskId,
    taskTitle: notification.taskTitle,
    compactMessageId: compactMessage?.id,
    excerpt:
      compactMessage && notification.taskTitle
        ? buildExcerpt(compactMessage.compactSummary ?? compactMessage.content)
        : undefined,
  }
}

export async function markNotificationRead(id: string, read: boolean) {
  const items = await readNotifications()
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) {
    throw new Error('Notification not found')
  }
  items[index] = { ...items[index], read }
  await saveNotifications(items)
  return items[index]
}

export async function markAllNotificationsRead() {
  const items = await readNotifications()
  const next = items.map((item) => ({ ...item, read: true }))
  await saveNotifications(next)
  return { updated: next.length }
}
