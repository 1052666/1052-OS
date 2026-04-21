import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../../config.js'
import type { WecomWebhookRecord } from './wecom.types.js'

const CHANNEL_DIR = path.join('channels', 'wecom')
const WEBHOOKS_DIR = 'webhooks'
const INDEX_FILE = 'webhooks.json'

function rootDir() {
  return path.join(config.dataDir, CHANNEL_DIR)
}

function webhooksDir() {
  return path.join(rootDir(), WEBHOOKS_DIR)
}

function indexPath() {
  return path.join(rootDir(), INDEX_FILE)
}

function webhookPath(id: string) {
  return path.join(webhooksDir(), `${id}.json`)
}

async function ensureDirs() {
  await fs.mkdir(webhooksDir(), { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
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

function sanitizeId(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function listWecomWebhookIds(): Promise<string[]> {
  await ensureDirs()
  const items = await readJson<unknown>(indexPath(), [])
  return Array.isArray(items)
    ? items.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

async function registerWebhookId(id: string) {
  const ids = await listWecomWebhookIds()
  if (ids.includes(id)) return
  await writeJson(indexPath(), [...ids, id])
}

async function unregisterWebhookId(id: string) {
  const ids = await listWecomWebhookIds()
  await writeJson(
    indexPath(),
    ids.filter((item) => item !== id),
  )
}

export async function loadWecomWebhook(id: string): Promise<WecomWebhookRecord | null> {
  const data = await readJson<Partial<WecomWebhookRecord> | null>(webhookPath(id), null)
  if (!data) return null
  return {
    id: data.id ?? id,
    name: typeof data.name === 'string' ? data.name : '',
    webhookUrl: typeof data.webhookUrl === 'string' ? data.webhookUrl : '',
    enabled: data.enabled !== false,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date().toISOString(),
    lastSentAt: typeof data.lastSentAt === 'number' ? data.lastSentAt : undefined,
    lastError: typeof data.lastError === 'string' ? data.lastError : undefined,
  }
}

export async function listWecomWebhooks(): Promise<WecomWebhookRecord[]> {
  const ids = await listWecomWebhookIds()
  const records = await Promise.all(ids.map((id) => loadWecomWebhook(id)))
  return records.filter((r): r is WecomWebhookRecord => r !== null)
}

export async function saveWecomWebhook(record: WecomWebhookRecord) {
  const id = sanitizeId(record.id)
  const next: WecomWebhookRecord = {
    ...record,
    id,
    savedAt: new Date().toISOString(),
  }
  await writeJson(webhookPath(id), next)
  await registerWebhookId(id)
  return next
}

export async function removeWecomWebhook(id: string) {
  const safeId = sanitizeId(id)
  await unregisterWebhookId(safeId)
  await fs.rm(webhookPath(safeId), { force: true })
}
