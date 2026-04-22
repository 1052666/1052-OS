/**
 * Approval Card Module — Type Definitions
 *
 * Represents the minimal contract between the approval card renderer,
 * the link builder, and the callback handler.
 */

/** Decision states for an approval item */
export type ApprovalDecision = 'pending' | 'approved' | 'rejected'

/**
 * Input to buildApprovalLink.
 * Generates a signed URL pointing to the mobile approval portal.
 */
export type ApprovalLinkParams = {
  /** Base URL of the approval portal, e.g. https://portal.example.com */
  portalBaseUrl: string
  /** Unique ID of the approval request */
  approvalId: string
  /** Feishu document / bitable ID associated with the approval */
  docId?: string
  /** Short-lived access token that the portal will validate */
  token: string
  /** Source label for analytics / audit trail */
  source?: string
}

/**
 * Input to renderApprovalCard.
 */
export type ApprovalCardParams = {
  approvalId: string
  title: string
  /** One-liner summary shown in the card body */
  summary: string
  /** Full URL to open in the browser (result of buildApprovalLink) */
  openUrl: string
  status: ApprovalDecision
  /** Optional footer note, e.g. deadline or submitter info */
  note?: string
}

/**
 * Payload delivered to the callback endpoint after the portal
 * completes the approval flow.
 *
 * Phase 2 will wire this to a POST /api/channels/feishu/approval-card/callback route.
 */
export type ApprovalCallbackPayload = {
  approvalId: string
  decision: ApprovalDecision
  /** Optional reviewer note */
  note?: string
  /** Open ID of the operator who acted */
  operator?: string
  /** ISO-8601 timestamp from the portal */
  decidedAt?: string
  /** Idempotency key — use approvalId + requestId to deduplicate */
  requestId?: string
}

/**
 * Result returned by the callback handler.
 */
export type ApprovalCallbackResult = {
  updated: boolean
  status: ApprovalDecision
}
