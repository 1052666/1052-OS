import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { resolveChromiumExecutablePath } from './browser-executable.mjs'

const baseUrl = process.env.PW_BASE_URL ?? 'http://127.0.0.1:10052'
const executablePath = resolveChromiumExecutablePath()
const outputDir = path.resolve('test-results', 'interaction-smoke')

const settings = {
  llm: {
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'gpt-test',
    kind: 'local',
    provider: 'local',
    apiFormat: 'openai-compatible',
    activeProfileId: 'local',
    profiles: [],
    taskRoutes: [],
    hasApiKey: true,
    apiKeyMask: 'sk-***',
  },
  appearance: { theme: 'dark', language: 'zh-CN', reduceMotion: false },
  agent: {
    streaming: true,
    userPrompt: '',
    permissionProfile: 'default',
    contextMessageLimit: 20,
    progressiveDisclosureEnabled: true,
    providerCachingEnabled: false,
    checkpointEnabled: true,
    seedOnResumeEnabled: true,
    upgradeDebugEventsEnabled: false,
    autoCompactEnabled: true,
    autoCompactThreshold: 8000,
    morningBrief: { enabled: false, time: '08:30' },
  },
  imageGeneration: {},
  ocr: { provider: 'uapis' },
  uapis: { hasApiKey: false, apiKeyMode: 'free-ip-quota' },
}

