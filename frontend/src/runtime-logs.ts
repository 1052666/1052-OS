type FrontendRuntimeLevel = 'info' | 'warn' | 'error'

type FrontendRuntimeLogEntry = {
  ts: number
  level: FrontendRuntimeLevel
  source: string
  message: string
  href: string
  userAgent: string
  sessionId: string
  context?: unknown
}

type LogOptions = {
  source?: string
  immediate?: boolean
}

const FRONTEND_LOG_ENDPOINT = '/api/logs/frontend'
const MAX_QUEUE = 100
const FLUSH_BATCH = 20
const FLUSH_DELAY_MS = 1500
const sessionId = Math.random().toString(36).slice(2)

let flushTimer: number | null = null
let flushInFlight = false
let installed = false
let queue: FrontendRuntimeLogEntry[] = []

function truncateText(value: string, max = 4000) {
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

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message),
      stack: value.stack ? truncateText(value.stack, 10000) : undefined,
    }
  }

  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`
    return value.slice(0, 40).map((item) => serializeForLog(item, depth + 1, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]'
    seen.add(value as object)
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40)
    const normalized = Object.fromEntries(
      entries.map(([key, item]) => [key, serializeForLog(item, depth + 1, seen)]),
    )
    seen.delete(value as object)
    return normalized
  }

  return String(value)
}

function formatConsoleArgs(args: unknown[]) {
  return truncateText(
    args
      .map((item) => {
        if (typeof item === 'string') return item
        if (item instanceof Error) return item.stack || item.message
        return JSON.stringify(serializeForLog(item))
      })
      .join(' '),
    6000,
  )
}

function requeue(entries: FrontendRuntimeLogEntry[]) {
  queue = [...entries, ...queue].slice(-MAX_QUEUE)
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushLogs()
  }, delay)
}

async function flushLogs(useBeacon = false) {
  if (!import.meta.env.PROD || queue.length === 0) return
  if (flushInFlight && !useBeacon) return

  if (flushTimer !== null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }

  const batch = queue.slice(0, FLUSH_BATCH)
  queue = queue.slice(batch.length)
  const body = JSON.stringify({ logs: batch })

  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const ok = navigator.sendBeacon(
      FRONTEND_LOG_ENDPOINT,
      new Blob([body], { type: 'application/json' }),
    )
    if (!ok) requeue(batch)
    return
  }

  flushInFlight = true
  try {
    const response = await fetch(FRONTEND_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
    if (!response.ok) requeue(batch)
  } catch {
    requeue(batch)
  } finally {
    flushInFlight = false
    if (queue.length > 0) scheduleFlush()
  }
}

export function logFrontendRuntime(
  level: FrontendRuntimeLevel,
  message: string,
  context?: unknown,
  options: LogOptions = {},
) {
  if (!import.meta.env.PROD || typeof window === 'undefined') return

  const entry: FrontendRuntimeLogEntry = {
    ts: Date.now(),
    level,
    source: options.source?.trim() || 'frontend',
    message: truncateText(message).trim() || 'frontend log',
    href: window.location.href,
    userAgent: navigator.userAgent,
    sessionId,
    context: serializeForLog(context),
  }

  queue = [...queue, entry].slice(-MAX_QUEUE)
  if (options.immediate) {
    void flushLogs()
    return
  }
  scheduleFlush()
}

export function installFrontendRuntimeLogging() {
  if (installed || typeof window === 'undefined' || !import.meta.env.PROD) return
  installed = true

  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)

  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    logFrontendRuntime('warn', formatConsoleArgs(args), undefined, {
      source: 'console',
    })
  }

  console.error = (...args: unknown[]) => {
    originalError(...args)
    logFrontendRuntime('error', formatConsoleArgs(args), undefined, {
      source: 'console',
      immediate: true,
    })
  }

  window.addEventListener('error', (event) => {
    logFrontendRuntime(
      'error',
      event.message || 'Unhandled window error',
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      { source: 'window', immediate: true },
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    logFrontendRuntime(
      'error',
      'Unhandled promise rejection',
      { reason: serializeForLog(event.reason) },
      { source: 'promise', immediate: true },
    )
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushLogs(true)
    }
  })

  window.addEventListener('pagehide', () => {
    void flushLogs(true)
  })

  logFrontendRuntime(
    'info',
    'Frontend runtime logging enabled',
    { mode: import.meta.env.MODE, path: window.location.pathname },
    { source: 'bootstrap', immediate: true },
  )
}
