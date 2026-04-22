import { api } from './client'

export type ChatRole = 'system' | 'user' | 'assistant'
export type TokenUsage = {
  userTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimated?: boolean
}
export type ChatMessage = { role: ChatRole; content: string; usage?: TokenUsage }
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
export type ChatHistory = { messages: StoredChatMessage[] }
export type CompactHistoryResponse = ChatHistory & {
  backupPath: string
  originalCount: number
}

export type TokenUsageAggregate = {
  messageCount: number
  assistantMessages: number
  messagesWithUsage: number
  estimatedMessages: number
  userTokens: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextTokens: number
}

export type TokenUsageBucket = TokenUsageAggregate & {
  date: string
  label: string
}

export type TokenUsageStats = {
  generatedAt: number
  backupFiles: number
  daysActive: number
  firstMessageAt?: number
  lastMessageAt?: number
  totals: TokenUsageAggregate
  current: TokenUsageAggregate
  archived: TokenUsageAggregate
  recent7Days: TokenUsageAggregate
  recent30Days: TokenUsageAggregate
  byDay: TokenUsageBucket[]
  peakDay?: TokenUsageBucket
}

export type StreamHandlers = {
  onDelta: (chunk: string) => void
  onUsage: (usage: TokenUsage) => void
  onDone: () => void
  onError: (message: string) => void
}

type StreamEvent = {
  type: 'delta' | 'usage' | 'done' | 'error'
  content?: string
  usage?: TokenUsage
  message?: string
}

export type HistorySaveReason = 'sync' | 'clear' | 'replace' | 'compact' | 'repair'

export const AgentApi = {
  getHistory: () => api.get<ChatHistory>('/agent/history'),

  getUsageStats: () => api.get<TokenUsageStats>('/agent/stats/usage'),

  saveHistory: (messages: StoredChatMessage[], reason: HistorySaveReason = 'sync') =>
    api.put<ChatHistory>('/agent/history', { messages, reason }),

  compactHistory: (messages: StoredChatMessage[]) =>
    api.post<CompactHistoryResponse>('/agent/history/compact', { messages }),

  chat: (messages: ChatMessage[]) =>
    api.post<{ message: ChatMessage }>('/agent/chat', { messages }),

  chatStream: async (
    messages: ChatMessage[],
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> => {
    let res: Response
    try {
      res = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal,
      })
    } catch (e) {
      handlers.onError((e as Error).message || '网络错误')
      return
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      const msg = tryExtract(text) ?? res.statusText
      handlers.onError(msg || `HTTP ${res.status}`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let terminal = false
    let receivedDelta = false

    const handleEvent = (event: string) => {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue

        try {
          const obj = JSON.parse(data) as StreamEvent
          if (obj.type === 'delta' && obj.content) {
            receivedDelta = true
            handlers.onDelta(obj.content)
          } else if (obj.type === 'usage' && obj.usage) {
            handlers.onUsage(obj.usage)
          } else if (obj.type === 'done') {
            terminal = true
            handlers.onDone()
          } else if (obj.type === 'error') {
            terminal = true
            handlers.onError(obj.message ?? '流式调用失败')
          }
        } catch {
          // Ignore malformed SSE fragments from proxies or partial writes.
        }
      }
    }

    try {
      while (!terminal) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''

        for (const event of events) {
          handleEvent(event)
          if (terminal) break
        }
      }

      const rest = decoder.decode()
      if (rest) buffer += rest
      if (!terminal && buffer.trim()) handleEvent(buffer)

      if (!terminal) {
        if (receivedDelta) handlers.onDone()
        else handlers.onError('连接已结束，但没有收到模型回复')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        handlers.onError((e as Error).message || '流中断')
      }
    } finally {
      reader.releaseLock()
    }
  },
}

function tryExtract(text: string): string | null {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj.error === 'string') return obj.error
  } catch {}
  return null
}
