import { describe, expect, it } from 'vitest'
import {
  describePackForRouting,
  expandMountedPacks,
  getToolNamesForMountedPacks,
  normalizeRequestedPacks,
} from '../agent.pack.service.js'
import {
  MAX_PACKS_PER_UPGRADE,
  MAX_UPGRADES_PER_MESSAGE,
  validateContextUpgradeRequest,
} from '../agent.upgrade.service.js'
import {
  emptyCheckpoint,
  normalizeSessionId,
  summarizeCheckpointForInjection,
} from '../agent.checkpoint.service.js'
import { buildP0Messages } from '../agent.p0.service.js'
import { getAgentToolDefinitionsForNames, hasAgentTool } from '../agent.tool.service.js'
import { terminalTools } from '../tools/terminal.tools.js'
import { isReadonlyTerminalCommandAllowed } from '../../terminal/terminal.service.js'

describe('agent progressive disclosure helpers', () => {
  it('normalizes requested packs and deduplicates invalid values', () => {
    expect(
      normalizeRequestedPacks(['repo-pack', 'repo-pack', 'search-pack', 'bad-pack']),
    ).toEqual(['repo-pack', 'search-pack'])
  })

  it('expands base-read-pack automatically and deduplicates mounted tool names', () => {
    const mountedPacks = expandMountedPacks(['repo-pack', 'image-pack', 'search-pack'])
    expect(mountedPacks).toEqual(['base-read-pack', 'repo-pack', 'image-pack', 'search-pack'])

    const toolNames = getToolNamesForMountedPacks(mountedPacks)
    expect(toolNames).toContain('agent_runtime_status')
    expect(toolNames).toContain('agent_llm_local_model_scan')
    expect(toolNames).toContain('filesystem_read_file')
    expect(toolNames).toContain('terminal_run_readonly')
    expect(toolNames).toContain('terminal_run')
    expect(toolNames).toContain('terminal_interrupt')
    expect(toolNames).toContain('image_generate')
    expect(toolNames).toContain('websearch_search')
    expect(toolNames).toContain('uapis_list_apis')
    expect(toolNames).toContain('uapis_read_api')
    expect(toolNames).toContain('uapis_call')
    expect(toolNames.filter((name) => name === 'filesystem_read_file')).toHaveLength(1)
  })

  it('routes image generation through image-pack before search capabilities', async () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['image-pack']))
    expect(toolNames).toContain('image_generate')
    expect(describePackForRouting('image-pack')).toContain('image_generate')
    expect(hasAgentTool('image_generate')).toBe(true)

    const built = await buildP0Messages({
      history: [],
      checkpoint: emptyCheckpoint('web-default'),
      userPrompt: '',
      mountedPacks: [],
    })
    const system = built.messages[0]?.content ?? ''
    expect(system).toContain('image-pack')
    expect(system).toContain('image_generate')
    expect(system).toContain('priority over search-pack')
  })

  it('exposes UAPIs as discoverable search-pack capability in P0', async () => {
    expect(describePackForRouting('search-pack')).toContain('UAPIs')
    const sourceToggleSchema = getAgentToolDefinitionsForNames(['websearch_set_source_enabled'])
      .at(0)
      ?.function.parameters as {
        properties?: { family?: { enum?: string[] } }
      } | undefined
    const sourceToggle = sourceToggleSchema?.properties?.family?.enum
    expect(sourceToggle).toContain('intel-source')

    const built = await buildP0Messages({
      history: [],
      checkpoint: emptyCheckpoint('web-default'),
      userPrompt: '',
      mountedPacks: [],
    })
    const system = built.messages[0]?.content ?? ''
    expect(system).toContain('UAPIs directory summary')
    expect(system).toContain('search-pack')
    expect(system).toContain('uapis_list_apis')
    expect(system).toContain('uapis_read_api')
    expect(system).toContain('uapis_call')
    expect(built.budgetReport.components.map((item) => item.key)).toContain('context-upgrade-tool')
    expect(built.budgetReport.limitTokens).toBeGreaterThan(0)
  })

  it('mounts memory write tools through memory-pack and advertises the route in P0', async () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['memory-pack']))
    expect(toolNames).toContain('memory_create')
    expect(toolNames).toContain('memory_suggest')
    expect(toolNames).toContain('memory_secure_write')

    const built = await buildP0Messages({
      history: [],
      checkpoint: emptyCheckpoint('web-default'),
      userPrompt: '',
      mountedPacks: [],
    })
    const system = built.messages[0]?.content ?? ''
    expect(system).toContain('memory-pack')
    expect(system).toContain('memory_create')
    expect(system).toContain('memory_suggest')
    expect(system).toContain('proactively request memory-pack')
  })

  it('mounts Wiki tools through data-pack and advertises the route in P0', async () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['data-pack']))
    expect(toolNames).toContain('wiki_summary')
    expect(toolNames).toContain('wiki_raw_read')
    expect(toolNames).toContain('wiki_page_write')
    expect(toolNames).toContain('wiki_query_writeback')
    expect(describePackForRouting('data-pack')).toContain('Wiki')

    const built = await buildP0Messages({
      history: [],
      checkpoint: emptyCheckpoint('web-default'),
      userPrompt: '',
      mountedPacks: [],
    })
    const system = built.messages[0]?.content ?? ''
    expect(system).toContain('data-pack')
    expect(system).toContain('Wiki')
    expect(system).toContain('raw')
    expect(system).toContain('综合分析')
  })

  it('mounts full SQL workbench tools through data-pack', () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['data-pack']))

    // SQL data source tools
    expect(toolNames).toContain('sql_datasource_list')
    expect(toolNames).toContain('sql_datasource_create')
    expect(toolNames).toContain('sql_datasource_update')
    expect(toolNames).toContain('sql_datasource_delete')
    expect(toolNames).toContain('sql_datasource_test')
    expect(hasAgentTool('sql_datasource_create')).toBe(true)
    expect(hasAgentTool('sql_datasource_test')).toBe(true)

    // SQL file tools
    expect(toolNames).toContain('sql_file_list')
    expect(toolNames).toContain('sql_file_create')
    expect(toolNames).toContain('sql_file_update')
    expect(toolNames).toContain('sql_file_delete')

    // SQL query
    expect(toolNames).toContain('sql_query')
    expect(hasAgentTool('sql_query')).toBe(true)

    // SQL variable tools
    expect(toolNames).toContain('sql_variable_list')
    expect(toolNames).toContain('sql_variable_create')
    expect(toolNames).toContain('sql_variable_update')
    expect(toolNames).toContain('sql_variable_delete')
    expect(hasAgentTool('sql_variable_list')).toBe(true)
    expect(hasAgentTool('sql_variable_create')).toBe(true)

    // SQL server tools
    expect(toolNames).toContain('sql_server_list')
    expect(toolNames).toContain('sql_server_create')
    expect(toolNames).toContain('sql_server_update')
    expect(toolNames).toContain('sql_server_delete')
    expect(toolNames).toContain('sql_server_test')
    expect(hasAgentTool('sql_server_list')).toBe(true)
    expect(hasAgentTool('sql_server_test')).toBe(true)

    // SQL shell file tools
    expect(toolNames).toContain('sql_shell_file_list')
    expect(toolNames).toContain('sql_shell_file_create')
    expect(toolNames).toContain('sql_shell_file_update')
    expect(toolNames).toContain('sql_shell_file_delete')
    expect(toolNames).toContain('sql_shell_file_execute')
    expect(hasAgentTool('sql_shell_file_list')).toBe(true)
    expect(hasAgentTool('sql_shell_file_execute')).toBe(true)

    // Orchestration tools
    expect(toolNames).toContain('orchestration_list')
    expect(toolNames).toContain('orchestration_create')
    expect(toolNames).toContain('orchestration_update')
    expect(toolNames).toContain('orchestration_delete')
    expect(toolNames).toContain('orchestration_execute')
    expect(toolNames).toContain('orchestration_logs')
    expect(hasAgentTool('orchestration_execute')).toBe(true)

    expect(describePackForRouting('data-pack')).toContain('SQL')
  })

  it('mounts Intel Brief formatting through channel-pack', () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['channel-pack']))
    expect(toolNames).toContain('intel_brief_format')
    expect(hasAgentTool('intel_brief_format')).toBe(true)
    expect(describePackForRouting('channel-pack')).toContain('Intel Brief')
  })

  it('advertises Intel Center as the preferred news and brief route in P0', async () => {
    expect(describePackForRouting('skill-pack')).toContain('intel-center')
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['skill-pack']))
    expect(toolNames).toContain('intel_center_collect')
    expect(hasAgentTool('intel_center_collect')).toBe(true)

    const built = await buildP0Messages({
      history: [],
      checkpoint: emptyCheckpoint('web-default'),
      userPrompt: '',
      mountedPacks: [],
    })
    const system = built.messages[0]?.content ?? ''
    expect(system).toContain('intel-center')
    expect(system).toContain('skill-pack')
    expect(system).toContain('intel_center_collect')
    expect(system).toContain('intel_brief_format')
    expect(system).toContain('does not collect intelligence')
  })

  it('mounts confirmed Agent settings tools through settings-pack', () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['settings-pack']))
    expect(toolNames).toContain('agent_morning_brief_update')
    expect(toolNames).toContain('agent_llm_activate_profile')
    expect(toolNames).toContain('agent_llm_set_task_route')
    expect(hasAgentTool('agent_morning_brief_update')).toBe(true)
    expect(hasAgentTool('agent_llm_activate_profile')).toBe(true)
    expect(hasAgentTool('agent_llm_set_task_route')).toBe(true)
    expect(describePackForRouting('settings-pack')).toContain('LLM Profile')
    expect(describePackForRouting('settings-pack')).toContain('早报')
  })

  it('enforces per-upgrade pack count and per-message upgrade count', () => {
    expect(() =>
      validateContextUpgradeRequest(
        {
          packs: ['repo-pack', 'search-pack', 'memory-pack'],
          reason: 'too many packs',
        },
        0,
      ),
    ).toThrow(String(MAX_PACKS_PER_UPGRADE))

    expect(() =>
      validateContextUpgradeRequest(
        {
          packs: ['repo-pack'],
          reason: 'too many upgrades',
        },
        MAX_UPGRADES_PER_MESSAGE,
      ),
    ).toThrow('upgrade_limit_reached')
  })

  it('caps injected checkpoint summary size', () => {
    const checkpoint = emptyCheckpoint('web-default')
    checkpoint.goal = 'Investigate MiniMax progressive disclosure behavior'
    checkpoint.facts = Array.from({ length: 30 }, (_, index) => `fact ${index} ${'x'.repeat(80)}`)
    checkpoint.done = Array.from({ length: 20 }, (_, index) => `done ${index} ${'y'.repeat(80)}`)
    checkpoint.failedAttempts = Array.from(
      { length: 10 },
      (_, index) => `failed ${index} ${'z'.repeat(80)}`,
    )

    const summary = summarizeCheckpointForInjection(checkpoint)
    expect(summary.injectedTokens).toBeLessThanOrEqual(800)
    expect(summary.text.startsWith('Checkpoint:')).toBe(true)
  })

  it('normalizes session id to a Windows-safe filename', () => {
    expect(normalizeSessionId('web:default')).toBe('web-default')
    expect(normalizeSessionId('wechat:acc/peer?x')).toBe('wechat-acc-peer-x')
  })

  it('allows full-access injected confirmation on allow-listed read-only terminal commands', async () => {
    const tool = terminalTools.find((item) => item.name === 'terminal_run_readonly')
    expect(tool).toBeTruthy()

    const result = await tool?.execute({
      command: 'ls',
      confirmed: true,
    })
    expect(result).toMatchObject({
      exitCode: 0,
      risk: 'safe',
    })
  })

  it('keeps read-only terminal commands on the allow list', async () => {
    expect(isReadonlyTerminalCommandAllowed('rg output-profile backend/src')).toBe(true)
    expect(isReadonlyTerminalCommandAllowed('git diff -- backend/src/modules/terminal/terminal.service.ts')).toBe(true)
    expect(isReadonlyTerminalCommandAllowed('git restore backend/src/modules/terminal/terminal.service.ts')).toBe(false)
    expect(isReadonlyTerminalCommandAllowed('[IO.File]::WriteAllText("x.txt","no")')).toBe(false)
    expect(isReadonlyTerminalCommandAllowed('python -c "open(\'x.txt\',\'w\').write(\'no\')"')).toBe(false)
  })

  it('keeps read-only terminal commands from modifying local state', async () => {
    const tool = terminalTools.find((item) => item.name === 'terminal_run_readonly')
    expect(tool).toBeTruthy()

    await expect(
      tool?.execute({
        command: 'Set-Content -Path should-not-exist.txt -Value no',
        confirmed: true,
      }),
    ).rejects.toThrow('Read-only terminal tool only allows explicit read commands')
  })
})
