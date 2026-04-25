import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-settings-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('settings llm profiles', () => {
  it('defaults and normalizes morning brief settings', async () => {
    const service = await import('./settings.service.js')
    const calendar = await import('../calendar/calendar.schedule.service.js')

    expect((await service.getSettings()).agent.morningBrief).toEqual({
      enabled: false,
      time: '09:30',
    })
    expect(await calendar.listScheduledTasks({ target: 'agent' })).toEqual([])

    const updated = await service.updateSettings({
      agent: { morningBrief: { enabled: true, time: '07:45' } },
    })
    expect(updated.agent.morningBrief).toEqual({ enabled: true, time: '07:45' })
    let tasks = await calendar.listScheduledTasks({ target: 'agent' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      title: '每日 Intel Center 早报',
      target: 'agent',
      mode: 'ongoing',
      time: '07:45',
      repeatUnit: 'day',
      enabled: true,
      delivery: {
        wechat: { mode: 'off' },
        feishu: { mode: 'off' },
      },
    })
    expect(tasks[0]?.notes).toContain('[managed:agent-morning-brief]')
    expect(tasks[0]?.prompt).toContain('intel-center')

    await service.updateSettings({ agent: { morningBrief: { time: 'bad-time' } } })
    expect((await service.getSettings()).agent.morningBrief).toEqual({
      enabled: true,
      time: '07:45',
    })
    tasks = await calendar.listScheduledTasks({ target: 'agent' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.time).toBe('07:45')

    await service.updateSettings({ agent: { morningBrief: { enabled: false } } })
    expect((await service.getSettings()).agent.morningBrief).toEqual({
      enabled: false,
      time: '07:45',
    })
    tasks = await calendar.listScheduledTasks({ target: 'agent' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ enabled: false, time: '07:45' })
  })

  it('does not take over user-created morning brief tasks without the managed marker', async () => {
    const service = await import('./settings.service.js')
    const calendar = await import('../calendar/calendar.schedule.service.js')

    const userTask = await calendar.createScheduledTask({
      title: '每日 Intel Center 早报',
      notes: '用户自己维护的飞书早报任务',
      target: 'agent',
      mode: 'ongoing',
      startDate: '2026-04-25',
      time: '06:30',
      repeatUnit: 'day',
      repeatInterval: 1,
      prompt: '请使用 intel-center 生成早报并发送到飞书。',
      delivery: {
        feishu: {
          mode: 'fixed',
          receiveIdType: 'chat_id',
          receiveId: 'oc_manual',
        },
        wechat: { mode: 'off' },
      },
      enabled: true,
    })

    await service.updateSettings({
      agent: { morningBrief: { enabled: true, time: '08:00' } },
    })

    const tasks = await calendar.listScheduledTasks({ target: 'agent' })
    expect(tasks).toHaveLength(2)
    expect(tasks.find((task) => task.id === userTask.id)).toMatchObject({
      notes: '用户自己维护的飞书早报任务',
      time: '06:30',
      enabled: true,
      delivery: {
        feishu: {
          mode: 'fixed',
          receiveIdType: 'chat_id',
          receiveId: 'oc_manual',
        },
      },
    })
    const managed = tasks.find((task) => task.notes.includes('[managed:agent-morning-brief]'))
    expect(managed).toMatchObject({
      title: '每日 Intel Center 早报',
      time: '08:00',
      enabled: true,
      delivery: {
        feishu: { mode: 'off' },
        wechat: { mode: 'off' },
      },
    })
  })

  it('updates an existing managed morning brief task without overwriting delivery', async () => {
    const service = await import('./settings.service.js')
    const calendar = await import('../calendar/calendar.schedule.service.js')

    const managedTask = await calendar.createScheduledTask({
      title: '每日 Intel Center 早报',
      notes: '[managed:agent-morning-brief]\n用户后来配置了固定飞书投递',
      target: 'agent',
      mode: 'ongoing',
      startDate: '2026-04-25',
      time: '07:00',
      repeatUnit: 'day',
      repeatInterval: 1,
      prompt: '旧早报 prompt',
      delivery: {
        feishu: {
          mode: 'fixed',
          receiveIdType: 'chat_id',
          receiveId: 'oc_managed',
        },
        wechat: { mode: 'off' },
      },
      enabled: true,
    })

    await service.updateSettings({
      agent: { morningBrief: { enabled: true, time: '08:20' } },
    })

    const tasks = await calendar.listScheduledTasks({ target: 'agent' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe(managedTask.id)
    expect(tasks[0]).toMatchObject({
      time: '08:20',
      enabled: true,
      delivery: {
        feishu: {
          mode: 'fixed',
          receiveIdType: 'chat_id',
          receiveId: 'oc_managed',
        },
        wechat: { mode: 'off' },
      },
    })
    expect(tasks[0]?.prompt).toContain('intel-center')
  })

  it('migrates legacy llm config into an active cloud profile', async () => {
    await fs.writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({
        llm: {
          baseUrl: 'https://api.openai.com/v1',
          modelId: 'gpt-4.1-mini',
          apiKey: 'cloud-key',
        },
      }),
      'utf-8',
    )

    const service = await import('./settings.service.js')
    const settings = await service.getSettings()
    const publicSettings = await service.getPublicSettings()

    expect(settings.llm.activeProfileId).toBeTruthy()
    expect(settings.llm.profiles).toHaveLength(1)
    expect(settings.llm.profiles[0]).toMatchObject({
      kind: 'cloud',
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4.1-mini',
      apiKey: 'cloud-key',
    })
    expect(publicSettings.llm.profiles[0].hasApiKey).toBe(true)
    expect('apiKey' in (publicSettings.llm.profiles[0] as Record<string, unknown>)).toBe(false)
  })

  it('can save and activate a local profile without leaking a cloud api key', async () => {
    const service = await import('./settings.service.js')

    await service.updateSettings({
      llm: {
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4.1-mini',
        apiKey: 'cloud-key',
      },
    })
    await service.upsertLlmProfile(
      {
        id: 'ollama-llama3',
        name: 'Ollama llama3',
        kind: 'local',
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'llama3',
        enabled: true,
      },
      { activate: true },
    )

    const settings = await service.getSettings()

    expect(settings.llm.activeProfileId).toBe('ollama-llama3')
    expect(settings.llm.kind).toBe('local')
    expect(settings.llm.provider).toBe('ollama')
    expect(settings.llm.modelId).toBe('llama3')
    expect(settings.llm.apiKey).toBe('')
  })

  it('resolves task routes before falling back to the active profile', async () => {
    const service = await import('./settings.service.js')

    await service.upsertLlmProfile(
      {
        id: 'cloud-default',
        name: 'Cloud default',
        kind: 'cloud',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4.1-mini',
        apiKey: 'cloud-key',
        enabled: true,
      },
      { activate: true },
    )
    await service.upsertLlmProfile({
      id: 'local-pdf',
      name: 'Local PDF',
      kind: 'local',
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen2.5',
      enabled: true,
    })
    await service.updateLlmTaskRoutes([{ task: 'pdf-to-markdown', profileId: 'local-pdf' }])

    const settings = await service.getSettings()

    expect(service.resolveLlmConfigForTask(settings.llm, 'pdf-to-markdown').modelId).toBe('qwen2.5')
    expect(service.resolveLlmConfigForTask(settings.llm, 'agent-chat').modelId).toBe(
      'gpt-4.1-mini',
    )
  })
})
