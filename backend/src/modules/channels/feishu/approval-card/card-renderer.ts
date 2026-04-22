/**
 * Approval Card Module — Card Renderer
 *
 * Converts an ApprovalCardParams into a Feishu interactive card JSON
 * that can be sent via feishu.service.ts.  This function is pure:
 * it does NOT call any Feishu API and does NOT modify state.
 *
 * Card layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  [header] <title>  │  subtitle: 1052 OS     │
 *   ├─────────────────────────────────────────────┤
 *   │  <summary>                                  │
 *   │  Status: <pending | approved | rejected>    │
 *   │  [note footer]                              │
 *   │  [Open Approval Portal]  button             │
 *   └─────────────────────────────────────────────┘
 *
 * Header color follows status:
 *   pending  → blue
 *   approved → green
 *   rejected → red
 */

import { buildFeishuSimpleCard } from '../feishu.cards.js'
import type { ApprovalCardParams, ApprovalDecision } from './types.js'

const STATUS_LABEL: Record<ApprovalDecision, string> = {
  pending: '⏳ Pending',
  approved: '✅ Approved',
  rejected: '❌ Rejected',
}

/**
 * Render an approval card.
 *
 * @returns Raw card JSON suitable for passing to feishu.service sendCard / patchCard.
 *          Does not send to Feishu; caller is responsible for delivery.
 */
export function renderApprovalCard(params: ApprovalCardParams): ReturnType<typeof buildFeishuSimpleCard> {
  const statusLabel = STATUS_LABEL[params.status]

  // Determine button visibility: only show "Open" when still pending
  const actions =
    params.status === 'pending'
      ? [
          {
            text: 'Open Approval Portal',
            style: 'primary' as const,
            url: params.openUrl,
          },
        ]
      : []

  return buildFeishuSimpleCard({
    title: params.title,
    subtitle: '1052 OS · Approval Request',
    content: params.summary,
    status: statusLabel,
    actions,
    note: params.note,
  })
}
