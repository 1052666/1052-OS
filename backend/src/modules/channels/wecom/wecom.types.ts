export type WecomWebhookRecord = {
  id: string
  name: string
  webhookUrl: string
  enabled: boolean
  savedAt: string
  lastSentAt?: number
  lastError?: string
}

export type WecomWebhookSummary = {
  id: string
  name: string
  webhookKey: string
  enabled: boolean
  savedAt: string
  lastSentAt?: number
  lastError?: string
}

export type WecomWebhookInput = {
  name?: unknown
  webhookUrl?: unknown
  enabled?: unknown
}

export type WecomWebhookStatus = {
  available: true
  webhooks: WecomWebhookSummary[]
}
