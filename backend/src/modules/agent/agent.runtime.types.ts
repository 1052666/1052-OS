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
  | {
      type: 'tool-started'
      name: string
      /**
       * Per-invocation identifier. Frontend uses this to key a running
       * tool-call entry so that parallel calls can be displayed as separate
       * rows even when they share the same tool name.
       */
      callId?: string
      /**
       * Truncated, human-readable preview of the arguments (e.g.
       * `路径=D:/a.txt`, `query="hello world"`). Safe to render as-is.
       */
      argsPreview?: string
      /**
       * True when the tool is classified as a write/side-effect operation by
       * {@link classifyToolSafety}. Lets the UI render a warning badge.
       */
      dangerous?: boolean
    }
  | {
      type: 'tool-finished'
      name: string
      ok: boolean
      error?: string
      callId?: string
      /**
       * Truncated, human-readable preview of the return payload. Frontend can
       * show this inline in the panel so users no longer have to inspect the
       * raw LLM conversation to know what a tool returned.
       */
      resultPreview?: string
      /** Wall-clock duration of the tool execution in milliseconds. */
      durationMs?: number
    }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; packs: string[] }
  | { type: 'context-upgrade-applied'; packs: string[] }
  | { type: 'context-upgrade-aborted'; stage: string }
