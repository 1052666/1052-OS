import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

async function loadService() {
  vi.resetModules()
  return import('../agent.history.service.js')
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-agent-history-'))
  process.env.DATA_DIR = tempDir
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('agent history /new persistence', () => {
  it('backs up the current context before clearing history for /new', async () => {
    const service = await loadService()
    await service.saveChatHistory(
      [
        {
          id: 1,
          ts: 1,
          role: 'user',
          content: '保留这段上下文',
        },
        {
          id: 2,
          ts: 2,
          role: 'assistant',
          content: '这段回复也要进入备份',
        },
      ],
      'replace',
    )

    await service.saveChatHistory([], 'command-new')

    expect(await service.getChatHistory()).toEqual({ messages: [] })
    const backupDir = path.join(tempDir, 'chat-history-backups')
    const backups = await fs.readdir(backupDir)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^chat-history-\d{8}-\d{6}-\d{3}-command-new-[a-f0-9]{8}\.json$/)

    const backup = JSON.parse(await fs.readFile(path.join(backupDir, backups[0]!), 'utf-8')) as {
      messages?: Array<{ content?: string }>
      backupReason?: string
    }
    expect(backup.backupReason).toBe('command-new')
    expect(backup.messages?.map((message) => message.content)).toEqual([
      '保留这段上下文',
      '这段回复也要进入备份',
    ])
  })

  it('does not create an empty backup when /new runs with no current context', async () => {
    const service = await loadService()

    await service.saveChatHistory([], 'command-new')

    await expect(fs.readdir(path.join(tempDir, 'chat-history-backups'))).rejects.toThrow()
  })
})
