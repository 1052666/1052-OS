import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveChromiumExecutablePath } from './browser-executable.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(frontendDir, '..')
const outputDir = path.join(repoRoot, 'assets', 'readme')
const baseUrl = process.env.PW_BASE_URL ?? 'http://127.0.0.1:10052'
const executablePath = resolveChromiumExecutablePath()

const now = Date.now()
const today = new Date().toISOString().slice(0, 10)

const settings = {
  llm: {
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'gpt-5-local',
    kind: 'local',
    provider: 'local',
    apiFormat: 'openai-compatible',
    activeProfileId: 'local-main',
    profiles: [{
      id: 'local-main',
      name: '本地主模型',
      kind: 'local',
      provider: 'local',
      apiFormat: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      modelId: 'gpt-5-local',
      enabled: true,
      hasApiKey: true,
      apiKeyMask: 'sk-***',
    }],
    taskRoutes: [],
    hasApiKey: true,
    apiKeyMask: 'sk-***',
  },
  appearance: { theme: 'dark', language: 'zh-CN', reduceMotion: false },
  agent: {
    streaming: true,
    userPrompt: '',
    permissionProfile: 'default',
    contextMessageLimit: 24,
    progressiveDisclosureEnabled: true,
    providerCachingEnabled: true,
    checkpointEnabled: true,
    seedOnResumeEnabled: true,
    upgradeDebugEventsEnabled: false,
    autoCompactEnabled: true,
    autoCompactThreshold: 80_000,
    morningBrief: { enabled: true, time: '08:30' },
  },
  imageGeneration: {},
  ocr: { provider: 'uapis' },
  uapis: { hasApiKey: false, apiKeyMode: 'free-ip-quota' },
}

const themeProfile = {
  id: 'builtin-obsidian',
  source: 'builtin',
  createdAt: now - 86400_000,
  updatedAt: now,
  theme: {
    schemaVersion: 1,
    name: '曜石深色',
    mode: 'dark',
    scope: 'all',
    safetyLevel: 'safe',
    coreTokens: {
      bg: '#080b0e',
      surface: '#10171b',
      fg: '#eef5f7',
      accent: '#26d9d0',
      success: '#4ade80',
      danger: '#ff6b6b',
    },
    tokens: {},
  },
  review: { passed: true, safetyLevel: 'safe', blockingIssues: [], warnings: [] },
}

const sampleEvents = [
  { id: 'event-1', title: '晨间简报与任务确认', date: today, startTime: '09:00', endTime: '09:30', location: '本地工作区', notes: '整理优先级', createdAt: now, updatedAt: now },
  { id: 'event-2', title: '知识库清理窗口', date: today, startTime: '14:00', endTime: '15:00', location: '1052 OS', notes: '归档本周资料', createdAt: now, updatedAt: now },
]

const sampleTasks = [
  {
    id: 'task-1',
    title: '每日工作摘要',
    notes: '汇总日程、通知和未完成任务',
    target: 'agent',
    mode: 'recurring',
    startDate: today,
    time: '08:30',
    timezone: 'Asia/Hong_Kong',
    repeatUnit: 'day',
    repeatInterval: 1,
    repeatWeekdays: [],
    endDate: '',
    prompt: '生成今日简报',
    command: '',
    shell: 'powershell',
    delivery: {},
    enabled: true,
    nextRunAt: now + 3600_000,
    lastRunAt: now - 86400_000,
    lastRunStatus: 'success',
    lastRunSummary: '已生成昨日总结',
    createdAt: now - 7 * 86400_000,
    updatedAt: now,
  },
  {
    id: 'task-2',
    title: '知识索引重建',
    notes: '低峰时段刷新 Wiki 与资源索引',
    target: 'agent',
    mode: 'once',
    startDate: today,
    time: '21:00',
    timezone: 'Asia/Hong_Kong',
    repeatUnit: '',
    repeatInterval: 1,
    repeatWeekdays: [],
    endDate: '',
    prompt: '重建知识索引并输出异常',
    command: '',
    shell: 'powershell',
    delivery: {},
    enabled: true,
    nextRunAt: now + 8 * 3600_000,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSummary: '',
    createdAt: now - 86400_000,
    updatedAt: now,
  },
]

