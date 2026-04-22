import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../../config.js'
import { WECHAT_DEFAULT_BASE_URL } from './wechat.api.js'
import type { WechatAccountRecord } from './wechat.types.js'

const CHANNEL_DIR = path.join('channels', 'wechat')
const ACCOUNTS_DIR = 'accounts'
const INDEX_FILE = 'accounts.json'
const SEEN_FILE = 'seen-messages.json'
const MAX_SEEN_KEYS = 2000

function rootDir() {
  return path.join(config.dataDir, CHANNEL_DIR)
}

function accountsDir() {
  return path.join(rootDir(), ACCOUNTS_DIR)
}

function indexPath() {
  return path.join(rootDir(), INDEX_FILE)
}

function seenPath() {
  return path.join(rootDir(), SEEN_FILE)
}

function accountPath(accountId: string) {
  return path.join(accountsDir(), `${normalizeAccountId(accountId)}.json`)
}

function syncPath(accountId: string) {
  return path.join(accountsDir(), `${normalizeAccountId(accountId)}.sync.json`)
}

function contextTokenPath(accountId: string) {
  return path.join(accountsDir(), `${normalizeAccountId(accountId)}.context-tokens.json`)
}

async function ensureDirs() {
  await fs.mkdir(accountsDir(), { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T) {
  try {
    const text = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeJson<T>(filePath: string, data: T) {
  await ensureDirs()
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

export function normalizeAccountId(value: string) {
  const normalized = value
    .trim()
    .replace(/@/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || `wechat-${Date.now().toString(36)}`
}

export async function listWechatAccountIds() {
  await ensureDirs()
  const items = await readJson<unknown>(indexPath(), [])
  return Array.isArray(items)
    ? items.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

export async function registerWechatAccountId(accountId: string) {
  const id = normalizeAccountId(accountId)
  const ids = await listWechatAccountIds()
  if (ids.includes(id)) return
  await writeJson(indexPath(), [...ids, id])
}

export async function unregisterWechatAccountId(accountId: string) {
  const id = normalizeAccountId(accountId)
  const ids = await listWechatAccountIds()
  await writeJson(indexPath(), ids.filter((item) => item !== id))
}

export async function loadWechatAccount(accountId: string): Promise<WechatAccountRecord | null> {
  const id = normalizeAccountId(accountId)
  const data = await readJson<Partial<WechatAccountRecord> | null>(accountPath(id), null)
  if (!data) return null
  return {
    accountId: id,
    token: typeof data.token === 'string' ? data.token : undefined,
    baseUrl: typeof data.baseUrl === 'string' && data.baseUrl.trim() ? data.baseUrl : WECHAT_DEFAULT_BASE_URL,
    userId: typeof data.userId === 'string' ? data.userId : undefined,
    name: typeof data.name === 'string' ? data.name : undefined,
    enabled: data.enabled !== false,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
  }
}

export async function listWechatAccounts() {
  const ids = await listWechatAccountIds()
  const accounts = await Promise.all(ids.map((id) => loadWechatAccount(id)))
  return accounts.filter((item): item is WechatAccountRecord => Boolean(item))
}

export async function saveWechatAccount(
  accountId: string,
  update: Partial<WechatAccountRecord>,
) {
  const id = normalizeAccountId(accountId)
  const existing = await loadWechatAccount(id)
  const next: WechatAccountRecord = {
    accountId: id,
    baseUrl: update.baseUrl?.trim() || existing?.baseUrl || WECHAT_DEFAULT_BASE_URL,
    token: update.token?.trim() || existing?.token,
    userId: update.userId?.trim() || existing?.userId,
    name: update.name?.trim() || existing?.name,
    enabled: update.enabled ?? existing?.enabled ?? true,
    savedAt: new Date().toISOString(),
  }
  await writeJson(accountPath(id), next)
  try {
    await fs.chmod(accountPath(id), 0o600)
  } catch {
    // Windows may ignore chmod; token remains in the private data directory.
  }
  await registerWechatAccountId(id)
  return next
}

export async function removeWechatAccount(accountId: string) {
  const id = normalizeAccountId(accountId)
  await unregisterWechatAccountId(id)
  await fs.rm(accountPath(id), { force: true })
  await fs.rm(syncPath(id), { force: true })
  await fs.rm(contextTokenPath(id), { force: true })
}

export async function loadWechatSyncBuf(accountId: string) {
  const data = await readJson<{ get_updates_buf?: unknown }>(syncPath(accountId), {})
  return typeof data.get_updates_buf === 'string' ? data.get_updates_buf : ''
}

export async function saveWechatSyncBuf(accountId: string, getUpdatesBuf: string) {
  await writeJson(syncPath(accountId), { get_updates_buf: getUpdatesBuf })
}

export async function getWechatContextToken(accountId: string, peerId: string) {
  const data = await readJson<Record<string, string>>(contextTokenPath(accountId), {})
  return data[peerId]
}

export async function listWechatContextTokens(accountId: string) {
  const data = await readJson<Record<string, string>>(contextTokenPath(accountId), {})
  return Object.entries(data)
    .filter(([peerId, token]) => Boolean(peerId.trim()) && Boolean(token.trim()))
    .map(([peerId, token]) => ({ peerId, token }))
}

export async function setWechatContextToken(accountId: string, peerId: string, token: string) {
  const data = await readJson<Record<string, string>>(contextTokenPath(accountId), {})
  data[peerId] = token
  await writeJson(contextTokenPath(accountId), data)
}

export async function hasSeenWechatMessage(key: string) {
  const data = await readJson<string[]>(seenPath(), [])
  return data.includes(key)
}

export async function markSeenWechatMessage(key: string) {
  const data = await readJson<string[]>(seenPath(), [])
  if (data.includes(key)) return
  await writeJson(seenPath(), [...data, key].slice(-MAX_SEEN_KEYS))
}
