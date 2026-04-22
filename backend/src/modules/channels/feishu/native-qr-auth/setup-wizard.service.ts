/**
 * setup-wizard.service.ts
 *
 * Orchestrates the Feishu native QR-scan bot registration flow.
 *
 * Flow:
 *   1. beginQrAuth()         → returns QrSession (verificationUriComplete = QR URL)
 *   2. poll loop             → waits for user to scan; pushes SSE events to caller
 *   3. verifyTenantToken()   → health-checks the new credentials
 *   4. saveWizardResult()    → persists via saveFeishuChannelConfig + optional env-writer
 *
 * Usage:
 *   const wizard = new SetupWizardSession()
 *   const session = await wizard.start(onEvent, signal)   // starts background polling
 *   // session.sessionId, session.qrUrl
 */

import { randomUUID } from 'node:crypto'
import { beginQrAuth, pollQrStatus, verifyTenantToken } from './feishu-accounts-client.js'
import type { FeishuBrand, FeishuCredentialPayload, QrSession } from './types.js'
import { FeishuQrAuthError } from './types.js'
import { writeEnvCredentials } from './env-writer.js'
import { saveFeishuChannelConfig } from '../feishu.service.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStatus = 'pending' | 'approved' | 'failed' | 'cancelled'

export interface WizardEvent {
  status: WizardStatus
  /** Human-readable message for the frontend. */
  message: string
  /** Present only when status === 'approved'. */
  credentials?: {
    appId: string
    brand: FeishuBrand
  }
  /** Present only when status === 'failed'. */
  error?: string
}

export interface WizardStartResult {
  sessionId: string
  qrUrl: string
  expiresAt: number
}

export type WizardEventCallback = (event: WizardEvent) => void

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default total timeout for a single wizard session (5 minutes). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000

/** How long (ms) before a session entry is swept from the in-memory map. */
const SESSION_TTL_MS = 5 * 60 * 1_000

/** Maximum exponential-backoff multiplier when retrying transient network errors. */
const MAX_BACKOFF_MS = 30_000

// ---------------------------------------------------------------------------
// Session store (in-memory, 5-minute TTL)
// ---------------------------------------------------------------------------

