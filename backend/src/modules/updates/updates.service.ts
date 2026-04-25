import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as unzipper from 'unzipper'
import { config } from '../../config.js'
import { httpError } from '../../http-error.js'
import type {
  GitHubCommitResponse,
  UpdateCommitInfo,
  UpdateInstallMode,
  UpdateRestartResponse,
  UpdateRun,
  UpdateStatus,
} from './updates.types.js'

const REPO_OWNER = '1052666'
const REPO_NAME = '1052-OS'
const REPO_BRANCH = 'main'
const GITHUB_API_COMMIT_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}`
const GITHUB_ZIP_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.zip`
const UPDATER_DIR = path.join(config.dataDir, 'updater')
const RUNS_DIR = path.join(UPDATER_DIR, 'runs')
const DOWNLOAD_DIR = path.join(UPDATER_DIR, 'downloads')
const EXTRACT_DIR = path.join(UPDATER_DIR, 'extract')
const BACKUP_DIR = path.join(config.dataDir, 'update-backups')
const LOG_DIR = path.join(config.dataDir, 'logs')
const STATE_FILE = path.join(UPDATER_DIR, 'state.json')
const INSTALL_BLOCKLIST = new Set([
  '.git',
  '.env',
  '.env.local',
  'AGENTS.md',
  'CHANGELOG.md',
  'data',
  'dist',
  'node_modules',
])
const PRESERVED_APP_CHILDREN = new Set([
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.production.local',
  'dist',
  'node_modules',
])
const LOG_TAIL_LIMIT = 12000

type StoredUpdateState = {
  installedCommit?: string
  installedAt?: string
  latest?: UpdateCommitInfo
  lastCheckedAt?: string
  mode?: UpdateInstallMode
}

type LocalSourceState = {
  mode: UpdateInstallMode
  commit: string
  branch: string
  source: 'git' | 'state' | 'unknown'
  dirty: boolean
  dirtyFiles: string[]
}

const runs = new Map<string, UpdateRun>()

export async function getUpdateStatus(refreshRemote = true): Promise<UpdateStatus> {
  const workspaceRoot = await resolveWorkspaceRoot()
  const state = await readStoredState()
  const local = await getLocalSourceState(workspaceRoot, state)
  const latest = refreshRemote ? await fetchLatestCommit() : state.latest ?? null
  const currentCommit = local.commit
  const warnings: string[] = []

  if (local.mode === 'git' && local.branch !== REPO_BRANCH) {
    warnings.push(`当前 Git 分支是 ${local.branch || '未知'}，自动更新仅支持 ${REPO_BRANCH}。`)
  }
  if (local.mode === 'git' && local.dirty) {
    warnings.push('当前 Git 工作区有未提交改动，自动更新前需要先处理这些改动。')
  }
  if (local.mode === 'archive' && !currentCommit) {
    warnings.push('当前运行目录不是 Git 仓库，首次会用源码包更新，更新后才会记录本地版本。')
  }

  const canInstall =
    local.mode === 'archive' || (!local.dirty && (!local.branch || local.branch === REPO_BRANCH))
  const updateAvailable = latest ? !currentCommit || latest.commit !== currentCommit : false
  const status: UpdateStatus = {
    workspaceRoot,
    dataDir: config.dataDir,
    mode: local.mode,
    current: {
      commit: currentCommit,
      shortCommit: currentCommit ? currentCommit.slice(0, 7) : '',
      branch: local.branch,
      source: local.source,
    },
    latest,
    updateAvailable,
    canInstall,
    dirty: local.dirty,
    dirtyFiles: local.dirtyFiles,
    warnings,
    lastCheckedAt: new Date().toISOString(),
  }

  await writeStoredState({
    ...state,
    latest: latest ?? state.latest,
    lastCheckedAt: status.lastCheckedAt,
    mode: local.mode,
  })
  return status
}

export async function startUpdateInstall(): Promise<UpdateRun> {
  const activeRun = [...runs.values()].find((run) => run.status === 'queued' || run.status === 'running')
  if (activeRun) {
    throw httpError(409, '已有更新任务正在执行，请等待当前任务结束。')
  }

  await fs.mkdir(LOG_DIR, { recursive: true })
  await fs.mkdir(RUNS_DIR, { recursive: true })

  const id = randomUUID()
  const run: UpdateRun = {
    id,
    status: 'queued',
    phase: 'queued',
    phaseLabel: '等待开始',
    progress: 0,
    message: '更新任务已创建。',
    logPath: path.join(LOG_DIR, `updater-${id}.log`),
    logTail: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    statusSnapshot: null,
  }
  runs.set(id, run)
  await persistRun(run)

  queueMicrotask(() => {
    void executeUpdate(run)
  })

  return cloneRun(run)
}

