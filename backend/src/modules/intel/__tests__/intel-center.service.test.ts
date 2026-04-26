import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''
const execFileAsync = promisify(execFile)

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-intel-center-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeIntelSkill(scriptBody: string) {
  const skillRoot = path.join(tempDir, 'skills', 'intel-center')
  await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true })
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: intel-center',
      'description: Test Intel Center',
      'enabled: true',
      '---',
      '',
      '# Intel Center',
    ].join('\n'),
    'utf-8',
  )
  await fs.writeFile(path.join(skillRoot, 'scripts', 'intel.py'), scriptBody, 'utf-8')
  return skillRoot
}

describe('Intel Center collection tool', () => {
  it('runs the installed Skill collector from the Skill root cwd', async () => {
    const skillRoot = await writeIntelSkill(`
import json
import os
print(json.dumps({
  "cwd": os.getcwd(),
  "collector_budget": os.environ.get("INTEL_CENTER_TOTAL_BUDGET_SECONDS"),
  "enabled_sources": os.environ.get("INTEL_CENTER_ENABLED_SOURCES"),
  "source_registry": os.environ.get("INTEL_CENTER_SOURCE_REGISTRY"),
  "python_unbuffered": os.environ.get("PYTHONUNBUFFERED"),
  "script_exists": os.path.exists("scripts/intel.py"),
  "gnews": {"total": 1, "items": [{"title": "Signal"}]}
}))
`)
    const { collectIntelCenterData } = await import('../intel-center.service.js')

    const result = await collectIntelCenterData({ timeoutMs: 5_000 })
    const realSkillRoot = await fs.realpath(skillRoot)

    expect(result.skillRoot).toBe(skillRoot)
    expect(result.scriptPath).toBe(path.join(skillRoot, 'scripts', 'intel.py'))
    expect(result.data).toMatchObject({
      cwd: realSkillRoot,
      collector_budget: '1',
      python_unbuffered: '1',
      source_registry: '1',
      script_exists: true,
      gnews: { total: 1 },
    })
    expect(String((result.data as { enabled_sources?: string }).enabled_sources)).toContain('google-news-rss')
    expect(String((result.data as { enabled_sources?: string }).enabled_sources)).not.toContain('tencent-news')
    expect(result.diagnostics.exitCode).toBe(0)
  })

  it('surfaces collector failures without falling back to terminal cwd', async () => {
    await writeIntelSkill(`
import sys
print("collector failed", file=sys.stderr)
sys.exit(7)
`)
    const { collectIntelCenterData } = await import('../intel-center.service.js')

    await expect(collectIntelCenterData({ timeoutMs: 5_000 })).rejects.toThrow(
      'Intel Center collection failed with exit code 7',
    )
  })

  it('passes enabled Intel source registry ids to the collector', async () => {
    await writeIntelSkill(`
import json
import os
print(json.dumps({
  "enabled_sources": os.environ.get("INTEL_CENTER_ENABLED_SOURCES"),
  "source_registry": os.environ.get("INTEL_CENTER_SOURCE_REGISTRY"),
}))
`)
    const { setSearchSourceEnabled } = await import('../../websearch/websearch.service.js')
    await setSearchSourceEnabled({
      family: 'intel-source',
      id: 'google-news-rss',
      enabled: false,
    })
    await setSearchSourceEnabled({
      family: 'intel-source',
      id: 'tencent-news',
      enabled: true,
    })
    const { collectIntelCenterData } = await import('../intel-center.service.js')

    const result = await collectIntelCenterData({ timeoutMs: 5_000 })
    const enabledSources = String((result.data as { enabled_sources?: string }).enabled_sources)

    expect((result.data as { source_registry?: string }).source_registry).toBe('1')
    expect(enabledSources).not.toContain('google-news-rss')
    expect(enabledSources).toContain('tencent-news')
  })

  it('does not overwrite the market delta snapshot when the market source is disabled', async () => {
    const skillRoot = path.join(tempDir, 'skill-copy')
    await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true })
    const sourceScript = path.resolve(process.cwd(), 'builtin-skills', 'intel-center', 'scripts', 'intel.py')
    const scriptPath = path.join(skillRoot, 'scripts', 'intel.py')
    const snapshotPath = path.join(skillRoot, 'scripts', 'market-snapshot.json')
    const originalSnapshot = {
      timestamp: '2026-04-25T00:00:00',
      signals: {
        sp500: { price: 5000, name: 'S&P 500' },
      },
    }
    await fs.copyFile(sourceScript, scriptPath)
    await fs.writeFile(snapshotPath, JSON.stringify(originalSnapshot, null, 2), 'utf-8')

    const { stdout } = await execFileAsync('python3', ['scripts/intel.py'], {
      cwd: skillRoot,
      env: {
        ...process.env,
        INTEL_CENTER_ENABLED_SOURCES: '',
        INTEL_CENTER_SOURCE_REGISTRY: '1',
        INTEL_CENTER_TOTAL_BUDGET_SECONDS: '20',
      },
      timeout: 20_000,
      maxBuffer: 2_000_000,
    })
    const output = JSON.parse(stdout) as {
      market_delta?: { snapshot_skipped?: boolean }
      diagnostics?: { skipped_source_ids?: string[] }
    }
    const afterSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8')) as unknown

    expect(afterSnapshot).toEqual(originalSnapshot)
    expect(output.market_delta?.snapshot_skipped).toBe(true)
    expect(output.diagnostics?.skipped_source_ids).toContain('yahoo-finance')
    expect(output.diagnostics?.skipped_source_ids).toContain('tencent-news')
  })
})