interface SessionEntry {
  sessionId: string
  qrSession: QrSession
  abortController: AbortController
  callbacks: Set<WizardEventCallback>
  status: WizardStatus
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

/** Periodically clean up expired sessions. */
setInterval(
  () => {
    const now = Date.now()
    for (const [id, entry] of sessions) {
      if (now - entry.createdAt > SESSION_TTL_MS) {
        if (entry.status === 'pending') {
          entry.abortController.abort()
        }
        sessions.delete(id)
      }
    }
  },
  60_000,
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new QR setup-wizard session.
 *
 * Calls `beginQrAuth()` to fetch a QR URL from Feishu, then kicks off a
 * background polling loop that emits `WizardEvent`s to all registered callbacks.
 *
 * @param brand       - 'feishu' (default) or 'lark' for international.
 * @param timeoutMs   - Session timeout in milliseconds (default 5 min).
 * @returns           The sessionId and QR URL to pass to the client.
 */
export async function startWizardSession(
  brand: FeishuBrand = 'feishu',
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WizardStartResult> {
  const qrSession = await beginQrAuth(brand)
  const sessionId = randomUUID()
  const abortController = new AbortController()

  const entry: SessionEntry = {
    sessionId,
    qrSession,
    abortController,
    callbacks: new Set(),
    status: 'pending',
    createdAt: Date.now(),
  }

  sessions.set(sessionId, entry)

  // Set overall timeout
  const timeoutHandle = setTimeout(() => {
    if (entry.status === 'pending') {
      abortController.abort()
      broadcastEvent(entry, {
        status: 'failed',
        message: '二维码已过期，请重新开始',
        error: 'TIMEOUT',
      })
      entry.status = 'failed'
    }
  }, timeoutMs)
  // Don't hold the process open if nothing else is running
  if (typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
    ;(timeoutHandle as NodeJS.Timeout).unref()
  }

  // Start background polling (non-blocking)
  void runPollLoop(entry, abortController.signal)

  return {
    sessionId,
    qrUrl: qrSession.verificationUriComplete,
    expiresAt: qrSession.expiresAt,
  }
}

/**
 * Register a callback to receive events for a given session.
 * Returns a cleanup function; call it when the client disconnects.
 *
 * @returns Cleanup function, or `null` if the sessionId is not found.
 */
export function subscribeToSession(
  sessionId: string,
  callback: WizardEventCallback,
): (() => void) | null {
  const entry = sessions.get(sessionId)
  if (!entry) return null

  entry.callbacks.add(callback)

  // If session already resolved, immediately send terminal event
  if (entry.status !== 'pending') {
    const message =
      entry.status === 'approved'
        ? '授权已完成'
        : entry.status === 'cancelled'
          ? '会话已取消'
          : '授权失败'
    callback({ status: entry.status, message })
  }

  return () => {
    entry.callbacks.delete(callback)
  }
}

/**
 * Cancel an active wizard session.
 *
 * @returns `true` if cancelled, `false` if session not found or already done.
 */
export function cancelWizardSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId)
  if (!entry || entry.status !== 'pending') return false

  entry.abortController.abort()
  entry.status = 'cancelled'
  broadcastEvent(entry, { status: 'cancelled', message: '用户已取消' })
  sessions.delete(sessionId)
  return true
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function broadcastEvent(entry: SessionEntry, event: WizardEvent) {
  for (const cb of entry.callbacks) {
    try {
      cb(event)
    } catch {
      // Swallow individual callback errors — don't crash the loop.
    }
  }
}

/**
 * Poll loop — runs until success, terminal failure, or abort.
 *
 * Uses exponential back-off for transient network errors, respecting the
 * server-recommended interval from `QrSession.interval`.
 */
async function runPollLoop(entry: SessionEntry, signal: AbortSignal) {
  const { qrSession } = entry
  const baseIntervalMs = (qrSession.interval ?? 5) * 1_000
  let consecutiveErrors = 0

  while (!signal.aborted && entry.status === 'pending') {
    // Wait the recommended interval (or backoff)
    const waitMs = Math.min(baseIntervalMs * Math.pow(1.5, consecutiveErrors), MAX_BACKOFF_MS)
    await sleep(waitMs, signal)
    if (signal.aborted || entry.status !== 'pending') break

    broadcastEvent(entry, {
      status: 'pending',
      message: '等待飞书扫码授权…',
    })

    try {
      const credentials = await pollQrStatus(qrSession.deviceCode, qrSession.brand, signal)
      consecutiveErrors = 0

      // Verify credentials before saving
      let verified = false
      try {
        verified = await verifyTenantToken(credentials.appId, credentials.appSecret, qrSession.brand)
      } catch {
        // Verification network error — still save but note it
      }

      if (!verified) {
        // Treat as soft failure — credentials obtained but validation failed
        broadcastEvent(entry, {
          status: 'failed',
          message: '凭证验证失败，请重试',
          error: 'VERIFY_FAILED',
        })
        entry.status = 'failed'
        break
      }

      // Persist credentials
      await persistCredentials(credentials)

      entry.status = 'approved'
      broadcastEvent(entry, {
        status: 'approved',
        message: '飞书 Bot 接入成功！',
        credentials: { appId: credentials.appId, brand: credentials.brand },
      })
      break
    } catch (err) {
      if (signal.aborted) break

      if (err instanceof FeishuQrAuthError) {
        const code = err.code

        // Non-terminal: still waiting for scan
        if (code === 'authorization_pending' || code === 'slow_down') {
          consecutiveErrors = 0
          continue
        }

        // Terminal errors
        if (code === 'EXPIRED') {
          entry.status = 'failed'
          broadcastEvent(entry, { status: 'failed', message: '二维码已过期，请重新开始', error: 'EXPIRED' })
          break
        }
        if (code === 'ACCESS_DENIED') {
          entry.status = 'failed'
          broadcastEvent(entry, { status: 'failed', message: '用户拒绝了授权请求', error: 'ACCESS_DENIED' })
          break
        }
        if (code === 'ABORTED') break

        // Transient: network / parse errors — back off and retry
        consecutiveErrors++
        broadcastEvent(entry, {
          status: 'pending',
          message: `网络错误，正在重试… (${consecutiveErrors})`,
        })
      } else {
        consecutiveErrors++
      }
    }
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function persistCredentials(credentials: FeishuCredentialPayload): Promise<void> {
  // 1. Write to data/.env (atomic backup + rename)
  try {
    await writeEnvCredentials(credentials.appId, credentials.appSecret)
  } catch {
    // env-writer failure is non-fatal; JSON store is the source of truth
  }

  // 2. Save to the channel config JSON store (triggers hot-reload)
  await saveFeishuChannelConfig({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    enabled: true,
  })
}
