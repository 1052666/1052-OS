import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pkm/pkm.service.js', () => ({
  schedulePkmReindex: vi.fn(),
}))

let tempDir = ''

function memoryPath(...parts: string[]) {
  return path.join(tempDir, 'memory', ...parts)
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadService() {
  vi.resetModules()
  return import('../memory.service.js')
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-memory-'))
  process.env.DATA_DIR = tempDir
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('memory persistence', () => {
  it('initializes durable storage files when the data directory is empty', async () => {
    const service = await loadService()

    await service.initMemoryStorage()

    expect((await fs.stat(memoryPath())).isDirectory()).toBe(true)
    expect(JSON.parse(await fs.readFile(memoryPath('memories.json'), 'utf-8'))).toEqual([])
    expect(JSON.parse(await fs.readFile(memoryPath('suggestions.json'), 'utf-8'))).toEqual([])
    expect(JSON.parse(await fs.readFile(memoryPath('secure', 'index.json'), 'utf-8'))).toEqual([])
    expect(await exists(memoryPath('events.jsonl'))).toBe(true)
    expect(await exists(memoryPath('profile.md'))).toBe(true)
    expect(await exists(memoryPath('secure', 'secure-memory.md'))).toBe(true)
  })

  it('creates missing directories and keeps created memories across module reloads', async () => {
    const service = await loadService()

    const created = await service.createMemory({
      title: 'GitHub clone path',
      content: 'Use the clean GitHub clone when committing and pushing this project.',
      category: 'workflow',
      scope: 'repository',
      priority: 'high',
      tags: ['git'],
    })

    expect(await exists(memoryPath('memories.json'))).toBe(true)
    const stored = JSON.parse(await fs.readFile(memoryPath('memories.json'), 'utf-8')) as Array<{
      id: string
    }>
    expect(stored.some((item) => item.id === created.id)).toBe(true)

    const reloaded = await loadService()
    const listed = await reloaded.listMemories({ query: 'clean GitHub clone' })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: created.id,
      title: 'GitHub clone path',
      active: true,
    })
  })

  it('does not silently turn malformed storage into an empty memory list', async () => {
    await fs.mkdir(memoryPath(), { recursive: true })
    await fs.writeFile(memoryPath('memories.json'), '{"bad": true}', 'utf-8')
    const service = await loadService()

    await expect(service.listMemories()).rejects.toThrow('must contain a JSON array')

    await fs.writeFile(memoryPath('memories.json'), '{ broken json', 'utf-8')
    await expect(service.listMemories()).rejects.toThrow('invalid JSON')
  })
})
