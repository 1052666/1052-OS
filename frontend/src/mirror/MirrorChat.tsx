import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useChatModel, type Msg } from '../hooks/useChatModel'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import { MirrorText } from './primitives'
import { MirrorComposer } from './MirrorComposer'
import Markdown from '../components/Markdown'

const FIVE_MIN_MS = 5 * 60 * 1000

/**
 * Decide the centered time-separator label between two adjacent messages.
 *
 * Returns null for:
 *  - the very first message (no prior anchor)
 *  - gaps ≤ 5 min (continuous flow, no break needed)
 *
 * Otherwise returns an uppercase short label. Pure function so it can be
 * exercised in tests without React.
 */
export function formatChatTimeSep(
  prevTs: number | undefined,
  currentTs: number,
  now: number = Date.now(),
): string | null {
  if (prevTs == null) return null
  if (currentTs - prevTs <= FIVE_MIN_MS) return null
  const ageMs = Math.max(0, now - currentTs)
  const minsAgo = Math.round(ageMs / 60_000)
  if (minsAgo < 1) return 'JUST NOW'
  if (minsAgo < 60) return `${minsAgo} MIN AGO`
  const hoursAgo = Math.round(minsAgo / 60)
  if (hoursAgo < 24) return `${hoursAgo} H AGO`
  return new Date(currentTs).toLocaleDateString()
}

function MirrorChatMessage({ message }: { message: Msg }) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const showTyping = isAssistant && message.streaming && !message.content
  const classes = [
    'mr-chat-msg',
    isUser ? 'is-user' : 'is-assistant',
    message.streaming ? 'is-streaming' : '',
    message.error ? 'is-error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes}>
      {showTyping ? (
        <div className="mr-chat-typing" aria-label="正在生成">
          <span />
          <span />
          <span />
        </div>
      ) : isUser ? (
        <div className="mr-chat-user-content">{message.content}</div>
      ) : (
        <div className="mr-chat-assistant-content">
          <Markdown text={message.content} />
          {message.streaming && <span className="mr-chat-caret" aria-hidden="true" />}
        </div>
      )}
    </article>
  )
}

export function MirrorChat() {
  const model = useChatModel()
  const { messages, historyLoaded } = model
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Pre-compute time-separator labels in a single pass so the render is
  // straightforward; useMemo keeps it stable when messages reference equality
  // doesn't change.
  const separators = useMemo(() => {
    const now = Date.now()
    return messages.map((msg, i) => {
      const prev = messages[i - 1]
      return formatChatTimeSep(prev?.ts, msg.ts, now)
    })
  }, [messages])

  // Scroll-to-bottom on new messages. The doc itself doesn't scroll —
  // `.mr-page-scroll` is the scroll container — so we anchor a 0-height
  // sentinel just under the last message and call scrollIntoView on it.
  // Users can still scroll up manually; the next message snaps them back.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  const showEmpty = historyLoaded && messages.length === 0

  return (
    <MirrorPageWrapper header={<MirrorPageHeader title="聊天" />}>
      <div className="mr-chat-doc">
        {showEmpty && (
          <div className="mr-chat-empty">
            <MirrorText role="meta">— 与你的本地 Agent 开始对话 —</MirrorText>
          </div>
        )}
        {messages.map((message, i) => {
          const sep = separators[i]
          return (
            <Fragment key={message.id}>
              {sep && (
                <div className="mr-chat-time-sep">
                  <MirrorText role="meta">{sep}</MirrorText>
                </div>
              )}
              <MirrorChatMessage message={message} />
            </Fragment>
          )
        })}
        <div ref={bottomRef} className="mr-chat-bottom-anchor" />
      </div>
      <MirrorComposer model={model} />
    </MirrorPageWrapper>
  )
}
