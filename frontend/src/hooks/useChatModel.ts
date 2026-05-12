import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  AgentApi,
  type AgentUploadItem,
  type ChatMessage,
  type StoredChatMessage,
  type ToolCallEntry,
} from '../api/agent'
import { SettingsApi } from '../api/settings'
import { setDirty, clearDirty } from '../mirror/dirtyGuard'

// Public shape of a chat message as seen by the page.
// Mirrors StoredChatMessage + a transient `streaming` flag.
export type Msg = StoredChatMessage & { streaming?: boolean }

export const CHAT_HISTORY_CACHE_KEY = '1052os.chat-history-cache'
const EMPTY_HISTORY_RETRY_MS = 240
export const INTERRUPTED_MESSAGE_PLACEHOLDER =
  '⚠️ 回复生成未完成，可能是连接中断或手动停止。'
const LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER = '已中止。'

export function normalizeInterruptedMessageContent(content: string): string {
  return content.startsWith(LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER)
    ? INTERRUPTED_MESSAGE_PLACEHOLDER +
        content.slice(LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER.length)
    : content
}

// Module-level helper: close over module-private constants only, so it is
// stable and doesn't need useCallback at the call site.
function normalizeRestoredMessages(
  storedMessages: StoredChatMessage[],
  now: number = Date.now(),
) {
  const restored = storedMessages.map((message) => ({ ...message }))
  let needsPatch = false
  for (const message of restored) {
    const normalizedContent = normalizeInterruptedMessageContent(message.content)
    if (normalizedContent !== message.content) {
      message.content = normalizedContent
      needsPatch = true
    }
    if (message.streaming) {
      const age = now - message.ts
      if (age < 60_000) continue
      message.streaming = false
      message.error = true
      if (!message.content) {
        message.content = INTERRUPTED_MESSAGE_PLACEHOLDER
      } else if (!message.content.includes(INTERRUPTED_MESSAGE_PLACEHOLDER)) {
        message.content = message.content + '\n\n' + INTERRUPTED_MESSAGE_PLACEHOLDER
      }
      needsPatch = true
    }
  }
  return { restored, needsPatch }
}

export function stripThinkForModel(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()
}

// Pure transform: take in-memory Msg[] and convert to the ChatMessage[]
// payload sent to AgentApi.chat / AgentApi.chatStream. Exported for parity
// testing — the send() contract is independent of React.
export function toChatMessages(messages: Msg[], assistantId?: number): ChatMessage[] {
  return messages
    .filter((message) => message.id !== assistantId)
    .filter((message) => !message.error && !message.streaming)
    .map(({ role, content, compactSummary }) => {
      const cleanContent = stripThinkForModel(content)
      const cleanSummary = compactSummary ? stripThinkForModel(compactSummary) : ''
      return {
        role,
        content:
          cleanContent && cleanSummary
            ? `${cleanContent}\n\n${cleanSummary}`
            : cleanContent || cleanSummary,
      }
    })
    .filter((message) => message.content.trim())
}

function buildHistorySyncKey(messages: Pick<Msg, 'id' | 'ts' | 'content' | 'streaming'>[]) {
  return JSON.stringify(
    messages.map((message) => [
      message.id,
      message.ts,
      message.content.length,
      message.streaming === true,
    ]),
  )
}

function sanitizeCachedMessages(value: unknown): Msg[] {
  if (!Array.isArray(value)) return []
  return value
    .map<Msg | null>((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = record.id
      const ts = record.ts
      const role = record.role
      const content = record.content
      if (
        typeof id !== 'number' ||
        !Number.isFinite(id) ||
        typeof ts !== 'number' ||
        !Number.isFinite(ts) ||
        typeof role !== 'string' ||
        (role !== 'system' && role !== 'user' && role !== 'assistant') ||
        typeof content !== 'string'
      ) {
        return null
      }

      return {
        id,
        ts,
        role,
        content: normalizeInterruptedMessageContent(content),
        error: record.error === true ? true : undefined,
        streaming: record.streaming === true ? true : undefined,
        usage:
          record.usage && typeof record.usage === 'object'
            ? (record.usage as Msg['usage'])
            : undefined,
        compactSummary:
          typeof record.compactSummary === 'string' ? record.compactSummary : undefined,
        compactBackupPath:
          typeof record.compactBackupPath === 'string'
            ? record.compactBackupPath
            : undefined,
        compactOriginalCount:
          typeof record.compactOriginalCount === 'number' &&
          Number.isFinite(record.compactOriginalCount)
            ? record.compactOriginalCount
            : undefined,
        meta:
          record.meta && typeof record.meta === 'object'
            ? (record.meta as Msg['meta'])
            : undefined,
      } as Msg
    })
    .filter((item): item is Msg => item !== null)
}

