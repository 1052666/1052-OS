import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import type {
  MemoryCategory,
  MemoryInput,
  MemoryItem,
  MemoryPriority,
  MemoryQuery,
  MemoryScope,
  MemorySource,
  MemorySuggestion,
  MemorySummary,
  RuntimeMemorySelection,
  SecureMemoryDetail,
  SecureMemoryExposureMode,
  SecureMemoryIndexItem,
  SecureMemoryInput,
  SecureMemoryType,
} from './memory.types.js'

const MEMORY_DIR = 'memory'
const MEMORIES_FILE = 'memories.json'
const SUGGESTIONS_FILE = 'suggestions.json'
const EVENTS_FILE = 'events.jsonl'
const PROFILE_FILE = 'profile.md'
const SECURE_DIR = 'secure'
const SECURE_INDEX_FILE = 'index.json'
const SECURE_PROFILE_FILE = 'secure-memory.md'
const SECURE_ENTRIES_DIR = 'entries'

const MAX_TITLE_CHARS = 160
const MAX_CONTENT_CHARS = 8_000
const MAX_TAGS = 16
const MAX_TAG_LENGTH = 40
const MAX_ALLOWED_USE = 16
const MAX_ALLOWED_USE_LENGTH = 48
const MAX_LIST_LIMIT = 300

const MEMORY_CATEGORIES: MemoryCategory[] = [
  'hard_rule',
  'preference',
  'habit',
  'style',
  'workflow',
  'constraint',
  'identity',
  'project_context',
]

const MEMORY_SCOPES: MemoryScope[] = ['global', 'repository', 'notes', 'workspace']
const MEMORY_PRIORITIES: MemoryPriority[] = ['high', 'normal', 'low']
const MEMORY_SOURCES: MemorySource[] = ['user_explicit', 'agent_inferred', 'imported']
const SECURE_TYPES: SecureMemoryType[] = ['api_key', 'token', 'password', 'config', 'certificate', 'other']
const SECURE_EXPOSURE_MODES: SecureMemoryExposureMode[] = ['tool_only', 'raw_on_demand']

function memoryRoot() {
  return path.join(config.dataDir, MEMORY_DIR)
}

function memoriesFilePath() {
  return path.join(memoryRoot(), MEMORIES_FILE)
}

function suggestionsFilePath() {
  return path.join(memoryRoot(), SUGGESTIONS_FILE)
}

function eventsFilePath() {
  return path.join(memoryRoot(), EVENTS_FILE)
}

function profileFilePath() {
  return path.join(memoryRoot(), PROFILE_FILE)
}

function secureRoot() {
  return path.join(memoryRoot(), SECURE_DIR)
}

function secureIndexPath() {
  return path.join(secureRoot(), SECURE_INDEX_FILE)
}

function secureProfilePath() {
  return path.join(secureRoot(), SECURE_PROFILE_FILE)
}

function secureEntriesRoot() {
  return path.join(secureRoot(), SECURE_ENTRIES_DIR)
}

function secureEntryPath(id: string) {
  return path.join(secureEntriesRoot(), `${normalizeId(id)}.md`)
}

async function ensureMemoryDirs() {
  await fs.mkdir(memoryRoot(), { recursive: true })
  await fs.mkdir(secureRoot(), { recursive: true })
  await fs.mkdir(secureEntriesRoot(), { recursive: true })
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

async function appendEvent(type: string, payload: Record<string, unknown>) {
  await ensureMemoryDirs()
  const line = JSON.stringify({
    ts: Date.now(),
    type,
    ...payload,
  })
  await fs.appendFile(eventsFilePath(), line + '\n', 'utf-8')
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeText(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
    : ''
}

function normalizeTags(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : []
  return [...new Set(items.map((item) => normalizeString(item).replace(/^#/, '')).filter(Boolean))].slice(
    0,
    MAX_TAGS,
  )
}

function normalizeAllowedUse(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : []
  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))].slice(0, MAX_ALLOWED_USE)
}

function normalizeId(value: unknown) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized || normalized.includes('..') || normalized === '.' || normalized === '..') {
    throw new HttpError(400, 'Memory id is invalid')
  }

  return normalized
}

