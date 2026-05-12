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
import ToolCallPanel from '../components/ToolCallPanel'
import { NotificationsApi, type NotificationContext } from '../api/notifications'
import { useChatModel, type Msg } from '../hooks/useChatModel'
import { decideSend } from './chat-send'

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
    description: '备份当前上下文到 data/chat-history-backups 后开始新会话。',
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

function formatUploadBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
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
          ⚠️ 消息渲染异常，请刷新页面或重新发送。
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
  const model = useChatModel()
  const {
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
    send: sendModel,
    stop,
    clearConversation,
    compactConversation,
    handleUploadSelection,
    removePendingUpload,
  } = model

  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [commandMenuSuppressed, setCommandMenuSuppressed] = useState(false)
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null)
  const [notificationContext, setNotificationContext] =
    useState<NotificationContext | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({})

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

  const openUploadPicker = () => {
    if (uploading || loading) return
    fileInputRef.current?.click()
  }

  const onUploadInputChange = async (files: FileList | null) => {
    await handleUploadSelection(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const send = async () => {
    const decision = decideSend({
      text: input.trim(),
      pendingUploadsCount: pendingUploads.length,
      loading,
      uploading,
      historyLoaded,
    })

    // Regression guard (restored after the useChatModel migration): if a
    // stream is in flight, an upload is queued, or initial history hasn't
    // loaded yet, drop the keystroke for *every* branch — including the
    // page-level commands /new and /compact. The hook's sendModel has its
    // own internal guard, but the page-level commands bypass that.
    if (decision.kind === 'blocked' || decision.kind === 'empty') return

    if (decision.kind === 'new') {
      await clearConversation()
      requestAnimationFrame(autosize)
      setSelectedCommandIndex(0)
      return
    }

    if (decision.kind === 'compact') {
      setSelectedCommandIndex(0)
      setCommandMenuSuppressed(false)
      requestAnimationFrame(() => {
        autosize()
        scrollToBottom('smooth')
      })
      await compactConversation()
      requestAnimationFrame(() => {
        autosize()
        scrollToBottom('auto')
      })
      return
    }

    requestAnimationFrame(() => {
      autosize()
      scrollToBottom('smooth')
    })
    await sendModel()
  }

  useEffect(() => {
    if (!historyLoaded) return
    requestAnimationFrame(() => {
      autosize()
      scrollToBottom('auto')
    })
  }, [historyLoaded])

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
                        {message.meta.delivery.targetChannel === 'feishu'
                          ? '发送到飞书中'
                          : message.meta.delivery.targetChannel === 'wechat_desktop'
                            ? '发送到微信桌面中'
                            : '发送到微信中'}
                      </span>
                    )}
                    {message.meta?.delivery?.status === 'failed' && (
                      <span className="msg-badge error">
                        {message.meta.delivery.targetChannel === 'feishu'
                          ? '飞书发送失败'
                          : message.meta.delivery.targetChannel === 'wechat_desktop'
                            ? '微信桌面发送失败'
                            : '微信发送失败'}
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
          onChange={(event) => void onUploadInputChange(event.target.files)}
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
        {toolCalls.length > 0 && <ToolCallPanel entries={toolCalls} />}
        {upgradeState ? <div className="composer-hint">{upgradeState}</div> : null}
        {!upgradeState && !toolCalls.length && uploadState ? <div className="composer-hint">{uploadState}</div> : null}
        <div className="composer-hint">
          {historyLoaded
            ? (useStream ? '流式响应' : '普通响应') + ' / Enter 发送 / Shift+Enter 换行'
            : '正在加载历史...'}
        </div>
      </div>
    </div>
  )
}
