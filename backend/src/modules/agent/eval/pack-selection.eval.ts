/**
 * Pack selection evaluation runner.
 *
 * Runs every fixture through the real P0 pipeline (buildP0Messages → LLM)
 * and compares the model's `request_context_upgrade` tool call against
 * expected packs. Produces a per-case pass/fail report, per-tag accuracy,
 * and an overall score.
 *
 * Usage:
 *   npx tsx src/modules/agent/eval/pack-selection.eval.ts [--model gpt-4.1-mini] [--concurrency 4]
 *
 * Requires:
 *   - A running backend (for settings/LLM config), OR set LLM_BASE_URL,
 *     LLM_API_KEY, LLM_MODEL_ID environment variables directly.
 *   - The fixtures file at ./pack-selection.fixtures.ts.
 */

import { PACK_SELECTION_FIXTURES, type PackSelectionCase } from './pack-selection.fixtures.js'
import { buildP0Messages, getContextUpgradeToolDefinition } from '../agent.p0.service.js'
import { chatCompletion, type LLMConfig, type LLMToolDefinition } from '../llm.client.js'
import { getSettings, resolveLlmConfigForTask } from '../../settings/settings.service.js'
import type { AgentCheckpoint } from '../agent.runtime.types.js'
import { REQUEST_CONTEXT_UPGRADE_TOOL } from '../agent.upgrade.service.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const MODEL_OVERRIDE = getArg('model', '')
const CONCURRENCY = Math.max(1, parseInt(getArg('concurrency', '3'), 10))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EvalResult = {
  case: PackSelectionCase
  actualPacks: string[]
  pass: boolean
  reason: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((item) => sa.has(item))
}

function setsOverlap(actual: string[], expected: string[]): 'exact' | 'superset' | 'subset' | 'partial' | 'disjoint' {
  if (setsEqual(actual, expected)) return 'exact'
  const sa = new Set(actual)
  const se = new Set(expected)
  const intersection = actual.filter((a) => se.has(a))
  if (intersection.length === 0) return 'disjoint'
  if (intersection.length === expected.length) return 'superset'
  if (intersection.length === actual.length) return 'subset'
  return 'partial'
}

const EMPTY_CHECKPOINT: AgentCheckpoint = {
  sessionId: 'eval',
  facts: [],
  done: [],
  failedAttempts: [],
  mountedPacks: [],
  relatedRules: [],
  relatedMemories: [],
  relatedSkills: [],
  updatedAt: Date.now(),
}

async function resolveLlmConfig(): Promise<LLMConfig> {
  // Prefer env vars for CI / headless runs.
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    return {
      baseUrl: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
      modelId: MODEL_OVERRIDE || process.env.LLM_MODEL_ID || 'gpt-4.1-mini',
    }
  }
  // Otherwise read from settings (requires running backend context).
  const settings = await getSettings()
  const base = resolveLlmConfigForTask(settings.llm, 'agent-chat')
  if (MODEL_OVERRIDE) return { ...base, modelId: MODEL_OVERRIDE }
  return base
}

// ---------------------------------------------------------------------------
// Single-case evaluator
// ---------------------------------------------------------------------------