function createId(prefix: 'mem' | 'sug' | 'sec') {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function maskSecret(value: string) {
  if (!value) return ''
  if (value.length <= 6) return `${value[0] ?? ''}****`
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

function assertMemoryTitle(title: string) {
  if (!title) throw new HttpError(400, 'Memory title cannot be empty')
  if (title.length > MAX_TITLE_CHARS) {
    throw new HttpError(400, `Memory title is too long. Max ${MAX_TITLE_CHARS} characters.`)
  }
}

function assertMemoryContent(content: string) {
  if (!content) throw new HttpError(400, 'Memory content cannot be empty')
  if (content.length > MAX_CONTENT_CHARS) {
    throw new HttpError(400, `Memory content is too long. Max ${MAX_CONTENT_CHARS} characters.`)
  }
}

function normalizeCategory(value: unknown, fallback: MemoryCategory = 'preference') {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory) ? (value as MemoryCategory) : fallback
}

function normalizeScope(value: unknown, fallback: MemoryScope = 'global') {
  return MEMORY_SCOPES.includes(value as MemoryScope) ? (value as MemoryScope) : fallback
}

function normalizePriority(value: unknown, fallback: MemoryPriority = 'normal') {
  return MEMORY_PRIORITIES.includes(value as MemoryPriority) ? (value as MemoryPriority) : fallback
}

function normalizeSource(value: unknown, fallback: MemorySource = 'user_explicit') {
  return MEMORY_SOURCES.includes(value as MemorySource) ? (value as MemorySource) : fallback
}

function normalizeSecureType(value: unknown, fallback: SecureMemoryType = 'other') {
  return SECURE_TYPES.includes(value as SecureMemoryType) ? (value as SecureMemoryType) : fallback
}

function normalizeExposureMode(value: unknown, fallback: SecureMemoryExposureMode = 'tool_only') {
  return SECURE_EXPOSURE_MODES.includes(value as SecureMemoryExposureMode)
    ? (value as SecureMemoryExposureMode)
    : fallback
}

function normalizeLimit(value: unknown, fallback = 120) {
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)))
}

function normalizeMemoryRecord(value: unknown): MemoryItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const title = normalizeString(record.title)
  const content = normalizeText(record.content)
  const id = normalizeString(record.id)
  if (!id || !title || !content) return null

  return {
    id,
    category: normalizeCategory(record.category),
    title,
    content,
    tags: normalizeTags(record.tags).map((item) => item.slice(0, MAX_TAG_LENGTH)),
    scope: normalizeScope(record.scope),
    priority: normalizePriority(record.priority),
    source: normalizeSource(record.source),
    confidence: 'confirmed',
    active: record.active !== false,
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
    lastUsedAt:
      typeof record.lastUsedAt === 'number' && Number.isFinite(record.lastUsedAt)
        ? record.lastUsedAt
        : null,
  }
}

function normalizeSuggestionRecord(value: unknown): MemorySuggestion | null {
  const base = normalizeMemoryRecord(value)
  return base ? { ...base, confidence: 'suggested' } : null
}

function normalizeSecureIndexRecord(value: unknown): SecureMemoryIndexItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = normalizeString(record.id)
  const title = normalizeString(record.title)
  const filePath = normalizeString(record.path)
  if (!id || !title || !filePath) return null

  return {
    id,
    title,
    type: normalizeSecureType(record.type),
    tags: normalizeTags(record.tags).map((item) => item.slice(0, MAX_TAG_LENGTH)),
    allowedUse: normalizeAllowedUse(record.allowedUse).map((item) => item.slice(0, MAX_ALLOWED_USE_LENGTH)),
    exposureMode: normalizeExposureMode(record.exposureMode),
    mask: normalizeString(record.mask),
    path: filePath,
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
  }
}

