import { api } from './client'

export type WechatAccountSummary = {
  accountId: string
  baseUrl: string
  userId?: string
  name?: string
  enabled: boolean
  savedAt?: string
  configured: boolean
  running: boolean
  lastInboundAt?: number
  lastOutboundAt?: number
  lastError?: string
}

export type WechatStatus = {
  available: boolean
  running: boolean
  accounts: WechatAccountSummary[]
}

export type WechatLoginStart = {
  sessionKey: string
  qrcodeUrl?: string
  message: string
  expiresAt: number
}

export type WechatLoginWait = {
  connected: boolean
  message: string
  account?: WechatAccountSummary
}

export type WechatDeliveryTarget = {
  accountId: string
  peerId: string
  label: string
  accountName?: string
  running: boolean
  configured: boolean
  lastMessageAt?: number
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
  name?: string
  webhookUrl?: string
  enabled?: boolean
}

export type WecomStatus = {
  available: true
  webhooks: WecomWebhookSummary[]
}

export const SocialChannelsApi = {
  wechatStatus: () => api.get<WechatStatus>('/channels/wechat/status'),
  wechatDeliveryTargets: () =>
    api.get<WechatDeliveryTarget[]>('/channels/wechat/delivery-targets'),
  startWechatLogin: () => api.post<WechatLoginStart>('/channels/wechat/login/start', {}),
  waitWechatLogin: (sessionKey: string, timeoutMs = 10_000) =>
    api.post<WechatLoginWait>('/channels/wechat/login/wait', { sessionKey, timeoutMs }),
  startWechatAccount: (accountId: string) =>
    api.post<WechatAccountSummary>(
      '/channels/wechat/accounts/' + encodeURIComponent(accountId) + '/start',
      {},
    ),
  stopWechatAccount: (accountId: string) =>
    api.post<WechatAccountSummary>(
      '/channels/wechat/accounts/' + encodeURIComponent(accountId) + '/stop',
      {},
    ),
  deleteWechatAccount: (accountId: string) =>
    api.delete<{ ok: true }>('/channels/wechat/accounts/' + encodeURIComponent(accountId)),

  wecomStatus: () => api.get<WecomStatus>('/channels/wecom/status'),
  wecomListWebhooks: () => api.get<WecomWebhookSummary[]>('/channels/wecom/webhooks'),
  wecomCreateWebhook: (payload: WecomWebhookInput) =>
    api.post<WecomWebhookSummary>('/channels/wecom/webhooks', payload),
  wecomUpdateWebhook: (id: string, payload: Partial<WecomWebhookInput>) =>
    api.patch<WecomWebhookSummary>('/channels/wecom/webhooks/' + encodeURIComponent(id), payload),
  wecomDeleteWebhook: (id: string) =>
    api.delete<{ ok: true }>('/channels/wecom/webhooks/' + encodeURIComponent(id)),
  wecomTestWebhook: (id: string) =>
    api.post<{ ok: true; message: string }>('/channels/wecom/webhooks/' + encodeURIComponent(id) + '/test', {}),
}
