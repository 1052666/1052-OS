import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-wiki-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('wiki service', () => {
  it('writes raw files, pages, index and lint results inside data/wiki', async () => {
    const service = await import('../wiki.service.js')

    const raw = await service.saveWikiRawUpload({
      buffer: Buffer.from('# Source\n\ncontent'),
      fileName: 'source.md',
    })
    expect(raw.path).toBe('source.md')

    const page = await service.writeWikiPage({
      title: '测试概念',
      category: 'concept',
      sources: ['source.md'],
      summary: '测试摘要',
      content: '# 测试概念\n\n## 关联\n\n[[实体/不存在]]\n',
    })
    expect(page.path).toBe('核心理念/测试概念.md')
    expect(page.hasFrontmatter).toBe(true)

    const lint = await import('../wiki.lint.js').then((module) => module.lintWiki())
    expect(lint.brokenLinks).toContainEqual({
      page: '核心理念/测试概念.md',
      link: '实体/不存在.md',
    })

    const index = await fs.readFile(path.join(tempDir, 'wiki', 'wiki', '索引.md'), 'utf-8')
    expect(index).toContain('核心理念/测试概念')
  })

  it('rejects path traversal', async () => {
    const service = await import('../wiki.service.js')
    await expect(service.readWikiRawFile('../secret.md')).rejects.toThrow('路径不能越过')
  })
})
