import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { readSkill } from '../skills/skills.service.js'
import { listEnabledIntelSourceIds } from '../websearch/websearch.service.js'

const DEFAULT_TIMEOUT_MS = 180_000
const MAX_TIMEOUT_MS = 600_000
const MAX_STDOUT_CHARS = 5_000_000
const MAX_STDERR_CHARS = 20_000

export type IntelCenterCollectionResult = {
  collectedAt: string
  skillId: 'intel-center'
  skillRoot: string
  scriptPath: string
  data: unknown
  diagnostics: {
    exitCode: number
    durationMs: number
    stderr: string
    stdoutChars: number
    stderrTruncated: boolean
  }
}

function normalizeTimeoutMs(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(value)))
}

function trimTail(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return {
    text: value.slice(-maxChars),
    truncated: true,
  }
}

function pythonCommand() {
  return process.platform === 'win32'
    ? { file: 'py', args: ['-3', 'scripts/intel.py'] }
    : { file: 'python3', args: ['scripts/intel.py'] }
}

function collectorBudgetSeconds(timeoutMs: number) {
  const reserveMs = 10_000
  return String(Math.max(1, Math.floor((timeoutMs - reserveMs) / 1000)))
}

async function resolveIntelCenterScript() {
  const skill = await readSkill('intel-center')
  const skillRoot = path.dirname(skill.path)
  const scriptPath = path.join(skillRoot, 'scripts', 'intel.py')
  const stat = await fs.stat(scriptPath).catch(() => null)
  if (!stat?.isFile()) {
    throw new HttpError(404, 'Intel Center script is missing: scripts/intel.py')
  }
  return { skillRoot, scriptPath }
}

export async function collectIntelCenterData(input: {
  timeoutMs?: unknown
} = {}): Promise<IntelCenterCollectionResult> {
  const { skillRoot, scriptPath } = await resolveIntelCenterScript()
  const enabledSourceIds = await listEnabledIntelSourceIds()
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs)
  const command = pythonCommand()
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn(command.file, command.args, {
      cwd: skillRoot,
      windowsHide: true,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        INTEL_CENTER_ENABLED_SOURCES: enabledSourceIds.join(','),
        INTEL_CENTER_SOURCE_REGISTRY: '1',
        INTEL_CENTER_TOTAL_BUDGET_SECONDS: collectorBudgetSeconds(timeoutMs),
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        TERM: 'dumb',
      },
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new HttpError(504, `Intel Center collection timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_STDOUT_CHARS && !settled) {
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        reject(new HttpError(500, 'Intel Center collection output is too large'))
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new HttpError(500, `Failed to start Intel Center collector: ${error.message}`))
    })

    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      const durationMs = Date.now() - startedAt
      const trimmedStderr = trimTail(stderr.trim(), MAX_STDERR_CHARS)
      if (exitCode !== 0) {
        reject(
          new HttpError(
            500,
            `Intel Center collection failed with exit code ${exitCode ?? 'unknown'}: ${
              trimmedStderr.text || 'no stderr'
            }`,
          ),
        )
        return
      }

      try {
        const data = JSON.parse(stdout) as unknown
        resolve({
          collectedAt: new Date().toISOString(),
          skillId: 'intel-center',
          skillRoot,
          scriptPath,
          data,
          diagnostics: {
            exitCode: exitCode ?? 0,
            durationMs,
            stderr: trimmedStderr.text,
            stdoutChars: stdout.length,
            stderrTruncated: trimmedStderr.truncated,
          },
        })
      } catch {
        reject(new HttpError(500, 'Intel Center collector did not return valid JSON'))
      }
    })
  })
}
