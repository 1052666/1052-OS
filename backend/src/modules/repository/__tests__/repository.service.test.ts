import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import unzipper from 'unzipper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-repository-'))
  process.env.DATA_DIR = path.join(tempDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('repository service', () => {
  it('creates repository archives without platform shell dependencies', async () => {
    const repoDir = path.join(tempDir, 'sample-repo')
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true })
    await fs.mkdir(path.join(repoDir, 'node_modules', 'ignored'), { recursive: true })
    await fs.writeFile(path.join(repoDir, 'README.md'), '# sample\n', 'utf-8')
    await fs.writeFile(path.join(repoDir, 'src', 'index.ts'), 'export const ok = true\n', 'utf-8')
    await fs.writeFile(path.join(repoDir, 'node_modules', 'ignored', 'skip.js'), 'skip\n', 'utf-8')

    const service = await import('../repository.service.js')
    const repository = await service.addManualRepository({ path: repoDir })
    const archive = await service.createRepositoryArchive(repository.id)

    const directory = await unzipper.Open.file(archive.filePath)
    const paths = directory.files.map((file) => file.path).sort()

    expect(paths).toContain('README.md')
    expect(paths).toContain('src/')
    expect(paths).toContain('src/index.ts')
    expect(paths.some((item) => item.startsWith('node_modules/'))).toBe(false)
  })
})
