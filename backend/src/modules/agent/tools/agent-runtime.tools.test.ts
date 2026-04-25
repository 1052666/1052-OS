import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '../agent.tool.types.js'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-agent-runtime-tools-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function loadRuntimeToolModules() {
  const settingsService = await import('../../settings/settings.service.js')
  const toolModule = await import('./agent-runtime.tools.js')
  const agentToolService = await import('../agent.tool.service.js')
  return { settingsService, toolModule, agentToolService }
}

function toolByName(tools: AgentTool[], name: string) {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`missing tool: ${name}`)
  return tool
}

async function seedProfiles(settingsService: typeof import('../../settings/settings.service.js')) {
  await settingsService.upsertLlmProfile(
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
  await settingsService.upsertLlmProfile({
    id: 'local-pdf',
    name: 'Local PDF',
    kind: 'local',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'qwen2.5',
    enabled: true,
  })
  await settingsService.upsertLlmProfile({
    id: 'disabled-local',
    name: 'Disabled local',
    kind: 'local',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'disabled',
    enabled: false,
  })
}

describe('agent llm settings tools', () => {
  it('requires explicit confirmation before changing llm settings', async () => {
    const { settingsService, toolModule } = await loadRuntimeToolModules()
    await seedProfiles(settingsService)

    const activate = toolByName(toolModule.agentRuntimeTools, 'agent_llm_activate_profile')
    const route = toolByName(toolModule.agentRuntimeTools, 'agent_llm_set_task_route')

    await expect(activate.execute({ profileId: 'local-pdf' })).rejects.toThrow('明确确认')
    await expect(
      route.execute({ task: 'pdf-to-markdown', profileId: 'local-pdf' }),
    ).rejects.toThrow('明确确认')
  })

  it('rejects unknown and disabled profiles', async () => {
    const { settingsService, toolModule } = await loadRuntimeToolModules()
    await seedProfiles(settingsService)

    const activate = toolByName(toolModule.agentRuntimeTools, 'agent_llm_activate_profile')
    const route = toolByName(toolModule.agentRuntimeTools, 'agent_llm_set_task_route')

    await expect(
      activate.execute({ profileId: 'missing-profile', confirmed: true }),
    ).rejects.toThrow('未找到 LLM profile')
    await expect(
      activate.execute({ profileId: 'disabled-local', confirmed: true }),
    ).rejects.toThrow('已停用')
    await expect(
      route.execute({
        task: 'pdf-to-markdown',
        profileId: 'disabled-local',
        confirmed: true,
      }),
    ).rejects.toThrow('已停用')
  })

  it('sets and clears task-level routes', async () => {
    const { settingsService, toolModule } = await loadRuntimeToolModules()
    await seedProfiles(settingsService)
    const route = toolByName(toolModule.agentRuntimeTools, 'agent_llm_set_task_route')

    await route.execute({
      task: 'pdf-to-markdown',
      profileId: 'local-pdf',
      confirmed: true,
    })
    expect((await settingsService.getSettings()).llm.taskRoutes).toEqual([
      { task: 'pdf-to-markdown', profileId: 'local-pdf' },
    ])

    await route.execute({
      task: 'pdf-to-markdown',
      clear: true,
      confirmed: true,
    })
    expect((await settingsService.getSettings()).llm.taskRoutes).toEqual([])
  })

  it('honors full-access confirmed injection through executeToolCalls', async () => {
    const { settingsService, agentToolService } = await loadRuntimeToolModules()
    await seedProfiles(settingsService)
    await settingsService.updateSettings({
      agent: { fullAccess: true },
    })

    const messages = await agentToolService.executeToolCalls([
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'agent_llm_activate_profile',
          arguments: JSON.stringify({ profileId: 'local-pdf' }),
        },
      },
    ])

    expect(messages[0]?.content).toContain('"ok": true')
    expect((await settingsService.getSettings()).llm.activeProfileId).toBe('local-pdf')
  })
})
