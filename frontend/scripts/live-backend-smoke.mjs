import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveChromiumExecutablePath } from './browser-executable.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const rootDir = path.resolve(frontendDir, '..')
const backendDir = path.join(rootDir, 'backend')
const outputDir = path.join(frontendDir, 'test-results', 'live-backend-smoke')
const executablePath = resolveChromiumExecutablePath()

const readOnlyApiChecks = [
  '/api/health',
  '/api/settings',
  '/api/agent/history',
  '/api/calendar/events',
  '/api/calendar/tasks',
  '/api/notifications',
  '/api/notifications/unread-count',
  '/api/memory/summary',
  '/api/resources',
  '/api/wiki/summary',
  '/api/wiki/pages',
  '/api/pkm/summary',
  '/api/output-profiles',
  '/api/appearance/themes',
  '/api/updates/status',
  '/api/websearch/engines',
  '/api/skills',
  '/api/sql/datasources',
  '/api/sql/files',
  '/api/sql/variables',
  '/api/sql/servers',
  '/api/sql/shell-files',
  '/api/orchestration',
  '/api/uapis/catalog',
  '/api/channels/wechat/status',
  '/api/channels/wechat/accounts',
  '/api/channels/feishu/status',
  '/api/channels/feishu/workspace',
  '/api/channels/wecom/status',
  '/api/channels/wecom/webhooks',
]

const pages = [
  { route: '/today', waitFor: 'h1' },
  { route: '/chat', waitFor: 'textarea' },
  { route: '/workspace/sql', waitFor: 'h1' },
  { route: '/knowledge/resources', waitFor: 'h1' },
  { route: '/automations/tasks', waitFor: 'h1' },
  { route: '/capabilities/skills', waitFor: 'h1' },
  { route: '/settings/models', waitFor: 'h1' },
]

function backendCommand() {
  return {
    command: process.execPath,
    args: [path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'],
  }
}

function frontendCommand(port) {
  return {
    command: process.execPath,
    args: [path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
    server.on('error', reject)
  })
}

async function waitForUrl(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not become ready: ${lastError}`)
}

function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

async function safeRemoveTempDir(target) {
  const resolved = path.resolve(target)
  const tmp = path.resolve(os.tmpdir())
  if (resolved.startsWith(tmp + path.sep)) await fs.rm(resolved, { recursive: true, force: true })
}

function captureLogs(child, label) {
  const lines = []
  const push = (chunk) => {
    const text = chunk.toString()
    lines.push(text)
    if (lines.join('').length > 24_000) lines.splice(0, Math.max(1, Math.floor(lines.length / 3)))
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
  child.on('exit', (code) => {
    if (code && code !== 0) lines.push(`\n[${label}] exited with ${code}\n`)
  })
  return () => lines.join('')
}

async function checkReadOnlyApi(baseUrl) {
  const failures = []
  for (const route of readOnlyApiChecks) {
    const response = await fetch(baseUrl + route)
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      failures.push(`${route}: ${response.status} ${text.slice(0, 240)}`)
      continue
    }
    if (!contentType.includes('application/json')) failures.push(`${route}: expected JSON, got ${contentType || 'unknown content-type'}`)
  }
  return failures
}

async function runFrontendPages(frontendUrl) {
  const browser = await chromium.launch({ executablePath, headless: true })
  const failures = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    for (const item of pages) {
      try {
        await page.goto(frontendUrl + item.route, { waitUntil: 'domcontentloaded', timeout: 35_000 })
        await page.locator(item.waitFor).first().waitFor({ state: 'visible', timeout: 20_000 })
        await page.waitForTimeout(500)
        await page.screenshot({
          path: path.join(outputDir, `${item.route.replace(/\W+/g, '-').replace(/^-|-$/g, '')}.png`),
          fullPage: false,
        })
      } catch (error) {
        failures.push(`${item.route}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
    await context.close()
  } finally {
    await browser.close()
  }
  return failures
}

await fs.mkdir(outputDir, { recursive: true })
const backendPort = await getFreePort()
const frontendPort = await getFreePort()
const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-live-backend-smoke-'))
const backendUrl = `http://127.0.0.1:${backendPort}`
const frontendUrl = `http://127.0.0.1:${frontendPort}`

let backend
let frontend
try {
  const backendLaunch = backendCommand()
  backend = spawn(backendLaunch.command, backendLaunch.args, {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(backendPort),
      DATA_DIR: tempDataDir,
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const backendLogs = captureLogs(backend, 'backend')
  await waitForUrl(`${backendUrl}/api/health`, 60_000).catch((error) => {
    throw new Error(`${error.message}\n${backendLogs()}`)
  })

  const apiFailures = await checkReadOnlyApi(backendUrl)
  if (apiFailures.length) throw new Error(`read-only API checks failed:\n${apiFailures.join('\n')}\n${backendLogs()}`)

  const frontendLaunch = frontendCommand(frontendPort)
  frontend = spawn(frontendLaunch.command, frontendLaunch.args, {
    cwd: frontendDir,
    env: {
      ...process.env,
      BACKEND_URL: backendUrl,
      BROWSER: 'none',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const frontendLogs = captureLogs(frontend, 'frontend')
  await waitForUrl(frontendUrl, 60_000).catch((error) => {
    throw new Error(`${error.message}\n${frontendLogs()}`)
  })

  const pageFailures = await runFrontendPages(frontendUrl)
  if (pageFailures.length) throw new Error(`frontend page checks failed:\n${pageFailures.join('\n')}\n${frontendLogs()}`)

  console.log(`live backend smoke passed; dataDir=${tempDataDir}; screenshots=${outputDir}`)
} finally {
  stopProcessTree(frontend)
  stopProcessTree(backend)
  await safeRemoveTempDir(tempDataDir)
}
