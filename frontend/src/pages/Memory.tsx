import {
  useDeferredValue,
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import {
  MemoryApi,
  type MemoryCategory,
  type MemoryItem,
  type MemoryPayload,
  type MemoryPriority,
  type MemoryScope,
  type MemorySource,
  type MemorySuggestion,
  type MemorySummary,
  type RuntimePreview,
  type SecureMemoryDetail,
  type SecureMemoryExposureMode,
  type SecureMemoryIndexItem,
  type SecureMemoryPayload,
  type SecureMemoryType,
} from '../api/memory'
import CollapsibleContent from '../components/CollapsibleContent'
import {
  IconEdit,
  IconMemory,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconTrash,
} from '../components/Icons'

type Notice = {
  type: 'success' | 'error'
  message: string
}

type MemoryDraft = {
  category: MemoryCategory
  title: string
  content: string
  tags: string
  scope: MemoryScope
  priority: MemoryPriority
  source: MemorySource
  active: boolean
}

type SecureDraft = {
  title: string
  type: SecureMemoryType
  tags: string
  allowedUse: string
  exposureMode: SecureMemoryExposureMode
  content: string
}

const memoryCategoryOptions: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'hard_rule', label: '硬规则' },
  { value: 'preference', label: '偏好' },
  { value: 'habit', label: '习惯' },
  { value: 'style', label: '风格' },
  { value: 'workflow', label: '工作流' },
  { value: 'constraint', label: '约束' },
  { value: 'identity', label: '身份信息' },
  { value: 'project_context', label: '项目上下文' },
]

const scopeOptions: Array<{ value: MemoryScope; label: string }> = [
  { value: 'global', label: '全局' },
  { value: 'repository', label: '仓库' },
  { value: 'notes', label: '笔记' },
  { value: 'workspace', label: '工作区' },
]

const priorityOptions: Array<{ value: MemoryPriority; label: string }> = [
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '中优先级' },
  { value: 'low', label: '低优先级' },
]

const sourceOptions: Array<{ value: MemorySource; label: string }> = [
  { value: 'user_explicit', label: '用户明确要求' },
  { value: 'agent_inferred', label: 'Agent 推断' },
  { value: 'imported', label: '导入' },
]

const secureTypeOptions: Array<{ value: SecureMemoryType; label: string }> = [
  { value: 'api_key', label: 'API Key' },
  { value: 'token', label: 'Token' },
  { value: 'password', label: '密码' },
  { value: 'config', label: '配置' },
  { value: 'certificate', label: '证书' },
  { value: 'other', label: '其他' },
]

const exposureModeOptions: Array<{ value: SecureMemoryExposureMode; label: string }> = [
  { value: 'tool_only', label: '仅工具使用' },
  { value: 'raw_on_demand', label: '按需读取原文' },
]

const emptyMemoryDraft: MemoryDraft = {
  category: 'preference',
  title: '',
  content: '',
  tags: '',
  scope: 'global',
  priority: 'normal',
  source: 'user_explicit',
  active: true,
}

const emptySecureDraft: SecureDraft = {
  title: '',
  type: 'api_key',
  tags: '',
  allowedUse: '',
  exposureMode: 'tool_only',
  content: '',
}

function formatTime(ts: number | null) {
  if (!ts) return '未记录'
  return new Date(ts).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseList(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '')
    if (message) return message
  }
  return fallback
}

function findOptionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find((item) => item.value === value)?.label ?? value
}

function toMemoryDraft(item: MemoryItem): MemoryDraft {
  return {
    category: item.category,
    title: item.title,
    content: item.content,
    tags: item.tags.join(', '),
    scope: item.scope,
    priority: item.priority,
    source: item.source,
    active: item.active,
  }
}

function toSecureDraft(item: SecureMemoryDetail): SecureDraft {
  return {
    title: item.title,
    type: item.type,
    tags: item.tags.join(', '),
    allowedUse: item.allowedUse.join(', '),
    exposureMode: item.exposureMode,
    content: item.content,
  }
}

