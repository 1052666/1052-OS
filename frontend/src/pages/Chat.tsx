import {
  Component,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconClose, IconPlus, IconSend, IconSparkle, IconStop } from '../components/Icons'
import Markdown from '../components/Markdown'
import {
  AgentApi,
  type AgentUploadItem,
  type ChatMessage,
  type StoredChatMessage,
} from '../api/agent'
import { NotificationsApi, type NotificationContext } from '../api/notifications'
import { SettingsApi } from '../api/settings'

type Msg = StoredChatMessage & {
  streaming?: boolean
}

type ParsedContent = {
  before: string
  thought: string
  after: string
  hasThought: boolean
  thoughtClosed: boolean
}

type ChatCommand = {
  command: string
  title: string
  description: string
  kind: 'action' | 'prompt'
  prompt?: string
}

const CHAT_COMMANDS: ChatCommand[] = [
  {
    command: '/new',
    title: '新对话',
    description: '清空当前聊天并开始一个新会话。',
    kind: 'action',
  },
  {
    command: '/compact',
    title: '压缩上下文',
    description: '让 AI 总结当前聊天，原始历史会备份到 data/chat-history-backups。',
    kind: 'action',
  },
  {
    command: '/notes',
    title: '查看笔记',
    description: '让 Agent 读取并整理当前笔记。',
    kind: 'prompt',
    prompt: '请读取我的笔记，整理重点内容，并给出可以继续追问的方向。',
  },
  {
    command: '/search-notes',
    title: '搜索笔记',
    description: '按关键词检索笔记内容。',
    kind: 'prompt',
    prompt: '请帮我搜索笔记：',
  },
  {
    command: '/repos',
    title: '查看仓库',
    description: '读取当前仓库列表并总结项目状态。',
    kind: 'prompt',
    prompt: '请查看当前仓库列表，帮我总结每个项目的用途和状态。',
  },
  {
    command: '/calendar',
    title: '查看日程',
    description: '查看最近日程和待办。',
    kind: 'prompt',
    prompt: '请帮我查看最近的日程安排。',
  },
  {
    command: '/tools',
    title: '工具清单',
    description: '说明当前可用工具和使用方式。',
    kind: 'prompt',
    prompt: '请列出当前你可以使用的工具，并按使用场景分类说明。',
  },
]

const EMPTY_CHAT_PROMPTS = [
  '帮我整理今天的重点任务',
  '读取项目并说明当前状态',
  '总结最近的聊天历史',
  '创建一个新的日程提醒',
]

const CHAT_HISTORY_CACHE_KEY = '1052os.chat-history-cache'
const EMPTY_HISTORY_RETRY_MS = 240
const INTERRUPTED_MESSAGE_PLACEHOLDER = '生成已中止。'
const LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER = '已中止。'

function normalizeInterruptedMessageContent(content: string) {
  return content.startsWith(LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER)
    ? INTERRUPTED_MESSAGE_PLACEHOLDER + content.slice(LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER.length)
    : content
}

function formatUploadBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
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

