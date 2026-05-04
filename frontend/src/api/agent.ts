import { api } from './client'

export type ChatRole = 'system' | 'user' | 'assistant'
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
    source?: 'web' | 'wechat' | 'wechat_desktop' | 'feishu' | 'scheduled-task'
    channel?: 'web' | 'wechat' | 'wechat_desktop' | 'feishu'
    accountId?: string
    peerId?: string
    externalMessageId?: string
    delivery?: {
      status?: 'pending' | 'sent' | 'failed'
      targetChannel?: 'wechat' | 'wechat_desktop' | 'feishu'
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
export type AgentUploadItem = {
  id: string
  kind: 'image' | 'file'
  fileName: string
  originalFileName: string
  mimeType: string
  sizeBytes: number
  relativePath: string
  absolutePath: string
  url: string
  markdown: string
}
export type AgentUploadResponse = {
  items: AgentUploadItem[]
}

export type AgentMigrationEntry = {
  key: string
  kind: 'file' | 'directory'
  sourceRelativePath: string
  targetRelativePath: string
  exists: boolean
  sizeBytes: number
  fileCount?: number
  status: 'planned' | 'copied' | 'staged' | 'skipped'
  reason?: string
}

export type AgentMigrationPreview = {
  sourcePath: string
  sourceDataDir: string
  targetDataDir: string
  entries: AgentMigrationEntry[]
  totalFiles: number
  totalBytes: number
}

export type AgentMigrationResult = AgentMigrationPreview & {
  migrationId: string
  dryRun: boolean
  manifestPath: string
  createdAt: string
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
  cacheReadTokens: number
  cacheWriteTokens: number
  upgradeOverheadInputTokens: number
  upgradeOverheadOutputTokens: number
  upgradeOverheadTotalTokens: number
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

export type ToolStartedInfo = {
  name: string
  callId?: string
  argsPreview?: string
  dangerous?: boolean
}

export type ToolFinishedInfo = {
  name: string
  ok: boolean
  error?: string
  callId?: string
  resultPreview?: string
  durationMs?: number
}

export type StreamHandlers = {
  onDelta: (chunk: string) => void
  onUsage: (usage: TokenUsage) => void
  onToolStarted?: (info: ToolStartedInfo) => void
  onToolFinished?: (info: ToolFinishedInfo) => void
  onUpgradeRequested?: (packs: string[], reason: string) => void
  onUpgradeApplying?: (packs: string[]) => void
  onUpgradeApplied?: (packs: string[]) => void
  onUpgradeAborted?: (stage: string) => void
  onDone: () => void
  onError: (message: string) => void
}

type StreamEvent = {
  type:
    | 'delta'
    | 'usage'
    | 'done'
    | 'error'
    | 'tool-started'
    | 'tool-finished'
    | 'context-upgrade-requested'
    | 'context-upgrade-applying'
    | 'context-upgrade-applied'
    | 'context-upgrade-aborted'
  content?: string
  usage?: TokenUsage
  message?: string
  name?: string
  ok?: boolean
  packs?: string[]
  reason?: string
  stage?: string
  error?: string
  callId?: string
  argsPreview?: string
  dangerous?: boolean
  resultPreview?: string
  durationMs?: number
}

export type HistorySaveReason = 'sync' | 'clear' | 'replace' | 'compact' | 'repair'

export const AgentApi = {
  getHistory: () => api.get<ChatHistory>('/agent/history'),

  getUsageStats: () => api.get<TokenUsageStats>('/agent/stats/usage'),

  saveHistory: (messages: StoredChatMessage[], reason: HistorySaveReason = 'sync') =>
    api.put<ChatHistory>('/agent/history', { messages, reason }),

  compactHistory: (messages: StoredChatMessage[]) =>
    api.post<CompactHistoryResponse>('/agent/history/compact', { messages }),

  uploadFiles: async (files: File[]) => {
    const form = new FormData()
    for (const file of files) {
      form.append('files', file)
    }

    const response = await fetch('/api/agent/uploads', {
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
    return data as AgentUploadResponse
  },

  previewMigration: (sourcePath: string) =>
    api.post<AgentMigrationPreview>('/agent/migrations/preview', { sourcePath }),

  runMigration: (sourcePath: string, dryRun = false) =>
    api.post<AgentMigrationResult>('/agent/migrations/run', { sourcePath, dryRun }),

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
          } else if (obj.type === 'tool-started' && typeof obj.name === 'string') {
            handlers.onToolStarted?.({
              name: obj.name,
              callId: obj.callId,
              argsPreview: obj.argsPreview,
              dangerous: obj.dangerous,
            })
          } else if (obj.type === 'tool-finished' && typeof obj.name === 'string') {
            handlers.onToolFinished?.({
              name: obj.name,
              ok: obj.ok === true,
              error: obj.error,
              callId: obj.callId,
              resultPreview: obj.resultPreview,
              durationMs: obj.durationMs,
            })
          } else if (obj.type === 'context-upgrade-requested' && Array.isArray(obj.packs)) {
            handlers.onUpgradeRequested?.(obj.packs, obj.reason ?? '')
          } else if (obj.type === 'context-upgrade-applying' && Array.isArray(obj.packs)) {
            handlers.onUpgradeApplying?.(obj.packs)
          } else if (obj.type === 'context-upgrade-applied' && Array.isArray(obj.packs)) {
            handlers.onUpgradeApplied?.(obj.packs)
          } else if (obj.type === 'context-upgrade-aborted' && typeof obj.stage === 'string') {
            handlers.onUpgradeAborted?.(obj.stage)
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