export async function getUpdateRun(id: string): Promise<UpdateRun> {
  const run = runs.get(id) ?? (await readRunFile(id))
  if (!run) throw httpError(404, '更新任务不存在。')
  return cloneRun(run)
}

export async function scheduleUpdateRestart(): Promise<UpdateRestartResponse> {
  const workspaceRoot = await resolveWorkspaceRoot()
  await fs.mkdir(UPDATER_DIR, { recursive: true })
  await fs.mkdir(LOG_DIR, { recursive: true })
  if (process.platform === 'win32') {
    return scheduleWindowsRestart(workspaceRoot)
  }
  return schedulePosixRestart(workspaceRoot)
}

async function executeUpdate(run: UpdateRun) {
  try {
    await setRun(run, {
      status: 'running',
      phase: 'preflight',
      phaseLabel: '检查版本',
      progress: 5,
      message: '正在检查本地状态和 GitHub 最新版本。',
    })

    const status = await getUpdateStatus(true)
    await setRun(run, { statusSnapshot: status })
    if (!status.latest) throw new Error('无法获取 GitHub 最新版本。')
    if (!status.canInstall) {
      throw new Error(status.warnings[0] ?? '当前环境暂不满足自动更新条件。')
    }
    if (!status.updateAvailable) {
      await setRun(run, {
        status: 'success',
        phase: 'complete',
        phaseLabel: '无需更新',
        progress: 100,
        message: '当前已经是最新版本。',
        finishedAt: new Date().toISOString(),
      })
      return
    }

    if (status.mode === 'git') {
      await installWithGit(run, status)
    } else {
      await installWithArchive(run, status)
    }

    const state = await readStoredState()
    await writeStoredState({
      ...state,
      installedCommit: status.latest.commit,
      installedAt: new Date().toISOString(),
      latest: status.latest,
      mode: status.mode,
    })

    await setRun(run, {
      phase: 'restart',
      phaseLabel: '重启服务',
      progress: 98,
      message: '更新已安装并完成构建，正在安排前后端服务重启。',
    })
    const restart = await scheduleUpdateRestart()
    await appendRunLog(run, `[restart] ${restart.message} script=${restart.scriptPath}${os.EOL}`)

    await setRun(run, {
      status: 'success',
      phase: 'complete',
      phaseLabel: '安装完成',
      progress: 100,
      message: restart.message,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendRunLog(run, `${os.EOL}[failed] ${message}${os.EOL}`)
    await setRun(run, {
      status: 'failed',
      phase: 'failed',
      phaseLabel: '更新失败',
      progress: Math.max(run.progress, 1),
      message,
      error: message,
      finishedAt: new Date().toISOString(),
    })
  }
}

async function installWithGit(run: UpdateRun, status: UpdateStatus) {
  const workspaceRoot = status.workspaceRoot
  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '拉取代码',
    progress: 15,
    message: '正在从 origin/main 拉取最新代码。',
  })
  await runLogged(run, 'git', ['fetch', 'origin', '--prune'], workspaceRoot, 28)
  await runLogged(run, 'git', ['pull', '--ff-only', 'origin', REPO_BRANCH], workspaceRoot, 45)
  await installDependenciesAndBuild(run, workspaceRoot)
}

async function installWithArchive(run: UpdateRun, status: UpdateStatus) {
  const workspaceRoot = status.workspaceRoot
  const zipPath = path.join(DOWNLOAD_DIR, `${REPO_NAME}-${Date.now()}.zip`)
  const extractTarget = path.join(EXTRACT_DIR, run.id)

  await fs.mkdir(DOWNLOAD_DIR, { recursive: true })
  await fs.rm(extractTarget, { recursive: true, force: true })
  await fs.mkdir(extractTarget, { recursive: true })

  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '下载更新',
    progress: 18,
    message: '正在下载 GitHub main 分支源码包。',
  })
  await downloadFile(GITHUB_ZIP_URL, zipPath, run)

  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '解压更新',
    progress: 35,
    message: '正在解压源码包。',
  })
  await createReadStream(zipPath).pipe(unzipper.Extract({ path: extractTarget })).promise()
  await appendRunLog(run, `[extract] ${zipPath} -> ${extractTarget}${os.EOL}`)

  const sourceRoot = await findExtractedRoot(extractTarget)
  const backupRoot = path.join(BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

  await setRun(run, {
    phase: 'backup',
    phaseLabel: '备份当前文件',
    progress: 45,
    message: '正在备份会被覆盖的项目文件。',
  })
  await backupInstallablePaths(sourceRoot, workspaceRoot, backupRoot, run)

  await setRun(run, {
    phase: 'apply',
    phaseLabel: '应用更新',
    progress: 55,
    message: '正在覆盖项目源码，运行时 data、日志、密钥和本地约定文件会保留。',
  })
  await applyInstallablePaths(sourceRoot, workspaceRoot, run)
  await installDependenciesAndBuild(run, workspaceRoot)
}

