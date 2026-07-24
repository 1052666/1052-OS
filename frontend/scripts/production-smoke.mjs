import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveChromiumExecutablePath } from './browser-executable.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const rootDir = path.resolve(frontendDir, '..')
const backendDir = path.join(rootDir, 'backend')
const frontendDistDir = path.join(frontendDir, 'dist')
const outputDir = path.join(frontendDir, 'test-results', 'production-smoke')
const executablePath = resolveChromiumExecutablePath()

const pages = [
  '/today',
  '/chat',
  '/workspace/sql',
  '/knowledge/resources',
  '/automations/orchestrations',
  '/capabilities/skills',
  '/settings/models',
]

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
])

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

function captureLogs(child, label) {
  const lines = []
  const push = (chunk) => {
    lines.push(chunk.toString())
    if (lines.join('').length > 24_000) lines.splice(0, Math.max(1, Math.floor(lines.length / 3)))
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
  child.on('exit', (code) => {
    if (code && code !== 0) lines.push(`\n[${label}] exited with ${code}\n`)
  })
  return () => lines.join('')
}

function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

async function safeRemoveTempDir(target) {
  const resolved = path.resolve(target)
  const tmp = path.resolve(os.tmpdir())
  if (resolved.startsWith(tmp + path.sep)) await fsp.rm(resolved, { recursive: true, force: true })
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

async function buildBackend() {
  const tsc = path.join(backendDir, 'node_modules', 'typescript', 'bin', 'tsc')
  const result = spawnSync(process.execPath, [tsc], { cwd: backendDir, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`backend production build failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  return req
}

function proxyHeaders(req, backendUrl) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['host', 'connection'].includes(key.toLowerCase())) continue
    if (Array.isArray(value)) headers.set(key, value.join(', '))
    else headers.set(key, value)
  }
  headers.set('host', new URL(backendUrl).host)
  return headers
}

async function proxyApi(req, res, backendUrl) {
  try {
    const upstream = await fetch(`${backendUrl}${req.url}`, {
      method: req.method,
      headers: proxyHeaders(req, backendUrl),
      body: requestBody(req),
      duplex: 'half',
    })
    const headers = Object.fromEntries(upstream.headers.entries())
    res.writeHead(upstream.status, headers)
    if (req.method === 'HEAD' || !upstream.body) {
      res.end()
      return
    }
    const stream = Readable.fromWeb(upstream.body)
    stream.on('error', () => {
      if (!res.destroyed) res.destroy()
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy failed' }))
  }
}

function safeStaticPath(requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const pathname = decodeURIComponent(url.pathname)
  const target = path.resolve(frontendDistDir, `.${pathname}`)
  const root = path.resolve(frontendDistDir)
  if (target !== root && !target.startsWith(root + path.sep)) return null
  return target
}

async function serveStatic(req, res) {
  const target = safeStaticPath(req.url ?? '/')
  if (!target) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  const filePath = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(frontendDistDir, 'index.html')
  const ext = path.extname(filePath)
  const contentType = mimeTypes.get(ext) ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': contentType })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath).pipe(res)
}

function startProductionStaticServer(backendUrl) {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api')) void proxyApi(req, res, backendUrl)
    else void serveStatic(req, res)
  })
  return server
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()))
}

async function checkPages(frontendUrl) {
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
    for (const route of pages) {
      try {
        await page.goto(frontendUrl + route, { waitUntil: 'domcontentloaded', timeout: 35_000 })
        await page.locator(route === '/chat' ? 'textarea' : 'h1').first().waitFor({ state: 'visible', timeout: 20_000 })
        await page.waitForTimeout(500)
        await page.screenshot({
          path: path.join(outputDir, `${route.replace(/\W+/g, '-').replace(/^-|-$/g, '')}.png`),
          fullPage: false,
        })
      } catch (error) {
        failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
    await context.close()
  } finally {
    await browser.close()
  }
  return failures
}

await fsp.mkdir(outputDir, { recursive: true })
if (!fs.existsSync(path.join(frontendDistDir, 'index.html'))) {
  throw new Error('frontend/dist/index.html is missing; run npm run build before production smoke')
}

const backendPort = await getFreePort()
const frontendPort = await getFreePort()
const tempDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), '1052-production-smoke-'))
const backendUrl = `http://127.0.0.1:${backendPort}`
const frontendUrl = `http://127.0.0.1:${frontendPort}`
let backend
let frontendServer

try {
  await buildBackend()
  backend = spawn(process.execPath, [path.join(backendDir, 'dist', 'index.js')], {
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

  frontendServer = startProductionStaticServer(backendUrl)
  await listen(frontendServer, frontendPort)
  await waitForUrl(`${frontendUrl}/api/health`, 15_000)
  await waitForUrl(`${frontendUrl}/workspace/sql`, 15_000)

  const failures = await checkPages(frontendUrl)
  if (failures.length) throw new Error(`production page checks failed:\n${failures.join('\n')}`)

  console.log(`production smoke passed; dataDir=${tempDataDir}; frontend=${frontendUrl}; screenshots=${outputDir}`)
} finally {
  if (frontendServer) await closeServer(frontendServer).catch(() => undefined)
  stopProcessTree(backend)
  await safeRemoveTempDir(tempDataDir)
}
