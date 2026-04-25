import { describe, expect, it } from 'vitest'
import { buildAgentRuntimeLogContext } from '../agent.runtime-log.service.js'

describe('agent runtime log context', () => {
  it('records P0, budget, seed, and pack state without prompt-sized labels', () => {
    const context = buildAgentRuntimeLogContext({
      stage: 'p0-budget',
      mode: 'progressive',
      sessionId: 'web:default',
      round: 0,
      mountedPacks: [],
      upgradeCount: 0,
      checkpointEnabled: true,
      providerCachingEnabled: true,
      checkpoint: {
        seedStatus: 'failed',
        seedAttempts: 3,
        summaryInjectedTokens: 128,
      },
      budgetReport: {
        key: 'p0',
        label: 'P0 prompt with verbose label that should not be logged',
        tokens: 3010,
        limitTokens: 3000,
        overLimit: true,
        components: [
          {
            key: 'system',
            label: 'large prompt component label should not be logged',
            tokens: 1800,
          },
        ],
      },
    })

    expect(context).toMatchObject({
      scope: 'agent-runtime',
      mode: 'progressive',
      stage: 'p0-budget',
      sessionId: 'web:default',
      round: 0,
      p0: true,
      mountedPacks: [],
      upgradeCount: 0,
      checkpointEnabled: true,
      providerCachingEnabled: true,
      seedStatus: 'failed',
      seedAttempts: 3,
      checkpointSummaryInjectedTokens: 128,
      budgetReport: {
        key: 'p0',
        tokens: 3010,
        limitTokens: 3000,
        overLimit: true,
        components: [{ key: 'system', tokens: 1800 }],
      },
    })
    expect(JSON.stringify(context)).not.toContain('verbose label')
    expect(JSON.stringify(context)).not.toContain('large prompt component label')
  })

  it('records mounted pack, upgrade, tool, and usage state for upgraded runs', () => {
    const context = buildAgentRuntimeLogContext({
      stage: 'business-tools',
      mode: 'progressive',
      sessionId: 'web:default',
      round: 2,
      mountedPacks: ['base-read-pack', 'repo-pack'],
      upgradeCount: 1,
      checkpoint: {
        seedStatus: 'ready',
        seedAttempts: 1,
        summaryInjectedTokens: 64,
      },
      toolNames: ['filesystem_read_file'],
      toolFailure: 'read failed',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
      },
    })

    expect(context).toMatchObject({
      stage: 'business-tools',
      p0: false,
      mountedPacks: ['base-read-pack', 'repo-pack'],
      upgradeCount: 1,
      seedStatus: 'ready',
      seedAttempts: 1,
      checkpointSummaryInjectedTokens: 64,
      toolNames: ['filesystem_read_file'],
      toolFailure: 'read failed',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
      },
    })
  })
})
