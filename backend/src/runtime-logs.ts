import fs from 'node:fs/promises'
import path from 'node:path'
import util from 'node:util'
import { config } from './config.js'

type RuntimeLogLevel = 'log' | 'info' | 'warn' | 'error'

type FrontendRuntimeLogEntry = {
  ts: number
  level: RuntimeLogLevel
  source: string
  message: string
  href?: string
  userAgent?: string
  sessionId?: string
  context?: unknown
}

const LOG_DIR = path.join(config.dataDir, 'logs')
const BACKEND_LOG_FILE = path.join(LOG_DIR, 'backend-runtime.jsonl')
const FRONTEND_LOG_FILE = path.join(LOG_DIR, 'frontend-runtime.jsonl')
const writeQueues = new Map<string, Promise<void>>()
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

let loggingInstalled = false

function truncateText(value: string, max = 8000) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function serializeForLog(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string' ? truncateText(value) : value
  }

  if (value === undefined) return undefined
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message, 4000),
      stack: value.stack ? truncateText(value.stack, 12000) : undefined,
    }
  }

  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`
    return value.slice(0, 50).map((item) => serializeForLog(item, depth + 1, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]'
    seen.add(value as object)
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50)
    const normalized = Object.fromEntries(
      entries.map(([key, item]) => [key, serializeForLog(item, depth + 1, seen)]),
    )
    seen.delete(value as object)
    return normalized
  }

  return truncateText(util.inspect(value, { depth: 3, breakLength: 120, maxArrayLength: 50 }))
}

function formatConsoleArgs(args: unknown[]) {
  return truncateText(
    args
      .map((item) =>
        typeof item === 'string'
          ? item
          : util.inspect(item, { depth: 4, breakLength: 120, maxArrayLength: 50 }),
      )
      .join(' '),
  )
}

async function appendLines(filePath: string, lines: string[]) {
  const queued = writeQueues.get(filePath) ?? Promise.resolve()
  const task = queued.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, lines.join(''), 'utf-8')
  })

  writeQueues.set(filePath, task)
  try {
    await task
  } finally {
    if (writeQueues.get(filePath) === task) writeQueues.delete(filePath)
  }
}

function toJsonLine(value: unknown) {
  return `${JSON.stringify(value)}\n`
}

export async function appendBackendRuntimeLog(
  level: RuntimeLogLevel,
  message: string,
  context?: unknown,
) {
  await appendLines(BACKEND_LOG_FILE, [
    toJsonLine({
      ts: Date.now(),
      level,
      source: 'backend',
      pid: process.pid,
      message: truncateText(message),
      context: serializeForLog(context),
    }),
  ])
}

function normalizeFrontendRuntimeLogEntry(value: unknown): FrontendRuntimeLogEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const level =
    record.level === 'log' ||
    record.level === 'info' ||
    record.level === 'warn' ||
    record.level === 'error'
      ? record.level
      : 'info'
  const message =
    typeof record.message === 'string' ? truncateText(record.message, 4000).trim() : ''
  if (!message) return null

  return {
    ts:
      typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : Date.now(),
    level,
    source:
      typeof record.source === 'string' && record.source.trim()
        ? truncateText(record.source, 120)
        : 'frontend',
    message,
    href:
      typeof record.href === 'string' && record.href.trim()
        ? truncateText(record.href, 1200)
        : undefined,
    userAgent:
      typeof record.userAgent === 'string' && record.userAgent.trim()
        ? truncateText(record.userAgent, 1200)
        : undefined,
    sessionId:
      typeof record.sessionId === 'string' && record.sessionId.trim()
        ? truncateText(record.sessionId, 120)
        : undefined,
    context: serializeForLog(record.context),
  }
}

export async function appendFrontendRuntimeLogs(input: unknown) {
  const raw =
    input && typeof input === 'object' && Array.isArray((input as { logs?: unknown[] }).logs)
      ? (input as { logs: unknown[] }).logs
      : Array.isArray(input)
        ? input
        : [input]

  const entries = raw
    .slice(0, 50)
    .map((item) => normalizeFrontendRuntimeLogEntry(item))
    .filter((item): item is FrontendRuntimeLogEntry => item !== null)

  if (entries.length === 0) return

  await appendLines(
    FRONTEND_LOG_FILE,
    entries.map((entry) => toJsonLine(entry)),
  )
}

export function installBackendRuntimeLogging() {
  if (loggingInstalled) return
  loggingInstalled = true

  const methods: RuntimeLogLevel[] = ['log', 'info', 'warn', 'error']
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      originalConsole[method](...args)
      void appendBackendRuntimeLog(method, formatConsoleArgs(args), {
        source: 'console',
      }).catch(() => {})
    }
  }

  process.on('unhandledRejection', (reason) => {
    originalConsole.error('[unhandledRejection]', reason)
    void appendBackendRuntimeLog('error', '[unhandledRejection]', reason).catch(() => {})
  })

  process.on('uncaughtException', (error) => {
    originalConsole.error('[uncaughtException]', error)
    void appendBackendRuntimeLog('error', '[uncaughtException]', error).catch(() => {})
  })
}
