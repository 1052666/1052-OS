import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { SqlApi, type SqlFile, type DataSource, type QueryResult } from '../api/sql'
import { IconPlus, IconRefresh, IconTrash, IconSqlFile, IconDatabase } from '../components/Icons'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type HistoryEntry = {
  sql: string
  datasourceId: string
  timestamp: number
  rowCount?: number
  error?: string
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateCell(value: unknown, max = 200): string {
  const str = String(value ?? 'NULL')
  return str.length > max ? str.slice(0, max) + '...' : str
}

export default function SqlFiles() {
  const [files, setFiles] = useState<SqlFile[]>([])
  const [datasources, setDatasources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)

  // Editor state
  const [activeFile, setActiveFile] = useState<SqlFile | null>(null)
  const [editorName, setEditorName] = useState('')
  const [editorDs, setEditorDs] = useState('')
  const [editorSql, setEditorSql] = useState('')
  const [editorLimit, setEditorLimit] = useState('100')
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)

  // Query result
  const [result, setResult] = useState<QueryResult | null>(null)
  const [queryError, setQueryError] = useState('')

  // Create dialog
  const [showCreate, setShowCreate] = useState(false)
  const [newFileName, setNewFileName] = useState('')

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const clearTimers = () => {
    if (noticeFadeTimer.current !== null) window.clearTimeout(noticeFadeTimer.current)
    if (noticeRemoveTimer.current !== null) window.clearTimeout(noticeRemoveTimer.current)
    noticeFadeTimer.current = null
    noticeRemoveTimer.current = null
  }

  const showNotice = (message: string, type: Notice['type'] = 'error') => {
    clearTimers()
    setNotice({ type, message, leaving: false })
    noticeFadeTimer.current = window.setTimeout(() => {
      setNotice((c) => (c ? { ...c, leaving: true } : c))
    }, 4200)
    noticeRemoveTimer.current = window.setTimeout(() => setNotice(null), 4800)
  }

  const load = async () => {
    setLoading(true)
    try {
      const [fileList, dsList] = await Promise.all([
        SqlApi.listSqlFiles(),
        SqlApi.listDataSources(),
      ])
      setFiles(fileList)
      setDatasources(dsList)
    } catch (e) {
      showNotice((e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => clearTimers, [])

  const dsName = (id: string) => {
    const ds = datasources.find((d) => d.id === id)
    return ds ? ds.name : id
  }

  const openFile = (file: SqlFile) => {
    setActiveFile(file)
    setEditorName(file.name)
    setEditorDs(file.datasourceId)
    setEditorSql(file.content)
    setEditorLimit('100')
    setResult(null)
    setQueryError('')
  }

  const backToList = () => {
    setActiveFile(null)
    setResult(null)
    setQueryError('')
  }

  const saveFile = async () => {
    if (!activeFile) return
    setSaving(true)
    try {
      const updated = await SqlApi.updateSqlFile(activeFile.id, {
        name: editorName.trim() || activeFile.name,
        datasourceId: editorDs,
        content: editorSql,
      })
      setFiles((c) => c.map((f) => (f.id === updated.id ? updated : f)))
      setActiveFile(updated)
      showNotice('已保存', 'success')
    } catch (e) {
      showNotice((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const execute = async () => {
    if (!editorDs) {
      showNotice('请先选择数据源')
      return
    }
    if (!editorSql.trim()) {
      showNotice('SQL 不能为空')
      return
    }
    setExecuting(true)
    setResult(null)
    setQueryError('')
    const startTime = Date.now()
    try {
      const res = await SqlApi.executeQuery(editorDs, editorSql.trim(), Number(editorLimit) || 100)
      setResult(res)
      setHistory((c) => [
        { sql: editorSql.trim(), datasourceId: editorDs, timestamp: startTime, rowCount: res.rowCount },
        ...c.slice(0, 19),
      ])
    } catch (e) {
      const msg = (e as Error).message || '查询失败'
      setQueryError(msg)
      setHistory((c) => [
        { sql: editorSql.trim(), datasourceId: editorDs, timestamp: startTime, error: msg },
        ...c.slice(0, 19),
      ])
    } finally {
      setExecuting(false)
    }
  }

  const createFile = async (event: FormEvent) => {
    event.preventDefault()
    if (!newFileName.trim()) return
    try {
      const created = await SqlApi.createSqlFile({ name: newFileName.trim(), content: '' })
      setFiles((c) => [created, ...c])
      setShowCreate(false)
      setNewFileName('')
      openFile(created)
    } catch (e) {
      showNotice((e as Error).message || '创建失败')
    }
  }

  const deleteFile = async (file: SqlFile) => {
    if (!window.confirm(`确认删除「${file.name}」？`)) return
    try {
      await SqlApi.deleteSqlFile(file.id)
      setFiles((c) => c.filter((f) => f.id !== file.id))
      if (activeFile?.id === file.id) backToList()
      showNotice('已删除', 'success')
    } catch (e) {
      showNotice((e as Error).message || '删除失败')
    }
  }

  const handleEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void execute()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      void saveFile()
    }
  }

  // ─── Editor View ──────────────────────────────────────

  if (activeFile) {
    return (
      <div className="page sql-files-page">
        {notice && (
          <div className={`toast ${notice.type} ${notice.leaving ? 'leaving' : ''}`}>
            {notice.message}
          </div>
        )}

        <header className="sql-editor-header">
          <div className="sql-editor-title-row">
            <button className="chip" type="button" onClick={backToList}>
              ← 返回
            </button>
            <input
              className="sql-editor-name"
              value={editorName}
              onChange={(e) => setEditorName(e.target.value)}
              placeholder="文件名"
            />
          </div>
          <div className="sql-editor-toolbar">
            <select value={editorDs} onChange={(e) => setEditorDs(e.target.value)}>
              <option value="">选择数据源</option>
              {datasources.map((ds) => (
                <option key={ds.id} value={ds.id}>{ds.name}</option>
              ))}
            </select>
            <input
              className="sql-editor-limit"
              type="number"
              min={1}
              max={1000}
              value={editorLimit}
              onChange={(e) => setEditorLimit(e.target.value)}
              title="行数限制"
            />
            <button className="chip" type="button" disabled={saving} onClick={() => void saveFile()}>
              保存 (Ctrl+S)
            </button>
            <button className="chip primary" type="button" disabled={executing} onClick={() => void execute()}>
              {executing ? '执行中...' : '执行 (Ctrl+Enter)'}
            </button>
          </div>
        </header>

        <section className="sql-editor-body">
          <div className="sql-editor-pane">
            <textarea
              className="sql-editor-textarea"
              value={editorSql}
              onChange={(e) => setEditorSql(e.target.value)}
              onKeyDown={handleEditorKey}
              placeholder="输入 SQL 查询语句..."
              spellCheck={false}
            />
          </div>

          <div className="sql-editor-results">
            {queryError && (
              <div className="sql-results-error">{queryError}</div>
            )}
            {result && (
              <>
                <div className="sql-results-info">
                  <span>{result.rowCount} 行</span>
                  {result.truncated && <span className="sql-results-truncated">结果已截断</span>}
                </div>
                <div className="sql-results-scroll">
                  <table className="sql-results-table">
                    <thead>
                      <tr>
                        {result.columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i}>
                          {result.columns.map((col) => (
                            <td key={col}>{truncateCell(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!result && !queryError && (
              <div className="sql-results-empty">执行查询后结果显示在这里</div>
            )}
          </div>
        </section>
      </div>
    )
  }

  // ─── List View ────────────────────────────────────────

  return (
    <div className="page sql-files-page">
      {notice && (
        <div className={`toast ${notice.type} ${notice.leaving ? 'leaving' : ''}`}>
          {notice.message}
        </div>
      )}

      <header className="page-header">
        <div>
          <h1>SQL 文件</h1>
          <p className="muted">管理 SQL 查询文件，选择数据源后编辑并执行查询。</p>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={load}>
            <IconRefresh size={14} />
            刷新
          </button>
          <button className="chip primary" type="button" onClick={() => setShowCreate(true)}>
            <IconPlus size={14} />
            新建 SQL 文件
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="sql-create-bar">
          <form onSubmit={createFile}>
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="输入文件名..."
              autoFocus
            />
            <button className="chip primary" type="submit">创建</button>
            <button className="chip" type="button" onClick={() => { setShowCreate(false); setNewFileName('') }}>
              取消
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="empty-state">加载中...</div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">还没有 SQL 文件</div>
          <p className="muted">点击上方「新建 SQL 文件」开始。</p>
        </div>
      ) : (
        <div className="sql-file-list">
          {files.map((file) => (
            <article key={file.id} className="sql-file-card" onClick={() => openFile(file)}>
              <div className="sql-file-card-head">
                <IconSqlFile size={16} />
                <h3>{file.name}</h3>
                <div className="sql-file-card-actions">
                  <button
                    className="icon-btn ghost"
                    type="button"
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); void deleteFile(file) }}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
              <div className="sql-file-card-body">
                {file.content ? (
                  <pre className="sql-file-preview">{file.content.slice(0, 200)}{file.content.length > 200 ? '...' : ''}</pre>
                ) : (
                  <span className="muted">空文件</span>
                )}
              </div>
              <div className="sql-file-card-footer">
                {file.datasourceId && (
                  <span className="sql-file-ds-badge">
                    <IconDatabase size={12} />
                    {dsName(file.datasourceId)}
                  </span>
                )}
                <span>更新于 {formatTime(file.updatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section className="sql-history">
          <h3>查询历史</h3>
          {history.map((entry, i) => (
            <div
              key={i}
              className={'sql-history-item' + (entry.error ? ' error' : '')}
              onClick={() => { setEditorSql(entry.sql); setEditorDs(entry.datasourceId) }}
            >
              <pre>{entry.sql.slice(0, 120)}{entry.sql.length > 120 ? '...' : ''}</pre>
              <div className="sql-history-meta">
                <span>{dsName(entry.datasourceId)}</span>
                <span>{formatTime(entry.timestamp)}</span>
                {entry.error ? <span className="error">失败</span> : <span>{entry.rowCount} 行</span>}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
