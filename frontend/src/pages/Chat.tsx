import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconPlus, IconSend, IconSparkle, IconStop } from '../components/Icons'
import Markdown from '../components/Markdown'
import {
  AgentApi,
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
    description: '清空当前聊天上下文和已保存聊天历史',
    kind: 'action',
  },
  {
    command: '/compact',
    title: '压缩上下文',
    description: '调用 AI 压缩当前聊天上下文，并把原始聊天历史备份到 data/chat-history-backups',
    kind: 'action',
  },
  {
    command: '/notes',
    title: '查看笔记库',
    description: '列出笔记库概览，可继续搜索或读取笔记',
    kind: 'prompt',
    prompt: '请读取我的笔记库概览，列出顶层文件夹、笔记数量，并告诉我可以继续怎么查。',
  },
  {
    command: '/search-notes',
    title: '搜索笔记',
    description: '生成一个全库搜索笔记的请求模板',
    kind: 'prompt',
    prompt: '请在我的整个笔记库里搜索：',
  },
  {
    command: '/repos',
    title: '查看仓库',
    description: '列出当前可访问的项目仓库和快速链接',
    kind: 'prompt',
    prompt: '请列出当前工作区里可以访问的项目仓库，并附上仓库快速链接。',
  },
  {
    command: '/calendar',
    title: '查看日程',
    description: '查询今天和近期日历安排',
    kind: 'prompt',
    prompt: '请查看我今天和近期的日程安排。',
  },
  {
    command: '/tools',
    title: '可用工具',
    description: '说明当前可用工具，以及哪些操作需要确认',
    kind: 'prompt',
    prompt: '请简要说明你当前可以使用哪些本地工具，以及哪些操作需要我确认。',
  },
]

const EMPTY_CHAT_PROMPTS = [
  '读取我的笔记库概览，告诉我有哪些内容可以继续整理。',
  '列出当前工作区里的项目仓库，并给我快速入口。',
  '查看我今天和近期的日程安排。',
  '说明你现在能使用哪些工具，以及哪些操作需要我确认。',
]

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

