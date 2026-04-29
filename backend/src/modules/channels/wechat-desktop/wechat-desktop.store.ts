import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from '../../../storage.js'
import type {
  WechatDesktopConfigRecord,
  WechatDesktopGroupMemoryItem,
  WechatDesktopGroupRecord,
  WechatDesktopSessionRecord,
  WechatDesktopSessionType,
} from './wechat-desktop.types.js'

const ROOT = path.join('channels', 'wechat-desktop')
const CONFIG_FILE = path.join(ROOT, 'config.json')
const SESSIONS_FILE = path.join(ROOT, 'sessions.json')
const GROUPS_FILE = path.join(ROOT, 'groups.json')
const GROUP_MEMORY_FILE = path.join(ROOT, 'group-memory.json')

export function defaultWechatDesktopConfig(): WechatDesktopConfigRecord {
  return {
    enabled: false,
    autoStart: false,
    pythonCommand: 'python',
    pywechatRoot: path.resolve(process.cwd(), '..', 'vendor', 'pywechat-windows-ui-auto-main'),
    botNames: [],
    chatNames: [],
    searchPages: 5,
    listenerEnabled: false,
  }
}

function trimString(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeSessionId(value: unknown, fallbackName = '') {
  const base = trimString(value || fallbackName, 200)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || `wxdesk-${Date.now().toString(36)}`
}

function normalizeSessionType(value: unknown): WechatDesktopSessionType {
  return value === 'group' ? 'group' : 'direct'
}

function nowIso() {
  return new Date().toISOString()
}

export async function loadWechatDesktopConfig(): Promise<WechatDesktopConfigRecord> {
  const raw = await readJson<Partial<WechatDesktopConfigRecord>>(CONFIG_FILE, {})
  const fallback = defaultWechatDesktopConfig()
  return {
    enabled: raw.enabled === true,
    autoStart: raw.autoStart === true,
    pythonCommand: trimString(raw.pythonCommand, 200) || fallback.pythonCommand,
    scriptPath: trimString(raw.scriptPath, 400) || undefined,
    pywechatRoot: trimString(raw.pywechatRoot, 400) || fallback.pywechatRoot,
    botNames: Array.isArray(raw.botNames)
      ? raw.botNames.map((item) => trimString(item, 120)).filter(Boolean)
      : fallback.botNames,
    chatNames: Array.isArray(raw.chatNames)
      ? raw.chatNames.map((item) => trimString(item, 160)).filter(Boolean)
      : fallback.chatNames,
    searchPages:
      typeof raw.searchPages === 'number' && Number.isFinite(raw.searchPages)
        ? Math.max(1, Math.min(20, Math.floor(raw.searchPages)))
        : fallback.searchPages,
    listenerEnabled: raw.listenerEnabled === true,
    savedAt: trimString(raw.savedAt, 80) || undefined,
  }
}

export async function saveWechatDesktopConfig(
  update: Partial<WechatDesktopConfigRecord>,
): Promise<WechatDesktopConfigRecord> {
  const current = await loadWechatDesktopConfig()
  const next: WechatDesktopConfigRecord = {
    enabled: update.enabled ?? current.enabled,
    autoStart: update.autoStart ?? current.autoStart,
    pythonCommand: trimString(update.pythonCommand, 200) || current.pythonCommand,
    scriptPath: trimString(update.scriptPath, 400) || current.scriptPath,
    pywechatRoot: trimString(update.pywechatRoot, 400) || current.pywechatRoot,
    botNames: Array.isArray(update.botNames)
      ? update.botNames.map((item) => trimString(item, 120)).filter(Boolean)
      : current.botNames,
    chatNames: Array.isArray(update.chatNames)
      ? update.chatNames.map((item) => trimString(item, 160)).filter(Boolean)
      : current.chatNames,
    searchPages:
      typeof update.searchPages === 'number' && Number.isFinite(update.searchPages)
        ? Math.max(1, Math.min(20, Math.floor(update.searchPages)))
        : current.searchPages,
    listenerEnabled: update.listenerEnabled ?? current.listenerEnabled,
    savedAt: nowIso(),
  }
  await writeJson(CONFIG_FILE, next)
  return next
}

export async function listWechatDesktopSessions(): Promise<WechatDesktopSessionRecord[]> {
  const raw = await readJson<unknown[]>(SESSIONS_FILE, [])
  const items: WechatDesktopSessionRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const sessionName = trimString(record.sessionName, 160)
    const sessionId = normalizeSessionId(record.sessionId, sessionName)
    if (!sessionName) continue
    items.push({
      sessionId,
      sessionName,
      sessionType: normalizeSessionType(record.sessionType),
      enabled: record.enabled !== false,
      listening: record.listening === true,
      source: record.source === 'discovered' ? 'discovered' : 'configured',
      lastMessageAt:
        typeof record.lastMessageAt === 'number' && Number.isFinite(record.lastMessageAt)
          ? record.lastMessageAt
          : undefined,
      lastSenderName: trimString(record.lastSenderName, 120) || undefined,
      lastMessagePreview: trimString(record.lastMessagePreview, 500) || undefined,
      updatedAt: trimString(record.updatedAt, 80) || nowIso(),
    })
  }
  return items.sort(
    (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.sessionName.localeCompare(b.sessionName),
  )
}

export async function saveWechatDesktopSessions(items: WechatDesktopSessionRecord[]) {
  await writeJson(SESSIONS_FILE, items)
}

export async function upsertWechatDesktopSession(
  input: Partial<WechatDesktopSessionRecord> & {
    sessionName: string
    sessionType?: WechatDesktopSessionType
  },
) {
  const items = await listWechatDesktopSessions()
  const sessionId = normalizeSessionId(input.sessionId, input.sessionName)
  const index = items.findIndex((item) => item.sessionId === sessionId)
  const current = index >= 0 ? items[index] : null
  const next: WechatDesktopSessionRecord = {
    sessionId,
    sessionName: trimString(input.sessionName, 160),
    sessionType: input.sessionType ?? current?.sessionType ?? 'direct',
    enabled: input.enabled ?? current?.enabled ?? true,
    listening: input.listening ?? current?.listening ?? false,
    source: input.source ?? current?.source ?? 'configured',
    lastMessageAt: input.lastMessageAt ?? current?.lastMessageAt,
    lastSenderName: trimString(input.lastSenderName, 120) || current?.lastSenderName,
    lastMessagePreview:
      trimString(input.lastMessagePreview, 500) || current?.lastMessagePreview,
    updatedAt: nowIso(),
  }
  if (index >= 0) items[index] = next
  else items.unshift(next)
  await saveWechatDesktopSessions(items)
  return next
}

export async function listWechatDesktopGroups(): Promise<WechatDesktopGroupRecord[]> {
  const raw = await readJson<unknown[]>(GROUPS_FILE, [])
  const items: WechatDesktopGroupRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const groupName = trimString(record.groupName, 160)
    const groupId = normalizeSessionId(record.groupId, groupName)
    if (!groupName) continue
    items.push({
      groupId,
      groupName,
      enabled: record.enabled !== false,
      mode: record.mode === 'full' ? 'full' : 'chat',
      promptAppend: trimString(record.promptAppend, 6000),
      allowTools: record.allowTools === true,
      allowMemoryWrite: record.allowMemoryWrite !== false,
      allowAutoReply: record.allowAutoReply !== false,
      mentionOnly: record.mentionOnly !== false,
      lastMessageAt:
        typeof record.lastMessageAt === 'number' && Number.isFinite(record.lastMessageAt)
          ? record.lastMessageAt
          : undefined,
      lastSenderName: trimString(record.lastSenderName, 120) || undefined,
      updatedAt: trimString(record.updatedAt, 80) || nowIso(),
    })
  }
  return items.sort(
    (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.groupName.localeCompare(b.groupName),
  )
}

export async function saveWechatDesktopGroups(items: WechatDesktopGroupRecord[]) {
  await writeJson(GROUPS_FILE, items)
}

export async function upsertWechatDesktopGroup(
  input: Partial<WechatDesktopGroupRecord> & { groupName: string },
) {
  const items = await listWechatDesktopGroups()
  const groupId = normalizeSessionId(input.groupId, input.groupName)
  const index = items.findIndex((item) => item.groupId === groupId)
  const current = index >= 0 ? items[index] : null
  const next: WechatDesktopGroupRecord = {
    groupId,
    groupName: trimString(input.groupName, 160),
    enabled: input.enabled ?? current?.enabled ?? true,
    mode: input.mode ?? current?.mode ?? 'chat',
    promptAppend: trimString(input.promptAppend, 6000) || current?.promptAppend || '',
    allowTools: input.allowTools ?? current?.allowTools ?? false,
    allowMemoryWrite: input.allowMemoryWrite ?? current?.allowMemoryWrite ?? true,
    allowAutoReply: input.allowAutoReply ?? current?.allowAutoReply ?? true,
    mentionOnly: input.mentionOnly ?? current?.mentionOnly ?? true,
    lastMessageAt: input.lastMessageAt ?? current?.lastMessageAt,
    lastSenderName: trimString(input.lastSenderName, 120) || current?.lastSenderName,
    updatedAt: nowIso(),
  }
  if (index >= 0) items[index] = next
  else items.unshift(next)
  await saveWechatDesktopGroups(items)
  return next
}

export async function getWechatDesktopGroup(groupIdInput: unknown) {
  const groupId = normalizeSessionId(groupIdInput)
  return (await listWechatDesktopGroups()).find((item) => item.groupId === groupId) ?? null
}

export async function listWechatDesktopGroupMemories(groupIdInput?: unknown) {
  const groupId = groupIdInput ? normalizeSessionId(groupIdInput) : ''
  const raw = await readJson<unknown[]>(GROUP_MEMORY_FILE, [])
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = trimString(record.id, 100)
      const groupName = trimString(record.groupName, 160)
      const parsedGroupId = normalizeSessionId(record.groupId, groupName)
      const title = trimString(record.title, 160)
      const content = trimString(record.content, 8000)
      if (!id || !parsedGroupId || !title || !content) return null
      return {
        id,
        groupId: parsedGroupId,
        groupName,
        title,
        content,
        source:
          record.source === 'user_explicit' || record.source === 'tool_write'
            ? record.source
            : 'agent_inferred',
        createdAt:
          typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
            ? record.createdAt
            : Date.now(),
        updatedAt:
          typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
            ? record.updatedAt
            : Date.now(),
        active: record.active !== false,
      } satisfies WechatDesktopGroupMemoryItem
    })
    .filter((item): item is WechatDesktopGroupMemoryItem => item !== null)
    .filter((item) => (groupId ? item.groupId === groupId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveWechatDesktopGroupMemories(items: WechatDesktopGroupMemoryItem[]) {
  await writeJson(GROUP_MEMORY_FILE, items)
}

export async function createWechatDesktopGroupMemory(input: {
  groupId: string
  groupName: string
  title: string
  content: string
  source: WechatDesktopGroupMemoryItem['source']
}) {
  const items = await listWechatDesktopGroupMemories()
  const now = Date.now()
  const item: WechatDesktopGroupMemoryItem = {
    id: `wxgm_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    groupId: normalizeSessionId(input.groupId, input.groupName),
    groupName: trimString(input.groupName, 160),
    title: trimString(input.title, 160),
    content: trimString(input.content, 8000),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    active: true,
  }
  items.unshift(item)
  await saveWechatDesktopGroupMemories(items)
  return item
}
