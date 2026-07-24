import { describe, expect, it } from 'vitest'
import {
  getPendingRuntime1052Approval,
  requestRuntime1052Approval,
  resolveRuntime1052Approval,
} from './1052-approval.service.js'

describe('1052 approval service', () => {
  it('resolves an exact pending approval once', async () => {
    const pending = requestRuntime1052Approval({
      turnId: 'turn-1',
      callId: 'call-1',
      toolName: 'terminal_run',
    })

    expect(getPendingRuntime1052Approval(pending.request.approvalId)).toMatchObject({
      turnId: 'turn-1',
      callId: 'call-1',
    })
    expect(resolveRuntime1052Approval(pending.request.approvalId, true)).toBe(true)
    await expect(pending.decision).resolves.toBe('approved')
    expect(resolveRuntime1052Approval(pending.request.approvalId, false)).toBe(false)
  })

  it('cancels a pending approval when its turn aborts', async () => {
    const controller = new AbortController()
    const pending = requestRuntime1052Approval({
      turnId: 'turn-2',
      callId: 'call-2',
      toolName: 'filesystem_write_file',
      signal: controller.signal,
    })

    controller.abort()
    await expect(pending.decision).resolves.toBe('cancelled')
    expect(getPendingRuntime1052Approval(pending.request.approvalId)).toBeNull()
  })
})
