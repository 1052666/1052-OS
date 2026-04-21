import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SqlApi, type DataSource } from '../api/sql'
import { IconDatabase, IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/Icons'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type DbKind = 'mysql' | 'oracle' | 'sqlite' | 'hive'

type Draft = {
  name: string
  type: DbKind
  host: string
  port: string
  user: string
  password: string
  database: string
  filePath: string
}

const DEFAULT_PORTS: Record<DbKind, string> = {
  mysql: '3306',
  oracle: '1521',
  sqlite: '',
  hive: '10000',
}

const emptyDraft: Draft = {
  name: '', type: 'mysql', host: '', port: '3306',
  user: '', password: '', database: '', filePath: '',
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const TYPE_LABELS: Record<DbKind, string> = {
  mysql: 'MySQL',
  oracle: 'Oracle',
  sqlite: 'SQLite',
  hive: 'Hive',
}

export default function SqlDataSources() {
  const [items, setItems] = useState<DataSource[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<DataSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)

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
      setItems(await SqlApi.listDataSources())
    } catch (e) {
      showNotice((e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => clearTimers, [])

  const resetForm = () => {
    setDraft(emptyDraft)
    setEditing(null)
  }

  const startEdit = (item: DataSource) => {
    setEditing(item)
    setDraft({
      name: item.name,
      type: item.type,
      host: item.host,
      port: String(item.port),
      user: item.user,
      password: '',
      database: item.database,
      filePath: item.filePath,
    })
  }

  const handleTypeChange = (newType: DbKind) => {
    setDraft((c) => ({
      ...c,
      type: newType,
      port: DEFAULT_PORTS[newType],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) {
      showNotice('名称不能为空')
      return
    }
    if (draft.type !== 'sqlite' && !draft.host.trim()) {
      showNotice('主机地址不能为空')
      return
    }
    if (draft.type === 'sqlite' && !draft.filePath.trim()) {
      showNotice('SQLite 文件路径不能为空')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        type: draft.type,
        host: draft.host.trim(),
        port: Number(draft.port) || Number(DEFAULT_PORTS[draft.type]),
        user: draft.user.trim(),
        password: draft.password.trim(),
        database: draft.database.trim(),
        filePath: draft.filePath.trim(),
      }
      if (editing) {
        const updated = await SqlApi.updateDataSource(editing.id, payload)
        setItems((c) => c.map((item) => (item.id === updated.id ? updated : item)))
        showNotice('数据源已更新', 'success')
      } else {
        const created = await SqlApi.createDataSource(payload)
        setItems((c) => [created, ...c])
        showNotice('数据源已创建', 'success')
      }
      resetForm()
    } catch (e) {
      showNotice((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: DataSource) => {
    if (!window.confirm(`确认删除数据源「${item.name}」？`)) return
    try {
      await SqlApi.deleteDataSource(item.id)
      setItems((c) => c.filter((ds) => ds.id !== item.id))
      if (editing?.id === item.id) resetForm()
      showNotice('数据源已删除', 'success')
    } catch (e) {
      showNotice((e as Error).message || '删除失败')
    }
  }

  const test = async (item: DataSource) => {
    setTesting(item.id)
    try {
      await SqlApi.testConnection(item.id)
      showNotice(`「${item.name}」连接成功`, 'success')
    } catch (e) {
      showNotice((e as Error).message || '连接失败')
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="page sql-datasources-page">
      {notice && (
        <div className={`toast ${notice.type} ${notice.leaving ? 'leaving' : ''}`}>
          {notice.message}
        </div>
      )}

      <header className="page-header">
        <div>
          <h1>SQL 数据源</h1>
          <p className="muted">管理 MySQL、Oracle、SQLite、Hive 数据库连接。</p>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={load}>
            <IconRefresh size={14} />
            刷新
          </button>
        </div>
      </header>

      <section className="sql-ds-layout">
        <aside className="sql-ds-form-card">
          <div className="sql-ds-card-title">
            <span>{editing ? '编辑数据源' : '添加数据源'}</span>
            {editing && (
              <button className="chip" type="button" onClick={resetForm}>
                取消
              </button>
            )}
          </div>
          <form className="sql-ds-form" onSubmit={submit}>
            <label>
              <span>名称</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
                placeholder="例如：生产库"
              />
            </label>
            <label>
              <span>数据库类型</span>
              <select
                value={draft.type}
                onChange={(e) => handleTypeChange(e.target.value as DbKind)}
              >
                <option value="mysql">MySQL</option>
                <option value="oracle">Oracle</option>
                <option value="sqlite">SQLite</option>
                <option value="hive">Hive</option>
              </select>
            </label>
            {draft.type === 'sqlite' ? (
              <label>
                <span>文件路径</span>
                <input
                  value={draft.filePath}
                  onChange={(e) => setDraft((c) => ({ ...c, filePath: e.target.value }))}
                  placeholder="例如：C:/data/my.db"
                />
              </label>
            ) : (
              <>
                <label>
                  <span>主机</span>
                  <input
                    value={draft.host}
                    onChange={(e) => setDraft((c) => ({ ...c, host: e.target.value }))}
                    placeholder="例如：192.168.1.100"
                  />
                </label>
                <label>
                  <span>端口</span>
                  <input
                    type="number"
                    value={draft.port}
                    onChange={(e) => setDraft((c) => ({ ...c, port: e.target.value }))}
                    placeholder={DEFAULT_PORTS[draft.type]}
                  />
                </label>
                <label>
                  <span>用户名</span>
                  <input
                    value={draft.user}
                    onChange={(e) => setDraft((c) => ({ ...c, user: e.target.value }))}
                    placeholder="可选"
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft((c) => ({ ...c, password: e.target.value }))}
                    placeholder={editing ? '留空保持原密码' : '可选'}
                  />
                </label>
                <label>
                  <span>数据库</span>
                  <input
                    value={draft.database}
                    onChange={(e) => setDraft((c) => ({ ...c, database: e.target.value }))}
                    placeholder={draft.type === 'hive' ? '例如：default' : '例如：mydb'}
                  />
                </label>
              </>
            )}
            <button className="chip primary" type="submit" disabled={saving}>
              <IconPlus size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '添加数据源'}
            </button>
          </form>
        </aside>

        <section className="sql-ds-main">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">还没有数据源</div>
              <p className="muted">在左侧添加数据库连接配置。</p>
            </div>
          ) : (
            <div className="sql-ds-list">
              {items.map((item) => (
                <article key={item.id} className="sql-ds-card">
                  <div className="sql-ds-card-head">
                    <div>
                      <h3>{item.name}</h3>
                      <div className="sql-ds-meta">
                        <span className="sql-ds-type-badge">{TYPE_LABELS[item.type]}</span>
                        {item.type === 'sqlite' ? (
                          <span>{item.filePath}</span>
                        ) : (
                          <>
                            <span>{item.host}:{item.port}</span>
                            {item.database && <span> / {item.database}</span>}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="sql-ds-card-actions">
                      <button
                        className="chip"
                        type="button"
                        disabled={testing === item.id}
                        onClick={() => void test(item)}
                      >
                        {testing === item.id ? '测试中...' : '测试连接'}
                      </button>
                      <button className="icon-btn ghost" type="button" title="编辑" onClick={() => startEdit(item)}>
                        <IconEdit size={14} />
                      </button>
                      <button className="icon-btn ghost" type="button" title="删除" onClick={() => void remove(item)}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="sql-ds-card-footer">
                    <IconDatabase size={13} />
                    <span>更新于 {formatTime(item.updatedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}
