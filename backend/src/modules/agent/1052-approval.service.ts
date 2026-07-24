import { randomUUID } from 'node:crypto'

export type Runtime1052ApprovalDecision = 'approved' | 'denied' | 'cancelled' | 'expired'

export type Runtime1052ApprovalRequest = {
  approvalId: string
  turnId: string
  callId: string
  toolName: string
  argsPreview?: string
  createdAt: number
  expiresAt: number
}

type PendingRuntime1052Approval = {
  request: Runtime1052ApprovalRequest
  finish: (decision: Runtime1052ApprovalDecision) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  abortListener?: () => void
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000
const pendingApprovals = new Map<string, PendingRuntime1052Approval>()

function settleRuntime1052Approval(
  approvalId: string,
  decision: Runtime1052ApprovalDecision,
) {
  const pending = pendingApprovals.get(approvalId)
  if (!pending) return false
  pendingApprovals.delete(approvalId)
  clearTimeout(pending.timer)
  if (pending.signal && pending.abortListener) {
    pending.signal.removeEventListener('abort', pending.abortListener)
  }
  pending.finish(decision)
  return true
}

export function requestRuntime1052Approval(input: {
  turnId: string
  callId: string
  toolName: string
  argsPreview?: string
  signal?: AbortSignal
  timeoutMs?: number
}) {
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS)
  const createdAt = Date.now()
  const request: Runtime1052ApprovalRequest = {
    approvalId: `approval-${randomUUID()}`,
    turnId: input.turnId,
    callId: input.callId,
    toolName: input.toolName,
    argsPreview: input.argsPreview,
    createdAt,
    expiresAt: createdAt + timeoutMs,
  }

  let finish!: (decision: Runtime1052ApprovalDecision) => void
  const decision = new Promise<Runtime1052ApprovalDecision>((resolve) => {
    finish = resolve
  })
  const timer = setTimeout(() => {
    settleRuntime1052Approval(request.approvalId, 'expired')
  }, timeoutMs)
  const pending: PendingRuntime1052Approval = {
    request,
    finish,
    timer,
    signal: input.signal,
  }

  if (input.signal) {
    pending.abortListener = () => {
      settleRuntime1052Approval(request.approvalId, 'cancelled')
    }
    if (input.signal.aborted) {
      clearTimeout(timer)
      finish('cancelled')
      return { request, decision }
    }
    input.signal.addEventListener('abort', pending.abortListener, { once: true })
  }

  pendingApprovals.set(request.approvalId, pending)
  return { request, decision }
}

export function resolveRuntime1052Approval(approvalId: string, approved: boolean) {
  return settleRuntime1052Approval(approvalId, approved ? 'approved' : 'denied')
}

export function getPendingRuntime1052Approval(approvalId: string) {
  return pendingApprovals.get(approvalId)?.request ?? null
}

export function listPendingRuntime1052Approvals() {
  return [...pendingApprovals.values()].map((pending) => pending.request)
}
