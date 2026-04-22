const INITIAL_RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000, 120_000] as const
const MAX_RETRY_DELAY_MS = 60 * 60_000
const HEALTH_ALERT_THRESHOLD_MS = 5 * 60_000

export type WechatReconnectState = {
  failures: number
  unhealthySince?: number
  failureEventEmittedAt?: number
  lastHealthyAt: number
}

export type WechatReconnectFailure = {
  failures: number
  delayMs: number
  unhealthyForMs: number
  shouldEmitFailureEvent: boolean
}

function getDelayForFailureCount(failures: number) {
  if (failures <= 0) return 0
  if (failures <= INITIAL_RETRY_DELAYS_MS.length) {
    return INITIAL_RETRY_DELAYS_MS[failures - 1]!
  }

  let delay: number = INITIAL_RETRY_DELAYS_MS[INITIAL_RETRY_DELAYS_MS.length - 1]!
  for (let attempt = INITIAL_RETRY_DELAYS_MS.length + 1; attempt <= failures; attempt += 1) {
    delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
  }
  return delay
}

export function createWechatReconnectState(now = Date.now()): WechatReconnectState {
  return {
    failures: 0,
    lastHealthyAt: now,
  }
}

export function markWechatReconnectHealthy(
  state: WechatReconnectState,
  now = Date.now(),
) {
  state.failures = 0
  state.unhealthySince = undefined
  state.failureEventEmittedAt = undefined
  state.lastHealthyAt = now
}

export function markWechatReconnectFailure(
  state: WechatReconnectState,
  now = Date.now(),
): WechatReconnectFailure {
  state.failures += 1
  state.unhealthySince ??= now

  const unhealthyForMs = Math.max(0, now - state.unhealthySince)
  const shouldEmitFailureEvent =
    unhealthyForMs >= HEALTH_ALERT_THRESHOLD_MS && !state.failureEventEmittedAt

  return {
    failures: state.failures,
    delayMs: getDelayForFailureCount(state.failures),
    unhealthyForMs,
    shouldEmitFailureEvent,
  }
}

export function markWechatReconnectFailureEventEmitted(
  state: WechatReconnectState,
  now = Date.now(),
) {
  state.failureEventEmittedAt = now
}

export function isWechatTokenExpiredFailure(input: {
  ret?: number
  errcode?: number
  errmsg?: string
}) {
  if (input.ret === -2 || input.errcode === 40001) return true

  const message = input.errmsg?.toLowerCase() ?? ''
  return (
    message.includes('token') &&
    (message.includes('expired') ||
      message.includes('invalid') ||
      message.includes('relogin') ||
      message.includes('re-login'))
  )
}
