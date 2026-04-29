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

export type WechatSendInput = {
  accountId: string
  peerId: string
  text: string
}

export type WechatSendResult = {
  ok: true
  chunks: number
  media: number
}

export type WechatMediaSendInput = {
  accountId: string
  peerId: string
  text?: string
  file: File
}

export type WechatUiBridgeStatus = {
  enabled: boolean
  running: boolean
  probed?: boolean
  message?: string
  root?: string
  config?: WechatUiBridgeConfig
  listener?: WechatUiBridgeListenerStatus
  profile?: Record<string, unknown>
  profileError?: string
}

export type WechatUiBridgeConfig = {
  pywechatRoot?: string
  botNames?: string[]
  chatNames?: string[]
  searchPages?: number
  listenerEnabled?: boolean
  savedAt?: string
}

export type WechatUiBridgeListenerStatus = {
  running: boolean
  startedAt?: string
  stoppedAt?: string
  lastCheckAt?: string
  lastMentionAt?: string
  lastError?: string
  processedCount: number
  processedKeys: number
  missingWindows: string[]
}

export type WechatUiBridgeSendResult = {
  ok: true
  sent: true
  friend: string
}

export type WechatUiBridgeMessagesResult = {
  ok: true
  messages: Record<string, unknown>
  structured?: Array<{
    chat: string
    rawMessages: string[]
    messages: Array<{
      raw: string
      sender?: string | null
      text: string
      mentioned: boolean
      mentions: string[]
    }>
  }>
}

export type WechatUiBridgeMentionsResult = {
  ok: true
  botNames?: string[]
  chatNames?: string[]
  missingWindows?: string[]
  mentions?: Array<{
    chat: string
    raw: string
    sender?: string | null
    text: string
    mentioned: boolean
    mentions: string[]
  }>
  structured?: WechatUiBridgeMessagesResult['structured']
}

export type WechatUiBridgeGroupsResult = {
  ok: true
  groups: Array<{
    name: string
    members?: string | null
  }>
}

export type WechatUiBridgeProcessResult = {
  ok: true
  chat: string
  sender: string
  reply: string
  userMessageId: number
  assistantMessageId: number
}