function readCachedMessages() {
  if (typeof window === 'undefined') return []
  try {
    return sanitizeCachedMessages(JSON.parse(localStorage.getItem(CHAT_HISTORY_CACHE_KEY) ?? '[]'))
  } catch {
    return []
  }
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

function stripThinkForModel(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()
}

function toChatMessages(messages: Msg[], assistantId?: number): ChatMessage[] {
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

function isCommandInput(value: string) {
  const trimmed = value.trimStart()
  return trimmed.startsWith('/') || trimmed.startsWith('-')
}

function normalizeCommandInput(value: string) {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('-')) return '/' + trimmed.slice(1)
  return trimmed
}

function parseThink(content: string): ParsedContent {
  let cursor = 0
  let before = ''
  let after = ''
  const thoughts: string[] = []
  let foundThought = false
  let thoughtClosed = true

  while (cursor < content.length) {
    const open = content.indexOf('<think>', cursor)
    if (open === -1) {
      const rest = content.slice(cursor)
      if (foundThought) after += rest
      else before += rest
      break
    }

    foundThought = true
    const visible = content.slice(cursor, open)
    if (thoughts.length === 0) before += visible
    else after += visible

    const close = content.indexOf('</think>', open + 7)
    if (close === -1) {
      thoughts.push(content.slice(open + 7).trim())
      thoughtClosed = false
      cursor = content.length
      break
    }

    thoughts.push(content.slice(open + 7, close).trim())
    cursor = close + 8
  }

  if (!foundThought) {
    return {
      before: content,
      thought: '',
      after: '',
      hasThought: false,
      thoughtClosed: false,
    }
  }

  return {
    before: before.replace(/\s+$/, ''),
    thought: thoughts.filter(Boolean).join('\n\n---\n\n'),
    after: after.replace(/^\s+/, ''),
    hasThought: true,
    thoughtClosed,
  }
}

class MessageRenderBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  componentDidCatch() {
    // Keep a single broken message from crashing the whole chat view.
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="msg-content msg-error">
          这条消息渲染失败，请刷新或重新生成。
        </div>
      )
    }
    return this.props.children
  }
}

