import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  ResourcesApi,
  type ResourceItem,
  type ResourcePayload,
  type ResourceStatus,
} from '../api/resources'
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconTrash } from '../components/Icons'
import Markdown from '../components/Markdown'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type Draft = {
  title: string
  content: string
  note: string
  tags: string
}

type ResourceKind = 'link' | 'list' | 'long' | 'text'

const emptyDraft: Draft = { title: '', content: '', note: '', tags: '' }

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function firstUrl(content: string) {
  return content.match(/https?:\/\/[^\s<>"']+/)?.[0] ?? ''
}

function summarize(content: string) {
  return content.length > 260 ? content.slice(0, 260) + '...' : content
}

function previewContent(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n')
  const preview = lines.slice(0, 6).join('\n').slice(0, 320).trim()
  return preview.length < normalized.length ? preview + '\n\n...' : preview
}

function shouldCollapse(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return normalized.length > 320 || normalized.split('\n').length > 6
}

function getResourceKind(content: string): ResourceKind {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const urlCount = normalized.match(/https?:\/\/[^\s<>"']+/g)?.length ?? 0
  const listLineCount = lines.filter((line) =>
    /^([-*+]\s+|\d+[.)、]\s*|[□☐☑✓]\s*)/.test(line),
  ).length
  const paragraphCount = normalized.split(/\n\s*\n/).filter((part) => part.trim()).length

  if (urlCount > 0 && normalized.length <= 900) return 'link'
  if (listLineCount >= 3 || (lines.length >= 5 && listLineCount >= Math.ceil(lines.length * 0.45))) return 'list'
  if (normalized.length > 900 || paragraphCount >= 4) return 'long'
  return 'text'
}

function resourceKindLabel(kind: ResourceKind) {
  if (kind === 'link') return '网址资源'
  if (kind === 'list') return '清单资源'
  if (kind === 'long') return '长文资源'
  return '文本资源'
}

function parseTags(value: string) {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]
}

function plainPreview(content: string, limit = 220) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() + '...' : normalized
}

const ResourceCard = memo(function ResourceCard({
  item,
  expanded,
  onEdit,
  onToggleExpanded,
  onToggleStrike,
  onRemove,
}: {
  item: ResourceItem
  expanded: boolean
  onEdit: (item: ResourceItem) => void
  onToggleExpanded: (id: string) => void
  onToggleStrike: (item: ResourceItem) => void
  onRemove: (item: ResourceItem) => void
}) {
  const cardRef = useRef<HTMLElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const url = firstUrl(item.content)
  const collapsible = shouldCollapse(item.content)
  const displayContent = expanded || !collapsible ? item.content : previewContent(item.content)
  const kind = getResourceKind(item.content)

  useEffect(() => {
    const node = cardRef.current
    if (!node) return undefined
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true)
      return undefined
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setNearViewport(entry.isIntersecting)
      },
      { root: null, rootMargin: '900px 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <article ref={cardRef} className={'resource-card ' + item.status + ' kind-' + kind}>
      <div className="resource-head">
        <div>
          <div className="resource-title-row">
            <h2>{item.title || '未命名资源'}</h2>
            <span className={'resource-kind kind-' + kind}>
              {resourceKindLabel(kind)}
            </span>
          </div>
          <div className="resource-meta">
            {item.status === 'struck' ? '已加删除线' : '有效'} · 更新于 {formatTime(item.updatedAt)}
          </div>
        </div>
        <div className="resource-actions">
          <button className="icon-btn ghost" type="button" title="编辑" onClick={() => onEdit(item)}>
            <IconEdit size={14} />
          </button>
          <button className="chip" type="button" onClick={() => onToggleStrike(item)}>
            {item.status === 'struck' ? '恢复' : '删除线'}
          </button>
          <button className="icon-btn ghost" type="button" title="删除" onClick={() => onRemove(item)}>
            <IconTrash size={14} />
          </button>
        </div>
      </div>

      <div className="resource-body">
        <div className="resource-content">
          {nearViewport ? (
            <Markdown text={displayContent} />
          ) : (
            <div className="resource-plain-preview">{plainPreview(displayContent)}</div>
          )}
        </div>
        {collapsible && (
          <button
            className="chip ghost resource-toggle"
            type="button"
            onClick={() => onToggleExpanded(item.id)}
          >
            {expanded ? '收起全文' : '展开全文'}
          </button>
        )}
      </div>

      {url && (
        <a className="resource-link" href={url} target="_blank" rel="noreferrer">
          打开链接
        </a>
      )}

      {(item.tags ?? []).length > 0 && (
        <div className="resource-tags">
          {(item.tags ?? []).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}

      {item.note && (
        <div className="resource-note">
          <div className="resource-note-title">备注</div>
          {nearViewport ? (
            <Markdown text={item.note} />
          ) : (
            <div className="resource-plain-preview">{plainPreview(item.note, 120)}</div>
          )}
        </div>
      )}

      <div className="resource-id">ID: {item.id}</div>
    </article>
  )
})

export default function Resources() {
  const [items, setItems] = useState<ResourceItem[]>([])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [status, setStatus] = useState<ResourceStatus | ''>('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<ResourceItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)

  const totals = useMemo(() => {
    const struck = items.filter((item) => item.status === 'struck').length
    return { all: items.length, active: items.length - struck, struck }
  }, [items])

  const clearNoticeTimers = () => {
    if (noticeFadeTimer.current !== null) window.clearTimeout(noticeFadeTimer.current)
    if (noticeRemoveTimer.current !== null) window.clearTimeout(noticeRemoveTimer.current)
    noticeFadeTimer.current = null
    noticeRemoveTimer.current = null
  }

  const showNotice = (message: string, type: Notice['type'] = 'error') => {
    clearNoticeTimers()
    setNotice({ type, message, leaving: false })
    noticeFadeTimer.current = window.setTimeout(() => {
      setNotice((current) => (current ? { ...current, leaving: true } : current))
    }, 4200)
    noticeRemoveTimer.current = window.setTimeout(() => setNotice(null), 4800)
  }

  const load = async (nextQuery = deferredQuery, nextStatus = status) => {
    setLoading(true)
    try {
      setItems(await ResourcesApi.list(nextQuery, nextStatus))
    } catch (e) {
      showNotice((e as Error).message || '资源加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(deferredQuery, status)
  }, [deferredQuery, status])

  useEffect(() => clearNoticeTimers, [])

  const resetForm = () => {
    setDraft(emptyDraft)
    setEditing(null)
  }

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => ({ ...current, [id]: !current[id] }))
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const content = draft.content.trim()
    if (!content) {
      showNotice('资源内容不能为空')
      return
    }

    const payload: ResourcePayload = {
      title: draft.title.trim(),
      content,
      note: draft.note.trim(),
      tags: parseTags(draft.tags),
    }

    setSaving(true)
    try {
      if (editing) {
        const updated = await ResourcesApi.update(editing.id, payload)
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        showNotice('资源已更新', 'success')
      } else {
        const created = await ResourcesApi.create(payload)
        setItems((current) => [created, ...current])
        showNotice('资源已添加', 'success')
      }
      resetForm()
    } catch (e) {
      showNotice((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = useCallback((item: ResourceItem) => {
    setEditing(item)
    setDraft({
      title: item.title,
      content: item.content,
      note: item.note,
      tags: (item.tags ?? []).join(', '),
    })
  }, [])

  const toggleStrike = useCallback(async (item: ResourceItem) => {
    try {
      const updated = await ResourcesApi.strike(item.id, item.status !== 'struck')
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)))
    } catch (e) {
      showNotice((e as Error).message || '状态更新失败')
    }
  }, [])

  const remove = useCallback(async (item: ResourceItem) => {
    const name = item.title || summarize(item.content).slice(0, 30)
    if (!window.confirm(`确认删除资源「${name}」？`)) return
    try {
      await ResourcesApi.delete(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      if (editing?.id === item.id) resetForm()
      showNotice('资源已删除', 'success')
    } catch (e) {
      showNotice((e as Error).message || '删除失败')
    }
  }, [editing?.id])

  const handleToggleStrike = useCallback((item: ResourceItem) => {
    void toggleStrike(item)
  }, [toggleStrike])

  const handleRemove = useCallback((item: ResourceItem) => {
    void remove(item)
  }, [remove])

  return (
    <div className="page resources-page">
      {notice && (
        <div className={`toast ${notice.type} ${notice.leaving ? 'leaving' : ''}`}>
          {notice.message}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>资源列表</h1>
          <p className="muted">存放网址、说明、长文本、片段和待处理素材。</p>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={() => void load(deferredQuery, status)}>
            <IconRefresh size={14} />
            刷新
          </button>
        </div>
      </div>

      <section className="resources-layout">
        <aside className="resources-form-card">
          <div className="resources-card-title">
            <span>{editing ? '编辑资源' : '添加资源'}</span>
            {editing && (
              <button className="chip" type="button" onClick={resetForm}>
                取消编辑
              </button>
            )}
          </div>
          <form className="resources-form" onSubmit={submit}>
            <label>
              <span>标题，可选</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="例如：供应商资料 / 参考链接"
              />
            </label>
            <label>
              <span>资源内容</span>
              <textarea
                value={draft.content}
                onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                placeholder="可以是一条网址加描述，也可以是一整段资料..."
                rows={11}
              />
            </label>
            <label>
              <span>备注，可选</span>
              <textarea
                value={draft.note}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="补充来源、处理要求、分类线索..."
                rows={4}
              />
            </label>
            <label>
              <span>标签，可多个</span>
              <input
                value={draft.tags}
                onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                placeholder="例如：AI, 设计, 待整理"
              />
            </label>
            <button className="chip primary" type="submit" disabled={saving}>
              <IconPlus size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '添加资源'}
            </button>
          </form>
        </aside>

        <section className="resources-main">
          <div className="resources-tools">
            <label className="search">
              <IconSearch size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、内容或备注"
              />
            </label>
            <div className="resources-tabs">
              <button className={status === '' ? 'active' : ''} type="button" onClick={() => setStatus('')}>
                全部 {totals.all}
              </button>
              <button className={status === 'active' ? 'active' : ''} type="button" onClick={() => setStatus('active')}>
                有效 {totals.active}
              </button>
              <button className={status === 'struck' ? 'active' : ''} type="button" onClick={() => setStatus('struck')}>
                删除线 {totals.struck}
              </button>
            </div>
          </div>

          <div className="resources-list">
            {loading ? (
              <div className="empty-state">资源加载中...</div>
            ) : items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">还没有资源</div>
                <p className="muted">在左侧添加网址、说明、长文本或任意片段。</p>
              </div>
            ) : (
              items.map((item) => (
                <ResourceCard
                  key={item.id}
                  item={item}
                  expanded={expandedIds[item.id] === true}
                  onEdit={startEdit}
                  onToggleExpanded={toggleExpanded}
                  onToggleStrike={handleToggleStrike}
                  onRemove={handleRemove}
                />
              ))
            )}
          </div>
        </section>
      </section>
    </div>
  )
}
