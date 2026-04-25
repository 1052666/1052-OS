import type { TokenUsage } from './agent.types.js'

export type AgentPackName =
  | 'base-read-pack'
  | 'repo-pack'
  | 'image-pack'
  | 'search-pack'
  | 'memory-pack'
  | 'skill-pack'
  | 'settings-pack'
  | 'plan-pack'
  | 'data-pack'
  | 'channel-pack'

export type ContextUpgradeRequest = {
  packs: Exclude<AgentPackName, 'base-read-pack'>[]
  reason: string
  scope?: string[]
}

export type SeedStatus = 'pending' | 'ready' | 'failed'

export type AgentCheckpoint = {
  sessionId: string
  goal?: string
  phase?: string
  facts: string[]
  done: string[]
  failedAttempts: string[]
  nextStep?: string
  mountedPacks: AgentPackName[]
  relatedRules: string[]
  relatedMemories: string[]
  relatedSkills: string[]
  summaryInjectedTokens?: number
  seedStatus?: SeedStatus
  seedAttempts?: number
  seedInputFingerprint?: string
  updatedAt: number
}

export type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; packs: string[] }
  | { type: 'context-upgrade-applied'; packs: string[] }
  | { type: 'context-upgrade-aborted'; stage: string }