function readCachedMessages(): Msg[] {
  if (typeof window === 'undefined') return []
  try {
    return sanitizeCachedMessages(
      JSON.parse(localStorage.getItem(CHAT_HISTORY_CACHE_KEY) ?? '[]'),
    )
  } catch {
    return []
  }
}

function toStoredMessages(messages: Msg[]): StoredChatMessage[] {
  return messages.map(
    ({
      id,
      role,
      content,
      ts,
      error,
      streaming,
      usage,
      compactSummary,
      compactBackupPath,
      compactOriginalCount,
      meta,
    }) => ({
      id,
      role,
      content,
      ts,
      error: error === true ? true : undefined,
      streaming: streaming === true ? true : undefined,
      usage,
      compactSummary,
      compactBackupPath,
      compactOriginalCount,
      meta,
    }),
  )
}

function writeCachedMessages(messages: Msg[]) {
  if (typeof window === 'undefined') return
  try {
    if (messages.length === 0) {
      localStorage.removeItem(CHAT_HISTORY_CACHE_KEY)
      return
    }
    localStorage.setItem(CHAT_HISTORY_CACHE_KEY, JSON.stringify(toStoredMessages(messages)))
  } catch {
    // Ignore storage quota or browser privacy errors.
  }
}

export interface UseChatModelReturn {
  // State exposed to the page
  messages: Msg[]
  input: string
  setInput: Dispatch<SetStateAction<string>>
  loading: boolean
  useStream: boolean
  historyLoaded: boolean
  upgradeState: string
  toolCalls: ToolCallEntry[]
  pendingUploads: AgentUploadItem[]
  uploading: boolean
  uploadState: string

  // Actions
  send: () => Promise<void>
  stop: () => void
  clearConversation: () => Promise<void>
  compactConversation: () => Promise<void>
  handleUploadSelection: (files: FileList | null) => Promise<void>
  removePendingUpload: (id: string) => void
}

