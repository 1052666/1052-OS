import { appendBackendRuntimeLog } from '../../runtime-logs.js'
import type { TokenBudgetReport } from './agent.budget.service.js'
import type { AgentCheckpoint, AgentPackName } from './agent.runtime.types.js'
import type { TokenUsage } from './agent.types.js'

export type AgentRuntimeLogStage =
  | 'progressive-start'
  | 'p0-budget'
  | 'p0-budget-exceeded'
  | 'context-upgrade-requested'
  | 'context-upgrade-applied'
  | 'context-upgrade-aborted'
  | 'business-tools'
  | 'progressive-complete'
  | 'progressive-round-limit'

type AgentRuntimeCheckpointState = Pick<
  AgentCheckpoint,
  'seedStatus' | 'seedAttempts' | 'summaryInjectedTokens'
>

export type AgentRuntimeLogInput = {
  stage: AgentRuntimeLogStage
  mode: 'progressive'
  sessionId: string
  round?: number
  mountedPacks: readonly AgentPackName[]
  upgradeCount: number
  checkpoint?: AgentRuntimeCheckpointState
  checkpointEnabled?: boolean
  providerCachingEnabled?: boolean
  budgetReport?: TokenBudgetReport
  requestedPacks?: readonly string[]
  reason?: string
  toolNames?: readonly string[]
  toolFailure?: string
  usage?: TokenUsage
  error?: string
}

function truncateLogText(value: string, max = 240) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

function summarizeBudgetReport(report?: TokenBudgetReport) {
  if (!report) return undefined
  return {
    key: report.key,
    tokens: report.tokens,
    limitTokens: report.limitTokens,
    overLimit: report.overLimit,
    components: report.components.map((component) => ({
      key: component.key,
      tokens: component.tokens,
      limitTokens: component.limitTokens,
    })),
  }
}

function summarizeUsage(usage?: TokenUsage) {
  if (!usage) return undefined
  return {
    userTokens: usage.userTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    upgradeOverheadInputTokens: usage.upgradeOverheadInputTokens,
    upgradeOverheadOutputTokens: usage.upgradeOverheadOutputTokens,
    upgradeOverheadTotalTokens: usage.upgradeOverheadTotalTokens,
    estimated: usage.estimated,
  }
}

export function buildAgentRuntimeLogContext(input: AgentRuntimeLogInput) {
  return {
    scope: 'agent-runtime',
    mode: input.mode,
    stage: input.stage,
    sessionId: input.sessionId,
    round: input.round,
    p0: input.mountedPacks.length === 0,
    mountedPacks: input.mountedPacks,
    upgradeCount: input.upgradeCount,
    checkpointEnabled: input.checkpointEnabled,
    providerCachingEnabled: input.providerCachingEnabled,
    seedStatus: input.checkpoint?.seedStatus,
    seedAttempts: input.checkpoint?.seedAttempts,
    checkpointSummaryInjectedTokens: input.checkpoint?.summaryInjectedTokens,
    budgetReport: summarizeBudgetReport(input.budgetReport),
    requestedPacks: input.requestedPacks,
    reason: input.reason ? truncateLogText(input.reason) : undefined,
    toolNames: input.toolNames,
    toolFailure: input.toolFailure ? truncateLogText(input.toolFailure) : undefined,
    usage: summarizeUsage(input.usage),
    error: input.error ? truncateLogText(input.error) : undefined,
  }
}

export function appendAgentRuntimeLog(input: AgentRuntimeLogInput) {
  const level =
    input.stage === 'p0-budget-exceeded' ||
    input.stage === 'context-upgrade-aborted' ||
    input.stage === 'progressive-round-limit'
      ? 'warn'
      : 'info'

  void appendBackendRuntimeLog(
    level,
    `[agent-runtime] ${input.stage}`,
    buildAgentRuntimeLogContext(input),
  ).catch(() => {})
}