export type FeishuStatus = {
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

export type FeishuDeliveryTarget = {
  receiveIdType: 'chat_id'
  receiveId: string
  label: string
  chatType: 'p2p' | 'group'
  lastMessageAt?: number
}

export type FeishuConfigInput = {
  appId?: string
  appSecret?: string
  verificationToken?: string
  encryptKey?: string
  callbackBaseUrl?: string
  enabled?: boolean
  autoReplyEnabled?: boolean
  cardCallbackEnabled?: boolean
}

export type FeishuSendInput = {
  receiveIdType: 'chat_id' | 'open_id' | 'user_id' | 'union_id' | 'email'
  receiveId: string
  text?: string
  card?: unknown
  cardTemplate?: 'test'
}

export type FeishuSendResult = {
  ok: true
  msgType: 'text' | 'post' | 'image' | 'file' | 'audio' | 'media' | 'sticker' | 'interactive'
  receiveIdType: FeishuSendInput['receiveIdType']
  receiveId: string
  messageId?: string
  chatId?: string
}

export type FeishuMediaSendInput = {
  receiveIdType: FeishuSendInput['receiveIdType']
  receiveId: string
  mode?: 'auto' | 'image' | 'file' | 'audio' | 'media'
  text?: string
  file: File
}

export type FeishuMediaSendResult = {
  ok: true
  result: FeishuSendResult
  results: FeishuSendResult[]
  warnings: string[]
}

export type FeishuWorkspaceConfig = {
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

export type FeishuSyncJob = {
  id: string
  type: string
  title: string
  status: 'running' | 'success' | 'failed'
  startedAt: number
  finishedAt?: number
  summary?: string
  result?: Record<string, unknown>
}

export type FeishuEventLog = {
  id: string
  type: string
  title: string
  detail?: string
  source?: string
  createdAt: number
}

export type FeishuWorkspaceStatus = {
  config: FeishuWorkspaceConfig
  recentJobs: FeishuSyncJob[]
  recentEvents: FeishuEventLog[]
}

export type WechatDesktopConfig = {
  enabled: boolean
  autoStart: boolean
  pythonCommand?: string
  scriptPath?: string
  pywechatRoot?: string
  botNames: string[]
  chatNames: string[]
  searchPages?: number
  listenerEnabled?: boolean
  savedAt?: string
}

export type WechatDesktopSessionType = 'direct' | 'group'
export type WechatDesktopGroupMode = 'chat' | 'full'

export type WechatDesktopSession = {
  sessionId: string
  sessionName: string
  sessionType: WechatDesktopSessionType
  enabled: boolean
  listening: boolean
  source: 'configured' | 'discovered'
  lastMessageAt?: number
  lastSenderName?: string
  lastMessagePreview?: string
  updatedAt: string
}

export type WechatDesktopGroup = {
  groupId: string
  groupName: string
  enabled: boolean
  mode: WechatDesktopGroupMode
  promptAppend: string
  allowTools: boolean
  allowMemoryWrite: boolean
  allowAutoReply: boolean
  mentionOnly: boolean
  lastMessageAt?: number
  lastSenderName?: string
  updatedAt: string
}

export type WechatDesktopGroupMemory = {
  id: string
  groupId: string
  groupName: string
  title: string
  content: string
  source: 'agent_inferred' | 'user_explicit' | 'tool_write'
  createdAt: number
  updatedAt: number
  active: boolean
}

export type WechatDesktopStatus = {
  available: true
  config: WechatDesktopConfig
  runtime: {
    running: boolean
    pid?: number
    startedAt?: number
    lastEventAt?: number
    lastMessageAt?: number
    selfName?: string
    lastError?: string
  }
  sessions: WechatDesktopSession[]
  groups: WechatDesktopGroup[]
}

export type FeishuDocImportResult = {
  ticket?: string
  token?: string
  url?: string
  type?: string
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
  wechatUiBridgeStatus: (input: {
    includeProfile?: boolean
    probeDesktop?: boolean
    pywechatRoot?: string
  } = {}) => {
    const params = new URLSearchParams()
    if (input.includeProfile) params.set('includeProfile', 'true')
    if (input.probeDesktop) params.set('probeDesktop', 'true')
    if (input.pywechatRoot?.trim()) params.set('pywechatRoot', input.pywechatRoot.trim())
    const query = params.toString()
    return api.get<WechatUiBridgeStatus>(
      `/channels/wechat/ui/status${query ? `?${query}` : ''}`,
    )
  },
  saveWechatUiBridgeConfig: (input: {
    pywechatRoot?: string
    botNames?: string[]
    chatNames?: string[]
    searchPages?: number
    listenerEnabled?: boolean
  }) => api.post<WechatUiBridgeConfig>('/channels/wechat/ui/config', input),
  wechatUiBridgeSendText: (input: {
    friend: string
    text: string
    confirmed: boolean
    pywechatRoot?: string
  }) =>
    api.post<WechatUiBridgeSendResult>('/channels/wechat/ui/send-text', input),
  wechatUiBridgeGroups: (input: {
    confirmed: boolean
    recent?: boolean
    pywechatRoot?: string
  }) => api.post<WechatUiBridgeGroupsResult>('/channels/wechat/ui/groups', input),
  wechatUiBridgeBindChatWindows: (input: {
    confirmed: boolean
    chatNames: string[]
    minimize?: boolean
    pywechatRoot?: string
  }) =>
    api.post<{
      ok: true
      chatNames: string[]
      windows: Array<{ chat: string; bound: boolean; reused?: boolean; error?: string }>
      allBound: boolean
    }>('/channels/wechat/ui/bind-chat-windows', input),
  wechatUiBridgeListenerStatus: () =>
    api.get<{ ok: true; listener: WechatUiBridgeListenerStatus }>('/channels/wechat/ui/listener'),
  wechatUiBridgeStartListener: (input: {
    confirmed: boolean
    pywechatRoot?: string
    botNames?: string[]
    chatNames?: string[]
    searchPages?: number
  }) =>
    api.post<{
      ok: true
      listener: WechatUiBridgeListenerStatus
      bindResult?: unknown
    }>('/channels/wechat/ui/listener/start', input),
  wechatUiBridgeStopListener: (input: { confirmed: boolean }) =>
    api.post<{ ok: true; listener: WechatUiBridgeListenerStatus }>(
      '/channels/wechat/ui/listener/stop',
      input,
    ),
  wechatUiBridgeCheckNewMessages: (input: {
    confirmed: boolean
    searchPages?: number
    botNames?: string[]
    chatNames?: string[]
    pywechatRoot?: string
  }) => api.post<WechatUiBridgeMessagesResult>('/channels/wechat/ui/check-new-messages', input),
  wechatUiBridgeCheckMentions: (input: {
    confirmed: boolean
    searchPages?: number
    botNames?: string[]
    chatNames?: string[]
    resetPosition?: boolean
    pywechatRoot?: string
  }) => api.post<WechatUiBridgeMentionsResult>('/channels/wechat/ui/check-mentions', input),
  wechatUiBridgeProcessMention: (input: {
    confirmed: boolean
    chat: string
    sender?: string
    text: string
    raw?: string
    pywechatRoot?: string
  }) => api.post<WechatUiBridgeProcessResult>('/channels/wechat/ui/process-mention', input),
  startWechatLogin: () => api.post<WechatLoginStart>('/channels/wechat/login/start', {}),
  waitWechatLogin: (sessionKey: string, timeoutMs = 10_000) =>
    api.post<WechatLoginWait>('/channels/wechat/login/wait', { sessionKey, timeoutMs }),
  sendWechatMessage: (input: WechatSendInput) =>
    api.post<WechatSendResult>('/channels/wechat/send', input),
  sendWechatMedia: async (input: WechatMediaSendInput) => {
    const form = new FormData()
    form.set('accountId', input.accountId)
    form.set('peerId', input.peerId)
    if (input.text?.trim()) form.set('text', input.text.trim())
    form.set('file', input.file)

    const response = await fetch('/api/channels/wechat/send-media', {
      method: 'POST',
      body: form,
    })
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) {
      throw {
        status: response.status,
        message:
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : response.statusText,
      }
    }
    return data as WechatSendResult
  },
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

  wechatDesktopStatus: () => api.get<WechatDesktopStatus>('/channels/wechat-desktop/status'),
  saveWechatDesktopConfig: (input: Partial<WechatDesktopConfig>) =>
    api.post<WechatDesktopStatus>('/channels/wechat-desktop/config', input),
  startWechatDesktop: () => api.post<WechatDesktopStatus>('/channels/wechat-desktop/start', {}),
  stopWechatDesktop: () => api.post<WechatDesktopStatus>('/channels/wechat-desktop/stop', {}),
  listWechatDesktopSessions: () =>
    api.get<WechatDesktopSession[]>('/channels/wechat-desktop/sessions'),
  refreshWechatDesktopSessions: () =>
    api.post<WechatDesktopSession[]>('/channels/wechat-desktop/sessions/refresh', {}),
  updateWechatDesktopSession: (
    sessionId: string,
    input: Partial<WechatDesktopSession>,
  ) =>
    api.patch<WechatDesktopSession>(
      '/channels/wechat-desktop/sessions/' + encodeURIComponent(sessionId),
      input,
    ),
  listWechatDesktopGroups: () =>
    api.get<WechatDesktopGroup[]>('/channels/wechat-desktop/groups'),
  updateWechatDesktopGroup: (groupId: string, input: Partial<WechatDesktopGroup>) =>
    api.patch<WechatDesktopGroup>(
      '/channels/wechat-desktop/groups/' + encodeURIComponent(groupId),
      input,
    ),
  sendWechatDesktopMessage: (input: { sessionName: string; text: string }) =>
    api.post<{ ok?: boolean; sessionName?: string }>('/channels/wechat-desktop/send', input),
  listWechatDesktopGroupMemories: (groupId?: string) =>
    api.get<WechatDesktopGroupMemory[]>(
      '/channels/wechat-desktop/group-memory' +
        (groupId ? '?groupId=' + encodeURIComponent(groupId) : ''),
    ),
  createWechatDesktopGroupMemory: (input: {
    groupId: string
    title: string
    content: string
    source?: WechatDesktopGroupMemory['source']
  }) =>
    api.post<WechatDesktopGroupMemory>('/channels/wechat-desktop/group-memory', input),

  feishuStatus: () => api.get<FeishuStatus>('/channels/feishu/status'),
  feishuDeliveryTargets: () =>
    api.get<FeishuDeliveryTarget[]>('/channels/feishu/delivery-targets'),
  saveFeishuConfig: (input: FeishuConfigInput) =>
    api.post<FeishuStatus>('/channels/feishu/config', input),
  connectFeishu: () => api.post<FeishuStatus>('/channels/feishu/connect', {}),
  disconnectFeishu: () => api.post<FeishuStatus>('/channels/feishu/disconnect', {}),
  sendFeishuMessage: (input: FeishuSendInput) =>
    api.post<FeishuSendResult>('/channels/feishu/send', input),
  sendFeishuMedia: async (input: FeishuMediaSendInput) => {
    const form = new FormData()
    form.set('receiveIdType', input.receiveIdType)
    form.set('receiveId', input.receiveId)
    if (input.mode) form.set('mode', input.mode)
    if (input.text?.trim()) form.set('text', input.text.trim())
    form.set('file', input.file)

    const response = await fetch('/api/channels/feishu/send-media', {
      method: 'POST',
      body: form,
    })
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) {
      throw {
        status: response.status,
        message:
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : response.statusText,
      }
    }
    return data as FeishuMediaSendResult
  },
  feishuWorkspaceStatus: () =>
    api.get<FeishuWorkspaceStatus>('/channels/feishu/workspace'),
  saveFeishuWorkspaceConfig: (input: Partial<FeishuWorkspaceConfig>) =>
    api.post<FeishuWorkspaceConfig>('/channels/feishu/workspace/config', input),
  feishuImportMarkdownDoc: (input: {
    title: string
    markdown: string
    folderToken?: string
  }) =>
    api.post<FeishuDocImportResult>('/channels/feishu/workspace/docs/import-markdown', input),
  feishuReadDocRaw: (documentId: string) =>
    api.get<{ documentId: string; content: string }>(
      '/channels/feishu/workspace/docs/' + encodeURIComponent(documentId) + '/raw',
    ),
  feishuSyncResourcesDoc: () =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/sync/resources-doc', {}),
  feishuSyncNotesDoc: (path?: string) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/sync/notes-doc', { path }),
  feishuSyncMemoryDoc: () =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/sync/memory-doc', {}),
  feishuSyncResourcesBitable: (input?: { appToken?: string; tableId?: string }) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/sync/resources-bitable', input ?? {}),
  feishuMountDocToWiki: (input: {
    documentToken: string
    spaceId?: string
    parentWikiToken?: string
    title?: string
  }) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/wiki/mount-doc', input),
  feishuListCalendars: () =>
    api.get<{ items: Array<Record<string, unknown>> }>('/channels/feishu/workspace/calendars'),
  feishuCreateCalendar: (input: {
    summary?: string
    description?: string
    permissions?: string
  }) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/calendars', input),
  feishuListCalendarEvents: (calendarId?: string) =>
    api.get<{ items: Array<Record<string, unknown>> }>(
      '/channels/feishu/workspace/calendar-events' +
        (calendarId ? '?calendarId=' + encodeURIComponent(calendarId) : ''),
    ),
  feishuCreateCalendarEvent: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/calendar-events', input),
  feishuListTasks: () =>
    api.get<{ items: Array<Record<string, unknown>> }>('/channels/feishu/workspace/tasks'),
  feishuCreateTask: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/tasks', input),
  feishuCreateApprovalDefinition: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/approvals/definitions', input),
  feishuCreateApprovalInstance: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/approvals/instances', input),
  feishuSearchApprovalTasks: (params?: { approvalCode?: string; userId?: string }) =>
    api.get<{ count: number; items: Array<Record<string, unknown>> }>(
      '/channels/feishu/workspace/approvals/tasks' +
        (params
          ? '?' +
            [
              params.approvalCode
                ? 'approvalCode=' + encodeURIComponent(params.approvalCode)
                : '',
              params.userId ? 'userId=' + encodeURIComponent(params.userId) : '',
            ]
              .filter(Boolean)
              .join('&')
          : ''),
    ),
  feishuListSearchDataSources: () =>
    api.get<{ items: Array<Record<string, unknown>> }>(
      '/channels/feishu/workspace/search/data-sources',
    ),
  feishuCreateSearchDataSource: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/search/data-sources', input),
  feishuIndexSearchItem: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>(
      '/channels/feishu/workspace/search/data-sources/items',
      input,
    ),
  feishuSyncResourcesSearch: (input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>('/channels/feishu/workspace/sync/resources-search', input),

  wecomStatus: () => api.get<WecomStatus>('/channels/wecom/status'),
  wecomListWebhooks: () => api.get<WecomWebhookSummary[]>('/channels/wecom/webhooks'),
  wecomCreateWebhook: (payload: WecomWebhookInput) =>
    api.post<WecomWebhookSummary>('/channels/wecom/webhooks', payload),
  wecomUpdateWebhook: (id: string, payload: Partial<WecomWebhookInput>) =>
    api.patch<WecomWebhookSummary>('/channels/wecom/webhooks/' + encodeURIComponent(id), payload),
  wecomDeleteWebhook: (id: string) =>
    api.delete<{ ok: true }>('/channels/wecom/webhooks/' + encodeURIComponent(id)),
  wecomTestWebhook: (id: string) =>
    api.post<{ ok: true; message: string }>(
      '/channels/wecom/webhooks/' + encodeURIComponent(id) + '/test',
      {},
    ),
}
