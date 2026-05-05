import { HttpError } from '../../http-error.js'
import type { ContextUpgradeRequest } from './agent.runtime.types.js'
import { normalizeRequestedPacks } from './agent.pack.service.js'

/** Max packs in a single request_context_upgrade call. There are 9 requestable packs total. */
export const MAX_PACKS_PER_UPGRADE = 8
/** Kept for test compatibility but no longer enforced at runtime — upgrades are unlimited. */
export const MAX_UPGRADES_PER_MESSAGE = Infinity
export const REQUEST_CONTEXT_UPGRADE_TOOL = 'request_context_upgrade'

export function isContextUpgradeToolCall(name: string) {
  return name === REQUEST_CONTEXT_UPGRADE_TOOL
}

export function parseContextUpgradeArgs(value: string): ContextUpgradeRequest {
  const parsed = value.trim() ? (JSON.parse(value) as unknown) : {}
  const input = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const packs = normalizeRequestedPacks(input.packs)
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const scope = Array.isArray(input.scope)
    ? input.scope.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : undefined
  return { packs, reason, scope }
}

export function validateContextUpgradeRequest(
  input: ContextUpgradeRequest,
  _currentUpgradeCount: number,
) {
  // No per-message upgrade count limit — the agent can request packs as many
  // times as needed to complete a complex task.
  if (input.packs.length === 0) {
    throw new HttpError(400, 'No valid pack requested')
  }
  if (input.packs.length > MAX_PACKS_PER_UPGRADE) {
    throw new HttpError(400, `At most ${MAX_PACKS_PER_UPGRADE} packs can be requested at once`)
  }
  if (!input.reason) {
    throw new HttpError(400, 'Upgrade reason cannot be empty')
  }
}
