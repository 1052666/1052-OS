import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'

export type TerminalShell = 'powershell' | 'cmd'

export type TerminalRunInput = {
  command: string
  shell?: TerminalShell
  cwd?: string
  timeoutMs?: number
  confirmed?: boolean
  readonly?: boolean
}

export type TerminalRunResult = {
  shell: TerminalShell
  cwd: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutLines: number
  stderrLines: number
  durationMs: number
  timedOut: boolean
  interrupted: boolean
  truncated: boolean
  risk: TerminalRiskLevel
}

export type TerminalStatus = {
  shell: TerminalShell
  cwd: string
  running: boolean
  runningCommand: string | null
  startedAt: number | null
  pid: number | null
  lastExitCode: number | null
}

type TerminalRiskLevel = 'safe' | 'confirm'

type RunningCommand = {
  child: ReturnType<typeof spawn>
  command: string
  startedAt: number
  interrupted: boolean
}

type SessionState = {
  shell: TerminalShell
  cwd: string
  lastExitCode: number | null
  running: RunningCommand | null
}

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 30 * 60 * 1000
const MAX_CAPTURE_CHARS = 30_000

const sessions = new Map<TerminalShell, SessionState>()

const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^(dir|ls)(\s|$)/i,
  /^(pwd|cd)(\s*$)/i,
  /^(echo)(\s|$)/i,
  /^(where|where\.exe|which)(\s|$)/i,
  /^(rg|rg\.exe)(\s|$)/i,
  /^(git\s+(status|diff|log|branch|show))(\s|$)/i,
  /^(node|npm|pnpm|yarn)\s+(-v|--version)\s*$/i,
  /^(python|python3|py)\s+--version\s*$/i,
  /^(type)(\s|$)/i,
  /^(more)(\s|$)/i,
  /^(Get-ChildItem|Get-Location|Get-Content|Get-Date|Test-Path|Select-String)(\s|$)/i,
]

const READONLY_DENY_PATTERNS: RegExp[] = [
  /\b(Remove-Item|rm|del|erase|rmdir|rd)\b/i,
  /\b(Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Rename-Item)\b/i,
  /\b(Stop-Process|Start-Process|taskkill|sc|net\s+stop|net\s+start)\b/i,
  /\b(git\s+(add|commit|checkout|switch|reset|clean|merge|rebase|pull|push|tag|stash))(\s|$)/i,
  /\b(npm|pnpm|yarn)\s+(install|add|remove|uninstall|publish|run)\b/i,
  /\b(pip|uv)\s+(install|uninstall|sync)\b/i,
  /\b(Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b/i,
  /(^|[^<])>>?([^=]|$)/,
]

const READONLY_ALLOWED_COMMAND_PATTERNS: RegExp[] = [
  /^(dir|ls)(\s+[^;&|<>`\r\n]*)?$/i,
  /^(cat|type)(\s+[^;&|<>`\r\n]+)?$/i,
  /^(rg|rg\.exe)(\s+[^;&|<>`\r\n]+)?$/i,
  /^git\s+(status|diff|log|show)(\s+[^;&|<>`\r\n]*)?$/i,
]

function workspaceRoot() {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === 'backend' ? path.dirname(cwd) : cwd
}

function normalizeShell(value: unknown): TerminalShell {
  return value === 'cmd' ? 'cmd' : 'powershell'
}

function normalizeCommand(value: unknown) {
  const command = typeof value === 'string' ? value.trim() : ''
  if (!command) throw new HttpError(400, 'Terminal command cannot be empty')
  return command
}

function normalizeTimeout(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(value)))
}

async function normalizeCwd(value: unknown, fallback: string) {
  const cwd =
    typeof value === 'string' && value.trim()
      ? path.resolve(value.trim())
      : path.resolve(fallback)
  const stat = await fs.stat(cwd).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    throw new HttpError(400, `Terminal cwd does not exist or is not a directory: ${cwd}`)
  }
  return cwd
}

function getSession(shell: TerminalShell) {
  const existing = sessions.get(shell)
  if (existing) return existing

  const created: SessionState = {
    shell,
    cwd: workspaceRoot(),
    lastExitCode: null,
    running: null,
  }
  sessions.set(shell, created)
  return created
}

function countLines(text: string) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function truncateOutput(text: string) {
  if (text.length <= MAX_CAPTURE_CHARS) {
    return { text, truncated: false }
  }
  return {
    text: text.slice(0, MAX_CAPTURE_CHARS) + '\n...[output truncated]',
    truncated: true,
  }
}

function classifyCommand(command: string): TerminalRiskLevel {
  const normalized = command.trim()
  return SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized)) ? 'safe' : 'confirm'
}

function assertConfirmedForRisk(risk: TerminalRiskLevel, confirmed: unknown, command: string) {
  if (risk === 'safe') return
  if (confirmed === true) return
  throw new HttpError(
    400,
    `Terminal command requires explicit user confirmation before execution: ${command}`,
  )
}