const sampleNotifications = [
  { id: 'n-1', title: 'Runtime 已完成上下文升级', message: '为当前对话挂载了 3 个知识包。', level: 'success', read: false, createdAt: now - 900_000, source: 'runtime' },
  { id: 'n-2', title: '自动化任务待确认', message: '每日工作摘要将在 08:30 运行。', level: 'warning', read: false, createdAt: now - 1800_000, source: 'calendar', taskId: 'task-1' },
  { id: 'n-3', title: '知识库已同步', message: '新增 12 条资源索引。', level: 'info', read: true, createdAt: now - 3600_000, source: 'knowledge' },
]

const sampleMemory = [
  { id: 'm-1', category: 'project', title: '1052 OS 前端重写', content: '新版采用今日控制台、运行检查器和分区工作流。', tags: ['frontend', 'runtime'], scope: 'local', priority: 'high', source: 'agent', confidence: 'confirmed', active: true, createdAt: now - 2 * 86400_000, updatedAt: now },
  { id: 'm-2', category: 'preference', title: '本地优先', content: '用户资产保留在 data/，前端只消费后端 API。', tags: ['privacy'], scope: 'local', priority: 'normal', source: 'settings', confidence: 'confirmed', active: true, createdAt: now - 5 * 86400_000, updatedAt: now },
]

const chatHistory = {
  messages: [
    { id: 1, ts: now - 120_000, role: 'user', content: '把今天的工作、知识库和自动化运行状态整理成一个行动清单。' },
    {
      id: 2,
      ts: now - 90_000,
      role: 'assistant',
      content: '### 今日行动清单\n\n1. 检查 2 个待确认通知。\n2. 运行知识索引重建前先查看最近失败日志。\n3. 将 Runtime Loop 里的工具调用折叠为运行轨迹，必要时打开右侧检查器查看参数。\n\n当前没有阻塞项，可以从今日控制台继续。',
      usage: { inputTokens: 916, outputTokens: 284, totalTokens: 1200 },
    },
  ],
}

const datasource = { id: 'ds-1', name: '本地 SQLite', type: 'sqlite', host: '', port: 0, user: '', database: '1052', filePath: 'data/local.db' }
const workflow = {
  id: 'workflow-1',
  name: '资料整理流水线',
  description: '抓取资源、写入知识库并生成运行摘要。',
  nodes: [
    { id: 'node-load', name: '读取资源', type: 'load', enabled: true, position: { x: 80, y: 120 } },
    { id: 'node-sql', name: '写入索引', type: 'sql', enabled: true, position: { x: 330, y: 120 } },
    { id: 'node-shell', name: '刷新缓存', type: 'shell', enabled: true, position: { x: 580, y: 120 } },
    { id: 'node-debug', name: '输出摘要', type: 'debug', enabled: true, position: { x: 830, y: 120 } },
  ],
  edges: [
    { id: 'e1', source: 'node-load', target: 'node-sql' },
    { id: 'e2', source: 'node-sql', target: 'node-shell' },
    { id: 'e3', source: 'node-shell', target: 'node-debug' },
  ],
  createdAt: now - 3 * 86400_000,
  updatedAt: now,
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
}

function sse(route, events) {
  return route.fulfill({
    status: 200,
    headers: {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream; charset=utf-8',
    },
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  })
}