async function installDependenciesAndBuild(run: UpdateRun, workspaceRoot: string) {
  const packages = [
    { name: '后端', dir: path.join(workspaceRoot, 'backend'), installProgress: 66, buildProgress: 82 },
    { name: '前端', dir: path.join(workspaceRoot, 'frontend'), installProgress: 74, buildProgress: 94 },
  ]
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

  for (const pkg of packages) {
    if (!(await pathExists(path.join(pkg.dir, 'package.json')))) continue
    await setRun(run, {
      phase: 'dependencies',
      phaseLabel: `安装${pkg.name}依赖`,
      progress: pkg.installProgress,
      message: `正在安装${pkg.name}依赖。`,
    })
    await runLogged(run, npmCommand, ['install', '--no-audit', '--no-fund'], pkg.dir, pkg.installProgress)

    await setRun(run, {
      phase: 'build',
      phaseLabel: `构建${pkg.name}`,
      progress: pkg.buildProgress,
      message: `正在执行${pkg.name}构建检查。`,
    })
    await runLogged(run, npmCommand, ['run', 'build'], pkg.dir, pkg.buildProgress)
  }
}

async function downloadFile(url: string, target: string, run: UpdateRun) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/zip',
        'User-Agent': '1052-OS-Updater',
      },
    })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    let received = 0
    const progressStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength
        if (total > 0) {
          const pct = 18 + Math.min(14, Math.round((received / total) * 14))
          void setRun(run, {
            progress: pct,
            message: `正在下载更新：${formatBytes(received)} / ${formatBytes(total)}`,
          })
        }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), progressStream, createWriteStream(target))
    await appendRunLog(run, `[download] ${url} -> ${target} (${formatBytes(received)})${os.EOL}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendRunLog(run, `[download] node fetch failed, fallback to system downloader: ${message}${os.EOL}`)
    await downloadFileWithSystemTool(url, target, run)
  }
}

async function downloadFileWithSystemTool(url: string, target: string, run: UpdateRun) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await setRun(run, {
    progress: 32,
    message: 'Node 网络访问失败，正在使用系统下载器继续下载。',
  })
  if (process.platform === 'win32') {
    await runLogged(
      run,
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Invoke-WebRequest -UseBasicParsing -Uri '${escapePowerShell(url)}' -OutFile '${escapePowerShell(target)}'`,
      ],
      await resolveWorkspaceRoot(),
      34,
    )
    return
  }
  await runLogged(run, 'curl', ['-L', '--fail', '--output', target, url], await resolveWorkspaceRoot(), 34)
}

async function backupInstallablePaths(
  sourceRoot: string,
  workspaceRoot: string,
  backupRoot: string,
  run: UpdateRun,
) {
  const names = await listInstallableNames(sourceRoot)
  await fs.mkdir(backupRoot, { recursive: true })
  for (const name of names) {
    const target = path.join(workspaceRoot, name)
    if (!(await pathExists(target))) continue
    assertInsideRoot(workspaceRoot, target)
    await copyBackupEntry(target, path.join(backupRoot, name))
    await appendRunLog(run, `[backup] ${target} -> ${path.join(backupRoot, name)}${os.EOL}`)
  }
}

async function applyInstallablePaths(sourceRoot: string, workspaceRoot: string, run: UpdateRun) {
  const names = await listInstallableNames(sourceRoot)
  for (const name of names) {
    const source = path.join(sourceRoot, name)
    const target = path.join(workspaceRoot, name)
    assertInsideRoot(workspaceRoot, target)
    const stats = await fs.stat(source)
    if (stats.isDirectory()) {
      const preserve = name === 'backend' || name === 'frontend' ? PRESERVED_APP_CHILDREN : new Set<string>()
      await syncDirectory(source, target, preserve)
    } else if (stats.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
    }
    await appendRunLog(run, `[apply] ${source} -> ${target}${os.EOL}`)
  }
}

