/**
 * setup-wizard.routes.ts
 *
 * Express routes for the Feishu one-shot QR-scan bot setup wizard.
 *
 * Routes:
 *   POST /api/channels/feishu/setup-wizard/start
 *     → Start a new wizard session; returns { sessionId, qrUrl, expiresAt }.
 *
 *   GET  /api/channels/feishu/setup-wizard/stream/:sessionId
 *     → SSE stream; emits WizardEvent JSON objects until resolved/cancelled.
 *
 *   POST /api/channels/feishu/setup-wizard/cancel/:sessionId
 *     → Cancel an active session.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  cancelWizardSession,
  startWizardSession,
  subscribeToSession,
} from './setup-wizard.service.js'
import type { WizardEvent } from './setup-wizard.service.js'
import type { FeishuBrand } from './types.js'
import { FeishuQrAuthError } from './types.js'
import { hasExistingFeishuEnvKeys } from './env-writer.js'

export const setupWizardRouter = Router()

// ---------------------------------------------------------------------------
// POST /start
// ---------------------------------------------------------------------------

setupWizardRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const brand: FeishuBrand =
      req.body?.brand === 'lark' ? 'lark' : 'feishu'

    // Warn (but don't block) if env keys already exist
    const hasExisting = await hasExistingFeishuEnvKeys()

    const result = await startWizardSession(brand)

    res.status(200).json({
      ok: true,
      sessionId: result.sessionId,
      qrUrl: result.qrUrl,
      expiresAt: result.expiresAt,
      warning: hasExisting
        ? 'FEISHU_APP_ID already present in data/.env — the file will not be overwritten unless you remove it first.'
        : undefined,
    })
  } catch (err) {
    const message =
      err instanceof FeishuQrAuthError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error starting wizard session'

    const statusCode = err instanceof FeishuQrAuthError && typeof err.code === 'number' ? err.code : 500
    res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      ok: false,
      error: message,
    })
  }
})

// ---------------------------------------------------------------------------
// GET /stream/:sessionId  (SSE)
// ---------------------------------------------------------------------------

setupWizardRouter.get('/stream/:sessionId', (req: Request, res: Response) => {
  const sessionId = Array.isArray(req.params['sessionId'])
    ? req.params['sessionId'][0]
    : (req.params['sessionId'] ?? '')

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  res.flushHeaders()

  function sendEvent(event: WizardEvent) {
    const data = JSON.stringify(event)
    res.write(`data: ${data}\n\n`)
    // Flush if available (compression middleware may buffer)
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      ;(res as unknown as { flush: () => void }).flush()
    }
  }

  // Send initial heartbeat so client knows the connection is live
  res.write(': ping\n\n')

  const cleanup = subscribeToSession(sessionId, (event) => {
    sendEvent(event)
    // Close SSE stream on terminal events
    if (event.status === 'approved' || event.status === 'failed' || event.status === 'cancelled') {
      res.end()
    }
  })

  if (cleanup === null) {
    // Session not found
    sendEvent({ status: 'failed', message: 'Session not found', error: 'SESSION_NOT_FOUND' })
    res.end()
    return
  }

  // Keepalive every 15 s to prevent proxy / load-balancer timeouts
  const keepaliveTimer = setInterval(() => {
    res.write(': ping\n\n')
  }, 15_000)

  req.on('close', () => {
    clearInterval(keepaliveTimer)
    cleanup()
  })
})

// ---------------------------------------------------------------------------
// POST /cancel/:sessionId
// ---------------------------------------------------------------------------

setupWizardRouter.post('/cancel/:sessionId', (req: Request, res: Response) => {
  const sessionId = Array.isArray(req.params['sessionId'])
    ? req.params['sessionId'][0]
    : (req.params['sessionId'] ?? '')
  const cancelled = cancelWizardSession(sessionId)
  if (cancelled) {
    res.status(200).json({ ok: true, message: 'Session cancelled' })
  } else {
    res.status(404).json({ ok: false, error: 'Session not found or already completed' })
  }
})