const MessageContent = memo(function MessageContent({
  message,
  onLinkClick,
}: {
  message: Msg
  onLinkClick: (href: string, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const parsed =
    message.role === 'assistant' ? parseThink(message.content) : null
  const text = parsed
    ? [parsed.before, parsed.after].filter(Boolean).join('\n')
    : message.content
  const compactMeta = [
    message.compactOriginalCount !== undefined
      ? `原始消息数：${message.compactOriginalCount}`
      : null,
    message.compactBackupPath ? `备份路径：${message.compactBackupPath}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div
      className={
        'msg-content' +
        (message.error ? ' msg-error' : '') +
        (message.streaming ? ' msg-streaming' : '')
      }
    >
      {parsed?.hasThought && parsed.thought && (
        <details className="thought">
          <summary>{parsed.thoughtClosed ? '思考过程' : '正在思考'}</summary>
          <div className="thought-content">
            <Markdown text={parsed.thought} onLinkClick={onLinkClick} />
          </div>
        </details>
      )}
      {message.compactSummary && (
        <details className="thought">
          <summary>上下文摘要</summary>
          <div className="thought-content">
            <Markdown
              text={
                compactMeta
                  ? `${message.compactSummary}\n\n---\n\n${compactMeta}`
                  : message.compactSummary
              }
              onLinkClick={onLinkClick}
            />
          </div>
        </details>
      )}
      {text && <Markdown text={text} onLinkClick={onLinkClick} />}
      {message.streaming && <span className="caret" />}
    </div>
  )
})

const TokenUsageLine = memo(function TokenUsageLine({ message }: { message: Msg }) {
  if (message.role !== 'assistant' || message.streaming || !message.usage) {
    return null
  }

  const { userTokens, inputTokens, outputTokens, totalTokens, estimated } =
    message.usage
  const parts = [
    userTokens !== undefined ? `用户 ${userTokens} tokens` : null,
    inputTokens !== undefined ? `输入 ${inputTokens}` : null,
    outputTokens !== undefined ? `输出 ${outputTokens}` : null,
    totalTokens !== undefined ? `总计 ${totalTokens}` : null,
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="msg-usage">
      {parts.join(' / ')}
      {estimated ? ' / 估算值' : ''}
    </div>
  )
})

export default function Chat() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [commandMenuSuppressed, setCommandMenuSuppressed] = useState(false)
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null)
  const [notificationContext, setNotificationContext] =
    useState<NotificationContext | null>(null)
  const [upgradeState, setUpgradeState] = useState('')
  const [pendingUploads, setPendingUploads] = useState<AgentUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadState, setUploadState] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<Msg[]>([])
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const nextId = useRef(1)
  const persistInFlight = useRef(false)
  const pendingPersist = useRef<StoredChatMessage[] | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const lastSyncedKeyRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  const autosize = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
    })
  }

  const focusMessage = (messageId: number) => {
    requestAnimationFrame(() => {
      const el = messageRefs.current[messageId]
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const commitMessages = (next: Msg[]) => {
    messagesRef.current = next
    writeCachedMessages(next)
    setMessages(next)
  }

  const persistMessages = async (next: Msg[]) => {
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
  }

  const schedulePersistMessages = (delay = 220) => {
    if (persistTimerRef.current !== null) return
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      void persistMessages(messagesRef.current)
    }, delay)
  }

  const normalizeRestoredMessages = (
    storedMessages: StoredChatMessage[],
    now = Date.now(),
  ) => {
    const restored = storedMessages.map((message) => ({ ...message }))
    let needsPatch = false
    for (const message of restored) {
      const normalizedContent = normalizeInterruptedMessageContent(message.content)
      if (normalizedContent !== message.content) {
        message.content = normalizedContent
        needsPatch = true
      }
      if (message.streaming) {
        // Skip normalization for recently created streaming messages
        // 鈥?they may still be in progress after a navigation change
        const age = now - message.ts
        if (age < 60_000) continue
        message.streaming = false
        message.error = true
        if (!message.content) message.content = INTERRUPTED_MESSAGE_PLACEHOLDER
        needsPatch = true
      }
    }
    return { restored, needsPatch }
  }

  const applyHistorySnapshot = (
    storedMessages: StoredChatMessage[],
    options: { allowEmpty?: boolean } = {},
  ) => {
    // Collect in-memory streaming message IDs before normalization corrupts them
    const liveStreamingIds = new Set(
      messagesRef.current
        .filter((m) => m.streaming)
        .map((m) => m.id),
    )

    const { restored, needsPatch } = normalizeRestoredMessages(storedMessages)
    if (!options.allowEmpty && restored.length === 0 && messagesRef.current.length > 0) {
      return false
    }

    // Preserve in-memory streaming messages to avoid race with EventSource sync
    const isActivelyStreaming = !!abortRef.current
    const merged = isActivelyStreaming && liveStreamingIds.size > 0
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
  }

  const retryEmptyHistorySnapshot = (
    cancelled: () => boolean,
    onSettled?: () => void,
  ) => {
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
  }

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setUpgradeState('')
    const streaming = messagesRef.current.find((message) => message.streaming)
    if (streaming) {
      patchMsg(
        streaming.id,
        {
          streaming: false,
          error: true,
          content: streaming.content || '生成已中止。',
        },
        true,
      )
    }
    setLoading(false)
  }

  const clearConversation = async () => {
    commitMessages([])
    nextId.current = 1
    setInput('')
    setPendingUploads([])
    setUploadState('')
    setSelectedCommandIndex(0)
    requestAnimationFrame(autosize)
    try {
      await AgentApi.saveHistory([], 'clear')
    } catch {}
  }

  const openUploadPicker = () => {
    if (uploading || loading) return
    fileInputRef.current?.click()
  }

  const removePendingUpload = (id: string) => {
    setPendingUploads((current) => current.filter((item) => item.id !== id))
  }

  const handleUploadSelection = async (files: FileList | null) => {
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const compactConversation = async () => {
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
    setSelectedCommandIndex(0)
    setCommandMenuSuppressed(false)
    requestAnimationFrame(() => {
      autosize()
      scrollToBottom('smooth')
    })
    try {
      const result = await AgentApi.compactHistory(toStoredMessages(toCompact))
      const restored = result.messages.map((message) => ({ ...message }))
      commitMessages(restored)
      nextId.current =
        restored.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
      requestAnimationFrame(() => {
        autosize()
        scrollToBottom('auto')
      })
    } catch (e) {
      const now = Date.now()
      const next = [
        ...pending.filter((message) => message.id !== assistantId),
        {
          ...assistantMsg,
          ts: now,
          streaming: false,
          error: true,
          content: '上下文压缩失败：' + ((e as Error).message || '未知错误'),
        },
      ]
      commitMessages(next)
      void persistMessages(next)
    } finally {
      setLoading(false)
    }
  }

  const patchMsg = (id: number, patch: Partial<Msg>, persist = false) => {
    const next = messagesRef.current.map((message) =>
      message.id === id ? { ...message, ...patch } : message,
    )
    commitMessages(next)
    if (persist) void persistMessages(next)
  }

  const appendDelta = (id: number, chunk: string) => {
    const next = messagesRef.current.map((message) =>
      message.id === id
        ? { ...message, content: message.content + chunk }
        : message,
    )
    commitMessages(next)
    schedulePersistMessages()
  }

  useEffect(() => {
    SettingsApi.get()
      .then((settings) => setUseStream(settings.agent.streaming))
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
      }
    }
  }, [])

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
      requestAnimationFrame(() => {
        autosize()
        scrollToBottom('auto')
      })
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
  }, [])

  useEffect(() => {
    if (!historyLoaded) return
    scrollToBottom('auto')
  }, [messages, historyLoaded])

  useEffect(() => {
    if (!focusedMessageId) return
    const exists = messages.some((message) => message.id === focusedMessageId)
    if (exists) focusMessage(focusedMessageId)
  }, [focusedMessageId, messages])

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
  }, [historyLoaded])

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
  }, [historyLoaded])

  useEffect(() => {
    const notificationId = searchParams.get('notification')
    if (!historyLoaded || !notificationId) {
      setNotificationContext(null)
      setFocusedMessageId(null)
      return
    }

    let cancelled = false
    NotificationsApi.getContext(notificationId)
      .then((context) => {
        if (cancelled) return
        setNotificationContext(context)
        const targetId =
          context.status === 'active'
            ? context.messageId ?? null
            : context.compactMessageId ?? null
        setFocusedMessageId(targetId)
      })
      .catch(() => {
        if (cancelled) return
        setNotificationContext(null)
        setFocusedMessageId(null)
      })

    return () => {
      cancelled = true
    }
  }, [historyLoaded, searchParams])

  useEffect(() => {
    if (!notificationContext || notificationContext.status !== 'active') return
    if (notificationContext.messageId === undefined) return
    const exists = messages.some((message) => message.id === notificationContext.messageId)
    if (exists) return
    const notificationId = searchParams.get('notification')
    if (!notificationId) return

    let cancelled = false
    NotificationsApi.getContext(notificationId)
      .then((context) => {
        if (cancelled) return
        setNotificationContext(context)
        const targetId =
          context.status === 'active'
            ? context.messageId ?? null
            : context.compactMessageId ?? null
        setFocusedMessageId(targetId)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [messages, notificationContext, searchParams])

  const send = async () => {
    const text = input.trim()
    const attachmentsMarkdown = pendingUploads.map((item) => item.markdown).join('\n\n')
    const outgoingContent = [text, attachmentsMarkdown].filter(Boolean).join('\n\n')
    if (!outgoingContent || loading || uploading || !historyLoaded) return

    if (normalizeCommandInput(text) === '/new') {
      await clearConversation()
      return
    }

    if (normalizeCommandInput(text) === '/compact') {
      await compactConversation()
      return
    }

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
    setLoading(true)
    requestAnimationFrame(() => {
      autosize()
      scrollToBottom('smooth')
    })

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
            onUpgradeRequested: (packs, reason) =>
              setUpgradeState('申请加载工具包: ' + packs.join(', ') + (reason ? ' / ' + reason : '')),
            onUpgradeApplying: (packs) => setUpgradeState('正在加载工具包: ' + packs.join(', ')),
            onUpgradeApplied: (packs) => setUpgradeState('已加载工具包: ' + packs.join(', ')),
            onUpgradeAborted: (stage) => setUpgradeState('工具包加载中止: ' + stage),
            onDone: () => {
              setUpgradeState('')
              patchMsg(assistantId, { streaming: false }, true)
            },
            onError: (message) =>
              patchMsg(
                assistantId,
                {
                  streaming: false,
                  error: true,
                  content: '请求失败: ' + message,
                },
                true,
              ),
          },
          controller.signal,
        )
        setUpgradeState('')
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
      patchMsg(
        assistantId,
        {
          streaming: false,
          error: true,
          content: '请求失败: ' + (err.message ?? '未知错误'),
        },
        true,
      )
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  const handleMarkdownLink = useCallback((
    href: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (!href.startsWith('/') || href.startsWith('/api/')) return
    event.preventDefault()
    navigate(href)
  }, [navigate])

  const filteredCommands = (() => {
    if (!isCommandInput(input)) return []
    const query = normalizeCommandInput(input).slice(1).trim().toLowerCase()
    if (!query) return CHAT_COMMANDS
    return CHAT_COMMANDS.filter((item) =>
      [item.command, item.title, item.description]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  })()
  const commandMenuOpen =
    filteredCommands.length > 0 && !loading && historyLoaded && !commandMenuSuppressed
  const emptyChat = historyLoaded && messages.length === 0 && !loading

  useEffect(() => {
    setSelectedCommandIndex(0)
  }, [input])

  const runCommand = async (command: ChatCommand) => {
    setInput(command.kind === 'action' ? command.command : command.prompt ?? command.command)
    setCommandMenuSuppressed(true)
    setSelectedCommandIndex(0)
    requestAnimationFrame(() => {
      autosize()
      taRef.current?.focus()
    })
  }

  const fillPrompt = (prompt: string) => {
    setInput(prompt)
    requestAnimationFrame(() => {
      autosize()
      taRef.current?.focus()
    })
  }

  const clearNotificationFocus = () => {
    setNotificationContext(null)
    setFocusedMessageId(null)
    if (!searchParams.get('notification')) return
    const next = new URLSearchParams(searchParams)
    next.delete('notification')
    setSearchParams(next, { replace: true })
  }

  const handleComposerKeyDown = async (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (commandMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedCommandIndex((index) => (index + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedCommandIndex(
          (index) => (index - 1 + filteredCommands.length) % filteredCommands.length,
        )
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setInput('')
        setSelectedCommandIndex(0)
        requestAnimationFrame(autosize)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        await runCommand(filteredCommands[selectedCommandIndex] ?? filteredCommands[0])
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        await runCommand(filteredCommands[selectedCommandIndex] ?? filteredCommands[0])
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner">
          {notificationContext && (
            <div className="context-banner">
              <div className="context-banner-copy">
                <strong>
                  {notificationContext.status === 'active'
                    ? '正在查看通知上下文'
                    : notificationContext.status === 'compacted'
                      ? '通知上下文已压缩'
                      : '通知上下文不可用'}
                </strong>
                <span>
                  {notificationContext.status === 'active'
                    ? '当前聚焦任务：' +
                      (notificationContext.taskTitle ?? '未命名任务') +
                      '。你可以直接追问。'
                    : notificationContext.status === 'compacted'
                      ? '原始通知历史已压缩，备份路径：' +
                        (notificationContext.backupPath ?? '暂无备份路径')
                      : '任务 ' +
                        (notificationContext.taskTitle ?? '未命名任务') +
                        ' 的原始消息没有找到。'}
                </span>
                {notificationContext.excerpt && <code>{notificationContext.excerpt}</code>}
              </div>
              <button className="chip ghost" type="button" onClick={clearNotificationFocus}>
                关闭
              </button>
            </div>
          )}
          {emptyChat && (
            <div className="empty-chat" aria-label="空聊天">
              <div className="empty-orb" />
              <div className="empty-chat-copy">
                <span>1052 OS</span>
                <p>选择一个建议，或者直接向 Agent 提问。</p>
              </div>
              <div className="empty-prompts">
                {EMPTY_CHAT_PROMPTS.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    onClick={() => fillPrompt(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => {
            const showTyping =
              message.role === 'assistant' &&
              message.streaming &&
              !message.content

            return (
              <div
                key={message.id}
                ref={(node) => {
                  messageRefs.current[message.id] = node
                }}
                className={
                  'msg ' +
                  message.role +
                  (focusedMessageId === message.id ? ' focused' : '')
                }
              >
                <div className="msg-avatar">
                  {message.role === 'assistant' ? <IconSparkle size={14} /> : 'U'}
                </div>
                <div className="msg-body">
                  <div className="msg-meta">
                    <span className="msg-name">
                      {message.role === 'assistant' ? 'Agent' : 'You'}
                    </span>
                    {message.meta?.source === 'scheduled-task' && (
                      <span className="msg-badge">定时任务提醒</span>
                    )}
                    {message.meta?.source === 'wechat' && (
                      <span className="msg-badge">微信</span>
                    )}
                    {message.meta?.source === 'feishu' && (
                      <span className="msg-badge">飞书</span>
                    )}
                    {message.meta?.delivery?.status === 'pending' && (
                      <span className="msg-badge">
                        {message.meta.delivery.targetChannel === 'feishu' ? '发送到飞书中' : '发送到微信中'}
                      </span>
                    )}
                    {message.meta?.delivery?.status === 'failed' && (
                      <span className="msg-badge error">
                        {message.meta.delivery.targetChannel === 'feishu' ? '飞书发送失败' : '微信发送失败'}
                      </span>
                    )}
                    <span className="msg-time">
                      {new Date(message.ts).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {showTyping ? (
                    <div className="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <MessageRenderBoundary
                      resetKey={`${message.id}:${message.content.length}:${message.streaming === true}:${message.error === true}`}
                    >
                      <MessageContent
                        message={message}
                        onLinkClick={handleMarkdownLink}
                      />
                      <TokenUsageLine message={message} />
                    </MessageRenderBoundary>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="composer-wrap">
        {commandMenuOpen && (
          <div className="command-menu" role="listbox" aria-label="聊天命令">
            <div className="command-menu-head">
              <span>命令</span>
              <span>上下选择 / Enter 填入 / 再发送执行 / Esc 关闭</span>
            </div>
            {filteredCommands.map((command, index) => (
              <button
                type="button"
                className={'command-item' + (index === selectedCommandIndex ? ' active' : '')}
                key={command.command}
                role="option"
                aria-selected={index === selectedCommandIndex}
                onMouseEnter={() => setSelectedCommandIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runCommand(command)}
              >
                <span className="command-name">{command.command}</span>
                <span className="command-copy">
                  <strong>{command.title}</strong>
                  <span>{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {pendingUploads.length > 0 && (
          <div className="composer-uploads" aria-label="待发送附件">
            {pendingUploads.map((item) => (
              <div className="composer-upload-chip" key={item.id}>
                <div className="composer-upload-copy">
                  <strong>{item.originalFileName}</strong>
                  <span>
                    {item.kind === 'image' ? '图片' : '文件'} / {formatUploadBytes(item.sizeBytes)}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-btn ghost composer-upload-remove"
                  onClick={() => removePendingUpload(item.id)}
                  title="移除附件"
                >
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => void handleUploadSelection(event.target.files)}
        />
        <div className="composer">
          <button
            className="icon-btn ghost"
            type="button"
            onClick={openUploadPicker}
            disabled={!historyLoaded || loading || uploading}
            title="添加附件"
          >
            <IconPlus size={16} />
          </button>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setCommandMenuSuppressed(false)
              autosize()
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              historyLoaded
                ? '和 Agent 对话，Enter 发送 / Shift+Enter 换行'
                : '正在加载历史...'
            }
            rows={1}
            disabled={!historyLoaded}
          />
          {loading ? (
            <button className="icon-btn danger" onClick={stop} title="停止生成" type="button">
              <IconStop size={16} />
            </button>
          ) : (
            <button
              className="icon-btn primary"
              onClick={send}
              disabled={!historyLoaded || uploading || (!input.trim() && pendingUploads.length === 0)}
              title="发送"
              type="button"
            >
              <IconSend size={16} />
            </button>
          )}
        </div>
        {upgradeState ? <div className="composer-hint">{upgradeState}</div> : null}
        {!upgradeState && uploadState ? <div className="composer-hint">{uploadState}</div> : null}
        <div className="composer-hint">
          {historyLoaded
            ? (useStream ? '流式响应' : '普通响应') + ' / Enter 发送 / Shift+Enter 换行'
            : '正在加载历史...'}
        </div>
      </div>
    </div>
  )
}