function assertReadonlyCommand(command: string) {
  if (isReadonlyTerminalCommandAllowed(command)) return
  throw new HttpError(400, `Read-only terminal tool only allows ls/dir/cat/type/rg and git status/diff/log/show: ${command}`)
}

export function isReadonlyTerminalCommandAllowed(command: string) {
  const normalized = command.trim()
  if (!normalized) return false

  // This is the repo-pack safety boundary: readonly means a narrow allow-list,
  // not "anything except known writes". Full-access must not expand this tool.
  if (READONLY_DENY_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  return READONLY_ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

function buildSpawnArgs(shell: TerminalShell, command: string) {
  if (shell === 'cmd') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    }
  }

  const wrapped = [
    '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'if ($global:PSStyle -and (Get-Member -InputObject $global:PSStyle -Name OutputRendering -ErrorAction SilentlyContinue)) { $global:PSStyle.OutputRendering = "PlainText" }',
    command,
  ].join('; ')

  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
  }
}

async function killProcessTree(pid: number) {
  if (!Number.isFinite(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
}

export async function terminalRun(input: TerminalRunInput): Promise<TerminalRunResult> {
  const shell = normalizeShell(input.shell)
  const session = getSession(shell)
  const command = normalizeCommand(input.command)
  const cwd = await normalizeCwd(input.cwd, session.cwd)
  const timeoutMs = normalizeTimeout(input.timeoutMs)
  const risk = classifyCommand(command)

  if (input.readonly === true) {
    assertReadonlyCommand(command)
  }
  assertConfirmedForRisk(risk, input.confirmed, command)

  if (session.running) {
    throw new HttpError(
      409,
      `${shell} session already has a running command: ${session.running.command}`,
    )
  }

  const { file, args } = buildSpawnArgs(shell, command)
  const child = spawn(file, args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const startedAt = Date.now()
  session.running = {
    child,
    command,
    startedAt,
    interrupted: false,
  }

  let stdout = ''
  let stderr = ''
  let timedOut = false
  let interrupted = false

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    if (stdout.length < MAX_CAPTURE_CHARS + 4096) stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < MAX_CAPTURE_CHARS + 4096) stderr += chunk
  })

  const timeout = setTimeout(async () => {
    timedOut = true
    interrupted = true
    session.running && (session.running.interrupted = true)
    if (child.pid) await killProcessTree(child.pid)
  }, timeoutMs)

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => reject(error))
    child.once('exit', (code) => resolve(code))
  }).finally(() => {
    clearTimeout(timeout)
  })

  interrupted = interrupted || Boolean(session.running?.interrupted)
  session.running = null
  session.cwd = cwd
  session.lastExitCode = exitCode

  const stdoutResult = truncateOutput(stdout.trim())
  const stderrResult = truncateOutput(
    timedOut && !stderr.trim() ? 'Command execution timed out' : stderr.trim(),
  )

  return {
    shell,
    cwd,
    command,
    exitCode,
    stdout: stdoutResult.text,
    stderr: stderrResult.text,
    stdoutLines: countLines(stdout.trim()),
    stderrLines: countLines(stderr.trim()),
    durationMs: Date.now() - startedAt,
    timedOut,
    interrupted,
    truncated: stdoutResult.truncated || stderrResult.truncated,
    risk,
  }
}

export async function terminalInterrupt(shellInput?: unknown) {
  const shell = normalizeShell(shellInput)
  const session = getSession(shell)
  if (!session.running) {
    return {
      shell,
      interrupted: false,
      message: 'No running terminal command',
    }
  }

  session.running.interrupted = true
  const pid = session.running.child.pid
  if (pid) {
    await killProcessTree(pid)
  }

  return {
    shell,
    interrupted: true,
    message: `Interrupt requested for: ${session.running.command}`,
  }
}

export function terminalStatus(shellInput?: unknown): TerminalStatus | TerminalStatus[] {
  if (shellInput === 'powershell' || shellInput === 'cmd') {
    const session = getSession(shellInput)
    return {
      shell: session.shell,
      cwd: session.cwd,
      running: Boolean(session.running),
      runningCommand: session.running?.command ?? null,
      startedAt: session.running?.startedAt ?? null,
      pid: session.running?.child.pid ?? null,
      lastExitCode: session.lastExitCode,
    }
  }

  return (['powershell', 'cmd'] as const).map((shell) => {
    const session = getSession(shell)
    return {
      shell: session.shell,
      cwd: session.cwd,
      running: Boolean(session.running),
      runningCommand: session.running?.command ?? null,
      startedAt: session.running?.startedAt ?? null,
      pid: session.running?.child.pid ?? null,
      lastExitCode: session.lastExitCode,
    }
  })
}

export async function terminalSetCwd(pathInput: unknown, shellInput?: unknown) {
  const shell = normalizeShell(shellInput)
  const session = getSession(shell)
  const cwd = await normalizeCwd(pathInput, session.cwd)
  session.cwd = cwd
  return {
    shell,
    cwd,
  }
}