async function copyBackupEntry(source: string, target: string) {
  const stats = await fs.stat(source)
  if (stats.isDirectory()) {
    await fs.mkdir(target, { recursive: true })
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      if (PRESERVED_APP_CHILDREN.has(entry.name)) continue
      await copyBackupEntry(path.join(source, entry.name), path.join(target, entry.name))
    }
    return
  }
  if (stats.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(source, target)
  }
}

async function syncDirectory(source: string, target: string, preserve: Set<string>) {
  await fs.mkdir(target, { recursive: true })
  const sourceEntries = await fs.readdir(source, { withFileTypes: true })
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name))
  const targetEntries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])

  for (const entry of targetEntries) {
    if (preserve.has(entry.name) || sourceNames.has(entry.name)) continue
    await fs.rm(path.join(target, entry.name), { recursive: true, force: true })
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      await syncDirectory(sourcePath, targetPath, new Set())
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.copyFile(sourcePath, targetPath)
    }
  }
}

async function listInstallableNames(sourceRoot: string): Promise<string[]> {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true })
  return entries
    .filter((entry) => !INSTALL_BLOCKLIST.has(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name)
}

async function findExtractedRoot(extractTarget: string): Promise<string> {
  const entries = await fs.readdir(extractTarget, { withFileTypes: true })
  const root = entries.find((entry) => entry.isDirectory())
  if (!root) throw new Error('源码包解压后没有找到项目目录。')
  return path.join(extractTarget, root.name)
}

async function getLocalSourceState(
  workspaceRoot: string,
  state: StoredUpdateState,
): Promise<LocalSourceState> {
  if (await pathExists(path.join(workspaceRoot, '.git'))) {
    const commit = await runCapture('git', ['rev-parse', 'HEAD'], workspaceRoot).catch(() => '')
    const branch = await runCapture('git', ['branch', '--show-current'], workspaceRoot).catch(() => '')
    const status = await runCapture('git', ['status', '--porcelain'], workspaceRoot).catch(() => '')
    const dirtyFiles = status
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return {
      mode: 'git',
      commit: commit.trim(),
      branch: branch.trim(),
      source: 'git',
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
    }
  }

  return {
    mode: 'archive',
    commit: state.installedCommit ?? '',
    branch: '',
    source: state.installedCommit ? 'state' : 'unknown',
    dirty: false,
    dirtyFiles: [],
  }
}

async function fetchLatestCommit(): Promise<UpdateCommitInfo> {
  try {
    const response = await fetch(GITHUB_API_COMMIT_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': '1052-OS-Updater',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as GitHubCommitResponse
    const commit = data.sha
    if (!commit) throw new Error('GitHub 响应缺少 commit。')
    const message = data.commit?.message?.split(/\r?\n/)[0]?.trim() || 'No commit message'
    const date = data.commit?.committer?.date ?? data.commit?.author?.date ?? ''
    return {
      commit,
      shortCommit: commit.slice(0, 7),
      date,
      message,
      url: data.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit}`,
    }
  } catch {
    return fetchLatestCommitWithGit()
  }
}

async function fetchLatestCommitWithGit(): Promise<UpdateCommitInfo> {
  const output = await runCapture(
    'git',
    ['ls-remote', `https://github.com/${REPO_OWNER}/${REPO_NAME}.git`, `refs/heads/${REPO_BRANCH}`],
    await resolveWorkspaceRoot(),
  ).catch(() => '')
  const commit = output.split(/\s+/)[0]?.trim()
  if (!commit) throw new Error('检查更新失败：无法访问 GitHub，也无法通过 git ls-remote 获取最新提交。')
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    date: '',
    message: `${REPO_BRANCH} 分支最新提交`,
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit}`,
  }
}

async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd()
  if ((await pathExists(path.join(cwd, 'backend'))) && (await pathExists(path.join(cwd, 'frontend')))) {
    return cwd
  }
  const parent = path.dirname(cwd)
  if (
    path.basename(cwd).toLowerCase() === 'backend' &&
    (await pathExists(path.join(parent, 'frontend')))
  ) {
    return parent
  }
  const grandParent = path.dirname(parent)
  if (
    path.basename(cwd).toLowerCase() === 'dist' &&
    path.basename(parent).toLowerCase() === 'backend' &&
    (await pathExists(path.join(grandParent, 'frontend')))
  ) {
    return grandParent
  }
  return cwd
}

function assertInsideRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`更新目标越过项目根目录：${resolvedTarget}`)
  }
}

async function runLogged(
  run: UpdateRun,
  command: string,
  args: string[],
  cwd: string,
  progressAfterSuccess: number,
) {
  await appendRunLog(run, `${os.EOL}$ ${command} ${args.join(' ')}${os.EOL}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    })
    child.stdout.on('data', (chunk: Buffer) => {
      void appendRunLog(run, chunk.toString('utf-8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      void appendRunLog(run, chunk.toString('utf-8'))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        void setRun(run, { progress: progressAfterSuccess })
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}`))
      }
    })
  })
}

async function runCapture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false })
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf-8').trim()
      if (code === 0) resolve(output)
      else reject(new Error(output || `${command} ${args.join(' ')} failed`))
    })
  })
}

async function setRun(run: UpdateRun, patch: Partial<UpdateRun>) {
  Object.assign(run, patch)
  runs.set(run.id, run)
  await persistRun(run)
}

async function appendRunLog(run: UpdateRun, text: string) {
  run.logTail = trimLogTail(run.logTail + text)
  runs.set(run.id, run)
  await fs.mkdir(path.dirname(run.logPath), { recursive: true })
  await fs.appendFile(run.logPath, text, 'utf-8').catch(() => undefined)
  await persistRun(run)
}

function trimLogTail(text: string): string {
  if (text.length <= LOG_TAIL_LIMIT) return text
  return text.slice(text.length - LOG_TAIL_LIMIT)
}

async function persistRun(run: UpdateRun) {
  await fs.mkdir(RUNS_DIR, { recursive: true })
  await fs.writeFile(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8')
}

async function readRunFile(id: string): Promise<UpdateRun | null> {
  const file = path.join(RUNS_DIR, `${id}.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as UpdateRun
  } catch {
    return null
  }
}

function cloneRun(run: UpdateRun): UpdateRun {
  return JSON.parse(JSON.stringify(run)) as UpdateRun
}

async function readStoredState(): Promise<StoredUpdateState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf-8')) as StoredUpdateState
  } catch {
    return {}
  }
}

