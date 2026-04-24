import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let currentDataDir: string | undefined

async function loadSeedModules() {
  currentDataDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-agent-seed-'))
  process.env.DATA_DIR = currentDataDir
  vi.resetModules()

  const checkpointModule = await import('../agent.checkpoint.service.js')
  const seedModule = await import('../agent.seed.service.js')
  return { checkpointModule, seedModule }
}

afterEach(async () => {
  vi.resetModules()
  delete process.env.DATA_DIR
  if (currentDataDir) {
    await fs.rm(currentDataDir, { recursive: true, force: true })
    currentDataDir = undefined
  }
})

describe('checkpoint seed retry boundary', () => {
  it('does not retry a failed seed after the max attempts for the same input', async () => {
    const { checkpointModule, seedModule } = await loadSeedModules()
    const history = [{ role: 'user' as const, content: 'resume this session' }]
    const recentPlainText = checkpointModule.messagesToRecentPlainText(history, 20)
    const fingerprint = checkpointModule.fingerprintSeedInput(['', recentPlainText])

    const checkpoint = checkpointModule.emptyCheckpoint('web-default')
    checkpoint.seedStatus = 'failed'
    checkpoint.seedInputFingerprint = fingerprint
    checkpoint.seedAttempts = seedModule.MAX_CHECKPOINT_SEED_ATTEMPTS
    await checkpointModule.saveCheckpoint(checkpoint)

    const result = await seedModule.ensureCheckpointSeedForSession('web:default', history)

    expect(seedModule.isCheckpointSeedRetryExhausted(result, fingerprint)).toBe(true)
    expect(result.seedStatus).toBe('failed')
    expect(result.seedAttempts).toBe(seedModule.MAX_CHECKPOINT_SEED_ATTEMPTS)
  })

  it('starts a fresh retry window when the seed input changes', async () => {
    const { checkpointModule, seedModule } = await loadSeedModules()
    const checkpoint = checkpointModule.emptyCheckpoint('web-default')
    checkpoint.seedStatus = 'failed'
    checkpoint.seedInputFingerprint = 'old-input'
    checkpoint.seedAttempts = seedModule.MAX_CHECKPOINT_SEED_ATTEMPTS
    await checkpointModule.saveCheckpoint(checkpoint)

    const result = await seedModule.ensureCheckpointSeedForSession(
      'web:default',
      [{ role: 'user' as const, content: 'continue with the new plan' }],
      [
        {
          id: 1,
          ts: Date.now(),
          role: 'assistant' as const,
          content: '',
          compactSummary: 'user: continue with the new plan\nassistant: inspect the next boundary',
        },
      ],
    )

    expect(result.seedStatus).toBe('ready')
    expect(result.seedAttempts).toBe(1)
    expect(result.goal).toBe('continue with the new plan')
  })
})
