import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-skills-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

function intelSkillFile() {
  return path.join(tempDir, 'skills', 'intel-center', 'SKILL.md')
}

describe('skills service bundled Skill updates', () => {
  it('installs bundled Skills and records source hashes', async () => {
    const service = await import('../skills.service.js')

    const result = await service.ensureBundledSkillsInstalled()
    expect(result.installed).toContain('intel-center')

    const updates = await service.listBundledSkillUpdates()
    const intel = updates.find((item) => item.id === 'intel-center')
    expect(intel).toMatchObject({
      installed: true,
      updateAvailable: false,
      localModified: false,
    })
    expect(intel?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(intel?.installedSourceHash).toBe(intel?.sourceHash)
  })

  it('detects local modifications and restores bundled content only after confirmation', async () => {
    const service = await import('../skills.service.js')

    await service.ensureBundledSkillsInstalled()
    const original = await fs.readFile(intelSkillFile(), 'utf-8')
    await fs.appendFile(intelSkillFile(), '\n\n<!-- local edit -->\n', 'utf-8')

    const modified = (await service.listBundledSkillUpdates()).find((item) => item.id === 'intel-center')
    expect(modified?.localModified).toBe(true)

    await expect(service.applyBundledSkillUpdate('intel-center')).rejects.toThrow(
      'requires explicit confirmation',
    )

    const applied = await service.applyBundledSkillUpdate('intel-center', { confirmed: true })
    expect(applied.applied).toBe(true)
    expect(applied.localModified).toBe(false)
    expect(applied.backupPath).toBeTruthy()
    expect(await fs.readFile(intelSkillFile(), 'utf-8')).toBe(original)
    await expect(fs.stat(applied.backupPath!)).resolves.toBeTruthy()
  })

  it('ignores Intel runtime market snapshots when deciding local modification state', async () => {
    const service = await import('../skills.service.js')

    await service.ensureBundledSkillsInstalled()
    const snapshot = path.join(tempDir, 'skills', 'intel-center', 'scripts', 'market-snapshot.json')
    await fs.writeFile(snapshot, JSON.stringify({ timestamp: 'test', signals: {} }), 'utf-8')

    const updates = await service.listBundledSkillUpdates()
    const intel = updates.find((item) => item.id === 'intel-center')
    expect(intel?.localModified).toBe(false)
  })

  it('ignores malformed bundled seed state entries during startup', async () => {
    await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true })
    await fs.writeFile(
      path.join(tempDir, 'skills', '.bundled-seeded.json'),
      JSON.stringify({
        installedIds: ['../bad', 'intel-center'],
        skills: {
          '../bad': { sourceHash: 'bad' },
        },
      }),
      'utf-8',
    )

    const service = await import('../skills.service.js')
    await expect(service.ensureBundledSkillsInstalled()).resolves.toMatchObject({
      installed: expect.arrayContaining(['intel-center']),
    })
  })
})
