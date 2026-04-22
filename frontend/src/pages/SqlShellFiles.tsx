import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SqlApi, type Server, type ShellFile, type ShellResult } from '../api/sql'
import { IconEdit, IconPlus, IconRefresh, IconShell, IconTrash } from '../components/Icons'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type Draft = {
  name: string
  serverId: string
  content: string
  description: string
}

const emptyDraft: Draft = { name: '', serverId: '', content: '', description: '' }

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function SqlShellFiles() {
  const [items, setItems] = useState<ShellFile[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<ShellFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  const [execResult, setExecResult] = useState<ShellResult | null>(null)
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
      const [shellFiles, serverList] = await Promise.all([SqlApi.listShellFiles(), SqlApi.listServers()])
      setItems(shellFiles)
      setServers(serverList)
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
    setExecResult(null)
  }

  const startEdit = (item: ShellFile) => {
    setEditing(item)
    setDraft({ name: item.name, serverId: item.serverId, content: item.content, description: item.description })
    setExecResult(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) { showNotice('名称不能为空'); return }
    setSaving(true)
    try {
      const payload = { name: draft.name.trim(), serverId: draft.serverId.trim(), content: draft.content, description: draft.description.trim() }
      if (editing) {
        const updated = await SqlApi.updateShellFile(editing.id, payload)
        setItems((c) => c.map((item) => (item.id === updated.id ? updated : item)))
        showNotice('脚本已更新', 'success')
      } else {
        const created = await SqlApi.createShellFile(payload)
        setItems((c) => [created, ...c])
        showNotice('脚本已创建', 'success')
      }
      resetForm()
    } catch (e) {
      showNotice((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: ShellFile) => {
    if (!window.confirm(`确认删除脚本「${item.name}」？`)) return
    try {
      await SqlApi.deleteShellFile(item.id)
      setItems((c) => c.filter((s) => s.id !== item.id))
      if (editing?.id === item.id) resetForm()
      showNotice('脚本已删除', 'success')
    } catch (e) {
      showNotice((e as Error).message || '删除失败')
    }
  }

  const execShell = async (item: ShellFile) => {
    setExecuting(item.id)
    setExecResult(null)
    try {
      const result = await SqlApi.executeShellFile(item.id)
      setExecResult(result)
      if (result.exitCode === 0) showNotice(`执行成功 (${result.duration}ms)`, 'success')
      else showNotice(`执行失败 exitCode=${result.exitCode}`)
    } catch (e) {
      showNotice((e as Error).message || '执行失败')
    } finally {
      setExecuting(null)
    }
  }

  const getServerName = (serverId: string) => {
    if (!serverId) return '本地'
    return servers.find((s) => s.id === serverId)?.name || serverId
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
          <h1>Shell 脚本</h1>
          <p className="muted">编写和管理 Shell 脚本，指定目标服务器执行。</p>
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
            <span>{editing ? '编辑脚本' : '添加脚本'}</span>
            {editing && <button className="chip" type="button" onClick={resetForm}>取消</button>}
          </div>
          <form className="sql-ds-form" onSubmit={submit}>
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="例如：重启服务" />
            </label>
            <label>
              <span>目标服务器</span>
              <select value={draft.serverId} onChange={(e) => setDraft((c) => ({ ...c, serverId: e.target.value }))}>
                <option value="">本地执行</option>
                {servers.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.host})</option>))}
              </select>
            </label>
            <label>
              <span>脚本内容</span>
              <textarea value={draft.content} onChange={(e) => setDraft((c) => ({ ...c, content: e.target.value }))} placeholder="#!/bin/bash&#10;echo hello" rows={8} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
            </label>
            <label>
              <span>备注</span>
              <input value={draft.description} onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))} placeholder="可选" />
            </label>
            <button className="chip primary" type="submit" disabled={saving}>
              <IconPlus size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '添加脚本'}
            </button>
          </form>
          {execResult && (
            <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-2)', borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)' }}>
              <div style={{ color: execResult.exitCode === 0 ? 'var(--green)' : 'var(--red)', marginBottom: 4 }}>
                退出码: {execResult.exitCode} | 耗时: {execResult.duration}ms
              </div>
              {execResult.stdout && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--fg-2)' }}>{execResult.stdout}</pre>}
              {execResult.stderr && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--red)' }}>{execResult.stderr}</pre>}
            </div>
          )}
        </aside>
        <section className="sql-ds-main">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">还没有脚本</div>
              <p className="muted">在左侧添加 Shell 脚本。</p>
            </div>
          ) : (
            <div className="sql-ds-list">
              {items.map((item) => (
                <article key={item.id} className="sql-ds-card">
                  <div className="sql-ds-card-head">
                    <div>
                      <h3>{item.name}</h3>
                      <div className="sql-ds-meta">
                        <span className="sql-ds-type-badge">Shell</span>
                        <span>{getServerName(item.serverId)}</span>
                      </div>
                    </div>
                    <div className="sql-ds-card-actions">
                      <button className="chip" type="button" disabled={executing === item.id} onClick={() => void execShell(item)}>
                        {executing === item.id ? '执行中...' : '执行'}
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
                    <IconShell size={13} />
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
