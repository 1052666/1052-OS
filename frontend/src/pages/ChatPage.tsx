import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  ArrowDown,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleStop,
  FilePlus2,
  LoaderCircle,
  PanelRight,
  Send,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
  Trash2,
  User,
  XCircle,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { RuntimeEventPayload, StoredMessage } from '../contracts/schemas'
import { agentApi, settingsApi } from '../data/api'
import { streamChat, type RuntimeTrace } from '../runtime/runtime'
import { useShellStore } from '../state/shell'
import { MarkdownView } from '../components/chat/MarkdownView'
import { Badge, Button, IconButton, Tooltip } from '../components/ui'
import styles from '../components/chat/chat.module.css'

function nextId(messages: StoredMessage[]) {
  return Math.max(Date.now(), ...messages.map((message) => message.id + 1))
}

function toModelHistory(messages: StoredMessage[]) {
  return messages
    .filter((message) => message.content.trim() && !message.streaming && !message.error)
    .map(({ role, content }) => ({ role, content }))
}

function messagesSameRevision(left: StoredMessage[], right: StoredMessage[]) {
  if (left.length !== right.length) return false
  return left.every((message, index) => {
    const other = right[index]
    if (!other) return false
    return (
      message.id === other.id &&
      message.ts === other.ts &&
      message.role === other.role &&
      message.content === other.content &&
      message.streaming === other.streaming &&
      message.error === other.error &&
      JSON.stringify(message.usage ?? {}) === JSON.stringify(other.usage ?? {}) &&
      JSON.stringify(message.meta ?? {}) === JSON.stringify(other.meta ?? {})
    )
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function channelLabel(value: string) {
  if (value === 'wechat') return '微信'
  if (value === 'feishu') return '飞书'
  if (value === 'web') return '网页'
  if (value === 'scheduled-task') return '定时任务'
  return ''
}

function channelMetaBadges(message: StoredMessage): Array<{ label: string; tone?: 'default' | 'success' | 'warning' | 'danger' }> {
  const meta = asRecord(message.meta)
  const source = stringValue(meta.source)
  const channel = stringValue(meta.channel)
  const delivery = asRecord(meta.delivery)
  const targetChannel = stringValue(delivery.targetChannel)
  const deliveryStatus = stringValue(delivery.status)
  const sourceLabel = channelLabel(source || channel)
  const targetLabel = channelLabel(targetChannel)
  const badges: Array<{ label: string; tone?: 'default' | 'success' | 'warning' | 'danger' }> = []

  if (message.role === 'user' && sourceLabel && sourceLabel !== '网页') {
    badges.push({ label: `来自${sourceLabel}`, tone: 'default' })
  }

  if (targetLabel) {
    if (deliveryStatus === 'sent') badges.push({ label: `已回传${targetLabel}`, tone: 'success' })
    else if (deliveryStatus === 'failed') badges.push({ label: `${targetLabel}回传失败`, tone: 'danger' })
    else if (deliveryStatus === 'pending') badges.push({ label: `待回传${targetLabel}`, tone: 'warning' })
  }

  return badges
}

function inlineRuntimeTraces(traces: RuntimeTrace[]) {
  return traces.filter((trace) => trace.kind === 'tool' || trace.kind === 'compact' || trace.kind === 'context')
}

function messageChannel(message: StoredMessage) {
  const meta = asRecord(message.meta)
  return stringValue(meta.source) || stringValue(meta.channel)
}

function runtimeTracesFromMessage(message: StoredMessage): RuntimeTrace[] {
  const meta = asRecord(message.meta)
  const traces = Array.isArray(meta.runtimeTraces) ? meta.runtimeTraces : []
  const normalized: RuntimeTrace[] = []
  for (const item of traces) {
    const trace = asRecord(item)
    const rawKind = stringValue(trace.kind)
    const rawStatus = stringValue(trace.status)
    const timestamp = typeof trace.timestamp === 'number' && Number.isFinite(trace.timestamp) ? trace.timestamp : Date.now()
    if (!['tool', 'approval', 'context', 'compact', 'system'].includes(rawKind)) continue
    if (!['running', 'success', 'warning', 'error', 'neutral'].includes(rawStatus)) continue
    const normalizedTrace: RuntimeTrace = {
      id: stringValue(trace.id) || `stored:${message.id}:${timestamp}`,
      kind: rawKind as RuntimeTrace['kind'],
      title: stringValue(trace.title, '运行事件'),
      status: rawStatus as RuntimeTrace['status'],
      timestamp,
    }
    const detail = stringValue(trace.detail)
    const callId = stringValue(trace.callId)
    const approvalId = stringValue(trace.approvalId)
    const raw = asRecord(trace.raw)
    if (detail) normalizedTrace.detail = detail
    if (typeof trace.contentOffset === 'number' && Number.isFinite(trace.contentOffset)) normalizedTrace.contentOffset = trace.contentOffset
    if (callId) normalizedTrace.callId = callId
    if (approvalId) normalizedTrace.approvalId = approvalId
    if (typeof trace.expiresAt === 'number' && Number.isFinite(trace.expiresAt)) normalizedTrace.expiresAt = trace.expiresAt
    if (Object.keys(raw).length) normalizedTrace.raw = raw as RuntimeEventPayload
    normalized.push(normalizedTrace)
  }
  return normalized
}

function runtimeTraceGroups(traces: RuntimeTrace[], contentLength: number) {
  const groups = new Map<number, RuntimeTrace[]>()
  for (const trace of inlineRuntimeTraces(traces)) {
    const rawOffset = trace.contentOffset ?? contentLength
    const offset = Math.max(0, Math.min(contentLength, rawOffset))
    const group = groups.get(offset) ?? []
    group.push(trace)
    groups.set(offset, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([offset, group]) => ({ offset, traces: group }))
}

function runtimeTraceLabel(trace: RuntimeTrace) {
  if (trace.kind !== 'tool') return trace.title
  const name = trace.raw?.name || trace.title.replace(/^正在使用\s*/, '').replace(/\s*(已完成|执行失败)$/, '')
  if (trace.status === 'running') return `正在运行 ${name}`
  if (trace.status === 'error') return `运行失败 ${name}`
  return `已运行 ${name}`
}

function RuntimeTraceIcon({ trace }: { trace: RuntimeTrace }) {
  if (trace.status === 'running') return <LoaderCircle size={14} className={styles.spin} />
  if (trace.status === 'error') return <XCircle size={14} />
  if (trace.status === 'warning') return <CircleAlert size={14} />
  if (trace.kind === 'tool') return <SquareTerminal size={14} />
  return <CheckCircle2 size={14} />
}

function InlineRuntimeTrace({
  traces,
  onInspect,
}: {
  traces: RuntimeTrace[]
  onInspect: (trace: RuntimeTrace) => void
}) {
  if (!traces.length) return null
  const toolCount = traces.filter((trace) => trace.kind === 'tool').length
  const label = toolCount > 1
    ? `运行了 ${toolCount} 个命令`
    : toolCount === 1
      ? '运行了 1 个命令'
      : `记录了 ${traces.length} 个运行事件`

  return (
    <details className={styles.inlineRuntimeTrace}>
      <summary>
        <SquareTerminal size={14} />
        <strong>{label}</strong>
        <ChevronDown size={14} />
      </summary>
      <div>
        {traces.map((trace) => (
          <button key={trace.id} type="button" onClick={() => onInspect(trace)}>
            <span className={`${styles.traceGlyph} ${styles[trace.status]}`}><RuntimeTraceIcon trace={trace} /></span>
            <span>
              <strong>{runtimeTraceLabel(trace)}</strong>
              {trace.detail ? <small>{trace.detail}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </details>
  )
}

function AssistantMessageContent({
  content,
  streaming,
  traces,
  onInspect,
}: {
  content: string
  streaming?: boolean
  traces: RuntimeTrace[]
  onInspect: (trace: RuntimeTrace) => void
}) {
  const groups = runtimeTraceGroups(traces, content.length)
  if (!groups.length) {
    return <MarkdownView content={content || (streaming ? '正在思考…' : '')} />
  }

  const blocks: JSX.Element[] = []
  let cursor = 0
  for (const group of groups) {
    const before = content.slice(cursor, group.offset)
    if (before.trim()) {
      blocks.push(<MarkdownView key={`text-${group.offset}`} content={before} />)
    }
    blocks.push(
      <InlineRuntimeTrace
        key={`trace-${group.offset}-${group.traces.map((trace) => trace.id).join('-')}`}
        traces={group.traces}
        onInspect={onInspect}
      />,
    )
    cursor = group.offset
  }

  const after = content.slice(cursor)
  if (after.trim()) {
    blocks.push(<MarkdownView key="text-tail" content={after} />)
  }
  if (!blocks.length && streaming) {
    blocks.push(<MarkdownView key="thinking" content="正在思考…" />)
  }

  return <div className={styles.messageFlow}>{blocks}</div>
}

export default function ChatPage() {
  const location = useLocation()
  const client = useQueryClient()
  const history = useQuery({ queryKey: ['agent', 'history'], queryFn: () => agentApi.history() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [draft, setDraft] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [followLatest, setFollowLatest] = useState(true)
  const messagesRef = useRef<StoredMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const quickPromptHandled = useRef(false)
  const runtime = useShellStore((state) => state.runtime)
  const dispatch = useShellStore((state) => state.dispatchRuntime)
  const setInspectorOpen = useShellStore((state) => state.setInspectorOpen)
  const inspectTrace = useShellStore((state) => state.inspectTrace)

  const replaceMessages = useCallback((updater: StoredMessage[] | ((current: StoredMessage[]) => StoredMessage[])) => {
    const next = typeof updater === 'function' ? updater(messagesRef.current) : updater
    messagesRef.current = next
    setMessages(next)
    return next
  }, [])

  useEffect(() => {
    if (!history.data || abortRef.current) return
    if (!hydrated || !messagesSameRevision(messagesRef.current, history.data.messages)) {
      messagesRef.current = history.data.messages
      setMessages(history.data.messages)
      setHydrated(true)
    }
  }, [history.data, hydrated])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => Math.max(86, Math.min(420, 72 + messages[index].content.length * 0.24)),
    overscan: 5,
  })

  const syncFollowLatest = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distanceFromBottom < 96
    setFollowLatest((current) => (current === next ? current : next))
  }, [])

  const jumpToBottom = useCallback(() => {
    if (!messages.length) return
    setFollowLatest(true)
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    })
  }, [messages.length, virtualizer])

  useEffect(() => {
    if (!messages.length || !followLatest) return
    requestAnimationFrame(() => virtualizer.scrollToIndex(messages.length - 1, { align: 'end' }))
  }, [followLatest, messages.length, runtime.assistantText.length, virtualizer])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const handleScroll = () => syncFollowLatest()
    handleScroll()
    element.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      element.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [messages.length, hydrated, syncFollowLatest])

  const persist = useCallback(async (reason = 'sync', source = messagesRef.current) => {
    const clean = source.map((message) => ({ ...message, streaming: undefined }))
    const saved = await agentApi.saveHistory(clean, reason)
    replaceMessages(saved.messages)
    void client.invalidateQueries({ queryKey: ['agent', 'history'] })
  }, [client, replaceMessages])

  const finishAssistant = useCallback(async (assistantId: number, error?: string) => {
    const latestUsage = useShellStore.getState().runtime.usage
    const finalMessages = replaceMessages((current) => current.map((message) => message.id === assistantId ? { ...message, streaming: false, error: Boolean(error), content: message.content || error || '未收到有效回复', usage: latestUsage ?? message.usage } : message))
    await persist('sync', finalMessages).catch(() => undefined)
  }, [persist, replaceMessages])

  const send = useCallback(async (input?: string) => {
    const content = (input ?? draft).trim()
    if (!content || abortRef.current || !hydrated) return
    setDraft('')
    setFollowLatest(true)
    dispatch({ type: 'reset' })
    dispatch({ type: 'start' })
    const id = nextId(messagesRef.current)
    const userMessage: StoredMessage = { id, ts: Date.now(), role: 'user', content }
    const assistantMessage: StoredMessage = { id: id + 1, ts: Date.now() + 1, role: 'assistant', content: '', streaming: true }
    const next = [...messagesRef.current, userMessage, assistantMessage]
    replaceMessages(next)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat({
        messages: toModelHistory(next.filter((message) => message.id !== assistantMessage.id)),
        signal: controller.signal,
        onEvent: (event: RuntimeEventPayload) => {
          dispatch({ type: 'event', event })
          if ((event.type === 'delta' || event.type === 'assistant-delta') && event.content) {
            replaceMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: message.content + event.content } : message))
          }
          if ((event.type === 'usage' || event.type === 'usage-recorded') && event.usage) {
            replaceMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, usage: event.usage } : message))
          }
        },
      })
      if (useShellStore.getState().runtime.status !== 'error') dispatch({ type: 'event', event: { type: 'done' } })
      await finishAssistant(assistantMessage.id)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        dispatch({ type: 'cancel' })
        replaceMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, streaming: false, content: message.content || '本轮运行已停止' } : message))
      } else {
        const message = error instanceof Error ? error.message : 'Runtime 连接中断'
        dispatch({ type: 'fail', message })
        await finishAssistant(assistantMessage.id, message)
      }
    } finally {
      abortRef.current = null
    }
  }, [dispatch, draft, finishAssistant, hydrated, replaceMessages])

  useEffect(() => {
    if (!hydrated || quickPromptHandled.current) return
    const prompt = (location.state as { prompt?: unknown } | null)?.prompt
    if (typeof prompt === 'string' && prompt.trim()) {
      quickPromptHandled.current = true
      void send(prompt)
      window.history.replaceState({}, '')
    }
  }, [hydrated, location.state, send])

  useEffect(() => {
    const events = new EventSource('/api/agent/history/events')
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string }
        if (payload.type !== 'connected' && !abortRef.current) void history.refetch()
      } catch {
        // Ignore malformed history notifications.
      }
    }
    return () => events.close()
  }, [history.refetch])

  const compact = useMutation({
    mutationFn: () => agentApi.compact(messagesRef.current),
    onSuccess: (result) => {
      replaceMessages(result.messages)
      dispatch({ type: 'event', event: { type: 'conversation-compacted' } })
    },
  })

  const clear = async () => {
    if (abortRef.current) return
    messagesRef.current = []
    setMessages([])
    setFollowLatest(true)
    dispatch({ type: 'reset' })
    await agentApi.saveHistory([], 'clear')
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const result = await agentApi.uploadFiles(Array.from(files))
      setDraft((current) => [current, ...result.items.map((item) => item.markdown)].filter(Boolean).join('\n\n'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const pendingApproval = runtime.traces.find((trace) => trace.kind === 'approval' && trace.status === 'warning')
  const resolveApproval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => agentApi.resolveApproval(id, approved),
    onSuccess: (result) => dispatch({ type: 'event', event: { type: 'approval-resolved', approvalId: result.approvalId, decision: result.approved ? 'approved' : 'denied', callId: pendingApproval?.callId, name: pendingApproval?.raw?.name } }),
  })
  const active = runtime.status === 'running' || runtime.status === 'waiting-approval'
  const traceSummary = useMemo(() => runtime.traces.filter((trace) => trace.kind !== 'turn').slice(-5), [runtime.traces])
  const messageRuntimeTraces = useMemo(() => inlineRuntimeTraces(runtime.traces), [runtime.traces])
  const lastAssistantId = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant')?.id, [messages])

  return (
    <div className={styles.chatPage}>
      <header className={styles.chatHeader}>
        <div><span className={`${styles.runtimeDot} ${active ? styles.runtimeActive : ''}`} /><div><strong>1052 Agent</strong><small>{settings.data?.llm.modelId || '本地 Runtime'}</small></div></div>
        <div>
          <Tooltip label="压缩对话"><IconButton aria-label="压缩对话" onClick={() => compact.mutate()} disabled={active || messages.length < 6}>{compact.isPending ? <LoaderCircle size={16} className={styles.spin} /> : <Archive size={16} />}</IconButton></Tooltip>
          <Tooltip label="清空对话"><IconButton aria-label="清空对话" onClick={() => void clear()} disabled={active || messages.length === 0}><Trash2 size={16} /></IconButton></Tooltip>
          <Tooltip label="运行检查器"><IconButton aria-label="打开运行检查器" onClick={() => setInspectorOpen(true)}><PanelRight size={16} /></IconButton></Tooltip>
        </div>
      </header>

      <div ref={scrollRef} className={styles.messageScroll}>
        {history.isLoading && !hydrated ? <div className={styles.chatLoading}><LoaderCircle size={20} className={styles.spin} />正在同步服务端历史</div> : null}
        {hydrated && messages.length === 0 ? (
          <div className={styles.welcome}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}><Sparkles size={24} /></motion.div>
            <h1>从一个目标开始</h1>
            <p>我可以读取本地工作区、整理知识、安排任务并调用已连接的工具。</p>
            <div>
              {['整理今天的工作重点', '检查项目当前状态', '从记忆中找出最近的决策'].map((item) => <button key={item} type="button" onClick={() => void send(item)}>{item}<Send size={13} /></button>)}
            </div>
          </div>
        ) : null}
        {messages.length ? (
          <div className={styles.virtualMessages} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const message = messages[row.index]
              const channelBadges = channelMetaBadges(message)
              const storedRuntimeTraces = runtimeTracesFromMessage(message)
              const channel = messageChannel(message)
              const liveRuntimeTraces =
                message.id === lastAssistantId && channel !== 'wechat' && channel !== 'feishu'
                  ? messageRuntimeTraces
                  : []
              const traces = storedRuntimeTraces.length ? storedRuntimeTraces : liveRuntimeTraces
              return (
                <article
                  key={message.id}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className={`${styles.message} ${message.role === 'user' ? styles.userMessage : message.role === 'system' ? styles.systemMessage : styles.assistantMessage}`}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <div className={styles.messageIdentity}>{message.role === 'user' ? <User size={15} /> : <Bot size={15} />}</div>
                  <div className={styles.messageBody}>
                    <header><strong>{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : '1052 Agent'}</strong><time>{new Date(message.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></header>
                    {channelBadges.length ? <div className={styles.messageMeta}>{channelBadges.map((badge) => <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>)}</div> : null}
                    {message.role === 'assistant'
                      ? <AssistantMessageContent content={message.content} streaming={message.streaming} traces={traces} onInspect={inspectTrace} />
                      : <MarkdownView content={message.content} />}
                    {message.error ? <Badge tone="danger">运行失败</Badge> : null}
                    {message.usage?.totalTokens ? <small className={styles.usage}>{message.usage.totalTokens.toLocaleString()} tokens</small> : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </div>

      {messages.length && !followLatest ? (
        <Tooltip label="回到底部">
          <button
            type="button"
            className={`${styles.jumpToBottom} ${styles.jumpToBottomActive}`}
            onClick={jumpToBottom}
            aria-label="回到底部"
          >
            <ArrowDown size={18} />
          </button>
        </Tooltip>
      ) : null}

      <footer className={styles.composerArea}>
        {pendingApproval ? (
          <div className={styles.inlineApproval}>
            <ShieldAlert size={17} />
            <span><strong>{pendingApproval.title}</strong><small>{pendingApproval.detail || 'Runtime 需要你的确认后才能继续。'}</small></span>
            <Button size="small" onClick={() => pendingApproval.approvalId && resolveApproval.mutate({ id: pendingApproval.approvalId, approved: false })}>拒绝</Button>
            <Button size="small" variant="primary" onClick={() => pendingApproval.approvalId && resolveApproval.mutate({ id: pendingApproval.approvalId, approved: true })}>允许</Button>
          </div>
        ) : traceSummary.length && active ? (
          <details className={styles.runtimeStrip}>
            <summary><span className={styles.runtimePulse} /><strong>{traceSummary.at(-1)?.title || 'Runtime 正在运行'}</strong><small>{runtime.traces.length} 个事件</small><ChevronDown size={14} /></summary>
            <div>{traceSummary.map((trace) => <button key={trace.id} type="button" onClick={() => inspectTrace(trace)}><span className={`${styles.traceStatus} ${styles[trace.status]}`} /><span><strong>{trace.title}</strong><small>{trace.detail}</small></span></button>)}</div>
          </details>
        ) : null}
        <div className={styles.composer}>
          <input ref={fileRef} type="file" multiple hidden onChange={(event) => void onFiles(event.target.files)} />
          <Tooltip label="添加附件"><IconButton aria-label="添加附件" onClick={() => fileRef.current?.click()} disabled={active || uploading}>{uploading ? <LoaderCircle size={17} className={styles.spin} /> : <FilePlus2 size={17} />}</IconButton></Tooltip>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={active ? 'Runtime 正在处理当前请求' : '输入你的目标或问题'} disabled={active} rows={1} />
          {active ? <Tooltip label="停止运行"><IconButton aria-label="停止运行" className={styles.stopButton} onClick={() => abortRef.current?.abort()}><CircleStop size={18} /></IconButton></Tooltip> : <Tooltip label="发送"><IconButton aria-label="发送" className={styles.sendButton} onClick={() => void send()} disabled={!draft.trim() || !hydrated}><Send size={18} /></IconButton></Tooltip>}
        </div>
        <div className={styles.composerMeta}><span>{settings.data?.agent.permissionProfile === 'danger-full-access' ? '完全访问' : settings.data?.agent.permissionProfile === 'read-only' ? '只读模式' : '敏感操作需确认'}</span><span>本地数据</span></div>
      </footer>
    </div>
  )
}
