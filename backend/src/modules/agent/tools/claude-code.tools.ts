import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '../agent.tool.types.js'

type ClaudeCodeArgs = {
  prompt: string
  sessionId?: string
  newSession?: boolean
  cwd?: string
  model?: string
  maxBudgetUsd?: number
  systemPrompt?: string
}

type ClaudeCodeJsonOutput = {
  session_id: string
  result: string
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  is_error?: boolean
}

const MAX_CAPTURE_CHARS = 60_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const SESSION_EXPIRY_MS = 30 * 60 * 1000

type SessionEntry = {
  sessionId: string
  updatedAt: number
}

// cwd -> latest session, survives conversation compaction
const activeSessions = new Map<string, SessionEntry>()

function getActiveSession(cwd: string): string | undefined {
  const entry = activeSessions.get(cwd)
  if (!entry) return undefined
  if (Date.now() - entry.updatedAt > SESSION_EXPIRY_MS) {
    activeSessions.delete(cwd)
    return undefined
  }
  return entry.sessionId
}

function setActiveSession(cwd: string, sessionId: string) {
  activeSessions.set(cwd, { sessionId, updatedAt: Date.now() })
}

function buildSpawnArgs(sessionId: string | undefined, args: ClaudeCodeArgs) {
  const spawnArgs: string[] = ['-p']

  if (sessionId) {
    spawnArgs.push('--resume', sessionId)
  }
  if (args.model) {
    spawnArgs.push('--model', args.model)
  }
  if (args.maxBudgetUsd != null && args.maxBudgetUsd > 0) {
    spawnArgs.push('--max-budget-usd', String(args.maxBudgetUsd))
  }
  if (args.systemPrompt) {
    spawnArgs.push('--system-prompt', args.systemPrompt)
  }

  spawnArgs.push('--output-format', 'json')
  spawnArgs.push('--dangerously-skip-permissions')

  return spawnArgs
}

function truncate(text: string): string {
  if (text.length <= MAX_CAPTURE_CHARS) return text
  return text.slice(0, MAX_CAPTURE_CHARS) + '\n...[output truncated]'
}

async function resolveCwd(cwd?: string): Promise<string> {
  if (cwd?.trim()) {
    const resolved = path.resolve(cwd.trim())
    const stat = await fs.stat(resolved).catch(() => null)
    if (stat?.isDirectory()) return resolved
  }
  const base = process.cwd()
  return path.basename(base).toLowerCase() === 'backend' ? path.dirname(base) : base
}

export const claudeCodeTools: AgentTool[] = [
  {
    name: 'claude_code',
    description:
      'Invoke Claude Code CLI for coding tasks with multi-turn session support. ' +
      'Session management is automatic: by default the tool continues the last session for the given cwd, ' +
      'so you do NOT need to remember or pass sessionId yourself. ' +
      'Set newSession=true only when starting a completely new task that needs a fresh context.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task or question to send to Claude Code.',
        },
        newSession: {
          type: 'boolean',
          description:
            'Set to true to start a fresh session, discarding any previous context. Default is false (auto-resume last session).',
        },
        sessionId: {
          type: 'string',
          description:
            'Explicit session ID to resume. Rarely needed — prefer relying on auto-resume or newSession.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for Claude Code to operate in.',
        },
        model: {
          type: 'string',
          description:
            'Model to use (e.g. "sonnet", "opus", "claude-sonnet-4-6"). Defaults to Claude Code\'s default model.',
        },
        maxBudgetUsd: {
          type: 'number',
          description:
            'Maximum dollar amount to spend on this call. Default is Claude Code\'s default limit.',
        },
        systemPrompt: {
          type: 'string',
          description: 'Custom system prompt to append for this session.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    execute: async (rawArgs) => {
      const args = rawArgs as ClaudeCodeArgs
      if (!args.prompt?.trim()) {
        throw new Error('claude_code: prompt is required')
      }

      const cwd = await resolveCwd(args.cwd)

      // Determine session: explicit > auto-resume > new
      let sessionId: string | undefined
      if (args.sessionId) {
        sessionId = args.sessionId
      } else if (!args.newSession) {
        sessionId = getActiveSession(cwd)
      }

      const spawnArgs = buildSpawnArgs(sessionId, args)
      const resuming = sessionId ? `resuming ${sessionId.slice(0, 8)}...` : 'new session'
      console.log(`[claude_code] spawning claude (${resuming}) cwd=${cwd}`)

      const child = spawn('claude', spawnArgs, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      child.stdin.write(args.prompt)
      child.stdin.end()

      const startedAt = Date.now()
      let stdout = ''
      let stderr = ''
      let timedOut = false

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < MAX_CAPTURE_CHARS + 4096) stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < MAX_CAPTURE_CHARS + 4096) stderr += chunk
      })

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
        }, 5000)
      }, DEFAULT_TIMEOUT_MS)

      let exitCode: number | null
      try {
        exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once('error', (err) => reject(err))
          child.once('exit', (code) => resolve(code))
        })
      } catch (err) {
        clearTimeout(timeout)
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`claude_code: Failed to start Claude Code CLI: ${message}. Make sure "claude" is installed and in PATH.`)
      } finally {
        clearTimeout(timeout)
      }

      const durationMs = Date.now() - startedAt

      if (timedOut) {
        throw new Error(`claude_code: Timed out after ${Math.round(durationMs / 1000)}s. stdout: ${truncate(stdout.trim())}`)
      }

      if (exitCode !== 0) {
        const errorDetail = truncate(stderr.trim() || stdout.trim()) || `exit code ${exitCode}`
        throw new Error(`claude_code: Claude Code failed (exit ${exitCode}): ${errorDetail}`)
      }

      let parsed: ClaudeCodeJsonOutput
      try {
        parsed = JSON.parse(stdout.trim()) as ClaudeCodeJsonOutput
      } catch {
        throw new Error(`claude_code: Failed to parse Claude Code output as JSON. Raw output: ${truncate(stdout.trim())}`)
      }

      if (parsed.is_error) {
        throw new Error(`claude_code: Claude Code returned error: ${truncate(parsed.result)}`)
      }

      setActiveSession(cwd, parsed.session_id)
      console.log(`[claude_code] completed in ${durationMs}ms, session=${parsed.session_id}`)

      return {
        sessionId: parsed.session_id,
        resumed: Boolean(sessionId),
        result: parsed.result,
        costUsd: parsed.total_cost_usd,
        durationMs: parsed.duration_ms ?? durationMs,
        numTurns: parsed.num_turns,
      }
    },
  },
]
