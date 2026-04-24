import { HttpError } from '../../http-error.js'
import type { ContextUpgradeRequest } from './agent.runtime.types.js'
import { normalizeRequestedPacks } from './agent.pack.service.js'

export const MAX_UPGRADES_PER_MESSAGE = 2
export const MAX_PACKS_PER_UPGRADE = 2
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
  currentUpgradeCount: number,
) {
  if (currentUpgradeCount >= MAX_UPGRADES_PER_MESSAGE) {
    throw new HttpError(
      400,
      'upgrade_limit_reached',
    )
  }
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
