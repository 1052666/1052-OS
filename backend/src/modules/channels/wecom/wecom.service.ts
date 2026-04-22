import { randomUUID } from 'node:crypto'
import { HttpError } from '../../../http-error.js'
import { sendWecomWebhookText } from './wecom.api.js'
import {
  listWecomWebhooks,
  loadWecomWebhook,
  removeWecomWebhook,
  saveWecomWebhook,
} from './wecom.store.js'
import type {
  WecomWebhookInput,
  WecomWebhookRecord,
  WecomWebhookStatus,
  WecomWebhookSummary,
} from './wecom.types.js'

function toSummary(record: WecomWebhookRecord): WecomWebhookSummary {
  const url = record.webhookUrl
  const keyMatch = url.match(/[?&]key=([^&]+)/)
  const webhookKey = keyMatch ? keyMatch[1]! : url.slice(-8)
  return {
    id: record.id,
    name: record.name,
    webhookKey,
    enabled: record.enabled,
    savedAt: record.savedAt,
    lastSentAt: record.lastSentAt,
    lastError: record.lastError,
  }
}

function toCleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeWebhookUrl(value: unknown) {
  const url = toCleanString(value, 500)
  if (!url) return ''
  if (!url.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send')) {
    throw new HttpError(
      400,
      'Webhook URL 格式不正确，应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
    )
  }
  return url
}

export async function getWecomStatus(): Promise<WecomWebhookStatus> {
  const webhooks = await listWecomWebhooks()
  return {
    available: true,
    webhooks: webhooks.map(toSummary),
  }
}

export async function listWecomChannelWebhooks(): Promise<WecomWebhookSummary[]> {
  const webhooks = await listWecomWebhooks()
  return webhooks.map(toSummary)
}

export async function createWecomWebhook(input: WecomWebhookInput) {
  const name = toCleanString(input.name, 120)
  const webhookUrl = normalizeWebhookUrl(input.webhookUrl)
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true

  if (!name) throw new HttpError(400, 'Webhook 名称不能为空')
  if (!webhookUrl) throw new HttpError(400, 'Webhook URL 不能为空')

  const record: WecomWebhookRecord = {
    id: randomUUID().slice(0, 8),
    name,
    webhookUrl,
    enabled,
    savedAt: new Date().toISOString(),
  }
  const saved = await saveWecomWebhook(record)
  return toSummary(saved)
}

export async function updateWecomWebhook(id: string, input: WecomWebhookInput) {
  const existing = await loadWecomWebhook(id)
  if (!existing) throw new HttpError(404, 'Webhook 不存在')

  const name = input.name !== undefined ? toCleanString(input.name, 120) : existing.name
  const webhookUrl =
    input.webhookUrl !== undefined ? normalizeWebhookUrl(input.webhookUrl) : existing.webhookUrl
  const enabled =
    typeof input.enabled === 'boolean' ? input.enabled : existing.enabled

  if (!name) throw new HttpError(400, 'Webhook 名称不能为空')
  if (!webhookUrl) throw new HttpError(400, 'Webhook URL 不能为空')

  const next: WecomWebhookRecord = {
    ...existing,
    name,
    webhookUrl,
    enabled,
  }
  const saved = await saveWecomWebhook(next)
  return toSummary(saved)
}

export async function deleteWecomWebhook(id: string) {
  const existing = await loadWecomWebhook(id)
  if (!existing) throw new HttpError(404, 'Webhook 不存在')
  await removeWecomWebhook(id)
  return { ok: true as const, id }
}

export async function testWecomWebhook(id: string) {
  const record = await loadWecomWebhook(id)
  if (!record) throw new HttpError(404, 'Webhook 不存在')
  if (!record.enabled) throw new HttpError(400, 'Webhook 已禁用，请先启用后再测试')

  const testContent = `[1052 OS] 测试消息 - ${new Date().toLocaleString('zh-CN')}`
  await sendWecomWebhookText(record.webhookUrl, testContent)

  const updated: WecomWebhookRecord = {
    ...record,
    lastSentAt: Date.now(),
    lastError: undefined,
  }
  await saveWecomWebhook(updated)
  return { ok: true as const, message: '测试消息已发送' }
}

export async function sendWecomWebhookMessage(webhookId: string, content: string) {
  const record = await loadWecomWebhook(webhookId)
  if (!record) throw new HttpError(404, 'Webhook 不存在')
  if (!record.enabled) throw new HttpError(400, 'Webhook 已禁用')

  try {
    await sendWecomWebhookText(record.webhookUrl, content)
    const updated: WecomWebhookRecord = {
      ...record,
      lastSentAt: Date.now(),
      lastError: undefined,
    }
    await saveWecomWebhook(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated: WecomWebhookRecord = {
      ...record,
      lastError: message,
    }
    await saveWecomWebhook(updated)
    throw error
  }

  return { ok: true as const }
}
