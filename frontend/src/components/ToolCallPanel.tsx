import { memo, useState, type CSSProperties } from 'react'

export type ToolCallEntry = {
  callId: string
  name: string
  argsPreview?: string
  dangerous?: boolean
  status: 'running' | 'ok' | 'error'
  resultPreview?: string
  error?: string
  durationMs?: number
}

const panelStyle: CSSProperties = {
  margin: '4px auto 0',
  maxWidth: 640,
  width: '100%',
  fontSize: 12,
  lineHeight: 1.5,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 6,
  background: 'var(--surface-1, #f5f5f5)',
  color: 'var(--fg-2, #555)',
  cursor: 'pointer',
  userSelect: 'none',
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 2,
  maxHeight: 200,
  overflowY: 'auto',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px 2px 16px',
  borderRadius: 4,
  background: 'var(--surface-1, #f5f5f5)',
  color: 'var(--fg-2, #555)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
}

const nameStyle: CSSProperties = {
  fontWeight: 600,
  flexShrink: 0,
}

const argsStyle: CSSProperties = {
  color: 'var(--fg-4, #999)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 1,
  minWidth: 0,
}

const durStyle: CSSProperties = {
  color: 'var(--fg-4, #999)',
  flexShrink: 0,
  marginLeft: 'auto',
}

const previewStyle: CSSProperties = {
  color: 'var(--fg-3, #777)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 1,
  minWidth: 0,
}

const errorStyle: CSSProperties = {
  color: 'var(--danger, #e53935)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 1,
  minWidth: 0,
}

const badgeStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
}

function StatusIcon({ status }: { status: ToolCallEntry['status'] }) {
  if (status === 'running') return <span style={badgeStyle} title="执行中">⏳</span>
  if (status === 'ok') return <span style={badgeStyle} title="完成">✅</span>
  return <span style={badgeStyle} title="失败">❌</span>
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const ToolCallRow = memo(function ToolCallRow({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)

  const toggleExpand = () => {
    if (entry.status !== 'running' && (entry.resultPreview || entry.error)) {
      setExpanded((v: boolean) => !v)
    }
  }

  const hasDetail = entry.status !== 'running' && !!(entry.resultPreview || entry.error)
  const cursor = hasDetail ? 'pointer' : 'default'

  return (
    <div
      style={{ ...rowStyle, cursor }}
      onClick={toggleExpand}
      title={hasDetail ? '点击展开/收起详情' : undefined}
    >
      <StatusIcon status={entry.status} />
      {entry.dangerous && <span style={{ ...badgeStyle, color: 'var(--warning, #ff9800)' }} title="写操作">⚠️</span>}
      <span style={nameStyle}>{entry.name}</span>
      {entry.status === 'running' && entry.argsPreview && (
        <span style={argsStyle}>({entry.argsPreview})</span>
      )}
      {entry.durationMs != null && (
        <span style={durStyle}>{formatDuration(entry.durationMs)}</span>
      )}
      {!expanded && entry.status === 'ok' && entry.resultPreview && (
        <span style={previewStyle}>→ {entry.resultPreview}</span>
      )}
      {!expanded && entry.status === 'error' && entry.error && (
        <span style={errorStyle}>{entry.error}</span>
      )}
      {expanded && (
        <span style={{ ...previewStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {entry.status === 'error' ? entry.error : entry.resultPreview}
        </span>
      )}
    </div>
  )
})

function ToolCallPanel({ entries }: { entries: ToolCallEntry[] }) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return null

  const running = entries.filter((e) => e.status === 'running').length
  const done = entries.filter((e) => e.status !== 'running').length
  const errors = entries.filter((e) => e.status === 'error').length
  const latestRunning = entries.find((e) => e.status === 'running')

  const summaryParts: string[] = []
  if (running > 0) summaryParts.push(`${running} 执行中`)
  if (done > 0) summaryParts.push(`${done} 已完成`)
  if (errors > 0) summaryParts.push(`${errors} 失败`)
  const summary = summaryParts.join(' / ')

  return (
    <div style={panelStyle}>
      <div style={headerStyle} onClick={() => setExpanded((v: boolean) => !v)}>
        <span style={{ fontSize: 10, flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
        <span>🔧 工具调用 ({summary})</span>
        {!expanded && latestRunning && (
          <span style={{ ...argsStyle, marginLeft: 4 }}>{latestRunning.name}{latestRunning.argsPreview ? ` (${latestRunning.argsPreview})` : ''}</span>
        )}
      </div>
      {expanded && (
        <div style={listStyle}>
          {entries.map((entry) => (
            <ToolCallRow key={entry.callId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(ToolCallPanel)
