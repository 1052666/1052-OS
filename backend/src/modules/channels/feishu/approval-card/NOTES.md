# Approval Card — MVP Skeleton Notes

## What is here (Phase 1)

| File | Role |
|------|------|
| `types.ts` | All shared types: `ApprovalDecision`, `ApprovalLinkParams`, `ApprovalCardParams`, `ApprovalCallbackPayload`, `ApprovalCallbackResult` |
| `link-builder.ts` | `buildApprovalLink()` — builds signed portal URL, pure function |
| `card-renderer.ts` | `renderApprovalCard()` — returns Feishu card JSON, pure function, no API call |
| `index.ts` | Barrel re-export; callers import only from here |

## What is NOT here (Phase 2+)

- `handleCallback()` — patch card after portal completes decision
- Route registration (`POST /api/channels/feishu/approval-card/callback`)
- `feishu.service.ts` facade (sendApprovalCard / patchApprovalCard)
- `feishu.store.ts` approvalId → messageId mapping
- mycc `approval-bridge.ts` replacement

## Integration sketch (Phase 2)

```
mycc approval-bridge.ts
  → buildApprovalLink()  ←──────────────── approval-card/link-builder
  → renderApprovalCard() ←──────────────── approval-card/card-renderer
  → feishu.service.sendCard(card)

Portal (mobile-approval-portal)
  user approves/rejects
  → POST /api/channels/feishu/approval-card/callback  (Phase 2 route)
      → handleCallback()  ←───────────────── approval-card service (Phase 2)
          → feishu.service.patchCard(messageId, updatedCard)
```

## Smoke checklist (Phase 2 pre-merge)

- [ ] `buildApprovalLink` encodes special chars in token correctly
- [ ] `renderApprovalCard` with status=approved hides "Open" button
- [ ] Callback with duplicate requestId returns `updated: false`
- [ ] Patch card reflects correct status label after callback
- [ ] `tsc --noEmit` passes with zero errors
