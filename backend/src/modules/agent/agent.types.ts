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
  estimated?: boolean
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
