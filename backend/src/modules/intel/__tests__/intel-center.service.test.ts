import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

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
      script_exists: true,
      gnews: { total: 1 },
    })
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
})
