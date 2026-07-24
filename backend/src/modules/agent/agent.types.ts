export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
  usage?: TokenUsage
}

export type TokenUsage = {
  userTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  upgradeOverheadInputTokens?: number
  upgradeOverheadOutputTokens?: number
  upgradeOverheadTotalTokens?: number
  estimated?: boolean
}

export type StoredRuntimeTrace = {
  id: string
  kind: 'tool' | 'approval' | 'context' | 'compact' | 'system'
  title: string
  detail?: string
  status: 'running' | 'success' | 'warning' | 'error' | 'neutral'
  timestamp: number
  contentOffset?: number
  callId?: string
  approvalId?: string
  expiresAt?: number
  raw?: Record<string, unknown>
}

export type StoredChatMessage = ChatMessage & {
  id: number
  ts: number
  error?: boolean
  streaming?: boolean
  compactSummary?: string
  compactBackupPath?: string
  compactOriginalCount?: number
  meta?: {
    source?: 'web' | 'wechat' | 'feishu' | 'scheduled-task'
    channel?: 'web' | 'wechat' | 'feishu'
    accountId?: string
    peerId?: string
    externalMessageId?: string
    delivery?: {
      status?: 'pending' | 'sent' | 'failed'
      targetChannel?: 'wechat' | 'feishu'
      targetPeerId?: string
      error?: string
    }
    taskId?: string
    taskTitle?: string
    runtimeTraces?: StoredRuntimeTrace[]
  }
}

export type ChatRequest = {
  messages: ChatMessage[]
}

export type ChatResponse = {
  message: ChatMessage
}

export type ChatHistory = {
  messages: StoredChatMessage[]
}
