import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SqlApi, type Server } from '../api/sql'
import { IconEdit, IconPlus, IconRefresh, IconServer, IconTrash } from '../components/Icons'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type Draft = {
  name: string
  host: string
  port: string
  user: string
  authType: 'password' | 'privateKey'
  password: string
  privateKey: string
  description: string
}

const emptyDraft: Draft = {
  name: '', host: '', port: '22', user: '',
  authType: 'password', password: '', privateKey: '', description: '',
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function SqlServers() {
  const [items, setItems] = useState<Server[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<Server | null>(null)
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
      setItems(await SqlApi.listServers())
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

  const startEdit = (item: Server) => {
    setEditing(item)
    setDraft({
      name: item.name,
      host: item.host,
      port: String(item.port),
      user: item.user,
      authType: item.authType,
      password: '',
      privateKey: '',
      description: item.description,
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) { showNotice('名称不能为空'); return }
    if (!draft.host.trim()) { showNotice('主机地址不能为空'); return }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        host: draft.host.trim(),
        port: Number(draft.port) || 22,
        user: draft.user.trim(),
        authType: draft.authType,
        password: draft.password.trim(),
        privateKey: draft.privateKey.trim(),
        description: draft.description.trim(),
      }
      if (editing) {
        const updated = await SqlApi.updateServer(editing.id, payload)
        setItems((c) => c.map((item) => (item.id === updated.id ? updated : item)))
        showNotice('服务器已更新', 'success')
      } else {
        const created = await SqlApi.createServer(payload)
        setItems((c) => [created, ...c])
        showNotice('服务器已创建', 'success')
      }
      resetForm()
    } catch (e) {
      showNotice((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Server) => {
    if (!window.confirm(`确认删除服务器「${item.name}」？`)) return
    try {
      await SqlApi.deleteServer(item.id)
      setItems((c) => c.filter((s) => s.id !== item.id))
      if (editing?.id === item.id) resetForm()
      showNotice('服务器已删除', 'success')
    } catch (e) {
      showNotice((e as Error).message || '删除失败')
    }
  }

  const test = async (item: Server) => {
    setTesting(item.id)
    try {
      await SqlApi.testServer(item.id)
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
          <h1>服务器</h1>
          <p className="muted">管理 SSH 远程服务器连接，支持密码和密钥认证。</p>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={load}>
            <IconRefresh size={14} /> 刷新
          </button>
        </div>
      </header>
      <section className="sql-ds-layout">
        <aside className="sql-ds-form-card">
          <div className="sql-ds-card-title">
            <span>{editing ? '编辑服务器' : '添加服务器'}</span>
            {editing && <button className="chip" type="button" onClick={resetForm}>取消</button>}
          </div>
          <form className="sql-ds-form" onSubmit={submit}>
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="例如：生产服务器" />
            </label>
            <label>
              <span>主机</span>
              <input value={draft.host} onChange={(e) => setDraft((c) => ({ ...c, host: e.target.value }))} placeholder="例如：192.168.1.100" />
            </label>
            <label>
              <span>端口</span>
              <input type="number" value={draft.port} onChange={(e) => setDraft((c) => ({ ...c, port: e.target.value }))} />
            </label>
            <label>
              <span>用户名</span>
              <input value={draft.user} onChange={(e) => setDraft((c) => ({ ...c, user: e.target.value }))} placeholder="例如：root" />
            </label>
            <label>
              <span>认证方式</span>
              <select value={draft.authType} onChange={(e) => setDraft((c) => ({ ...c, authType: e.target.value as 'password' | 'privateKey' }))}>
                <option value="password">密码</option>
                <option value="privateKey">私钥</option>
              </select>
            </label>
            {draft.authType === 'password' ? (
              <label>
                <span>密码</span>
                <input type="password" value={draft.password} onChange={(e) => setDraft((c) => ({ ...c, password: e.target.value }))} placeholder={editing ? '留空保持原密码' : ''} />
              </label>
            ) : (
              <label>
                <span>私钥 (PEM)</span>
                <textarea value={draft.privateKey} onChange={(e) => setDraft((c) => ({ ...c, privateKey: e.target.value }))} placeholder="-----BEGIN RSA PRIVATE KEY-----..." rows={4} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
              </label>
            )}
            <label>
              <span>备注</span>
              <input value={draft.description} onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))} placeholder="可选" />
            </label>
            <button className="chip primary" type="submit" disabled={saving}>
              <IconPlus size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '添加服务器'}
            </button>
          </form>
        </aside>
        <section className="sql-ds-main">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">还没有服务器</div>
              <p className="muted">在左侧添加 SSH 服务器连接配置。</p>
            </div>
          ) : (
            <div className="sql-ds-list">
              {items.map((item) => (
                <article key={item.id} className="sql-ds-card">
                  <div className="sql-ds-card-head">
                    <div>
                      <h3>{item.name}</h3>
                      <div className="sql-ds-meta">
                        <span className="sql-ds-type-badge">SSH</span>
                        <span>{item.host}:{item.port}</span>
                        <span>/ {item.user}</span>
                      </div>
                    </div>
                    <div className="sql-ds-card-actions">
                      <button className="chip" type="button" disabled={testing === item.id} onClick={() => void test(item)}>
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
                    <IconServer size={13} />
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