async function evaluateCase(fixture: PackSelectionCase, llm: LLMConfig): Promise<EvalResult> {
  const t0 = Date.now()
  try {
    const { messages } = await buildP0Messages({
      history: [{ role: 'user', content: fixture.input }],
      checkpoint: EMPTY_CHECKPOINT,
      userPrompt: '',
    })

    const tools: LLMToolDefinition[] = [getContextUpgradeToolDefinition()]
    const response = await chatCompletion(llm, messages, tools)

    // Parse tool calls from response.
    let actualPacks: string[] = []
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        if (tc.function.name === REQUEST_CONTEXT_UPGRADE_TOOL) {
          try {
            const parsed = JSON.parse(tc.function.arguments) as { packs?: string[] }
            if (Array.isArray(parsed.packs)) {
              actualPacks = [...new Set([...actualPacks, ...parsed.packs])]
            }
          } catch {
            // malformed arguments
          }
        }
      }
    }

    const expected = fixture.expectedPacks
    const pass = setsEqual([...actualPacks].sort(), [...expected].sort())
    const overlap = setsOverlap(actualPacks, expected)
    const reason = pass
      ? 'exact match'
      : `${overlap}: expected=[${expected.join(',')}] actual=[${actualPacks.join(',')}]`

    return { case: fixture, actualPacks, pass, reason, durationMs: Date.now() - t0 }
  } catch (error) {
    return {
      case: fixture,
      actualPacks: [],
      pass: false,
      reason: `error: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - t0,
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runEval() {
  console.log('🔬 Pack Selection Eval')
  console.log(`   Fixtures: ${PACK_SELECTION_FIXTURES.length}`)
  console.log(`   Concurrency: ${CONCURRENCY}`)
  console.log(`   Model override: ${MODEL_OVERRIDE || '(default from settings)'}`)
  console.log()

  const llm = await resolveLlmConfig()
  console.log(`   Using model: ${llm.modelId}`)
  console.log(`   Base URL: ${llm.baseUrl}`)
  console.log()

  const results: EvalResult[] = []
  const queue = [...PACK_SELECTION_FIXTURES]
  let completed = 0

  async function worker() {
    while (queue.length > 0) {
      const fixture = queue.shift()!
      const result = await evaluateCase(fixture, llm)
      results.push(result)
      completed++
      const icon = result.pass ? '✅' : '❌'
      console.log(
        `  [${String(completed).padStart(2)}/${PACK_SELECTION_FIXTURES.length}] ${icon} #${String(fixture.id).padStart(2)} [${fixture.tag}] ${fixture.input.slice(0, 50)}${fixture.input.length > 50 ? '…' : ''}`,
      )
      if (!result.pass) {
        console.log(`       ${result.reason}`)
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)

  // ── Report ──────────────────────────────────────────────────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════')

  // Per-tag summary
  const byTag = new Map<string, { total: number; passed: number }>()
  for (const r of results) {
    const tag = r.case.tag
    const entry = byTag.get(tag) ?? { total: 0, passed: 0 }
    entry.total++
    if (r.pass) entry.passed++
    byTag.set(tag, entry)
  }

  console.log('\n📊 Per-tag accuracy:')
  for (const [tag, { total, passed }] of [...byTag.entries()].sort()) {
    const pct = ((passed / total) * 100).toFixed(0)
    console.log(`   ${tag.padEnd(12)} ${passed}/${total}  (${pct}%)`)
  }

  const totalPassed = results.filter((r) => r.pass).length
  const totalCases = results.length
  const overallPct = ((totalPassed / totalCases) * 100).toFixed(1)
  const avgDuration = (results.reduce((s, r) => s + r.durationMs, 0) / totalCases).toFixed(0)

  console.log()
  console.log(`📈 Overall: ${totalPassed}/${totalCases} (${overallPct}%)`)
  console.log(`⏱  Avg latency: ${avgDuration}ms per case`)
  console.log()

  // Failed cases list
  const failed = results.filter((r) => !r.pass)
  if (failed.length > 0) {
    console.log('❌ Failed cases:')
    for (const r of failed) {
      console.log(`   #${r.case.id} [${r.case.tag}] ${r.case.input.slice(0, 60)}`)
      console.log(`     ${r.reason}`)
    }
  } else {
    console.log('🎉 All cases passed!')
  }

  // Exit code: fail if accuracy below 80%
  if (totalPassed / totalCases < 0.8) {
    console.log('\n⚠️  Accuracy below 80% threshold — exiting with code 1')
    process.exit(1)
  }
}

runEval().catch((err) => {
  console.error('Eval failed:', err)
  process.exit(2)
})