export default function Memory() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const [summary, setSummary] = useState<MemorySummary | null>(null)
  const [profile, setProfile] = useState('')
  const [secureProfile, setSecureProfile] = useState('')
  const [preview, setPreview] = useState<RuntimePreview | null>(null)
  const [previewRequest, setPreviewRequest] = useState('')

  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([])
  const [secureItems, setSecureItems] = useState<SecureMemoryIndexItem[]>([])

  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(emptyMemoryDraft)
  const [secureDraft, setSecureDraft] = useState<SecureDraft>(emptySecureDraft)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingSecureId, setEditingSecureId] = useState<string | null>(null)
  const [showMemoryForm, setShowMemoryForm] = useState(false)
  const [showSecureForm, setShowSecureForm] = useState(false)
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(() => new Set())
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState<Set<string>>(() => new Set())
  const [expandedSecureIds, setExpandedSecureIds] = useState<Set<string>>(() => new Set())

  const [loading, setLoading] = useState(true)
  const [savingMemory, setSavingMemory] = useState(false)
  const [savingSecure, setSavingSecure] = useState(false)
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null)
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null)
  const [busySecureDeleteId, setBusySecureDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const toggleExpandedId = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const loadLists = async (keyword = deferredQuery) => {
    const [memoryItems, suggestionItems, secureEntries] = await Promise.all([
      MemoryApi.list(keyword),
      MemoryApi.listSuggestions(keyword),
      MemoryApi.listSecure(keyword),
    ])
    setMemories(memoryItems)
    setSuggestions(suggestionItems)
    setSecureItems(secureEntries)
  }

  const loadMeta = async () => {
    const [summaryResult, profileResult] = await Promise.all([MemoryApi.summary(), MemoryApi.profile()])
    setSummary(summaryResult)
    setProfile(profileResult.profile)
    setSecureProfile(profileResult.secureProfile)
  }

  const loadPreview = async (request = previewRequest) => {
    setPreview(await MemoryApi.runtimePreview(request))
  }

  const refreshAll = async (keyword = deferredQuery, request = previewRequest) => {
    setLoading(true)
    try {
      await Promise.all([loadLists(keyword), loadMeta(), loadPreview(request)])
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '记忆中心加载失败') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll(deferredQuery, previewRequest)
  }, [deferredQuery])

  const resetMemoryForm = () => {
    setEditingMemoryId(null)
    setMemoryDraft(emptyMemoryDraft)
    setShowMemoryForm(false)
  }

  const resetSecureForm = () => {
    setEditingSecureId(null)
    setSecureDraft(emptySecureDraft)
    setShowSecureForm(false)
  }

  const submitMemory = async (event: FormEvent) => {
    event.preventDefault()
    const payload: MemoryPayload = {
      category: memoryDraft.category,
      title: memoryDraft.title.trim(),
      content: memoryDraft.content.trim(),
      tags: parseList(memoryDraft.tags),
      scope: memoryDraft.scope,
      priority: memoryDraft.priority,
      source: memoryDraft.source,
      active: memoryDraft.active,
    }

    setSavingMemory(true)
    try {
      if (editingMemoryId) {
        await MemoryApi.update(editingMemoryId, payload)
        setNotice({ type: 'success', message: '长期记忆已更新' })
      } else {
        await MemoryApi.create(payload)
        setNotice({ type: 'success', message: '长期记忆已创建' })
      }
      resetMemoryForm()
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '长期记忆保存失败') })
    } finally {
      setSavingMemory(false)
    }
  }

  const startEditMemory = (item: MemoryItem) => {
    setEditingMemoryId(item.id)
    setMemoryDraft(toMemoryDraft(item))
    setShowMemoryForm(true)
  }

  const toggleMemoryActive = async (item: MemoryItem) => {
    try {
      await MemoryApi.update(item.id, { active: !item.active })
      setNotice({ type: 'success', message: item.active ? '长期记忆已停用' : '长期记忆已启用' })
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '状态切换失败') })
    }
  }

  const removeMemory = async (item: MemoryItem) => {
    setBusyDeleteId(item.id)
    try {
      await MemoryApi.delete(item.id)
      setNotice({ type: 'success', message: '长期记忆已删除' })
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '删除长期记忆失败') })
    } finally {
      setBusyDeleteId(null)
    }
  }

  const confirmSuggestion = async (item: MemorySuggestion) => {
    setBusySuggestionId(item.id)
    try {
      await MemoryApi.confirmSuggestion(item.id)
      setNotice({ type: 'success', message: '建议已转为正式长期记忆' })
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '确认建议失败') })
    } finally {
      setBusySuggestionId(null)
    }
  }

  const rejectSuggestion = async (item: MemorySuggestion) => {
    setBusySuggestionId(item.id)
    try {
      await MemoryApi.rejectSuggestion(item.id)
      setNotice({ type: 'success', message: '建议已丢弃' })
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '丢弃建议失败') })
    } finally {
      setBusySuggestionId(null)
    }
  }

  const submitSecure = async (event: FormEvent) => {
    event.preventDefault()
    const payload: SecureMemoryPayload = {
      title: secureDraft.title.trim(),
      type: secureDraft.type,
      tags: parseList(secureDraft.tags),
      allowedUse: parseList(secureDraft.allowedUse),
      exposureMode: secureDraft.exposureMode,
      content: secureDraft.content.trim(),
    }

    setSavingSecure(true)
    try {
      if (editingSecureId) {
        await MemoryApi.updateSecure(editingSecureId, payload)
        setNotice({ type: 'success', message: '敏感长期记忆已更新' })
      } else {
        await MemoryApi.createSecure(payload)
        setNotice({ type: 'success', message: '敏感长期记忆已创建' })
      }
      resetSecureForm()
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '敏感长期记忆保存失败') })
    } finally {
      setSavingSecure(false)
    }
  }

  const startEditSecure = async (item: SecureMemoryIndexItem) => {
    try {
      const detail = await MemoryApi.readSecure(item.id)
      setEditingSecureId(detail.id)
      setSecureDraft(toSecureDraft(detail))
      setShowSecureForm(true)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '敏感长期记忆读取失败') })
    }
  }

  const removeSecure = async (item: SecureMemoryIndexItem) => {
    setBusySecureDeleteId(item.id)
    try {
      await MemoryApi.deleteSecure(item.id)
      setNotice({ type: 'success', message: '敏感长期记忆已删除' })
      await refreshAll(deferredQuery, previewRequest)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '删除敏感长期记忆失败') })
    } finally {
      setBusySecureDeleteId(null)
    }
  }

  const runPreview = async () => {
    try {
      await loadPreview(previewRequest)
      setNotice({ type: 'success', message: '运行时注入预览已刷新' })
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '运行时预览失败') })
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>记忆中心</h1>
          <div className="muted">
            管理 Agent 的长期记忆、待确认建议和敏感长期记忆库。敏感项会单独保存，不会默认全量注入。
          </div>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={() => void refreshAll()}>
            <IconRefresh size={14} /> 刷新
          </button>
          <button
            className="chip"
            type="button"
            onClick={() => {
              resetMemoryForm()
              setShowMemoryForm(true)
            }}
          >
            <IconPlus size={14} /> 新增长期记忆
          </button>
          <button
            className="chip primary"
            type="button"
            onClick={() => {
              resetSecureForm()
              setShowSecureForm(true)
            }}
          >
            <IconPlus size={14} /> 新增敏感记忆
          </button>
        </div>
      </header>

      {notice ? <div className={'banner' + (notice.type === 'error' ? ' error' : '')}>{notice.message}</div> : null}

      <div className="memory-topbar">
        <label className="memory-search">
          <IconSearch size={15} />
          <input
            type="text"
            placeholder="搜索长期记忆、建议或敏感目录"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="memory-stats">
        <div className="memory-stat">
          <span>已确认记忆</span>
          <strong>{summary?.counts.confirmed ?? 0}</strong>
        </div>
        <div className="memory-stat">
          <span>启用中</span>
          <strong>{summary?.counts.active ?? 0}</strong>
        </div>
        <div className="memory-stat">
          <span>待确认建议</span>
          <strong>{summary?.counts.suggestions ?? 0}</strong>
        </div>
        <div className="memory-stat">
          <span>敏感目录</span>
          <strong>{summary?.counts.secure ?? 0}</strong>
        </div>
        <div className="memory-stat">
          <span>高优先级</span>
          <strong>{summary?.counts.highPriority ?? 0}</strong>
        </div>
      </div>

      <div className="memory-layout">
        <div className="memory-main">
          {showMemoryForm ? (
            <section className="memory-section">
              <div className="memory-section-head">
                <div>
                  <h2>{editingMemoryId ? '编辑长期记忆' : '新增长期记忆'}</h2>
                  <p>这里保存会被 Agent 长期记住并参与运行时注入的规则、偏好和项目上下文。</p>
                </div>
              </div>
              <form className="memory-form" onSubmit={submitMemory}>
                <div className="memory-form-grid">
                  <label>
                    <span>标题</span>
                    <input
                      className="settings-input"
                      value={memoryDraft.title}
                      onChange={(event) =>
                        setMemoryDraft((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>类别</span>
                    <select
                      className="settings-input"
                      value={memoryDraft.category}
                      onChange={(event) =>
                        setMemoryDraft((current) => ({
                          ...current,
                          category: event.target.value as MemoryCategory,
                        }))
                      }
                    >
                      {memoryCategoryOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>作用域</span>
                    <select
                      className="settings-input"
                      value={memoryDraft.scope}
                      onChange={(event) =>
                        setMemoryDraft((current) => ({
                          ...current,
                          scope: event.target.value as MemoryScope,
                        }))
                      }
                    >
                      {scopeOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>优先级</span>
                    <select
                      className="settings-input"
                      value={memoryDraft.priority}
                      onChange={(event) =>
                        setMemoryDraft((current) => ({
                          ...current,
                          priority: event.target.value as MemoryPriority,
                        }))
                      }
                    >
                      {priorityOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>来源</span>
                    <select
                      className="settings-input"
                      value={memoryDraft.source}
                      onChange={(event) =>
                        setMemoryDraft((current) => ({
                          ...current,
                          source: event.target.value as MemorySource,
                        }))
                      }
                    >
                      {sourceOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="memory-toggle-row">
                    <span>启用状态</span>
                    <button
                      className={'switch' + (memoryDraft.active ? ' on' : '')}
                      type="button"
                      onClick={() => setMemoryDraft((current) => ({ ...current, active: !current.active }))}
                    >
                      <span className="switch-thumb" />
                    </button>
                  </label>
                </div>

                <label>
                  <span>内容</span>
                  <textarea
                    className="settings-input"
                    rows={5}
                    value={memoryDraft.content}
                    onChange={(event) =>
                      setMemoryDraft((current) => ({ ...current, content: event.target.value }))
                    }
                    placeholder="例如：默认使用中文回复；修改仓库代码前先说明影响范围。"
                  />
                </label>

                <label>
                  <span>标签</span>
                  <input
                    className="settings-input"
                    placeholder="例如：language, formatting, repo"
                    value={memoryDraft.tags}
                    onChange={(event) =>
                      setMemoryDraft((current) => ({ ...current, tags: event.target.value }))
                    }
                  />
                </label>

                <div className="memory-form-actions">
                  <button className="chip" type="button" onClick={resetMemoryForm}>
                    取消
                  </button>
                  <button className="chip primary" type="submit" disabled={savingMemory}>
                    {savingMemory ? '保存中...' : editingMemoryId ? '保存修改' : '创建记忆'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>已确认长期记忆</h2>
                <p>这些内容会进入 Agent 的长期画像层，并按优先级和相关性参与运行时注入。</p>
              </div>
            </div>
            <div className="memory-card-grid">
              {loading && memories.length === 0 ? (
                <div className="memory-empty">正在加载长期记忆...</div>
              ) : memories.length === 0 ? (
                <div className="memory-empty">当前没有已确认的长期记忆。</div>
              ) : (
                memories.map((item) => {
                  const expanded = expandedMemoryIds.has(item.id)
                  return (
                    <article
                      key={item.id}
                      className={
                        'memory-card memory-card-collapsible' +
                        (item.active ? '' : ' inactive') +
                        (expanded ? ' expanded' : ' collapsed')
                      }
                    >
                    <div className="memory-card-head">
                      <div>
                        <h3>{item.title}</h3>
                        <div className="memory-card-meta">
                          <span>{findOptionLabel(memoryCategoryOptions, item.category)}</span>
                          <span>{findOptionLabel(scopeOptions, item.scope)}</span>
                          <span>{findOptionLabel(priorityOptions, item.priority)}</span>
                          <span>{findOptionLabel(sourceOptions, item.source)}</span>
                          <span>{item.active ? '启用中' : '已停用'}</span>
                        </div>
                      </div>
                      <div className="memory-card-actions">
                        <button
                          className="chip"
                          type="button"
                          onClick={() => toggleExpandedId(setExpandedMemoryIds, item.id)}
                        >
                          {expanded ? '收起详情' : '展开详情'}
                        </button>
                        <button
                          className="icon-btn ghost"
                          type="button"
                          title="编辑"
                          onClick={() => startEditMemory(item)}
                        >
                          <IconEdit size={14} />
                        </button>
                        <button className="chip" type="button" onClick={() => void toggleMemoryActive(item)}>
                          {item.active ? '停用' : '启用'}
                        </button>
                        <button
                          className="icon-btn ghost"
                          type="button"
                          title="删除"
                          onClick={() => void removeMemory(item)}
                          disabled={busyDeleteId === item.id}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <>
                        <CollapsibleContent text={item.content} collapsedLines={8} collapsedChars={900} />
                        {item.tags.length > 0 ? (
                          <div className="memory-tags">
                            {item.tags.map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="memory-card-foot">
                          <span>ID: {item.id}</span>
                          <span>更新于 {formatTime(item.updatedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="memory-card-preview-line">
                        <span>{item.content.slice(0, 96) || '暂无正文'}</span>
                      </div>
                    )}
                  </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>待确认建议</h2>
                <p>这些建议不会直接长期生效，确认后才会转入正式长期记忆。</p>
              </div>
            </div>
            <div className="memory-card-grid">
              {loading && suggestions.length === 0 ? (
                <div className="memory-empty">正在加载建议...</div>
              ) : suggestions.length === 0 ? (
                <div className="memory-empty">当前没有待确认的长期记忆建议。</div>
              ) : (
                suggestions.map((item) => {
                  const expanded = expandedSuggestionIds.has(item.id)
                  return (
                    <article
                      key={item.id}
                      className={'memory-card memory-card-collapsible suggestion' + (expanded ? ' expanded' : ' collapsed')}
                    >
                    <div className="memory-card-head">
                      <div>
                        <h3>{item.title}</h3>
                        <div className="memory-card-meta">
                          <span>{findOptionLabel(memoryCategoryOptions, item.category)}</span>
                          <span>{findOptionLabel(priorityOptions, item.priority)}</span>
                          <span>{findOptionLabel(sourceOptions, item.source)}</span>
                        </div>
                      </div>
                      <div className="memory-card-actions">
                        <button
                          className="chip"
                          type="button"
                          onClick={() => toggleExpandedId(setExpandedSuggestionIds, item.id)}
                        >
                          {expanded ? '收起详情' : '展开详情'}
                        </button>
                        <button
                          className="chip primary"
                          type="button"
                          onClick={() => void confirmSuggestion(item)}
                          disabled={busySuggestionId === item.id}
                        >
                          确认
                        </button>
                        <button
                          className="chip"
                          type="button"
                          onClick={() => void rejectSuggestion(item)}
                          disabled={busySuggestionId === item.id}
                        >
                          丢弃
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <>
                        <CollapsibleContent text={item.content} collapsedLines={6} collapsedChars={700} />
                        {item.tags.length > 0 ? (
                          <div className="memory-tags">
                            {item.tags.map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="memory-card-foot">
                          <span>ID: {item.id}</span>
                          <span>生成于 {formatTime(item.updatedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="memory-card-preview-line">
                        <span>{item.content.slice(0, 96) || '暂无正文'}</span>
                      </div>
                    )}
                  </article>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <aside className="memory-side">
          {showSecureForm ? (
            <section className="memory-section">
              <div className="memory-section-head">
                <div>
                  <h2>{editingSecureId ? '编辑敏感长期记忆' : '新增敏感长期记忆'}</h2>
                  <p>敏感内容会单独写入 `data/memory/secure/entries/*.md`，默认只注入目录摘要。</p>
                </div>
              </div>
              <form className="memory-form" onSubmit={submitSecure}>
                <div className="memory-form-grid">
                  <label>
                    <span>标题</span>
                    <input
                      className="settings-input"
                      value={secureDraft.title}
                      onChange={(event) =>
                        setSecureDraft((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>类型</span>
                    <select
                      className="settings-input"
                      value={secureDraft.type}
                      onChange={(event) =>
                        setSecureDraft((current) => ({
                          ...current,
                          type: event.target.value as SecureMemoryType,
                        }))
                      }
                    >
                      {secureTypeOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>暴露模式</span>
                    <select
                      className="settings-input"
                      value={secureDraft.exposureMode}
                      onChange={(event) =>
                        setSecureDraft((current) => ({
                          ...current,
                          exposureMode: event.target.value as SecureMemoryExposureMode,
                        }))
                      }
                    >
                      {exposureModeOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>标签</span>
                    <input
                      className="settings-input"
                      value={secureDraft.tags}
                      onChange={(event) =>
                        setSecureDraft((current) => ({ ...current, tags: event.target.value }))
                      }
                    />
                  </label>
                  <label className="memory-form-span-2">
                    <span>允许用途</span>
                    <input
                      className="settings-input"
                      placeholder="例如：llm, image-generation, github"
                      value={secureDraft.allowedUse}
                      onChange={(event) =>
                        setSecureDraft((current) => ({ ...current, allowedUse: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label>
                  <span>原始内容</span>
                  <textarea
                    className="settings-input"
                    rows={5}
                    value={secureDraft.content}
                    onChange={(event) =>
                      setSecureDraft((current) => ({ ...current, content: event.target.value }))
                    }
                    placeholder="输入密钥、令牌、密码或其他敏感配置。"
                  />
                </label>

                <div className="memory-form-actions">
                  <button className="chip" type="button" onClick={resetSecureForm}>
                    取消
                  </button>
                  <button className="chip primary" type="submit" disabled={savingSecure}>
                    {savingSecure ? '保存中...' : editingSecureId ? '保存修改' : '创建敏感记忆'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>敏感长期记忆目录</h2>
                <p>默认只展示目录和脱敏值。需要时 Agent 再按条读取原文。</p>
              </div>
            </div>
            <div className="memory-side-list">
              {loading && secureItems.length === 0 ? (
                <div className="memory-empty">正在加载敏感目录...</div>
              ) : secureItems.length === 0 ? (
                <div className="memory-empty">当前没有敏感长期记忆。</div>
              ) : (
                secureItems.map((item) => {
                  const expanded = expandedSecureIds.has(item.id)
                  return (
                    <article
                      key={item.id}
                      className={'memory-secure-card memory-card-collapsible' + (expanded ? ' expanded' : ' collapsed')}
                    >
                    <div className="memory-card-head">
                      <div>
                        <h3>{item.title}</h3>
                        <div className="memory-card-meta">
                          <span>{findOptionLabel(secureTypeOptions, item.type)}</span>
                          <span>{findOptionLabel(exposureModeOptions, item.exposureMode)}</span>
                        </div>
                      </div>
                      <div className="memory-card-actions">
                        <button
                          className="chip"
                          type="button"
                          onClick={() => toggleExpandedId(setExpandedSecureIds, item.id)}
                        >
                          {expanded ? '收起详情' : '展开详情'}
                        </button>
                        <button
                          className="icon-btn ghost"
                          type="button"
                          title="编辑"
                          onClick={() => void startEditSecure(item)}
                        >
                          <IconEdit size={14} />
                        </button>
                        <button
                          className="icon-btn ghost"
                          type="button"
                          title="删除"
                          onClick={() => void removeSecure(item)}
                          disabled={busySecureDeleteId === item.id}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <>
                        <div className="memory-secure-mask">{item.mask || '(empty)'}</div>
                        {item.tags.length > 0 ? (
                          <div className="memory-tags">
                            {item.tags.map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        {item.allowedUse.length > 0 ? (
                          <div className="memory-secure-uses">
                            {item.allowedUse.map((use) => (
                              <span key={use}>{use}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="memory-card-foot">
                          <span>{item.id}</span>
                          <span>{formatTime(item.updatedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="memory-card-preview-line">
                        <span>{item.mask || '(empty)'}</span>
                      </div>
                    )}
                  </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>运行时注入预览</h2>
                <p>可直接预览某条请求会命中哪些长期记忆和敏感目录摘要。</p>
              </div>
            </div>
            <div className="memory-preview-form">
              <textarea
                className="settings-input"
                rows={4}
                placeholder="输入一条请求，例如：以后默认用中文，并且修改前先说明风险。"
                value={previewRequest}
                onChange={(event) => setPreviewRequest(event.target.value)}
              />
              <button className="chip primary" type="button" onClick={() => void runPreview()}>
                <IconSparkle size={14} /> 预览注入
              </button>
            </div>
            <div className="memory-runtime-meta">
              <span>常驻记忆：{preview?.always.length ?? 0}</span>
              <span>相关记忆：{preview?.relevant.length ?? 0}</span>
              <span>敏感目录：{preview?.secureCatalog.length ?? 0}</span>
            </div>
            <div className="memory-profile-panel">
              <CollapsibleContent text={preview?.rendered ?? ''} collapsedLines={20} collapsedChars={2800} />
            </div>
          </section>

          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>画像文档</h2>
                <p>这里展示系统自动生成的 `profile.md` 和 `secure-memory.md`。</p>
              </div>
            </div>
            <div className="memory-profile-panel">
              <div className="memory-profile-title">
                <IconMemory size={15} /> 普通长期记忆画像
              </div>
              <CollapsibleContent text={profile} collapsedLines={24} collapsedChars={3200} />
            </div>
            <div className="memory-profile-panel">
              <div className="memory-profile-title">
                <IconMemory size={15} /> 敏感长期记忆总览
              </div>
              <CollapsibleContent text={secureProfile} collapsedLines={24} collapsedChars={3200} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
