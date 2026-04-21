import { useState, useRef, useCallback, useEffect } from 'react'
import type { OrchestrationExecution, LogEntry } from '../../api/orchestration'

const HEIGHT_STORAGE_KEY = 'orch-log-panel-height'
const DEFAULT_HEIGHT = 320
const MIN_HEIGHT = 120

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

function LogEntryCard({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(true)
  const icons: Record<string, string> = { success: '\u2713', failed: '\u2717', warning: '\u26A0', skipped: '\u2014', running: '\u23F3' }
  return (
    <div className={`orch-log-entry ${log.status}`} onClick={() => setExpanded(!expanded)}>
      <div className="orch-log-entry-header">
        <span className={`orch-log-status-icon ${log.status === 'running' ? 'spin' : ''}`}>{icons[log.status]}</span>
        <span className="orch-log-node-name">{log.nodeName}</span>
        <span className={`orch-node-type-badge small ${log.nodeType}`}>
          {log.nodeType === 'sql' ? 'SQL' : log.nodeType === 'debug' ? 'Debug' : log.nodeType === 'load' ? '加载' : '等待'}
        </span>
        <span className="orch-log-duration">{log.status === 'running' ? '等待中...' : `${(log.duration / 1000).toFixed(2)}s`}</span>
        {log.nodeType === 'debug' && log.thresholdPassed !== undefined && (
          <span className={`orch-threshold-result ${log.thresholdPassed ? 'pass' : 'fail'}`}>{log.thresholdPassed ? '通过' : '未通过'}</span>
        )}
      </div>
      {expanded && (
        <div className="orch-log-entry-body">
          <div className="orch-log-sql"><label>SQL:</label><code>{log.sql}</code></div>
          {log.affectedRows !== undefined && <div className="orch-log-detail"><label>影响行数:</label><span>{log.affectedRows}</span></div>}
          {log.result && (
            <div className="orch-log-detail"><label>结果:</label>
              <div className="orch-log-result-table"><table>
                <thead><tr>{log.result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{log.result.rows.map((row, i) => <tr key={i}>{log.result!.columns.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
          )}
          {log.nodeType === 'debug' && log.actualValue !== undefined && (
            <div className="orch-log-detail">
              <label>实际值:</label><span>{log.actualValue}</span>
              {log.expectedValue !== undefined && <><span className="orch-log-sep">|</span><label>期望:</label><span>{log.expectedValue}</span></>}
            </div>
          )}
          {log.nodeType === 'wait' && log.actualValue !== undefined && (
            <div className="orch-log-detail">
              <label>数据条数:</label><span>{log.actualValue}</span>
              {log.expectedValue !== undefined && <><span className="orch-log-sep">|</span><span>{log.expectedValue}</span></>}
            </div>
          )}
          {log.error && <div className="orch-log-error"><label>错误:</label><span>{log.error}</span></div>}
        </div>
      )}
    </div>
  )
}

export function LogPanel({
  execution, collapsed, onToggle,
}: {
  execution: OrchestrationExecution | null; collapsed: boolean; onToggle: () => void
}) {
  const [height, setHeight] = useState<number>(readStoredHeight)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    try { localStorage.setItem(HEIGHT_STORAGE_KEY, String(height)) } catch { /* ignore */ }
  }, [height])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startY: e.clientY, startH: height }
    const maxH = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.8))

    const onMove = (ev: MouseEvent) => {
      const st = dragRef.current
      if (!st) return
      const dy = st.startY - ev.clientY
      const next = Math.min(maxH, Math.max(MIN_HEIGHT, st.startH + dy))
      setHeight(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height])

  if (!execution) return null

  return (
    <div className="orch-log-panel" style={collapsed ? undefined : { height }}>
      {!collapsed && (
        <div
          className="orch-log-resize-handle"
          onMouseDown={onDragStart}
          role="separator"
          aria-orientation="horizontal"
          title="拖动调整高度"
        />
      )}
      <div className="orch-log-header" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <h3>执行日志</h3>
        <span className={`orch-status-badge ${execution.status}`}>
          {execution.status === 'success' ? '成功' : execution.status === 'failed' ? '失败' : execution.status === 'running' ? '执行中' : '警告'}
        </span>
        {execution.endTime
          ? <span className="orch-log-duration">{((execution.endTime - execution.startTime) / 1000).toFixed(1)}s</span>
          : <span className="orch-log-duration">执行中...</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--fg-4)', fontSize: 10 }}>{collapsed ? '▲' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="orch-log-entries">
          {execution.logs.map((log) => <LogEntryCard key={log.nodeId} log={log} />)}
        </div>
      )}
    </div>
  )
}