async function readMemories() {
  await ensureMemoryDirs()
  const raw = await readJsonFile<unknown[]>(memoriesFilePath(), [])
  return raw.map((item) => normalizeMemoryRecord(item)).filter((item): item is MemoryItem => item !== null)
}

async function saveMemories(items: MemoryItem[]) {
  await writeJsonFile(memoriesFilePath(), items)
}

async function readSuggestions() {
  await ensureMemoryDirs()
  const raw = await readJsonFile<unknown[]>(suggestionsFilePath(), [])
  return raw
    .map((item) => normalizeSuggestionRecord(item))
    .filter((item): item is MemorySuggestion => item !== null)
}

async function saveSuggestions(items: MemorySuggestion[]) {
  await writeJsonFile(suggestionsFilePath(), items)
}

async function readSecureIndex() {
  await ensureMemoryDirs()
  const raw = await readJsonFile<unknown[]>(secureIndexPath(), [])
  return raw
    .map((item) => normalizeSecureIndexRecord(item))
    .filter((item): item is SecureMemoryIndexItem => item !== null)
}

async function saveSecureIndex(items: SecureMemoryIndexItem[]) {
  await writeJsonFile(secureIndexPath(), items)
}

function matchesQuery(haystack: string[], query: string) {
  if (!query) return true
  const lower = query.toLowerCase()
  return haystack.some((item) => item.toLowerCase().includes(lower))
}

function categoryLabel(category: MemoryCategory) {
  return {
    hard_rule: '硬规则',
    preference: '偏好',
    habit: '习惯',
    style: '风格',
    workflow: '工作流',
    constraint: '约束',
    identity: '身份信息',
    project_context: '项目上下文',
  }[category]
}

function scopeLabel(scope: MemoryScope) {
  return {
    global: '全局',
    repository: '仓库',
    notes: '笔记',
    workspace: '工作区',
  }[scope]
}

function priorityLabel(priority: MemoryPriority) {
  return {
    high: '高',
    normal: '中',
    low: '低',
  }[priority]
}

function sourceLabel(source: MemorySource) {
  return {
    user_explicit: '用户明确要求',
    agent_inferred: 'Agent 推断',
    imported: '导入',
  }[source]
}

function secureTypeLabel(type: SecureMemoryType) {
  return {
    api_key: 'API Key',
    token: 'Token',
    password: '密码',
    config: '配置',
    certificate: '证书',
    other: '其他',
  }[type]
}

function frontmatterValue(value: unknown) {
  return JSON.stringify(value, null, 0)
}

function buildSecureMemoryMarkdown(entry: SecureMemoryDetail) {
  return [
    '---',
    `id: ${frontmatterValue(entry.id)}`,
    `title: ${frontmatterValue(entry.title)}`,
    `type: ${frontmatterValue(entry.type)}`,
    `tags: ${frontmatterValue(entry.tags)}`,
    `allowedUse: ${frontmatterValue(entry.allowedUse)}`,
    `exposureMode: ${frontmatterValue(entry.exposureMode)}`,
    `mask: ${frontmatterValue(entry.mask)}`,
    `createdAt: ${frontmatterValue(entry.createdAt)}`,
    `updatedAt: ${frontmatterValue(entry.updatedAt)}`,
    '---',
    '',
    entry.content,
    '',
  ].join('\n')
}

function parseFrontmatterValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseSecureMemoryMarkdown(text: string, fallbackPath: string): SecureMemoryDetail {
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.startsWith('---\n') ? normalized.split('\n---\n') : []
  if (parts.length < 2) throw new HttpError(500, 'Secure memory file is malformed')

  const frontmatterLines = parts[0]!.slice(4).split('\n')
  const body = parts.slice(1).join('\n---\n').trim()
  const meta: Record<string, unknown> = {}
  for (const line of frontmatterLines) {
    const index = line.indexOf(':')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    const rawValue = line.slice(index + 1).trim()
    meta[key] = parseFrontmatterValue(rawValue)
  }

  const indexRecord = normalizeSecureIndexRecord({
    ...meta,
    path: fallbackPath,
  })
  if (!indexRecord) throw new HttpError(500, 'Secure memory metadata is invalid')

  return {
    ...indexRecord,
    content: body,
  }
}

async function writeSecureEntry(entry: SecureMemoryDetail) {
  await ensureMemoryDirs()
  await fs.writeFile(secureEntryPath(entry.id), buildSecureMemoryMarkdown(entry), 'utf-8')
}

async function rebuildProfiles() {
  const memories = await readMemories()
  const secureIndex = await readSecureIndex()

  const grouped = new Map<MemoryCategory, MemoryItem[]>()
  for (const item of memories.filter((memory) => memory.active)) {
    const list = grouped.get(item.category) ?? []
    list.push(item)
    grouped.set(item.category, list)
  }

  const profileLines: string[] = [
    '# 长期记忆画像',
    '',
    `- 已确认记忆：${memories.length}`,
    `- 当前启用：${memories.filter((item) => item.active).length}`,
    `- 高优先级：${memories.filter((item) => item.active && item.priority === 'high').length}`,
    '',
  ]

  for (const category of MEMORY_CATEGORIES) {
    const items = (grouped.get(category) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
    if (items.length === 0) continue
    profileLines.push(`## ${categoryLabel(category)}`, '')
    for (const item of items) {
      const meta = [scopeLabel(item.scope), `${priorityLabel(item.priority)}优先级`, sourceLabel(item.source)]
      const tags = item.tags.length > 0 ? ` 标签：${item.tags.join(' / ')}` : ''
      profileLines.push(`- **${item.title}**`)
      profileLines.push(`  - ${meta.join(' · ')}${tags}`)
      profileLines.push(`  - ${item.content}`)
    }
    profileLines.push('')
  }

  const secureLines: string[] = [
    '# 敏感长期记忆总览',
    '',
    `- 条目数：${secureIndex.length}`,
    '',
    '以下为敏感记忆目录摘要，仅展示元数据与脱敏值；原始内容保存在 `secure/entries/*.md`。',
    '',
  ]

  for (const item of secureIndex.sort((a, b) => b.updatedAt - a.updatedAt)) {
    secureLines.push(`## ${item.title}`, '')
    secureLines.push(`- ID：${item.id}`)
    secureLines.push(`- 类型：${secureTypeLabel(item.type)}`)
    secureLines.push(`- 暴露模式：${item.exposureMode}`)
    secureLines.push(`- 脱敏值：${item.mask || '(empty)'}`)
    if (item.tags.length > 0) secureLines.push(`- 标签：${item.tags.join(' / ')}`)
    if (item.allowedUse.length > 0) secureLines.push(`- 允许用途：${item.allowedUse.join(' / ')}`)
    secureLines.push(`- 文件：${item.path}`, '')
  }

  await fs.writeFile(profileFilePath(), profileLines.join('\n'), 'utf-8')
  await fs.writeFile(secureProfilePath(), secureLines.join('\n'), 'utf-8')
}

function buildMemoryRecord(input: MemoryInput, fallback?: Partial<MemoryItem>): MemoryItem {
  const title = normalizeString(input.title ?? fallback?.title)
  const content = normalizeText(input.content ?? fallback?.content)
  assertMemoryTitle(title)
  assertMemoryContent(content)
  const now = Date.now()

  return {
    id: fallback?.id ?? createId('mem'),
    category: normalizeCategory(input.category, fallback?.category ?? 'preference'),
    title,
    content,
    tags: normalizeTags(input.tags ?? fallback?.tags).map((item) => item.slice(0, MAX_TAG_LENGTH)),
    scope: normalizeScope(input.scope, fallback?.scope ?? 'global'),
    priority: normalizePriority(input.priority, fallback?.priority ?? 'normal'),
    source: normalizeSource(input.source, fallback?.source ?? 'user_explicit'),
    confidence: 'confirmed',
    active: typeof input.active === 'boolean' ? input.active : fallback?.active ?? true,
    createdAt: fallback?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: fallback?.lastUsedAt ?? null,
  }
}

function buildSuggestionRecord(input: MemoryInput): MemorySuggestion {
  const id = createId('sug')
  const memory = buildMemoryRecord(input, { id })
  return {
    ...memory,
    id,
    confidence: 'suggested',
  }
}

function buildSecureRecord(input: SecureMemoryInput, fallback?: Partial<SecureMemoryDetail>): SecureMemoryDetail {
  const title = normalizeString(input.title ?? fallback?.title)
  const content = normalizeText(input.content ?? fallback?.content)
  if (!title) throw new HttpError(400, 'Secure memory title cannot be empty')
  if (!content) throw new HttpError(400, 'Secure memory content cannot be empty')
  if (title.length > MAX_TITLE_CHARS) {
    throw new HttpError(400, `Secure memory title is too long. Max ${MAX_TITLE_CHARS} characters.`)
  }
  if (content.length > MAX_CONTENT_CHARS) {
    throw new HttpError(400, `Secure memory content is too long. Max ${MAX_CONTENT_CHARS} characters.`)
  }

  const now = Date.now()
  const id = fallback?.id ?? createId('sec')

  return {
    id,
    title,
    type: normalizeSecureType(input.type, fallback?.type ?? 'other'),
    tags: normalizeTags(input.tags ?? fallback?.tags).map((item) => item.slice(0, MAX_TAG_LENGTH)),
    allowedUse: normalizeAllowedUse(input.allowedUse ?? fallback?.allowedUse).map((item) =>
      item.slice(0, MAX_ALLOWED_USE_LENGTH),
    ),
    exposureMode: normalizeExposureMode(input.exposureMode, fallback?.exposureMode ?? 'tool_only'),
    mask: maskSecret(content),
    path: path.relative(memoryRoot(), secureEntryPath(id)).replace(/\\/g, '/'),
    createdAt: fallback?.createdAt ?? now,
    updatedAt: now,
    content,
  }
}

export async function listMemories(queryInput: MemoryQuery = {}) {
  const query = normalizeString(queryInput.query)
  const category = normalizeString(queryInput.category)
  const scope = normalizeString(queryInput.scope)
  const priority = normalizeString(queryInput.priority)
  const limit = normalizeLimit(queryInput.limit)
  const active =
    queryInput.active === 'true' || queryInput.active === true
      ? true
      : queryInput.active === 'false' || queryInput.active === false
        ? false
        : null

  return (await readMemories())
    .filter((item) => (category ? item.category === category : true))
    .filter((item) => (scope ? item.scope === scope : true))
    .filter((item) => (priority ? item.priority === priority : true))
    .filter((item) => (active === null ? true : item.active === active))
    .filter((item) => matchesQuery([item.id, item.title, item.content, item.tags.join('\n')], query))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export async function getMemory(idInput: unknown) {
  const id = normalizeId(idInput)
  const item = (await readMemories()).find((memory) => memory.id === id)
  if (!item) throw new HttpError(404, 'Memory not found')
  return item
}

export async function createMemory(input: MemoryInput) {
  const item = buildMemoryRecord(input)
  const items = await readMemories()
  items.unshift(item)
  await saveMemories(items)
  await rebuildProfiles()
  await appendEvent('memory.create', { id: item.id, title: item.title, category: item.category })
  return item
}

export async function updateMemory(idInput: unknown, input: MemoryInput) {
  const id = normalizeId(idInput)
  const items = await readMemories()
  const index = items.findIndex((memory) => memory.id === id)
  if (index === -1) throw new HttpError(404, 'Memory not found')

  const next = buildMemoryRecord(input, items[index])
  items[index] = next
  await saveMemories(items)
  await rebuildProfiles()
  await appendEvent('memory.update', { id: next.id, title: next.title })
  return next
}

export async function deleteMemory(idInput: unknown) {
  const id = normalizeId(idInput)
  const items = await readMemories()
  const item = items.find((memory) => memory.id === id)
  if (!item) throw new HttpError(404, 'Memory not found')

  await saveMemories(items.filter((memory) => memory.id !== id))
  await rebuildProfiles()
  await appendEvent('memory.delete', { id: item.id, title: item.title })
  return { ok: true as const, deleted: item }
}

export async function listMemorySuggestions(queryInput: Pick<MemoryQuery, 'query' | 'limit'> = {}) {
  const query = normalizeString(queryInput.query)
  const limit = normalizeLimit(queryInput.limit, 80)
  return (await readSuggestions())
    .filter((item) => matchesQuery([item.id, item.title, item.content, item.tags.join('\n')], query))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export async function createMemorySuggestion(input: MemoryInput) {
  const suggestion = buildSuggestionRecord(input)
  const items = await readSuggestions()
  items.unshift(suggestion)
  await saveSuggestions(items)
  await appendEvent('memory.suggest', { id: suggestion.id, title: suggestion.title })
  void (async () => {
    try {
      const { loadFeishuWorkspaceConfig } = await import('../channels/feishu/feishu.store.js')
      const workspace = await loadFeishuWorkspaceConfig()
      if (workspace.enableMemoryCards === false) return
      const { sendFeishuMemorySuggestionCardMessage } = await import(
        '../channels/feishu/feishu.service.js'
      )
      await sendFeishuMemorySuggestionCardMessage({
        suggestionId: suggestion.id,
        title: suggestion.title,
        content: suggestion.content,
        tags: suggestion.tags,
      })
    } catch {
      // Feishu delivery is best-effort for memory suggestions.
    }
  })()
  return suggestion
}

export async function confirmMemorySuggestion(idInput: unknown, patch: MemoryInput = {}) {
  const id = normalizeId(idInput)
  const suggestions = await readSuggestions()
  const suggestion = suggestions.find((item) => item.id === id)
  if (!suggestion) throw new HttpError(404, 'Memory suggestion not found')

  const memories = await readMemories()
  const confirmed = buildMemoryRecord(
    {
      category: patch.category ?? suggestion.category,
      title: patch.title ?? suggestion.title,
      content: patch.content ?? suggestion.content,
      tags: patch.tags ?? suggestion.tags,
      scope: patch.scope ?? suggestion.scope,
      priority: patch.priority ?? suggestion.priority,
      source: patch.source ?? suggestion.source,
      active: patch.active ?? suggestion.active,
    },
    undefined,
  )

  memories.unshift(confirmed)
  await saveMemories(memories)
  await saveSuggestions(suggestions.filter((item) => item.id !== id))
  await rebuildProfiles()
  await appendEvent('memory.confirm', {
    suggestionId: suggestion.id,
    memoryId: confirmed.id,
    title: confirmed.title,
  })
  return confirmed
}

export async function rejectMemorySuggestion(idInput: unknown) {
  const id = normalizeId(idInput)
  const suggestions = await readSuggestions()
  const suggestion = suggestions.find((item) => item.id === id)
  if (!suggestion) throw new HttpError(404, 'Memory suggestion not found')

  await saveSuggestions(suggestions.filter((item) => item.id !== id))
  await appendEvent('memory.reject', { id: suggestion.id, title: suggestion.title })
  return { ok: true as const, rejected: suggestion }
}

export async function listSecureMemories(queryInput: Pick<MemoryQuery, 'query' | 'limit'> = {}) {
  const query = normalizeString(queryInput.query)
  const limit = normalizeLimit(queryInput.limit, 100)
  return (await readSecureIndex())
    .filter((item) =>
      matchesQuery([item.id, item.title, item.type, item.tags.join('\n'), item.allowedUse.join('\n')], query),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export async function getSecureMemory(idInput: unknown) {
  const id = normalizeId(idInput)
  const secureIndex = await readSecureIndex()
  const item = secureIndex.find((entry) => entry.id === id)
  if (!item) throw new HttpError(404, 'Secure memory not found')

  const fullPath = path.join(memoryRoot(), item.path)
  const text = await fs.readFile(fullPath, 'utf-8')
  return parseSecureMemoryMarkdown(text, item.path)
}

export async function createSecureMemory(input: SecureMemoryInput) {
  const entry = buildSecureRecord(input)
  const index = await readSecureIndex()
  index.unshift({
    id: entry.id,
    title: entry.title,
    type: entry.type,
    tags: entry.tags,
    allowedUse: entry.allowedUse,
    exposureMode: entry.exposureMode,
    mask: entry.mask,
    path: entry.path,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })

  await writeSecureEntry(entry)
  await saveSecureIndex(index)
  await rebuildProfiles()
  await appendEvent('secure.create', { id: entry.id, title: entry.title, type: entry.type })
  return entry
}

export async function updateSecureMemory(idInput: unknown, input: SecureMemoryInput) {
  const id = normalizeId(idInput)
  const current = await getSecureMemory(id)
  const next = buildSecureRecord(input, current)
  const index = await readSecureIndex()
  const itemIndex = index.findIndex((item) => item.id === id)
  if (itemIndex === -1) throw new HttpError(404, 'Secure memory not found')

  index[itemIndex] = {
    id: next.id,
    title: next.title,
    type: next.type,
    tags: next.tags,
    allowedUse: next.allowedUse,
    exposureMode: next.exposureMode,
    mask: next.mask,
    path: next.path,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  }

  await writeSecureEntry(next)
  await saveSecureIndex(index)
  await rebuildProfiles()
  await appendEvent('secure.update', { id: next.id, title: next.title, type: next.type })
  return next
}

export async function deleteSecureMemory(idInput: unknown) {
  const id = normalizeId(idInput)
  const current = await getSecureMemory(id)
  const index = await readSecureIndex()

  await fs.rm(secureEntryPath(id), { force: true })
  await saveSecureIndex(index.filter((item) => item.id !== id))
  await rebuildProfiles()
  await appendEvent('secure.delete', { id: current.id, title: current.title })
  return { ok: true as const, deleted: { ...current, content: '' } }
}

export async function readMemoryProfile() {
  await ensureMemoryDirs()
  try {
    return await fs.readFile(profileFilePath(), 'utf-8')
  } catch {
    await rebuildProfiles()
    return await fs.readFile(profileFilePath(), 'utf-8')
  }
}

export async function readSecureMemoryProfile() {
  await ensureMemoryDirs()
  try {
    return await fs.readFile(secureProfilePath(), 'utf-8')
  } catch {
    await rebuildProfiles()
    return await fs.readFile(secureProfilePath(), 'utf-8')
  }
}

export async function getMemorySummary(): Promise<MemorySummary> {
  const memories = await readMemories()
  const suggestions = await readSuggestions()
  const secure = await readSecureIndex()
  let profileUpdatedAt: number | null = null
  let secureProfileUpdatedAt: number | null = null

  try {
    const stat = await fs.stat(profileFilePath())
    profileUpdatedAt = stat.mtimeMs
  } catch {
    // Ignore missing profile file.
  }

  try {
    const stat = await fs.stat(secureProfilePath())
    secureProfileUpdatedAt = stat.mtimeMs
  } catch {
    // Ignore missing secure profile file.
  }

  return {
    counts: {
      confirmed: memories.length,
      active: memories.filter((item) => item.active).length,
      suggestions: suggestions.length,
      secure: secure.length,
      highPriority: memories.filter((item) => item.active && item.priority === 'high').length,
    },
    recent: memories.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
    secure: secure.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
    profileUpdatedAt,
    secureProfileUpdatedAt,
  }
}

function keywordSet(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  )
}

function relevanceScore(item: MemoryItem, requestWords: Set<string>) {
  if (requestWords.size === 0) return 0

  const haystack = keywordSet([item.title, item.content, item.tags.join(' ')].join(' '))
  let score = 0
  for (const word of requestWords) {
    if (haystack.has(word)) score += 1
  }
  if (item.priority === 'high') score += 2
  if (item.scope === 'global') score += 1
  return score
}

export async function selectRuntimeMemories(requestInput: unknown): Promise<RuntimeMemorySelection> {
  const request = normalizeText(requestInput)
  const words = keywordSet(request)
  const activeMemories = (await readMemories()).filter((item) => item.active)

  const always = activeMemories
    .filter((item) => item.priority === 'high' || item.category === 'hard_rule')
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
    .slice(0, 16)

  const excluded = new Set(always.map((item) => item.id))
  const relevant = activeMemories
    .filter((item) => !excluded.has(item.id))
    .map((item) => ({ item, score: relevanceScore(item, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.item.updatedAt - a.item.updatedAt
    })
    .slice(0, 10)
    .map((entry) => entry.item)

  const secureCatalog = (await readSecureIndex()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)

  return { always, relevant, secureCatalog }
}

function renderMemoryLine(item: MemoryItem) {
  const tags = item.tags.length > 0 ? ` 标签：${item.tags.join(' / ')}` : ''
  return `- [${categoryLabel(item.category)} | ${scopeLabel(item.scope)} | ${priorityLabel(item.priority)}优先级] ${item.title}：${item.content}${tags}`
}

function renderSecureCatalogLine(item: SecureMemoryIndexItem) {
  const tags = item.tags.length > 0 ? ` 标签：${item.tags.join(' / ')}` : ''
  const allowedUse = item.allowedUse.length > 0 ? ` 用途：${item.allowedUse.join(' / ')}` : ''
  return `- ${item.id} | ${item.title} | ${secureTypeLabel(item.type)} | ${item.exposureMode} | ${item.mask}${tags}${allowedUse}`
}

export async function formatMemoryRuntimeContext(requestInput: unknown) {
  const selection = await selectRuntimeMemories(requestInput)
  const sections: string[] = ['长期记忆运行时上下文：']

  if (selection.always.length > 0) {
    sections.push('## 必须持续遵守', ...selection.always.map((item) => renderMemoryLine(item)), '')
  }

  if (selection.relevant.length > 0) {
    sections.push('## 与当前请求相关', ...selection.relevant.map((item) => renderMemoryLine(item)), '')
  }

  if (selection.secureCatalog.length > 0) {
    sections.push(
      '## 敏感长期记忆目录（仅元数据）',
      ...selection.secureCatalog.map((item) => renderSecureCatalogLine(item)),
      '',
      '如果任务确实需要原始敏感值，可调用 `memory_secure_read` 读取单条敏感记忆；除非用户明确要求，不要在最终回复中回显原始内容。',
      '',
    )
  }

  sections.push(
    '当用户明确表达“以后都这样”“记住这个”“这是长期偏好/规则/限制”时，可优先创建记忆建议或长期记忆；对敏感信息默认优先存入敏感长期记忆。',
  )

  return sections.join('\n')
}

export async function getMemoryRuntimePreview(requestInput: unknown) {
  const selection = await selectRuntimeMemories(requestInput)
  return {
    request: normalizeText(requestInput),
    always: selection.always,
    relevant: selection.relevant,
    secureCatalog: selection.secureCatalog,
    rendered: await formatMemoryRuntimeContext(requestInput),
  }
}