function toChatMessages(messages: Msg[], assistantId?: number): ChatMessage[] {
  return messages
    .filter((message) => message.id !== assistantId)
    .map(({ role, content, compactSummary }) => ({
      role,
      content: compactSummary?.trim() ? `${content}\n\n${compactSummary}` : content,
    }))
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
      ? `原消息数：${message.compactOriginalCount}`
      : null,
    message.compactBackupPath ? `备份：${message.compactBackupPath}` : null,
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
          <summary>{parsed.thoughtClosed ? '思考过程' : '思考中'}</summary>
          <div className="thought-content">
            <Markdown text={parsed.thought} onLinkClick={onLinkClick} />
          </div>
        </details>
      )}
      {message.compactSummary && (
        <details className="thought">
          <summary>压缩摘要</summary>
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
    userTokens !== undefined ? `用户发送约 ${userTokens} tokens` : null,
    inputTokens !== undefined ? `输入 ${inputTokens}` : null,
    outputTokens !== undefined ? `输出 ${outputTokens}` : null,
    totalTokens !== undefined ? `总计 ${totalTokens}` : null,
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="msg-usage">
      {parts.join(' · ')}
      {estimated ? ' · 部分为估算' : ''}
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<Msg[]>([])
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const nextId = useRef(1)
  const persistInFlight = useRef(false)
  const pendingPersist = useRef<StoredChatMessage[] | null>(null)
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
    setMessages(next)
  }

  const persistMessages = async (next: Msg[]) => {
    pendingPersist.current = toStoredMessages(next)
    if (persistInFlight.current) return

    persistInFlight.current = true
    try {
      while (pendingPersist.current) {
        const payload = pendingPersist.current
        pendingPersist.current = null
        try {
          await AgentApi.saveHistory(payload)
        } catch {}
      }
    } finally {
      persistInFlight.current = false
      if (pendingPersist.current) void persistMessages(messagesRef.current)
    }
  }

  const stop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    const streaming = messagesRef.current.find((m) => m.streaming)
    if (streaming) {
      patchMsg(
        streaming.id,
        {
          streaming: false,
          error: true,
          content: streaming.content || '（已手动停止）',
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
    setSelectedCommandIndex(0)
    requestAnimationFrame(autosize)
    try {
      await AgentApi.saveHistory([])
    } catch {}
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
    void persistMessages(next)
  }

  useEffect(() => {
    SettingsApi.get()
      .then((settings) => setUseStream(settings.agent.streaming))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false

    AgentApi.getHistory()
      .then(({ messages: storedMessages }) => {
        if (cancelled) return

        const restored = storedMessages.map((message) => ({ ...message }))
        let needsPatch = false
        for (const m of restored) {
          if (m.streaming) {
            m.streaming = false
            m.error = true
            if (!m.content) m.content = '（请求中断，未收到回复）'
            needsPatch = true
          }
        }
        lastSyncedKeyRef.current = JSON.stringify(
          restored.map((message) => [message.id, message.ts, message.content.length, message.streaming === true]),
        )
        commitMessages(restored)
        nextId.current =
          restored.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
        setLoading(false)
        if (needsPatch) void persistMessages(restored)
        setHistoryLoaded(true)
        requestAnimationFrame(() => {
          autosize()
          scrollToBottom('auto')
        })
      })
      .catch(() => {
        if (cancelled) return

        commitMessages([])
        lastSyncedKeyRef.current = '[]'
        nextId.current = 1
        setLoading(false)
        setHistoryLoaded(true)
        requestAnimationFrame(() => {
          autosize()
          scrollToBottom('auto')
        })
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
    const syncHistory = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      AgentApi.getHistory()
        .then(({ messages: storedMessages }) => {
          if (cancelled) return

          const restored = storedMessages.map((message) => ({ ...message }))
          const syncKey = JSON.stringify(
            restored.map((message) => [
              message.id,
              message.ts,
              message.content.length,
              message.streaming === true,
            ]),
          )
          if (syncKey === lastSyncedKeyRef.current) return

          lastSyncedKeyRef.current = syncKey
          commitMessages(restored)
          nextId.current =
            restored.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
          setLoading(restored.some((message) => message.streaming))
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
    let timer: number | undefined
    const events = new EventSource('/api/agent/history/events')
    const reload = () => {
      if (cancelled) return
      AgentApi.getHistory()
        .then(({ messages: storedMessages }) => {
          if (cancelled) return
          const restored = storedMessages.map((message) => ({ ...message }))
          const syncKey = JSON.stringify(
            restored.map((message) => [
              message.id,
              message.ts,
              message.content.length,
              message.streaming === true,
            ]),
          )
          if (syncKey === lastSyncedKeyRef.current) return
          lastSyncedKeyRef.current = syncKey
          commitMessages(restored)
          nextId.current =
            restored.reduce((maxId, message) => Math.max(maxId, message.id), 0) + 1
          setLoading(restored.some((message) => message.streaming))
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
    if (!text || loading || !historyLoaded) return

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
      content: text,
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
    setLoading(true)
    requestAnimationFrame(() => {
      autosize()
      scrollToBottom('smooth')
    })

    const history = toChatMessages(next, assistantId)

    try {
      if (useStream) {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        await AgentApi.chatStream(
          history,
          {
            onDelta: (chunk) => appendDelta(assistantId, chunk),
            onUsage: (usage) => patchMsg(assistantId, { usage }, true),
            onDone: () => patchMsg(assistantId, { streaming: false }, true),
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
          ctrl.signal,
        )
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
                    ? '????????????'
                    : notificationContext.status === 'compacted'
                      ? '??????????????'
                      : '????????????????'}
                </strong>
                <span>
                  {notificationContext.status === 'active'
                    ? '????????' +
                      (notificationContext.taskTitle ?? '?????') +
                      '?????????'
                    : notificationContext.status === 'compacted'
                      ? '??????????????????????' +
                        (notificationContext.backupPath ?? '???????')
                      : '???' +
                        (notificationContext.taskTitle ?? '?????') +
                        '?????????????????'}
                </span>
                {notificationContext.excerpt && <code>{notificationContext.excerpt}</code>}
              </div>
              <button className="chip ghost" type="button" onClick={clearNotificationFocus}>
                ??
              </button>
            </div>
          )}
          {emptyChat && (
            <div className="empty-chat" aria-label="开始对话">
              <div className="empty-orb" />
              <div className="empty-chat-copy">
                <span>发送一条消息开始</span>
                <p>选择一个入口填入输入框，确认后再发送给 Agent。</p>
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
                    {message.meta?.delivery?.status === 'pending' && (
                      <span className="msg-badge">微信待发送</span>
                    )}
                    {message.meta?.delivery?.status === 'failed' && (
                      <span className="msg-badge error">微信发送失败</span>
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
                    <>
                      <MessageContent
                        message={message}
                        onLinkClick={handleMarkdownLink}
                      />
                      <TokenUsageLine message={message} />
                    </>
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
              <span>↑↓ 选择 · Enter 填入 · 再发送执行 · Esc 关闭</span>
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
        <div className="composer">
          <button className="icon-btn ghost" title="附加" type="button">
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
                ? '给 Agent 发消息...  (Enter 发送 / Shift+Enter 换行)'
                : '正在加载聊天记录...'
            }
            rows={1}
            disabled={!historyLoaded}
          />
          {loading ? (
            <button className="icon-btn danger" onClick={stop} title="停止" type="button">
              <IconStop size={16} />
            </button>
          ) : (
            <button
              className="icon-btn primary"
              onClick={send}
              disabled={!historyLoaded || !input.trim()}
              title="发送"
              type="button"
            >
              <IconSend size={16} />
            </button>
          )}
        </div>
        <div className="composer-hint">
          {historyLoaded
            ? `${useStream ? '流式输出已启用' : '非流式模式'} · 聊天记录自动保存 · 在“设置”修改`
            : '正在加载聊天记录...'}
        </div>
      </div>
    </div>
  )
}
