import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-output-profile-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('output profile service', () => {
  it('stores composition profiles and renders active runtime context', async () => {
    const service = await import('../output-profile.service.js')

    const profile = await service.createOutputProfile({
      title: '深度长文输出',
      description: '把认知模型、文风和素材范围组合成固定输出方式',
      active: true,
      isDefault: true,
      priority: 'high',
      modes: ['analysis', 'essay'],
      cognitiveModels: [
        { type: 'memory', ref: 'mem_model', label: '核心认知模型', note: '先建模再写结论' },
      ],
      writingStyles: [
        { type: 'memory', ref: 'mem_style', label: '偏好的写作风格', note: '克制、具体、有判断' },
      ],
      materials: [
        { type: 'wiki', ref: '核心理念/样例.md', label: '个人知识库素材', note: '需要时读取原文' },
      ],
      instructions: '输出时先选认知框架，再套写作风格，最后用素材支撑。',
      guardrails: ['不要把素材凭空补全', '需要原文时读取 Wiki'],
    })

    expect(profile.id).toMatch(/^out_/)

    const context = await service.formatOutputProfileRuntimeContext('写一篇分析')
    expect(context).toContain('Output profile runtime context')
    expect(context).toContain('深度长文输出')
    expect(context).toContain('Core cognitive models')
    expect(context).toContain('Writing style')
    expect(context).toContain('Material scope')
    expect(context).toContain('memory:mem_model')
    expect(context).toContain('wiki:核心理念/样例.md')
  })

  it('does not render inactive profiles', async () => {
    const service = await import('../output-profile.service.js')

    await service.createOutputProfile({
      title: '停用配方',
      active: false,
      instructions: '不应该进入运行时',
    })

    expect(await service.formatOutputProfileRuntimeContext('任意请求')).toBe('')
  })

  it('sorts all priority levels before updated time', async () => {
    const service = await import('../output-profile.service.js')

    await service.createOutputProfile({
      title: 'normal profile',
      priority: 'normal',
      instructions: 'normal instructions',
    })
    await service.createOutputProfile({
      title: 'low profile',
      priority: 'low',
      instructions: 'low instructions',
    })
    await service.createOutputProfile({
      title: 'high profile',
      priority: 'high',
      instructions: 'high instructions',
    })

    const titles = (await service.listOutputProfiles()).map((profile) => profile.title)
    expect(titles).toEqual(['high profile', 'normal profile', 'low profile'])
  })
})
