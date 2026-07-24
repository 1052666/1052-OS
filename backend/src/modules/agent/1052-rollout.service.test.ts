import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''
let previousDataDir: string | undefined

beforeEach(async () => {
  previousDataDir = process.env.DATA_DIR
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-rollout-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = previousDataDir
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('1052 rollout store', () => {
  it('appends and reads turn events in order', async () => {
    const service = await import('./1052-rollout.service.js')
    const writer = service.createRuntime1052RolloutWriter()
    writer.enqueue({
      type: 'turn-started',
      turnId: 'turn-1',
      source: { channel: 'web' },
      messageCount: 1,
    })
    writer.enqueue({
      type: 'turn-completed',
      turnId: 'turn-1',
      status: 'completed',
      steps: 1,
      usage: { totalTokens: 5 },
    })
    await writer.flush()

    const records = await service.readRuntime1052Rollout('turn-1')
    expect(records.map((record) => record.event.type)).toEqual([
      'turn-started',
      'turn-completed',
    ])
    expect(records[1]?.event).toMatchObject({ status: 'completed', steps: 1 })
  })

  it('sanitizes a turn id before using it as a filename', async () => {
    const service = await import('./1052-rollout.service.js')

    expect(service.runtime1052RolloutPath('turn:../unsafe')).toBe(
      path.join(tempDir, '1052-rollouts', 'turn_.._unsafe.jsonl'),
    )
  })

  it('redacts secure-tool payloads and common credentials before persistence', async () => {
    const service = await import('./1052-rollout.service.js')
    await service.appendRuntime1052RolloutEvent({
      type: 'model-response',
      turnId: 'turn-secret',
      step: 1,
      content: 'using sk-1234567890abcdef',
      toolCalls: [
        {
          id: 'secure-write',
          name: 'memory_secure_write',
          arguments: '{"apiKey":"plain-value"}',
        },
      ],
    })
    await service.appendRuntime1052RolloutEvent({
      type: 'tool-call-finished',
      turnId: 'turn-secret',
      callId: 'secure-read',
      name: 'memory_secure_read',
      ok: true,
      resultPreview: 'plain-value',
      resultContent: '{"ok":true,"data":"plain-value"}',
    })

    const records = await service.readRuntime1052Rollout('turn-secret')
    const persisted = JSON.stringify(records)
    expect(persisted).not.toContain('plain-value')
    expect(persisted).not.toContain('sk-1234567890abcdef')
    expect(persisted).toContain('[REDACTED]')
  })
})
