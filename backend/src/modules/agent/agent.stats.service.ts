import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { getChatHistory, sanitizeStoredMessages } from './agent.history.service.js'
import type { StoredChatMessage } from './agent.types.js'

const BACKUP_DIR = path.join(config.dataDir, 'chat-history-backups')
const TIME_ZONE = 'Asia/Hong_Kong'
const TREND_DAYS = 14

export type TokenUsageAggregate = {
  messageCount: number
  assistantMessages: number
  messagesWithUsage: number
  estimatedMessages: number
  userTokens: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextTokens: number
}

export type TokenUsageBucket = TokenUsageAggregate & {
  date: string
  label: string
}

export type TokenUsageStats = {
  generatedAt: number
  backupFiles: number
  daysActive: number
  firstMessageAt?: number
  lastMessageAt?: number
  totals: TokenUsageAggregate
  current: TokenUsageAggregate
  archived: TokenUsageAggregate
  recent7Days: TokenUsageAggregate
  recent30Days: TokenUsageAggregate
  byDay: TokenUsageBucket[]
  peakDay?: TokenUsageBucket
}

type IndexedMessage = {
  message: StoredChatMessage
  source: 'current' | 'backup'
}

function emptyAggregate(): TokenUsageAggregate {
  return {
    messageCount: 0,
    assistantMessages: 0,
    messagesWithUsage: 0,
    estimatedMessages: 0,
    userTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
  }
}

function formatDateKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  return `${year}-${month}-${day}`
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, (month || 1) - 1, day || 1)))
}

function fingerprintMessage(message: StoredChatMessage) {
  return JSON.stringify([
    message.role,
    message.ts,
    message.content,
    message.compactSummary ?? '',
    message.compactBackupPath ?? '',
    message.compactOriginalCount ?? null,
    message.meta?.source ?? '',
    message.meta?.taskId ?? '',
    message.meta?.taskTitle ?? '',
    message.usage?.userTokens ?? null,
    message.usage?.inputTokens ?? null,
    message.usage?.outputTokens ?? null,
    message.usage?.totalTokens ?? null,
    message.usage?.estimated ?? null,
  ])
}

function addMessageToAggregate(target: TokenUsageAggregate, message: StoredChatMessage) {
  target.messageCount += 1
  if (message.role === 'assistant') {
    target.assistantMessages += 1
  }

  if (!message.usage) return

  target.messagesWithUsage += 1
  if (message.usage.estimated === true) {
    target.estimatedMessages += 1
  }

  const userTokens = message.usage.userTokens ?? 0
  const inputTokens = message.usage.inputTokens ?? 0
  const outputTokens = message.usage.outputTokens ?? 0
  const totalTokens =
    message.usage.totalTokens ?? (inputTokens > 0 || outputTokens > 0 ? inputTokens + outputTokens : 0)
  const contextTokens = Math.max(inputTokens - userTokens, 0)

  target.userTokens += userTokens
  target.inputTokens += inputTokens
  target.outputTokens += outputTokens
  target.totalTokens += totalTokens
  target.contextTokens += contextTokens
}

function buildTrendDates(now = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000
  const result: string[] = []
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    result.push(formatDateKey(now - offset * dayMs))
  }
  return result
}

async function readBackupMessages(filePath: string) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8')) as {
      messages?: unknown
    } | unknown[]
    if (Array.isArray(raw)) return sanitizeStoredMessages(raw)
    if (raw && typeof raw === 'object') {
      return sanitizeStoredMessages((raw as { messages?: unknown }).messages)
    }
  } catch {}
  return []
}

async function listBackupFiles() {
  try {
    const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(BACKUP_DIR, entry.name))
  } catch {
    return []
  }
}

export async function getTokenUsageStats(): Promise<TokenUsageStats> {
  const currentHistory = await getChatHistory()
  const backupFiles = await listBackupFiles()
  const indexed = new Map<string, IndexedMessage>()

  for (const backupFile of backupFiles) {
    const backupMessages = await readBackupMessages(backupFile)
    for (const message of backupMessages) {
      indexed.set(fingerprintMessage(message), {
        message,
        source: 'backup',
      })
    }
  }

  for (const message of currentHistory.messages) {
    indexed.set(fingerprintMessage(message), {
      message,
      source: 'current',
    })
  }

  const messages = [...indexed.values()].sort((left, right) => left.message.ts - right.message.ts)
  const totals = emptyAggregate()
  const current = emptyAggregate()
  const archived = emptyAggregate()
  const recent7Days = emptyAggregate()
  const recent30Days = emptyAggregate()
  const trendKeys = buildTrendDates()
  const trendKeySet = new Set(trendKeys)
  const byDayMap = new Map<string, TokenUsageBucket>()
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  for (const date of trendKeys) {
    byDayMap.set(date, {
      date,
      label: formatDateLabel(date),
      ...emptyAggregate(),
    })
  }

  for (const entry of messages) {
    const { message, source } = entry
    addMessageToAggregate(totals, message)
    addMessageToAggregate(source === 'current' ? current : archived, message)

    if (message.ts >= sevenDaysAgo) {
      addMessageToAggregate(recent7Days, message)
    }
    if (message.ts >= thirtyDaysAgo) {
      addMessageToAggregate(recent30Days, message)
    }

    const dateKey = formatDateKey(message.ts)
    if (trendKeySet.has(dateKey)) {
      addMessageToAggregate(byDayMap.get(dateKey)!, message)
    }
  }

  const byDay = trendKeys.map((date) => byDayMap.get(date)!)
  const peakDay = [...byDay].sort((left, right) => right.totalTokens - left.totalTokens)[0]
  const timestamps = messages.map((entry) => entry.message.ts)
  const activeDays = new Set(messages.map((entry) => formatDateKey(entry.message.ts))).size

  return {
    generatedAt: Date.now(),
    backupFiles: backupFiles.length,
    daysActive: activeDays,
    firstMessageAt: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    lastMessageAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    totals,
    current,
    archived,
    recent7Days,
    recent30Days,
    byDay,
    peakDay: peakDay && peakDay.totalTokens > 0 ? peakDay : undefined,
  }
}
