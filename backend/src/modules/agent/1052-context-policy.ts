import type { AgentSettings } from '../settings/settings.types.js'

export const RUNTIME_1052_AUTO_CONTEXT_MESSAGE_LIMIT = 160
export const RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT = 80_000
export const RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT_MIN = 20_000
export const RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT_MAX = 200_000
export const RUNTIME_1052_COMPACTION_CHUNK_CHARS = 32_000
export const RUNTIME_1052_COMPACTED_USER_MESSAGE_TOKEN_BUDGET = 8_000
export const RUNTIME_1052_COMPACTION_FALLBACK_MESSAGES = 60

export type Runtime1052CompactionPhase = 'pre-step'
export type Runtime1052CompactionTrigger = 'auto' | 'safety'
export type Runtime1052CompactionReason =
  | 'token-limit'
  | 'message-window'
  | 'manual-safety'
  | 'model-error'
export type Runtime1052CompactionStrategy = 'summary-checkpoint' | 'tail-trim'

export type Runtime1052ContextPolicy = {
  autoCompactEnabled: boolean
  contextMessageLimit: number
  compactTokenLimit: number
  compactedUserMessageTokenBudget: number
  compactionChunkChars: number
  fallbackMessageLimit: number
}

function normalizeAutoCompactTokenLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT
  }

  const rounded = Math.round(value)
  if (rounded < RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT_MIN) {
    // Values below the token floor are legacy message-count thresholds.
    return RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT
  }

  return Math.min(
    Math.max(rounded, RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT_MIN),
    RUNTIME_1052_AUTO_COMPACT_TOKEN_LIMIT_MAX,
  )
}

export function resolveRuntime1052ContextPolicy(
  agent?: Partial<AgentSettings>,
): Runtime1052ContextPolicy {
  return {
    autoCompactEnabled: agent?.autoCompactEnabled !== false,
    contextMessageLimit: RUNTIME_1052_AUTO_CONTEXT_MESSAGE_LIMIT,
    compactTokenLimit: normalizeAutoCompactTokenLimit(agent?.autoCompactThreshold),
    compactedUserMessageTokenBudget: RUNTIME_1052_COMPACTED_USER_MESSAGE_TOKEN_BUDGET,
    compactionChunkChars: RUNTIME_1052_COMPACTION_CHUNK_CHARS,
    fallbackMessageLimit: RUNTIME_1052_COMPACTION_FALLBACK_MESSAGES,
  }
}
