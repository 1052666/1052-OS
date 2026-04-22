import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import type { ResourceInput, ResourceItem, ResourceStatus } from './resources.types.js'

const RESOURCE_DIR = 'resources'
const ITEMS_DIR = 'items'
const LEGACY_FILE = 'resources.json'
const LEGACY_BACKUP_FILE = 'resources.migrated.json'
const MAX_CONTENT_CHARS = 80_000
const MAX_LIST_LIMIT = 500

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMultilineText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeContent(value: unknown) {
  return normalizeMultilineText(value)
}

function normalizeStatus(value: unknown): ResourceStatus {
  return value === 'struck' ? 'struck' : 'active'
}

function normalizeTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n，]/) : []
  const tags = raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((item) => item.replace(/^#/, ''))
  return [...new Set(tags)].slice(0, 20)
}

function normalizeId(value: unknown) {
  const id = normalizeString(value)
  if (!id) throw new HttpError(400, '资源 ID 不能为空')
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new HttpError(400, '资源 ID 格式不合法')
  return id
}

function normalizeResourceItem(value: unknown): ResourceItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ResourceItem>
  const id = normalizeString(raw.id)
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) return null

  return {
    id,
    title: normalizeString(raw.title),
    content: normalizeMultilineText(raw.content),
    note: normalizeMultilineText(raw.note),
    tags: normalizeTags((raw as { tags?: unknown }).tags),
    status: normalizeStatus(raw.status),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function resourceDirPath() {
  return path.join(config.dataDir, RESOURCE_DIR)
}

function resourceItemsDirPath() {
  return path.join(resourceDirPath(), ITEMS_DIR)
}

function legacyResourceFilePath() {
  return path.join(resourceDirPath(), LEGACY_FILE)
}

function legacyBackupFilePath() {
  return path.join(resourceDirPath(), LEGACY_BACKUP_FILE)
}

function resourceItemPath(idInput: unknown) {
  return path.join(resourceItemsDirPath(), `${normalizeId(idInput)}.json`)
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureResourceDir() {
  await fs.mkdir(resourceItemsDirPath(), { recursive: true })
}

async function readResourceFileByPath(filePath: string) {
  try {
    const text = await fs.readFile(filePath, 'utf-8')
    return normalizeResourceItem(JSON.parse(text))
  } catch {
    return null
  }
}

async function writeResourceFile(item: ResourceItem) {
  await ensureResourceDir()
  await fs.writeFile(resourceItemPath(item.id), `${JSON.stringify(item, null, 2)}\n`, 'utf-8')
}

async function backupLegacyResourceFile() {
  const source = legacyResourceFilePath()
  const target = legacyBackupFilePath()
  if (await pathExists(target)) {
    await fs.rm(source, { force: true })
    return
  }

  try {
    await fs.rename(source, target)
  } catch {
    await fs.copyFile(source, target)
    await fs.rm(source, { force: true })
  }
}

async function migrateLegacyResourcesIfNeeded() {
  await ensureResourceDir()
  const itemFiles = await fs.readdir(resourceItemsDirPath()).catch(() => [])
  if (itemFiles.some((name) => name.toLowerCase().endsWith('.json'))) return

  const legacyPath = legacyResourceFilePath()
  if (!(await pathExists(legacyPath))) return

  try {
    const text = await fs.readFile(legacyPath, 'utf-8')
    const raw = JSON.parse(text) as unknown
    const items = Array.isArray(raw) ? raw.map(normalizeResourceItem).filter((item): item is ResourceItem => Boolean(item)) : []
    for (const item of items) {
      await writeResourceFile(item)
    }
    await backupLegacyResourceFile()
  } catch {
    return
  }
}

async function readResources() {
  await migrateLegacyResourcesIfNeeded()
  const entries = await fs.readdir(resourceItemsDirPath(), { withFileTypes: true })
  const items = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => readResourceFileByPath(path.join(resourceItemsDirPath(), entry.name))),
  )
  return items.filter((item): item is ResourceItem => Boolean(item))
}

async function readResourceFile(idInput: unknown) {
  await migrateLegacyResourcesIfNeeded()
  const item = await readResourceFileByPath(resourceItemPath(idInput))
  if (!item) throw new HttpError(404, '资源不存在')
  return item
}

function assertContent(content: string) {
  if (!content) throw new HttpError(400, '资源内容不能为空')
  if (content.length > MAX_CONTENT_CHARS) {
    throw new HttpError(400, `资源内容过长，最多 ${MAX_CONTENT_CHARS} 个字符`)
  }
}

function matchesQuery(item: ResourceItem, query: string) {
  if (!query) return true
  const haystack = `${item.title}\n${item.content}\n${item.note}\n${item.tags.join('\n')}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function normalizeLimit(value: unknown) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 100
  return Math.min(Math.max(raw, 1), MAX_LIST_LIMIT)
}

export async function listResources(queryInput?: unknown, statusInput?: unknown, limitInput?: unknown) {
  const query = normalizeString(queryInput)
  const status = statusInput === 'active' || statusInput === 'struck' ? statusInput : ''
  const limit = normalizeLimit(limitInput)
  const items = await readResources()
  return items
    .filter((item) => (status ? item.status === status : true))
    .filter((item) => matchesQuery(item, query))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export async function getResource(idInput: unknown) {
  return readResourceFile(idInput)
}

export async function createResource(input: ResourceInput) {
  const title = normalizeString(input.title)
  const content = normalizeContent(input.content)
  const note = normalizeMultilineText(input.note)
  const tags = normalizeTags(input.tags)
  assertContent(content)

  const now = Date.now()
  const item: ResourceItem = {
    id: createId(),
    title,
    content,
    note,
    tags,
    status: normalizeStatus(input.status),
    createdAt: now,
    updatedAt: now,
  }
  await migrateLegacyResourcesIfNeeded()
  await writeResourceFile(item)
  return item
}

export async function updateResource(idInput: unknown, input: ResourceInput) {
  const current = await readResourceFile(idInput)
  const title = input.title === undefined ? current.title : normalizeString(input.title)
  const content = input.content === undefined ? current.content : normalizeContent(input.content)
  const note = input.note === undefined ? current.note : normalizeMultilineText(input.note)
  const tags = input.tags === undefined ? current.tags : normalizeTags(input.tags)
  const status = input.status === undefined ? current.status : normalizeStatus(input.status)
  assertContent(content)

  const next: ResourceItem = {
    ...current,
    title,
    content,
    note,
    tags,
    status,
    updatedAt: Date.now(),
  }
  await writeResourceFile(next)
  return next
}

export async function strikeResource(idInput: unknown, struck: boolean) {
  return updateResource(idInput, { status: struck ? 'struck' : 'active' })
}

export async function deleteResource(idInput: unknown) {
  const item = await readResourceFile(idInput)
  await fs.rm(resourceItemPath(item.id), { force: true })
  return { ok: true as const, deleted: item }
}