async function writeStoredState(state: StoredUpdateState) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function scheduleWindowsRestart(workspaceRoot: string): Promise<UpdateRestartResponse> {
  const scriptPath = path.join(UPDATER_DIR, `restart-${Date.now()}.ps1`)
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Milliseconds 900
$root = '${escapePowerShell(workspaceRoot)}'
$logDir = '${escapePowerShell(LOG_DIR)}'
New-Item -ItemType Directory -Force $logDir | Out-Null
$ports = @(10052, 10053)
$portPids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $portPids) {
  if ($processId -and $processId -ne $PID) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}
$escapedRoot = [regex]::Escape($root)
$projectProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and
  $_.CommandLine -match $escapedRoot -and
  $_.CommandLine -match '(npm|vite|tsx|node)'
}
foreach ($proc in $projectProcesses) {
  if ($proc.ProcessId -and $proc.ProcessId -ne $PID) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 600
Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'backend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'backend-dev.err.log')
Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'frontend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'frontend-dev.err.log')
`
  await fs.writeFile(scriptPath, script.trimStart(), 'utf-8')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
  return {
    scheduled: true,
    message: '已安排重启前后端服务，请稍后刷新页面。',
    scriptPath,
  }
}

async function schedulePosixRestart(workspaceRoot: string): Promise<UpdateRestartResponse> {
  const scriptPath = path.join(UPDATER_DIR, `restart-${Date.now()}.sh`)
  const script = `#!/bin/sh
set +e
sleep 1
root='${escapeSingleQuote(workspaceRoot)}'
logDir='${escapeSingleQuote(LOG_DIR)}'
mkdir -p "$logDir"
if command -v lsof >/dev/null 2>&1; then
  for port in 10052 10053; do
    pids=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null)
    if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null; fi
  done
fi
if command -v pkill >/dev/null 2>&1; then
  pkill -f "$root.*\\(npm run dev\\|vite\\|tsx watch\\|node\\)" 2>/dev/null
fi
(cd "$root/backend" && nohup npm run dev > "$logDir/backend-dev.out.log" 2> "$logDir/backend-dev.err.log" &)
(cd "$root/frontend" && nohup npm run dev > "$logDir/frontend-dev.out.log" 2> "$logDir/frontend-dev.err.log" &)
`
  await fs.writeFile(scriptPath, script, 'utf-8')
  await fs.chmod(scriptPath, 0o755).catch(() => undefined)
  const child = spawn('sh', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  return {
    scheduled: true,
    message: '已安排重启前后端服务，请稍后刷新页面。',
    scriptPath,
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''")
}