export function useChatModel(): UseChatModelReturn {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [upgradeState, setUpgradeState] = useState('')
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([])
  const [pendingUploads, setPendingUploads] = useState<AgentUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadState, setUploadState] = useState('')

  const messagesRef = useRef<Msg[]>([])
  const nextId = useRef(1)
  const persistInFlight = useRef(false)
  const pendingPersist = useRef<StoredChatMessage[] | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const lastSyncedKeyRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const toolCallsClearTimerRef = useRef<number | null>(null)

  // Sync chat draft dirty state to sessionStorage for profile-switch warning.
  useEffect(() => {
    if (input.trim().length > 0) {
      setDirty('chat-draft', null)
    } else {
      clearDirty('chat-draft')
    }
  }, [input])

  // Defensive cleanup on unmount.
  useEffect(() => {
    return () => {
      clearDirty('chat-draft')
    }
  }, [])

  const commitMessages = useCallback((next: Msg[]) => {
    messagesRef.current = next
    writeCachedMessages(next)
    setMessages(next)
  }, [])

  const persistMessages = useCallback(async (next: Msg[]) => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    pendingPersist.current = toStoredMessages(next)
    if (persistInFlight.current) return

    persistInFlight.current = true
    try {
      while (pendingPersist.current) {
        const payload = pendingPersist.current
        pendingPersist.current = null
        try {
          await AgentApi.saveHistory(payload, 'sync')
        } catch {}
      }
    } finally {
      persistInFlight.current = false
      if (pendingPersist.current) void persistMessages(messagesRef.current)
    }
  }, [])

  const schedulePersistMessages = useCallback(
    (delay = 220) => {
      if (persistTimerRef.current !== null) return
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null
        void persistMessages(messagesRef.current)
      }, delay)
    },
    [persistMessages],
  )

  const applyHistorySnapshot = useCallback(
    (
      storedMessages: StoredChatMessage[],
      options: { allowEmpty?: boolean } = {},
    ): boolean => {
      const liveStreamingIds = new Set(
        messagesRef.current.filter((m) => m.streaming).map((m) => m.id),
      )

      const { restored, needsPatch } = normalizeRestoredMessages(storedMessages)
      if (!options.allowEmpty && restored.length === 0 && messagesRef.current.length > 0) {
        return false
      }

      const isActivelyStreaming = !!abortRef.current
      const merged =
        isActivelyStreaming && liveStreamingIds.size > 0
          ? restored.map((m) => {
              if (!liveStreamingIds.has(m.id)) return m
              const live = messagesRef.current.find((im) => im.id === m.id)
              return live ?? m
            })
          : restored

      const syncKey = buildHistorySyncKey(merged)
      if (syncKey === lastSyncedKeyRef.current) return true

      lastSyncedKeyRef.current = syncKey
      commitMessages(merged)
      nextId.current =
        merged.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
      setLoading(merged.some((message) => message.streaming))
      if (needsPatch && !isActivelyStreaming) void persistMessages(merged)
      return true
    },
    [commitMessages, persistMessages],
  )

  const retryEmptyHistorySnapshot = useCallback(
    (cancelled: () => boolean, onSettled?: () => void) => {
      window.setTimeout(() => {
        if (cancelled()) {
          onSettled?.()
          return
        }
        AgentApi.getHistory()
          .then(({ messages: storedMessages }) => {
            if (cancelled()) return
            void applyHistorySnapshot(storedMessages, { allowEmpty: true })
          })
          .catch(() => {})
          .finally(() => {
            if (!cancelled()) onSettled?.()
          })
      }, EMPTY_HISTORY_RETRY_MS)
    },
    [applyHistorySnapshot],
  )

  const patchMsg = useCallback(
    (id: number, patch: Partial<Msg>, persist = false) => {
      const next = messagesRef.current.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      )
      commitMessages(next)
      if (persist) void persistMessages(next)
    },
    [commitMessages, persistMessages],
  )

  const appendDelta = useCallback(
    (id: number, chunk: string) => {
      const next = messagesRef.current.map((message) =>
        message.id === id
          ? { ...message, content: message.content + chunk }
          : message,
      )
      commitMessages(next)
      schedulePersistMessages()
    },
    [commitMessages, schedulePersistMessages],
  )

  // Load streaming preference once on mount.
  useEffect(() => {
    SettingsApi.get()
      .then((settings) => setUseStream(settings.agent.streaming))
      .catch(() => {})
  }, [])

  // Cleanup the persist debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
      }
    }
  }, [])

  // Unmount-only cleanup: abort any in-flight stream and clear the
  // tool-calls dismissal timer so we don't write to an unmounted component
  // (or to localStorage) after navigation.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      if (toolCallsClearTimerRef.current !== null) {
        window.clearTimeout(toolCallsClearTimerRef.current)
        toolCallsClearTimerRef.current = null
      }
    }
  }, [])

  // Initial history load: cache → server → settle.
  useEffect(() => {
    let cancelled = false
    let initialLoadSettled = false
    const cached = readCachedMessages()
    const isCancelled = () => cancelled
    const finishInitialLoad = () => {
      if (cancelled || initialLoadSettled) return
      initialLoadSettled = true
      setLoading(false)
      setHistoryLoaded(true)
    }

    if (cached.length > 0) {
      lastSyncedKeyRef.current = buildHistorySyncKey(cached)
      commitMessages(cached)
      nextId.current = cached.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
      setLoading(cached.some((message) => message.streaming))
    }

    AgentApi.getHistory()
      .then(({ messages: storedMessages }) => {
        if (cancelled) return
        const applied = applyHistorySnapshot(storedMessages, {
          allowEmpty: messagesRef.current.length === 0,
        })
        if (applied) {
          finishInitialLoad()
          return
        }
        retryEmptyHistorySnapshot(isCancelled, finishInitialLoad)
      })
      .catch(() => {
        if (cancelled) return
        if (cached.length === 0) {
          lastSyncedKeyRef.current = buildHistorySyncKey([])
          commitMessages([])
          nextId.current = 1
        }
        finishInitialLoad()
      })

    return () => {
      cancelled = true
    }
  }, [applyHistorySnapshot, commitMessages, retryEmptyHistorySnapshot])

  // 5-second polling sync (paused when document hidden).
  useEffect(() => {
    if (!historyLoaded) return

    let cancelled = false
    const isCancelled = () => cancelled
    const syncHistory = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      AgentApi.getHistory()
        .then(({ messages: storedMessages }) => {
          if (cancelled) return
          if (!applyHistorySnapshot(storedMessages)) {
            retryEmptyHistorySnapshot(isCancelled)
          }
        })
        .catch(() => {})
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncHistory()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const timer = window.setInterval(syncHistory, 5000)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(timer)
    }
  }, [historyLoaded, applyHistorySnapshot, retryEmptyHistorySnapshot])

  // EventSource: server-side history change notifications.
  useEffect(() => {
    if (!historyLoaded) return

    let cancelled = false
    const isCancelled = () => cancelled
    let timer: number | undefined
    const events = new EventSource('/api/agent/history/events')
    const reload = () => {
      if (cancelled) return
      AgentApi.getHistory()
        .then(({ messages: storedMessages }) => {
          if (cancelled) return
          if (!applyHistorySnapshot(storedMessages)) {
            retryEmptyHistorySnapshot(isCancelled)
          }
        })
        .catch(() => {})
    }

    events.onmessage = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(reload, 350)
    }
    events.onerror = () => {
      events.close()
    }

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      events.close()
    }
  }, [historyLoaded, applyHistorySnapshot, retryEmptyHistorySnapshot])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setUpgradeState('')
    if (toolCallsClearTimerRef.current !== null) {
      window.clearTimeout(toolCallsClearTimerRef.current)
      toolCallsClearTimerRef.current = null
    }
    setToolCalls([])
    const streaming = messagesRef.current.find((message) => message.streaming)
    if (streaming) {
      const existing = streaming.content || ''
      patchMsg(
        streaming.id,
        {
          streaming: false,
          error: true,
          content: existing
            ? existing + '\n\n⚠️ 已手动停止生成。'
            : '⚠️ 已手动停止生成。',
        },
        true,
      )
    }
    setLoading(false)
  }, [patchMsg])

  const clearConversation = useCallback(async () => {
    commitMessages([])
    nextId.current = 1
    setInput('')
    setPendingUploads([])
    setUploadState('')
    try {
      await AgentApi.saveHistory([], 'command-new')
    } catch {}
  }, [commitMessages])

  const removePendingUpload = useCallback((id: string) => {
    setPendingUploads((current) => current.filter((item) => item.id !== id))
  }, [])

  const handleUploadSelection = useCallback(async (files: FileList | null) => {
    const selected = files ? [...files].filter((file) => file.size > 0) : []
    if (selected.length === 0) return

    setUploading(true)
    setUploadState('正在上传 ' + selected.length + ' 个附件...')
    try {
      const result = await AgentApi.uploadFiles(selected)
      setPendingUploads((current) => {
        const seen = new Set(current.map((item) => item.url))
        const next = [...current]
        for (const item of result.items) {
          if (seen.has(item.url)) continue
          seen.add(item.url)
          next.push(item)
        }
        return next
      })
      setUploadState('已添加 ' + result.items.length + ' 个附件')
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''
      setUploadState(message || '文件上传失败')
    } finally {
      setUploading(false)
    }
  }, [])

  const compactConversation = useCallback(async () => {
    if (messagesRef.current.length === 0) return
    const now = Date.now()
    const userMsg: Msg = {
      id: nextId.current++,
      role: 'user',
      content: '/compact',
      ts: now,
    }
    const assistantId = nextId.current++
    const assistantMsg: Msg = {
      id: assistantId,
      role: 'assistant',
      content: '正在压缩上下文...',
      ts: now,
      streaming: true,
    }
    const pending = [...messagesRef.current, userMsg, assistantMsg]
    const toCompact = [...messagesRef.current, userMsg]

    commitMessages(pending)
    void persistMessages(pending)
    setLoading(true)
    setInput('')
    setPendingUploads([])
    setUploadState('')
    try {
      const result = await AgentApi.compactHistory(toStoredMessages(toCompact))
      const restored = result.messages.map((message) => ({ ...message }))
      commitMessages(restored)
      nextId.current =
        restored.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
    } catch (e) {
      const errAt = Date.now()
      const next = [
        ...pending.filter((message) => message.id !== assistantId),
        {
          ...assistantMsg,
          ts: errAt,
          streaming: false,
          error: true,
          content:
            '⚠️ 上下文压缩出错：' +
            ((e as Error).message || '未知错误') +
            '\n\n可以重新发送消息重试。',
        },
      ]
      commitMessages(next)
      void persistMessages(next)
    } finally {
      setLoading(false)
    }
  }, [commitMessages, persistMessages])

  const send = useCallback(async () => {
    const text = input.trim()
    const attachmentsMarkdown = pendingUploads.map((item) => item.markdown).join('\n\n')
    const outgoingContent = [text, attachmentsMarkdown].filter(Boolean).join('\n\n')
    if (!outgoingContent || loading || uploading || !historyLoaded) return

    const now = Date.now()
    const userMsg: Msg = {
      id: nextId.current++,
      role: 'user',
      content: outgoingContent,
      ts: now,
    }
    const assistantId = nextId.current++
    const assistantMsg: Msg = {
      id: assistantId,
      role: 'assistant',
      content: '',
      ts: now,
      streaming: true,
    }

    const next = [...messagesRef.current, userMsg, assistantMsg]
    commitMessages(next)
    void persistMessages(next)
    setInput('')
    setPendingUploads([])
    setUploadState('')
    setUpgradeState('')
    // Cancel any pending tool-calls clear from a previous send before
    // resetting state — otherwise an orphan timer could wipe this send's
    // tool calls a few seconds in.
    if (toolCallsClearTimerRef.current !== null) {
      window.clearTimeout(toolCallsClearTimerRef.current)
      toolCallsClearTimerRef.current = null
    }
    setToolCalls([])
    setLoading(true)

    const history = toChatMessages(next, assistantId)

    try {
      if (useStream) {
        const controller = new AbortController()
        abortRef.current = controller
        await AgentApi.chatStream(
          history,
          {
            onDelta: (chunk) => appendDelta(assistantId, chunk),
            onUsage: (usage) => patchMsg(assistantId, { usage }, true),
            onToolStarted: (info) => {
              setToolCalls((prev) => [
                ...prev,
                {
                  callId: info.callId || `${Date.now()}-${info.name}`,
                  name: info.name,
                  argsPreview: info.argsPreview,
                  dangerous: info.dangerous,
                  status: 'running',
                },
              ])
            },
            onToolFinished: (info) => {
              setToolCalls((prev) =>
                prev.map((entry) => {
                  if (info.callId && entry.callId === info.callId) {
                    return {
                      ...entry,
                      status: info.ok ? 'ok' : 'error',
                      resultPreview: info.resultPreview,
                      error: info.error,
                      durationMs: info.durationMs,
                    }
                  }
                  if (!info.callId && entry.name === info.name && entry.status === 'running') {
                    return {
                      ...entry,
                      status: info.ok ? 'ok' : 'error',
                      resultPreview: info.resultPreview,
                      error: info.error,
                      durationMs: info.durationMs,
                    }
                  }
                  return entry
                }),
              )
            },
            onUpgradeRequested: (packs, reason) =>
              setUpgradeState(
                '申请加载工具包: ' + packs.join(', ') + (reason ? ' / ' + reason : ''),
              ),
            onUpgradeApplying: (packs) =>
              setUpgradeState('正在加载工具包: ' + packs.join(', ')),
            onUpgradeApplied: (packs) =>
              setUpgradeState('已加载工具包: ' + packs.join(', ')),
            onUpgradeAborted: (stage) => setUpgradeState('工具包加载中止: ' + stage),
            onDone: () => {
              setUpgradeState('')
              if (toolCallsClearTimerRef.current !== null) {
                window.clearTimeout(toolCallsClearTimerRef.current)
              }
              toolCallsClearTimerRef.current = window.setTimeout(() => {
                setToolCalls([])
                toolCallsClearTimerRef.current = null
              }, 3000)
              const current = messagesRef.current.find((m) => m.id === assistantId)
              const finalContent = current?.content || ''
              patchMsg(assistantId, { streaming: false, content: finalContent }, true)
            },
            onError: (message) => {
              const current = messagesRef.current.find((m) => m.id === assistantId)
              const existingContent = current?.content || ''
              const errorSuffix = '\n\n⚠️ 请求失败: ' + message
              patchMsg(
                assistantId,
                {
                  streaming: false,
                  error: true,
                  content: existingContent
                    ? existingContent + errorSuffix
                    : '请求失败: ' + message,
                },
                true,
              )
            },
          },
          controller.signal,
        )
        setUpgradeState('')
        setToolCalls([])
      } else {
        const { message } = await AgentApi.chat(history)
        patchMsg(
          assistantId,
          {
            streaming: false,
            content: message.content,
            usage: message.usage,
          },
          true,
        )
      }
    } catch (e) {
      const err = e as { message?: string }
      const current = messagesRef.current.find((m) => m.id === assistantId)
      const existingContent = current?.content || ''
      const errorMsg = err.message ?? '未知错误'
      const errorSuffix = '\n\n⚠️ 请求失败: ' + errorMsg
      patchMsg(
        assistantId,
        {
          streaming: false,
          error: true,
          content: existingContent
            ? existingContent + errorSuffix
            : '请求失败: ' + errorMsg,
        },
        true,
      )
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }, [
    input,
    pendingUploads,
    loading,
    uploading,
    historyLoaded,
    useStream,
    commitMessages,
    persistMessages,
    appendDelta,
    patchMsg,
  ])

  return {
    messages,
    input,
    setInput,
    loading,
    useStream,
    historyLoaded,
    upgradeState,
    toolCalls,
    pendingUploads,
    uploading,
    uploadState,
    send,
    stop,
    clearConversation,
    compactConversation,
    handleUploadSelection,
    removePendingUpload,
  }
}