async function installApiMocks(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const apiPath = url.pathname.replace(/^\/api/, '')
    const method = request.method()

    if (apiPath === '/agent/history/events') return sse(route, [{ type: 'connected' }])
    if (apiPath === '/agent/history') return json(route, chatHistory)
    if (apiPath === '/settings') return json(route, settings)
    if (apiPath === '/appearance/themes') {
      return json(route, { schemaVersion: 1, activeProfileId: themeProfile.id, activeProfile: themeProfile, applyHistory: [], profiles: [themeProfile] })
    }
    if (apiPath === '/calendar/events') return json(route, sampleEvents)
    if (apiPath === '/calendar/tasks') return json(route, sampleTasks)
    if (apiPath === '/calendar/task-runs') return json(route, [{ id: 'run-1', title: '每日工作摘要', status: 'success', startedAt: now - 3600_000, summary: '已生成今日简报' }])
    if (apiPath === '/notifications') return json(route, sampleNotifications)
    if (apiPath === '/notifications/unread-count') return json(route, { unread: 2 })
    if (apiPath === '/memory/summary') return json(route, { counts: { confirmed: 2, active: 2, suggestions: 1, secure: 0, highPriority: 1 }, recent: sampleMemory, secure: [] })
    if (apiPath === '/sql/datasources') return json(route, [datasource])
    if (apiPath === '/sql/files') return json(route, [{ id: 'sql-1', name: '今日任务统计.sql', datasourceId: datasource.id, content: 'select status, count(*) as total from tasks group by status;', updatedAt: now }])
    if (apiPath === '/sql/query' && method === 'POST') return json(route, { columns: ['status', 'total'], rows: [{ status: 'ready', total: 12 }, { status: 'pending', total: 2 }], rowCount: 2, truncated: false })
    if (apiPath === '/sql/variables') return json(route, [])
    if (apiPath === '/sql/servers') return json(route, [])
    if (apiPath === '/sql/shell-files') return json(route, [])
    if (apiPath === '/orchestration') return json(route, [workflow])
    if (/^\/orchestration\/[^/]+\/active$/.test(apiPath)) return json(route, { active: false })
    if (/^\/orchestration\/[^/]+\/logs$/.test(apiPath)) {
      return json(route, [
        { id: 'log-1', timestamp: now - 180_000, status: 'success', nodeName: '读取资源', message: '载入 24 条资源' },
        { id: 'log-2', timestamp: now - 120_000, status: 'success', nodeName: '写入索引', message: '索引刷新完成' },
      ])
    }
    if (apiPath === '/health') return json(route, { ok: true, ts: now })
    if (apiPath === '/updates/status') {
      return json(route, { mode: 'git', current: { shortCommit: 'local' }, latest: null, updateAvailable: false, canInstall: false, dirty: false, dirtyFiles: [], warnings: [], lastCheckedAt: new Date(now).toISOString() })
    }

    return json(route, {})
  })
}

async function serverReady() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const response = await fetch(baseUrl, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await serverReady()) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`frontend dev server did not become ready at ${baseUrl}`)
}

async function ensureServer() {
  if (await serverReady()) return null
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '10052', '--strictPort'], {
    cwd: frontendDir,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(stderr.trim())
  })
  await waitForServer()
  return child
}

const shots = [
  { file: 'hero.png', route: '/today', width: 1600, height: 940 },
  { file: 'preview-today.png', route: '/today', width: 1440, height: 900 },
  { file: 'preview-chat.png', route: '/chat', width: 1440, height: 900, waitFor: async (page) => {
    await page.getByText('今日行动清单').waitFor({ timeout: 20_000 })
  } },
  { file: 'preview-workspace.png', route: '/workspace/sql', width: 1440, height: 900, afterLoad: async (page) => {
    await page.getByRole('button', { name: /运行查询/ }).click()
    await page.getByRole('cell', { name: 'ready' }).waitFor({ timeout: 15_000 })
  } },
  { file: 'preview-automations.png', route: '/automations/orchestrations', width: 1440, height: 900, selector: '.react-flow__node' },
]

await fs.mkdir(outputDir, { recursive: true })
const server = await ensureServer()
const browser = await chromium.launch({ executablePath, headless: true })
const failures = []

try {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await installApiMocks(page)
    try {
      await page.goto(baseUrl + shot.route, { waitUntil: 'domcontentloaded', timeout: 35_000 })
      if (shot.waitFor) await shot.waitFor(page)
      else await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 })
      if (shot.selector) await page.locator(shot.selector).first().waitFor({ state: 'visible', timeout: 20_000 })
      if (shot.afterLoad) await shot.afterLoad(page)
      await page.waitForTimeout(1000)
      if (pageErrors.length) throw new Error(pageErrors.join(' | '))
      await page.screenshot({ path: path.join(outputDir, shot.file), fullPage: false })
      console.log(`captured ${shot.file}`)
    } catch (error) {
      failures.push(`${shot.file}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (server) server.kill()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`README screenshots written to ${outputDir}`)
