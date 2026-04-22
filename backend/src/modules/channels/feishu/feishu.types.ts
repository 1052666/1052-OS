export type FeishuReceiveIdType = 'chat_id' | 'open_id' | 'user_id' | 'union_id' | 'email'

export type FeishuMessageType =
  | 'text'
  | 'post'
  | 'image'
  | 'file'
  | 'audio'
  | 'media'
  | 'sticker'
  | 'interactive'

export type FeishuAppConfigRecord = {
  appId?: string
  appSecret?: string
  verificationToken?: string
  encryptKey?: string
  callbackBaseUrl?: string
  enabled: boolean
  autoReplyEnabled: boolean
  cardCallbackEnabled: boolean
  savedAt?: string
}

export type FeishuAppStatus = {
  available: true
  configured: boolean
  enabled: boolean
  autoReplyEnabled: boolean
  cardCallbackEnabled: boolean
  appIdMasked?: string
  hasAppSecret: boolean
  hasVerificationToken: boolean
  hasEncryptKey: boolean
  callbackBaseUrl?: string
  eventWebhookPath: string
  cardWebhookPath: string
  callbackUrls: {
    event?: string
    card?: string
  }
  running: boolean
  savedAt?: string
  lastInboundAt?: number
  lastOutboundAt?: number
  lastEventAt?: number
  lastError?: string
}

export type FeishuChatType = 'p2p' | 'group'

export type FeishuChatRecord = {
  receiveIdType: 'chat_id'
  receiveId: string
  chatId: string
  chatType: FeishuChatType
  label: string
  lastMessageAt?: number
  lastMessageId?: string
  lastSenderOpenId?: string
  lastSenderName?: string
}

export type FeishuDeliveryTarget = {
  receiveIdType: 'chat_id'
  receiveId: string
  label: string
  chatType: FeishuChatType
  lastMessageAt?: number
}

export type FeishuCardActionValue = {
  actionType: string
  entityType?: string
  entityId?: string
  notificationId?: string
  taskId?: string
  enabled?: boolean
  receiveId?: string
  url?: string
  source?: string
  version?: number
  [key: string]: unknown
}

export type FeishuMessageSendResult = {
  ok: true
  msgType: FeishuMessageType
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  messageId?: string
  chatId?: string
}

export type FeishuWorkspaceConfigRecord = {
  webBaseUrl?: string
  driveFolderToken?: string
  wikiSpaceId?: string
  wikiParentNodeToken?: string
  bitableAppToken?: string
  bitableTableId?: string
  searchDataSourceId?: string
  approvalCode?: string
  calendarId?: string
  enableNotificationCards: boolean
  enableMemoryCards: boolean
  enableScheduledTaskCards: boolean
  savedAt?: string
}

export type FeishuSyncJobStatus = 'running' | 'success' | 'failed'

export type FeishuSyncJobRecord = {
  id: string
  type: string
  title: string
  status: FeishuSyncJobStatus
  startedAt: number
  finishedAt?: number
  summary?: string
  result?: Record<string, unknown>
}

export type FeishuEventLogRecord = {
  id: string
  type: string
  title: string
  detail?: string
  source?: string
  createdAt: number
}

export type FeishuWorkspaceStatus = {
  config: FeishuWorkspaceConfigRecord
  recentJobs: FeishuSyncJobRecord[]
  recentEvents: FeishuEventLogRecord[]
}
