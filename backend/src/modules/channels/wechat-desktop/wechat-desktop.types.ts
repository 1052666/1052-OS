export type WechatDesktopConfigRecord = {
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

export type WechatDesktopSessionRecord = {
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

export type WechatDesktopGroupRecord = {
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

export type WechatDesktopGroupMemoryItem = {
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

export type WechatDesktopBridgeGroup = {
  name: string
  members?: string | null
}

export type WechatDesktopBridgeMention = {
  chat: string
  raw?: string
  sender?: string | null
  text?: string
  mentioned?: boolean
  mentions?: string[]
  debugTexts?: string[]
}

export type WechatDesktopRuntimeStatus = {
  running: boolean
  startedAt?: number
  stoppedAt?: number
  lastEventAt?: number
  lastMessageAt?: number
  lastError?: string
  queuePending?: number
  queueRunning?: number
  sentCount?: number
  sendFailedCount?: number
  missingWindows?: string[]
  bridgeQueuePendingHigh?: number
  bridgeQueuePendingNormal?: number
}

export type WechatDesktopStatus = {
  available: true
  config: WechatDesktopConfigRecord
  runtime: WechatDesktopRuntimeStatus
  sessions: WechatDesktopSessionRecord[]
  groups: WechatDesktopGroupRecord[]
}