function fail(message) {
  throw new Error(message)
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

function readJson(request) {
  const raw = request.postData()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(predicate, message, timeout = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await delay(100)
  }
  fail(message)
}

function taskFrom(body, index) {
  const now = Date.now()
  return {
    id: `task-${index}`,
    title: body.title || `任务 ${index}`,
    notes: body.notes ?? '',
    target: body.target ?? 'agent',
    mode: body.mode ?? 'once',
    startDate: body.startDate ?? new Date(now).toISOString().slice(0, 10),
    time: body.time ?? '09:00',
    timezone: body.timezone ?? 'Asia/Hong_Kong',
    repeatUnit: body.repeatUnit ?? '',
    repeatInterval: body.repeatInterval ?? 1,
    repeatWeekdays: body.repeatWeekdays ?? [],
    endDate: body.endDate ?? '',
    prompt: body.prompt ?? '',
    command: body.command ?? '',
    shell: body.shell ?? 'powershell',
    delivery: body.delivery ?? {},
    enabled: body.enabled ?? true,
    nextRunAt: now + 3600_000,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSummary: '',
    createdAt: now,
    updatedAt: now,
  }
}

function skillFrom(body, index) {
  const now = Date.now()
  const id = body.id || `skill-${index}`
  const source = body.body || '# Smoke Skill'
  return {
    id,
    name: body.name || `Skill ${index}`,
    description: body.description || '',
    enabled: true,
    path: `C:/Users/lixia/.codex/skills/${id}/SKILL.md`,
    updatedAt: now,
    size: source.length,
    body: source,
  }
}

function resourceFrom(body, index) {
  const now = Date.now()
  return {
    id: body.id || `resource-${index}`,
    title: body.title || `资源 ${index}`,
    content: body.content || '',
    note: body.note || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    status: body.status || 'active',
    createdAt: body.createdAt || now,
    updatedAt: now,
  }
}

function workflowFrom(body, index) {
  const now = Date.now()
  return {
    id: body.id || `workflow-${index}`,
    name: body.name || `流程 ${index}`,
    description: body.description || '',
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    createdAt: body.createdAt || now,
    updatedAt: now,
  }
}

function reviewForTheme(theme) {
  const safetyLevel = theme?.safetyLevel || 'safe'
  return {
    passed: safetyLevel !== 'rejected',
    safetyLevel,
    blockingIssues: safetyLevel === 'rejected' ? [{ code: 'rejected', path: 'theme.safetyLevel', message: 'theme rejected', suggestedFix: 'use safe tokens' }] : [],
    warnings: safetyLevel === 'experimental' ? [{ code: 'experimental', path: 'theme.safetyLevel', message: 'experimental theme', suggestedFix: 'review before apply' }] : [],
  }
}

function themeProfileFrom(body, index) {
  const now = Date.now()
  const theme = body.theme || body
  const spec = {
    schemaVersion: 1,
    name: theme.name || `Smoke Theme ${index}`,
    mode: theme.mode || 'dark',
    scope: theme.scope || 'all',
    safetyLevel: theme.safetyLevel || 'safe',
    coreTokens: {
      bg: '#080b0e',
      surface: '#10171b',
      fg: '#eef5f7',
      accent: '#26d9d0',
      success: '#4ade80',
      danger: '#ff6b6b',
      ...(theme.coreTokens || {}),
    },
    tokens: theme.tokens || {},
  }
  return {
    id: body.id || theme.id || `theme-${index}`,
    theme: spec,
    review: reviewForTheme(spec),
    createdAt: body.createdAt || now,
    updatedAt: now,
    source: body.source,
  }
}

function appearanceStore(state) {
  const activeProfile = state.appearanceThemes.find((profile) => profile.id === state.activeAppearanceId) ?? null
  return {
    schemaVersion: 1,
    activeProfileId: state.activeAppearanceId,
    activeProfile,
    applyHistory: state.themeActions.filter((action) => action.type === 'apply'),
    profiles: state.appearanceThemes,
  }
}

const smokeDatasource = {
  id: 'ds-1',
  name: '本地 SQLite',
  type: 'sqlite',
  host: '',
  port: 0,
  user: '',
  database: '',
  filePath: 'C:/tmp/smoke.db',
}

async function installApiMocks(page, options = {}) {
  const state = {
    history: [],
    tasks: options.initialTasks ? options.initialTasks.map((task, index) => taskFrom(task, index + 1)) : [],
    skills: [],
    resources: [],
    workflows: [workflowFrom({ id: 'workflow-1', name: 'Smoke 编排', description: '用于交互验证' }, 1)],
    appearanceThemes: [themeProfileFrom({ id: 'builtin-dark', name: 'Smoke Obsidian', source: 'builtin' }, 1)],
    activeAppearanceId: 'builtin-dark',
    webhooks: [],
    postedChatMessages: [],
    savedSettings: [],
    uploadedFiles: 0,
    approvalResolutions: [],
    taskRuns: [],
    sqlQueries: [],
    workflowExecutions: [],
    themeActions: [],
    channelActions: [],
    feishuConnected: false,
    feishuWizardSessions: [],
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const apiPath = url.pathname.replace(/^\/api/, '')
    const method = request.method()

    if (apiPath === '/agent/chat/stream' && method === 'POST') {
      state.postedChatMessages.push(readJson(request).messages ?? [])
      if (options.slowChat) {
        await delay(options.slowChatDelay ?? 5000)
        return sse(route, [{ type: 'done' }]).catch(() => undefined)
      }
      if (options.approvalChat) {
        return sse(route, [
          { type: 'turn-started', turnId: 'approval-turn' },
          { type: 'tool-call-started', callId: 'approval-call', name: 'mock_delete', argsPreview: '{"path":"C:/tmp/smoke.txt"}', dangerous: true },
          { type: 'approval-requested', callId: 'approval-call', approvalId: 'approval-1', name: 'mock_delete', argsPreview: '{"path":"C:/tmp/smoke.txt"}', expiresAt: Date.now() + 60_000 },
          { type: 'assistant-delta', content: '这个操作需要确认。' },
        ])
      }
      return sse(route, [
        { type: 'turn-started', turnId: 'smoke-turn' },
        { type: 'step-started', step: 1, mode: 'progressive' },
        { type: 'tool-call-started', callId: 'call-1', name: 'mock_tool', argsPreview: '{"query":"smoke"}' },
        { type: 'assistant-delta', content: '收到，已完成测试运行。' },
        { type: 'tool-call-finished', callId: 'call-1', name: 'mock_tool', ok: true, resultPreview: 'ok' },
        { type: 'usage-recorded', usage: { inputTokens: 24, outputTokens: 18, totalTokens: 42 } },
        { type: 'done' },
      ])
    }

    if (apiPath === '/agent/history/events') return sse(route, [{ type: 'connected' }])
    if (apiPath === '/agent/uploads' && method === 'POST') {
      state.uploadedFiles += 1
      return json(route, { items: [{ markdown: '[附件 smoke.txt](attachment://smoke.txt)', fileName: 'smoke.txt' }] })
    }
    if (apiPath === '/agent/history' && method === 'GET') return json(route, { messages: state.history })
    if (apiPath === '/agent/history' && method === 'PUT') {
      const body = readJson(request)
      state.history = Array.isArray(body.messages) ? body.messages : []
      return json(route, { messages: state.history })
    }
    if (apiPath === '/agent/history/compact') return json(route, { messages: state.history, backupPath: 'smoke.json', originalCount: state.history.length })
    if (apiPath.startsWith('/agent/approvals/')) {
      const approved = readJson(request).approved === true
      const approvalId = apiPath.split('/')[3] || 'approval-1'
      state.approvalResolutions.push({ approvalId, approved })
      return json(route, { ok: true, approvalId, approved })
    }

    if (apiPath === '/settings' && method === 'GET') return json(route, settings)
    if (apiPath === '/settings' && method === 'PUT') {
      const body = readJson(request)
      const next = { ...settings, ...body, appearance: { ...settings.appearance, ...(body.appearance ?? {}) } }
      state.savedSettings.push(next)
      return json(route, next)
    }

    if (apiPath === '/appearance/themes' && method === 'GET') return json(route, appearanceStore(state))
    if (apiPath === '/appearance/themes/review' && method === 'POST') {
      const body = readJson(request)
      state.themeActions.push({ type: 'review' })
      return json(route, reviewForTheme(body.theme || body))
    }
    if (apiPath === '/appearance/themes' && method === 'POST') {
      const profile = themeProfileFrom(readJson(request), state.appearanceThemes.length + 1)
      state.appearanceThemes.push(profile)
      state.themeActions.push({ type: 'create', profileId: profile.id })
      return json(route, profile, 201)
    }
    if (apiPath === '/appearance/themes/reset' && method === 'POST') {
      state.activeAppearanceId = 'builtin-dark'
      state.themeActions.push({ type: 'reset', profileId: 'builtin-dark', themeName: 'Smoke Obsidian', appliedAt: Date.now() })
      return json(route, appearanceStore(state))
    }
    const appearanceApplyMatch = apiPath.match(/^\/appearance\/themes\/([^/]+)\/apply$/)
    if (appearanceApplyMatch && method === 'POST') {
      state.activeAppearanceId = appearanceApplyMatch[1]
      const profile = state.appearanceThemes.find((item) => item.id === state.activeAppearanceId)
      state.themeActions.push({ type: 'apply', profileId: state.activeAppearanceId, themeName: profile?.theme.name ?? state.activeAppearanceId, appliedAt: Date.now() })
      return json(route, appearanceStore(state))
    }
    const appearanceDeleteMatch = apiPath.match(/^\/appearance\/themes\/([^/]+)$/)
    if (appearanceDeleteMatch && method === 'DELETE') {
      state.appearanceThemes = state.appearanceThemes.filter((profile) => profile.id !== appearanceDeleteMatch[1] || profile.source === 'builtin')
      if (!state.appearanceThemes.some((profile) => profile.id === state.activeAppearanceId)) state.activeAppearanceId = 'builtin-dark'
      state.themeActions.push({ type: 'delete', profileId: appearanceDeleteMatch[1] })
      return json(route, appearanceStore(state))
    }

    if (apiPath === '/calendar/events') return json(route, [])
    if (apiPath.startsWith('/calendar/tasks')) {
      if (options.failTodayTasks && method === 'GET' && url.searchParams.get('enabled') === 'true') {
        return json(route, { error: '定时任务服务离线' }, 503)
      }
      if (apiPath === '/calendar/tasks' && method === 'GET') return json(route, state.tasks)
      if (apiPath === '/calendar/tasks' && method === 'POST') {
        const task = taskFrom(readJson(request), state.tasks.length + 1)
        state.tasks.push(task)
        return json(route, task, 201)
      }
      const match = apiPath.match(/^\/calendar\/tasks\/([^/]+)(?:\/(run|pause|resume))?$/)
      if (match && method === 'POST') {
        const task = state.tasks.find((item) => item.id === match[1]) ?? taskFrom({}, 0)
        if (match[2] === 'run') {
          state.taskRuns.push({ id: `run-${state.taskRuns.length + 1}`, taskId: task.id, title: task.title, status: 'success', startedAt: Date.now(), summary: 'manual smoke run' })
          task.lastRunStatus = 'success'
          task.lastRunAt = Date.now()
        }
        if (match[2] === 'pause') task.enabled = false
        if (match[2] === 'resume') task.enabled = true
        return json(route, task)
      }
      if (match && method === 'PUT') {
        const next = taskFrom({ ...state.tasks.find((task) => task.id === match[1]), ...readJson(request) }, state.tasks.length + 1)
        state.tasks = state.tasks.map((task) => task.id === match[1] ? next : task)
        return json(route, next)
      }
      if (match && method === 'DELETE') return json(route, { ok: true })
    }
    if (apiPath === '/calendar/task-runs') return json(route, state.taskRuns)

    if (apiPath === '/notifications') return json(route, [])
    if (apiPath === '/notifications/unread-count') return json(route, { unread: 0 })
    if (apiPath.startsWith('/notifications/')) return json(route, { id: 'n1', title: '已读', message: '', level: 'info', read: true, source: 'smoke', createdAt: Date.now() })
    if (apiPath === '/memory/summary') return json(route, { counts: { confirmed: 0, active: 0, suggestions: 0, secure: 0, highPriority: 0 }, recent: [], secure: [] })

    if (apiPath === '/resources' && method === 'GET') return json(route, state.resources)
    if (apiPath === '/resources' && method === 'POST') {
      const resource = resourceFrom(readJson(request), state.resources.length + 1)
      state.resources.push(resource)
      return json(route, resource, 201)
    }
    const resourceMatch = apiPath.match(/^\/resources\/([^/]+)(?:\/strike)?$/)
    if (resourceMatch && method === 'PUT') {
      const patch = readJson(request)
      const current = state.resources.find((item) => item.id === resourceMatch[1]) ?? resourceFrom({ id: resourceMatch[1] }, state.resources.length + 1)
      const next = apiPath.endsWith('/strike') ? { ...current, status: patch.struck ? 'struck' : 'active', updatedAt: Date.now() } : resourceFrom({ ...current, ...patch }, state.resources.length + 1)
      state.resources = state.resources.some((item) => item.id === next.id) ? state.resources.map((item) => item.id === next.id ? next : item) : [...state.resources, next]
      return json(route, next)
    }
    if (resourceMatch && method === 'DELETE') {
      state.resources = state.resources.filter((item) => item.id !== resourceMatch[1])
      return json(route, { ok: true })
    }

    if (apiPath === '/sql/datasources' && method === 'GET') return json(route, [smokeDatasource])
    if (apiPath === '/sql/files' && method === 'GET') return json(route, [])
    if (apiPath === '/sql/query' && method === 'POST') {
      state.sqlQueries.push(readJson(request))
      return json(route, { columns: ['ready'], rows: [{ ready: 1 }], rowCount: 1, truncated: false })
    }

    if (apiPath === '/orchestration' && method === 'GET') return json(route, state.workflows)
    if (apiPath === '/orchestration' && method === 'POST') {
      const workflow = workflowFrom(readJson(request), state.workflows.length + 1)
      state.workflows.push(workflow)
      return json(route, workflow, 201)
    }
    const workflowMatch = apiPath.match(/^\/orchestration\/([^/]+)(?:\/(execute|active|logs|stop))?$/)
    if (workflowMatch) {
      const id = workflowMatch[1]
      const action = workflowMatch[2]
      const workflow = state.workflows.find((item) => item.id === id) ?? workflowFrom({ id, name: id }, 1)
      if (action === 'active' && method === 'GET') return json(route, { active: false })
      if (action === 'logs' && method === 'GET') return json(route, [{ id: 'log-1', timestamp: Date.now(), status: 'success', message: 'Smoke log' }])
      if (action === 'execute' && method === 'POST') {
        state.workflowExecutions.push(id)
        return json(route, { executionId: `exec-${state.workflowExecutions.length}` })
      }
      if (action === 'stop' && method === 'POST') return json(route, { ok: true, stopped: true })
      if (!action && method === 'PUT') {
        const next = workflowFrom({ ...workflow, ...readJson(request), id }, state.workflows.length + 1)
        state.workflows = state.workflows.map((item) => item.id === id ? next : item)
        return json(route, next)
      }
      if (!action && method === 'DELETE') {
        state.workflows = state.workflows.filter((item) => item.id !== id)
        return json(route, { ok: true })
      }
    }

    if (apiPath === '/channels/wechat/status') return json(route, { running: false })
    if (apiPath === '/channels/wechat/accounts') return json(route, [])
    if (apiPath === '/channels/wechat/login/start' && method === 'POST') {
      state.channelActions.push('wechat-login')
      return json(route, { sessionKey: 'wechat-smoke-session', qrcodeUrl: '', message: '请扫码', expiresAt: Math.floor(Date.now() / 1000) + 300 })
    }
    if (apiPath === '/channels/wechat/login/wait' && method === 'POST') {
      return json(route, { connected: false, message: '等待扫码' })
    }
    if (apiPath === '/channels/feishu/status') return json(route, { connected: state.feishuConnected, status: state.feishuConnected ? 'connected' : 'offline' })
    if (apiPath === '/channels/feishu/workspace') return json(route, { spaces: [] })
    if (apiPath === '/channels/feishu/setup-wizard/start' && method === 'POST') {
      const sessionId = `feishu-wizard-${state.feishuWizardSessions.length + 1}`
      state.feishuWizardSessions.push(sessionId)
      state.channelActions.push('feishu-qr-start')
      return json(route, { ok: true, sessionId, qrUrl: 'https://accounts.feishu.cn/login/qrcode/smoke', expiresAt: Math.floor(Date.now() / 1000) + 300 })
    }
    if (apiPath.startsWith('/channels/feishu/setup-wizard/stream/')) {
      return sse(route, [{ status: 'pending', message: '等待飞书扫码授权' }])
    }
    if (apiPath.startsWith('/channels/feishu/setup-wizard/cancel/') && method === 'POST') {
      state.channelActions.push('feishu-qr-cancel')
      return json(route, { ok: true })
    }
    if (apiPath === '/channels/feishu/config' && method === 'POST') {
      state.channelActions.push({ type: 'feishu-save', body: readJson(request) })
      return json(route, { ok: true, configured: true })
    }
    if (apiPath === '/channels/feishu/connect' && method === 'POST') {
      state.feishuConnected = true
      state.channelActions.push('feishu-connect')
      return json(route, { connected: true, status: 'connected' })
    }
    if (apiPath === '/channels/feishu/disconnect' && method === 'POST') {
      state.feishuConnected = false
      state.channelActions.push('feishu-disconnect')
      return json(route, { connected: false, status: 'offline' })
    }
    if (apiPath === '/channels/wecom/status') return json(route, { available: true })
    if (apiPath === '/channels/wecom/webhooks' && method === 'GET') return json(route, state.webhooks)
    if (apiPath === '/channels/wecom/webhooks' && method === 'POST') {
      const hook = { id: `hook-${state.webhooks.length + 1}`, ...readJson(request) }
      state.webhooks.push(hook)
      return json(route, hook, 201)
    }
    if (/^\/channels\/wecom\/webhooks\/[^/]+\/test$/.test(apiPath) && method === 'POST') return json(route, { ok: true })

    if (apiPath === '/skills/marketplace/search') return json(route, { items: [] })
    if (apiPath === '/skills' && method === 'GET') return json(route, state.skills)
    if (apiPath === '/skills' && method === 'POST') {
      const skill = skillFrom(readJson(request), state.skills.length + 1)
      state.skills.push(skill)
      return json(route, skill, 201)
    }
    const skillMatch = apiPath.match(/^\/skills\/([^/]+)$/)
    if (skillMatch && method === 'GET') return json(route, state.skills.find((skill) => skill.id === skillMatch[1]) ?? skillFrom({ id: skillMatch[1] }, 0))
    if (skillMatch && method === 'DELETE') return json(route, { ok: true })

    return json(route, {})
  })

  return state
}

