import type { ChatMessage, TokenUsage } from './agent.types.js'
import type { AgentToolRuntimeContext } from './agent.tool.service.js'

export type Runtime1052Source =
  | { channel: 'web' }
  | NonNullable<AgentToolRuntimeContext['source']>

export type Runtime1052TurnInput = {
  turnId: string
  history: ChatMessage[]
  source: Runtime1052Source
}

export type Runtime1052ApprovalMode = 'interactive' | 'deny'

export type Runtime1052RunOptions = {
  runtimeContext?: AgentToolRuntimeContext
  abortSignal?: AbortSignal
  approvalMode?: Runtime1052ApprovalMode
  turnId?: string
  maxSteps?: number
  maxDurationMs?: number
}

export type Runtime1052TurnStatus =
  | 'completed'
  | 'model-error'
  | 'time-limit'
  | 'step-limit'

export type Runtime1052Event =
  | { type: 'turn-started'; turnId: string; source: Runtime1052Source; messageCount: number }
  | {
      type: 'step-started'
      turnId: string
      step: number
      mode: 'progressive' | 'full-toolbox'
      mountedPacks: string[]
      toolCount: number
      promptTokens: number
      promptTokenLimit: number
    }
  | {
      type: 'model-response'
      turnId: string
      step: number
      content: string
      finishReason?: string
      toolCalls: Array<{ id: string; name: string; arguments: string }>
      usage?: TokenUsage
    }
  | { type: 'model-error'; turnId: string; step: number; message: string }
  | { type: 'assistant-delta'; turnId: string; content: string }
  | { type: 'usage-recorded'; turnId: string; usage: TokenUsage }
  | {
      type: 'conversation-compacted'
      turnId: string
      beforeMessages: number
      afterMessages: number
      beforeTokens?: number
      afterTokens?: number
      summaryTokens?: number
      fallback?: boolean
      trigger?: 'auto' | 'safety'
      reason?: 'token-limit' | 'message-window' | 'manual-safety' | 'model-error'
      phase?: 'pre-step'
      strategy?: 'summary-checkpoint' | 'tail-trim'
      tokenLimit?: number
      windowNumber?: number
      firstWindowId?: string
      previousWindowId?: string
      windowId?: string
    }
  | {
      type: 'conversation-compaction-failed'
      turnId: string
      message: string
      beforeMessages: number
      afterMessages: number
    }
  | {
      type: 'tool-call-started'
      turnId: string
      name: string
      callId?: string
      argsPreview?: string
      dangerous?: boolean
    }
  | {
      type: 'tool-call-finished'
      turnId: string
      name: string
      ok: boolean
      error?: string
      callId?: string
      resultPreview?: string
      resultContent?: string
      durationMs?: number
    }
  | {
      type: 'approval-requested'
      turnId: string
      approvalId: string
      callId: string
      name: string
      argsPreview?: string
      expiresAt: number
    }
  | {
      type: 'approval-resolved'
      turnId: string
      approvalId: string
      callId: string
      name: string
      decision: 'approved' | 'denied' | 'cancelled' | 'expired'
    }
  | { type: 'context-upgrade-requested'; turnId: string; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; turnId: string; packs: string[] }
  | { type: 'context-upgrade-applied'; turnId: string; packs: string[] }
  | { type: 'context-upgrade-aborted'; turnId: string; stage: string }
  | {
      type: 'turn-completed'
      turnId: string
      status: Runtime1052TurnStatus
      steps: number
      usage: TokenUsage
    }
  | { type: 'turn-aborted'; turnId: string; reason: string }
