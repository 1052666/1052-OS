import { useCallback, useEffect, useRef, type KeyboardEvent, type ChangeEvent } from 'react'
import { MirrorCard } from './primitives'
import ToolCallPanel from '../components/ToolCallPanel'
import type { UseChatModelReturn } from '../hooks/useChatModel'

export interface MirrorComposerProps {
  model: UseChatModelReturn
}

/**
 * Floating composer for the mirror chat doc.
 *
 * Renders a glass card pinned to the bottom of the viewport with:
 *  - an attach (+) button on the left,
 *  - an auto-resizing textarea in the middle,
 *  - an 8x8 accent dot on the right (Enter or click to send, becomes a
 *    square while a stream is in flight so Enter / click stops it).
 *
 * Tool calls and pending upload chips stack above the card. Field names
 * mirror `UseChatModelReturn` directly — this component is a thin shell
 * over the hook, no extra state.
 */
export function MirrorComposer({ model }: MirrorComposerProps) {
  const {
    input,
    setInput,
    send,
    stop,
    loading,
    uploading,
    pendingUploads,
    removePendingUpload,
    handleUploadSelection,
    toolCalls,
  } = model

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Auto-resize: snap height to scrollHeight, capped at 200px so the doc
  // above the composer never disappears entirely.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [input])

  const onSubmit = useCallback(() => {
    if (loading) {
      stop()
      return
    }
    if (!input.trim() && pendingUploads.length === 0) return
    void send()
  }, [input, loading, send, stop, pendingUploads.length])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter (without shift) sends; ⇧↵ inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void handleUploadSelection(e.target.files)
      // Reset so the same file can be re-selected after removal.
      e.target.value = ''
    },
    [handleUploadSelection],
  )

  const hasInput = input.trim().length > 0 || pendingUploads.length > 0
  const dotActive = hasInput || loading

  return (
    <div className="mr-composer-wrap">
      {toolCalls.length > 0 && (
        <div className="mr-composer-tools">
          <ToolCallPanel entries={toolCalls} />
        </div>
      )}
      {pendingUploads.length > 0 && (
        <div className="mr-composer-uploads">
          {pendingUploads.map((u) => (
            <div key={u.id} className="mr-upload-chip">
              <span>{u.fileName}</span>
              <button
                type="button"
                onClick={() => removePendingUpload(u.id)}
                aria-label={`移除附件 ${u.fileName}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <MirrorCard level={1} pad="tight" className="mr-composer">
        <button
          className="mr-composer-attach"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="添加附件"
          disabled={uploading || loading}
        >
          ＋
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onFileInput}
        />
        <textarea
          ref={textareaRef}
          className="mr-composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={loading ? '正在生成…按 ↵ 停止' : '说点什么…按 ↵ 发送，⇧↵ 换行'}
          rows={1}
        />
        <button
          className={`mr-composer-send${dotActive ? ' is-active' : ''}${loading ? ' is-loading' : ''}`}
          type="button"
          onClick={onSubmit}
          aria-label={loading ? '停止生成' : '发送'}
        >
          {loading ? <SquareIcon /> : null}
        </button>
      </MirrorCard>
    </div>
  )
}

function SquareIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="0" y="0" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}