async function runCase(browser, name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    await fn(page)
    if (pageErrors.length) fail(`${name}: page errors: ${pageErrors.join(' | ')}`)
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false })
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `${name}-failed.png`), fullPage: false }).catch(() => undefined)
    throw error
  } finally {
    await context.close()
  }
}

await fs.mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const failures = []

for (const [name, fn] of [
  ['chat-runtime-loop', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/chat', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '从一个目标开始' }).waitFor({ timeout: 15_000 })
    await page.getByPlaceholder('输入你的目标或问题').fill('测试运行轨迹')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByText('收到，已完成测试运行。').waitFor({ timeout: 15_000 })
    await page.getByText('42 tokens').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '打开运行检查器' }).first().click()
    await page.getByText('运行检查器').waitFor({ timeout: 10_000 })
    await page.getByText('mock_tool 已完成').waitFor({ timeout: 10_000 })
    if (!state.postedChatMessages.length) fail('chat stream request was not posted')
  }],
  ['chat-attachment', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/chat', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '从一个目标开始' }).waitFor({ timeout: 15_000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'smoke.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await page.getByPlaceholder('输入你的目标或问题').waitFor({ timeout: 10_000 })
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('smoke.txt'))
    if (state.uploadedFiles !== 1) fail('attachment upload was not posted')
  }],
  ['chat-cancel', async (page) => {
    const state = await installApiMocks(page, { slowChat: true, slowChatDelay: 4000 })
    await page.goto(baseUrl + '/chat', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '从一个目标开始' }).waitFor({ timeout: 15_000 })
    await page.getByPlaceholder('输入你的目标或问题').fill('取消这轮运行')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByRole('button', { name: '停止运行' }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '停止运行' }).click()
    await page.getByText('本轮运行已停止').waitFor({ timeout: 10_000 })
    if (!state.postedChatMessages.length) fail('cancel flow did not start chat stream')
  }],
  ['chat-approval', async (page) => {
    const state = await installApiMocks(page, { approvalChat: true })
    await page.goto(baseUrl + '/chat', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '从一个目标开始' }).waitFor({ timeout: 15_000 })
    await page.getByPlaceholder('输入你的目标或问题').fill('执行需要确认的操作')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByText('mock_delete 等待确认').waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: '允许' }).click()
    await page.getByRole('button', { name: '打开运行检查器' }).first().click()
    await page.getByText('mock_delete 已批准').first().waitFor({ timeout: 10_000 })
    if (state.approvalResolutions[0]?.approved !== true) fail('approval resolution was not posted')
  }],
  ['tasks-create', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/automations/tasks', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: '定时任务' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: /新任务/ }).click()
    await page.getByLabel('标题').fill('自动化测试任务')
    await page.getByLabel('Agent 提示词').fill('生成每日摘要')
    await page.getByRole('button', { name: /保存/ }).click()
    await page.getByText('自动化测试任务').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '运行 自动化测试任务' }).click()
    await page.getByText('success').waitFor({ timeout: 10_000 })
    if (state.tasks[0]?.title !== '自动化测试任务') fail('task create payload was not recorded')
    if (state.taskRuns[0]?.taskId !== state.tasks[0]?.id) fail('task run payload was not recorded')
  }],
  ['knowledge-resource-crud', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/knowledge/resources', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: '资源库' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: /新建/ }).click()
    await page.getByLabel('标题').fill('交互测试资源')
    await page.getByLabel('内容或链接').fill('https://example.test/resource')
    await page.getByLabel('备注').fill('初始备注')
    await page.getByLabel('标签').fill('smoke, ui')
    await page.getByRole('button', { name: '保存' }).click()
    await page.getByText('交互测试资源').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '编辑' }).click()
    await page.getByLabel('备注').fill('已更新备注')
    await page.getByRole('button', { name: '保存' }).click()
    await page.getByText('已更新备注').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '删除 交互测试资源' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('交互测试资源'))
    if (state.resources.length !== 0) fail('resource delete did not update mock state')
  }],
  ['sql-query', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/workspace/sql', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: 'SQL 工作台' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: /运行查询/ }).click()
    await page.getByText('1 行').waitFor({ timeout: 15_000 })
    await page.getByText('ready').first().waitFor({ timeout: 10_000 })
    if (state.sqlQueries[0]?.datasourceId !== 'ds-1') fail('SQL query did not target the seeded datasource')
  }],
  ['orchestration-save-run', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/automations/orchestrations', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: '流程编排' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'sql' }).click()
    await page.getByText('sql 节点').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '保存流程' }).click()
    await waitUntil(() => Boolean(state.workflows[0]?.nodes?.length), 'workflow save did not include the added node')
    await page.getByRole('button', { name: '运行流程' }).click()
    await page.getByText('Smoke log').waitFor({ timeout: 10_000 })
    if (state.workflowExecutions[0] !== 'workflow-1') fail('workflow execute was not posted')
  }],
  ['channels-connect', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/capabilities/channels', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: '外部通道' }).waitFor({ timeout: 15_000 })
    await page.getByLabel('App ID').fill('cli_a_smoke')
    await page.getByLabel('App Secret').fill('secret')
    await page.getByRole('button', { name: '保存' }).click()
    await page.getByRole('button', { name: '连接' }).click()
    await page.getByText('已连接').waitFor({ timeout: 10_000 })
    await page.getByPlaceholder('名称').fill('Smoke Webhook')
    await page.getByPlaceholder('Webhook URL').fill('https://example.test/webhook')
    await page.getByRole('button', { name: '新增' }).click()
    await page.getByText('Smoke Webhook').waitFor({ timeout: 10_000 })
    if (!state.channelActions.includes('feishu-connect')) fail('feishu connect was not posted')
    if (state.webhooks[0]?.name !== 'Smoke Webhook') fail('wecom webhook create was not posted')
  }],
  ['skills-create', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/capabilities/skills', { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: 'Skills' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: /新建/ }).click()
    await page.getByLabel('ID').fill('smoke-skill')
    await page.getByLabel('名称').fill('交互测试 Skill')
    await page.getByLabel('描述').fill('用于验证新前端创建流程')
    await page.getByLabel('正文').fill('# 交互测试 Skill\n\n执行一个无副作用验证。')
    await page.getByRole('button', { name: '创建' }).click()
    await page.getByRole('heading', { name: '交互测试 Skill', exact: true }).waitFor({ timeout: 10_000 })
    if (state.skills[0]?.id !== 'smoke-skill') fail('skill create payload was not recorded')
  }],
  ['appearance-save', async (page) => {
    const state = await installApiMocks(page)
    await page.goto(baseUrl + '/settings/appearance', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '外观与动态' }).waitFor({ timeout: 15_000 })
    await page.getByText('Smoke Obsidian').first().waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: /钛白浅色/ }).click()
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    if (theme !== 'light') fail(`theme did not switch to light, got ${theme}`)
    await page.getByRole('button', { name: '审计 JSON' }).click()
    await page.getByText('审计通过').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '保存主题包' }).click()
    await page.getByRole('button', { name: /本地主题包/ }).first().waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '应用' }).click()
    await waitUntil(() => state.activeAppearanceId === 'theme-2', 'appearance theme apply was not posted')
    await page.getByRole('button', { name: '重置' }).click()
    await waitUntil(() => state.activeAppearanceId === 'builtin-dark', 'appearance theme reset was not posted')
    await page.getByRole('button', { name: /保存外观设置/ }).click()
    await page.waitForFunction(() => window.fetch !== undefined)
    if (state.savedSettings[0]?.appearance.theme !== 'light') fail('appearance settings were not saved with light theme')
    if (!state.themeActions.some((action) => action.type === 'review')) fail('theme review was not posted')
    if (!state.themeActions.some((action) => action.type === 'create')) fail('theme create was not posted')
  }],
  ['today-partial-failure', async (page) => {
    await installApiMocks(page, { failTodayTasks: true })
    await page.goto(baseUrl + '/today', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: /本地用户/ }).waitFor({ timeout: 15_000 })
    await page.getByText('今天的日程').waitFor({ timeout: 10_000 })
    await page.getByText('定时任务服务离线').waitFor({ timeout: 10_000 })
    await page.getByPlaceholder(/例如：整理今天的安排/).waitFor({ timeout: 10_000 })
  }],
]) {
  try {
    await runCase(browser, name, fn)
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await browser.close()

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`interaction smoke passed; screenshots: ${outputDir}`)
