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
import { hasAgentTool } from '../agent.tool.service.js'
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

  it('mounts Intel Brief formatting through channel-pack', () => {
    const toolNames = getToolNamesForMountedPacks(expandMountedPacks(['channel-pack']))
    expect(toolNames).toContain('intel_brief_format')
    expect(hasAgentTool('intel_brief_format')).toBe(true)
    expect(describePackForRouting('channel-pack')).toContain('Intel Brief')
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
