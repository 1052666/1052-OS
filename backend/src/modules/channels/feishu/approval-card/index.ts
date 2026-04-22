/**
 * Approval Card Module — Barrel Export
 *
 * Public surface of the approval-card feature.
 * Import from this file; do not import internal modules directly.
 *
 * Usage:
 *   import { buildApprovalLink, renderApprovalCard } from './approval-card/index.js'
 *   import type { ApprovalDecision, ApprovalCardParams } from './approval-card/index.js'
 */

export { buildApprovalLink } from './link-builder.js'
export { renderApprovalCard } from './card-renderer.js'
export type {
  ApprovalDecision,
  ApprovalLinkParams,
  ApprovalCardParams,
  ApprovalCallbackPayload,
  ApprovalCallbackResult,
} from './types.js'
