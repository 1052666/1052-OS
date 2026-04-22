/*
 * Integration plan:
 * The current WeChat module retries `monitorWechatAccount()` internally, but it does not expose an
 * append-only reconnect or session-failure hook. When that hook exists, call `scheduleReconnect()`
 * from the monitor failure path to restart the account runtime after token/session errors.
 */
import type { ReconnectEvent } from './reconnect.types.js'

const DEFAULT_INITIAL_MS = 5_000
const DEFAULT_MAX_MS = 3_600_000
const FIXED_DELAYS_MS: readonly number[] = [5_000, 10_000, 30_000, 60_000, 120_000]

export interface ReconnectOptions {
  initialMs?: number
  maxMs?: number
  maxAttempts?: number
  onEvent?: (e: ReconnectEvent) => void
}

export interface ReconnectHandle {
  cancel(): void
  readonly attempts: number
}

function sanitizeDelay(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function sanitizeAttempts(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function toErrorString(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function resolveDelayMs(attempt: number, initialMs: number, maxMs: number) {
  if (attempt <= 0) return initialMs
  if (attempt === 1) return Math.min(initialMs, maxMs)
  if (attempt <= FIXED_DELAYS_MS.length) return Math.min(FIXED_DELAYS_MS[attempt - 1], maxMs)

  let delay = FIXED_DELAYS_MS[FIXED_DELAYS_MS.length - 1]
  for (let index = FIXED_DELAYS_MS.length + 1; index <= attempt; index += 1) {
    delay = Math.min(delay * 2, maxMs)
  }
  return delay
}

async function sleep(ms: number, signal: AbortSignal) {
  if (ms <= 0) return

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new Error('Reconnect cancelled'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function scheduleReconnect(
  task: () => Promise<boolean>,
  opts: ReconnectOptions = {},
): ReconnectHandle {
  const controller = new AbortController()
  const initialMs = sanitizeDelay(opts.initialMs, DEFAULT_INITIAL_MS)
  const maxMs = Math.max(sanitizeDelay(opts.maxMs, DEFAULT_MAX_MS), 1)
  const maxAttempts = sanitizeAttempts(opts.maxAttempts)
  let attempts = 0

  const emit = (event: ReconnectEvent) => {
    opts.onEvent?.(event)
  }

  const run = async () => {
    while (!controller.signal.aborted) {
      const nextAttempt = attempts + 1
      const delayMs = resolveDelayMs(nextAttempt, initialMs, maxMs)

      try {
        await sleep(delayMs, controller.signal)
      } catch {
        return
      }
      if (controller.signal.aborted) return

      attempts = nextAttempt
      emit({ type: 'started', attempt: attempts, timestamp: Date.now() })

      let succeeded = false
      let errorText: string | undefined
      try {
        succeeded = await task()
      } catch (error) {
        errorText = toErrorString(error)
      }
      if (controller.signal.aborted) return

      if (succeeded) {
        emit({ type: 'success', attempt: attempts, timestamp: Date.now() })
        controller.abort()
        return
      }

      const exhausted = maxAttempts !== undefined && attempts >= maxAttempts
      const nextDelayMs = exhausted ? undefined : resolveDelayMs(attempts + 1, initialMs, maxMs)
      emit({
        type: 'failed',
        attempt: attempts,
        nextDelayMs,
        timestamp: Date.now(),
        error: errorText,
      })

      if (exhausted) {
        emit({
          type: 'giving-up',
          attempt: attempts,
          timestamp: Date.now(),
          error: errorText,
        })
        controller.abort()
        return
      }
    }
  }

  void run()

  return {
    cancel() {
      controller.abort()
    },
    get attempts() {
      return attempts
    },
  }
}
