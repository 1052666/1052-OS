import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { HttpError } from '../../http-error.js'
import { requestRuntime1052Approval } from './1052-approval.service.js'
import { agentRouter } from './agent.routes.js'

function app() {
  const instance = express()
  instance.use(express.json())
  instance.use('/api/agent', agentRouter)
  instance.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error instanceof HttpError ? error.status : 500
      res.status(status).json({ message: error instanceof Error ? error.message : 'error' })
    },
  )
  return instance
}

describe('1052 approval route', () => {
  it('resolves the exact pending approval through HTTP', async () => {
    const pending = requestRuntime1052Approval({
      turnId: 'turn-http',
      callId: 'call-http',
      toolName: 'terminal_run',
      timeoutMs: 10_000,
    })

    const response = await request(app())
      .post(`/api/agent/approvals/${pending.request.approvalId}/resolve`)
      .send({ approved: true })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      approvalId: pending.request.approvalId,
      approved: true,
    })
    await expect(pending.decision).resolves.toBe('approved')
  })

  it('rejects unknown and malformed approval decisions', async () => {
    const unknown = await request(app())
      .post('/api/agent/approvals/not-pending/resolve')
      .send({ approved: false })
    const malformed = await request(app())
      .post('/api/agent/approvals/not-pending/resolve')
      .send({ approved: 'yes' })

    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(400)
  })
})
