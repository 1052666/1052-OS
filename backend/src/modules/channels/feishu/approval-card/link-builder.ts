/**
 * Approval Card Module — Link Builder
 *
 * Builds a signed redirect URL that opens the mobile approval portal
 * for a specific approval request. The token is passed as a query param
 * and validated server-side by the portal; this module does NOT sign or
 * generate the token itself.
 *
 * Unit test sketch (not wired to a test runner yet):
 *
 *   const url = buildApprovalLink({
 *     portalBaseUrl: 'https://portal.example.com',
 *     approvalId: 'APV-001',
 *     docId: 'doxbc1234567',
 *     token: 'eyJhbGci...',
 *     source: 'feishu-card',
 *   })
 *   // Expected:
 *   // https://portal.example.com/approve?approvalId=APV-001&docId=doxbc1234567&token=eyJhbGci...&source=feishu-card
 *
 *   // Minimal (no docId, no source):
 *   const url2 = buildApprovalLink({
 *     portalBaseUrl: 'https://portal.example.com',
 *     approvalId: 'APV-002',
 *     token: 'tok',
 *   })
 *   // Expected:
 *   // https://portal.example.com/approve?approvalId=APV-002&token=tok
 */

import type { ApprovalLinkParams } from './types.js'

/**
 * Build a URL pointing to the approval portal page for the given request.
 *
 * Rules:
 * - `portalBaseUrl` trailing slash is stripped automatically.
 * - Only `approvalId` and `token` are required; other params are omitted when absent.
 * - All values are URL-encoded.
 */
export function buildApprovalLink(params: ApprovalLinkParams): string {
  const base = params.portalBaseUrl.replace(/\/$/, '')
  const qs = new URLSearchParams()

  qs.set('approvalId', params.approvalId)
  if (params.docId) qs.set('docId', params.docId)
  qs.set('token', params.token)
  if (params.source) qs.set('source', params.source)

  return `${base}/approve?${qs.toString()}`
}
