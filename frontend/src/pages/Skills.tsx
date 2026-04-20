import { memo, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  SkillsApi,
  type SkillDetail,
  type SkillItem,
  type SkillMarketplaceInspect,
  type SkillMarketplaceItem,
  type SkillMarketplacePreview,
} from '../api/skills'
import {
  IconBranch,
  IconClose,
  IconFolder,
  IconRefresh,
  IconSearch,
  IconStar,
  IconTrash,
} from '../components/Icons'
import CollapsibleContent from '../components/CollapsibleContent'
import VirtualList from '../components/VirtualList'

type ActionDialogState =
  | { kind: 'delete'; item: SkillItem }
  | { kind: 'install'; item: SkillMarketplaceItem; inspect: SkillMarketplaceInspect }

type ActionDialogProps = {
  open: boolean
  title: string
  subtitle?: string
  confirmLabel: string
  confirmTone?: 'primary' | 'danger'
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
  children: ReactNode
}

const MARKET_SHORTCUTS = ['frontend', 'browser', 'docs', 'design', 'automation', 'react']
const MARKET_CARD_HEIGHT = 112
const LOCAL_SKILL_CARD_HEIGHT = 126

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message || '')
    if (message) return message
  }
  return fallback
}

function getLocalSkillId(item: SkillMarketplaceItem) {
  return item.id.split('/')[2] ?? item.id
}

function getPreviewKey(id: string, filePath: string) {
  return `${id}::${filePath}`
}

function sampleFilesPreview(files: string[], limit = 18) {
  return {
    visible: files.slice(0, limit),
    hiddenCount: Math.max(files.length - limit, 0),
  }
}

function ActionDialog({
  open,
  title,
  subtitle,
  confirmLabel,
  confirmTone = 'primary',
  busy = false,
  onClose,
  onConfirm,
  children,
}: ActionDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-head">
          <div>
            <div className="confirm-dialog-title">{title}</div>
            {subtitle ? <p className="confirm-dialog-subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-btn ghost" type="button" onClick={onClose} disabled={busy} title="关闭">
            <IconClose size={16} />
          </button>
        </div>
        <div className="confirm-dialog-body">{children}</div>
        <div className="confirm-dialog-foot">
          <button className="skill-btn subtle" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className={`skill-btn ${confirmTone === 'danger' ? 'danger' : 'primary'}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const SkillMarketCard = memo(function SkillMarketCard({
  item,
  active,
  installed,
  fileCount,
  onSelect,
}: {
  item: SkillMarketplaceItem
  active: boolean
  installed: boolean
  fileCount: number | null
  onSelect: (id: string) => void
}) {
  return (
    <article className={`skill-market-result${active ? ' active' : ''}`} onClick={() => onSelect(item.id)}>
      <div className="skill-market-result-head">
        <div className="skill-market-result-copy">
          <h3>{item.name}</h3>
          <p>{item.id}</p>
        </div>
        {installed ? <span className="skill-market-status installed">已安装</span> : null}
      </div>
      <div className="skill-market-result-meta">
        <span>
          <IconBranch size={13} />
          {item.owner}/{item.repo}
        </span>
        <span>
          <IconStar size={13} />
          {item.downloads || '0'}
        </span>
        {fileCount !== null ? (
          <span>
            <IconFolder size={13} />
            {fileCount} 文件
          </span>
        ) : null}
      </div>
    </article>
  )
})

const LocalSkillCard = memo(function LocalSkillCard({
  item,
  active,
  onSelect,
}: {
  item: SkillItem
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <article className={`skill-card${active ? ' active' : ''}`} onClick={() => onSelect(item.id)}>
      <div className="skill-card-head">
        <div>
          <h3>{item.name}</h3>
          <div className="skill-id">{item.id}</div>
        </div>
        <span className={`skill-state${item.enabled ? ' enabled' : ''}`}>{item.enabled ? '启用中' : '已停用'}</span>
      </div>
      <p>{item.description}</p>
      <div className="skill-card-foot">
        <span>{formatBytes(item.size)}</span>
        <span>{formatTime(item.updatedAt)}</span>
      </div>
    </article>
  )
})

export default function Skills() {
  const [items, setItems] = useState<SkillItem[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const [marketQuery, setMarketQuery] = useState('')
  const [marketItems, setMarketItems] = useState<SkillMarketplaceItem[]>([])
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null)
  const [marketInspect, setMarketInspect] = useState<Record<string, SkillMarketplaceInspect>>({})
  const [marketPreviewPath, setMarketPreviewPath] = useState<Record<string, string>>({})
  const [marketPreviewCache, setMarketPreviewCache] = useState<Record<string, SkillMarketplacePreview>>({})

  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [marketLoading, setMarketLoading] = useState(false)
  const [inspectingId, setInspectingId] = useState<string | null>(null)
  const [previewingKey, setPreviewingKey] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<ActionDialogState | null>(null)

  const filteredItems = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) =>
      [item.id, item.name, item.description].some((value) => value.toLowerCase().includes(keyword)),
    )
  }, [deferredQuery, items])

  const installedIds = useMemo(() => new Set(items.map((item) => item.id)), [items])

  const counts = useMemo(
    () => ({
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      market: marketItems.length,
    }),
    [items, marketItems],
  )

  const selectedMarket = useMemo(
    () => marketItems.find((item) => item.id === selectedMarketId) ?? null,
    [marketItems, selectedMarketId],
  )

  const selectedInspect = selectedMarket ? marketInspect[selectedMarket.id] ?? null : null
  const selectedMarketFilePath =
    selectedMarket && selectedInspect
      ? marketPreviewPath[selectedMarket.id] ?? selectedInspect.previewFiles[0] ?? null
      : null
  const selectedMarketPreview =
    selectedMarket && selectedMarketFilePath
      ? marketPreviewCache[getPreviewKey(selectedMarket.id, selectedMarketFilePath)] ?? null
      : null

  const handleSelectMarket = useCallback((id: string) => {
    setSelectedMarketId(id)
  }, [])

  const handleSelectSkill = useCallback((id: string) => {
    setSelectedSkillId(id)
  }, [])

  const loadSkills = useCallback(async () => {
    setLoading(true)
    try {
      const next = await SkillsApi.list()
      setItems(next)
      setSelectedSkillId((current) => {
        if (current && next.some((item) => item.id === current)) return current
        return next[0]?.id ?? null
      })
    } catch (error) {
      setNotice(getErrorMessage(error, '本地 Skill 加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  const searchMarketplace = useCallback(async (nextQuery: string) => {
    setMarketLoading(true)
    setNotice('')
    try {
      const result = await SkillsApi.searchMarketplace(nextQuery.trim(), 24)
      setMarketItems(result.items)
      setMarketInspect({})
      setMarketPreviewPath({})
      setMarketPreviewCache({})
      setSelectedMarketId(result.items[0]?.id ?? null)
      if (result.items.length === 0 && nextQuery.trim()) {
        setNotice('没有找到匹配的 Skill。')
      }
    } catch (error) {
      setNotice(getErrorMessage(error, 'Skill 市场搜索失败'))
    } finally {
      setMarketLoading(false)
    }
  }, [])

  const ensureInspect = useCallback(
    async (item: SkillMarketplaceItem) => {
      if (marketInspect[item.id]) return marketInspect[item.id]
      setInspectingId(item.id)
      try {
        const inspect = await SkillsApi.inspectMarketplace(item.id)
        setMarketInspect((current) => ({ ...current, [item.id]: inspect }))
        if (inspect.previewFiles.length > 0) {
          setMarketPreviewPath((current) => ({
            ...current,
            [item.id]: current[item.id] ?? inspect.previewFiles[0] ?? 'SKILL.md',
          }))
        }
        return inspect
      } catch (error) {
        setNotice(getErrorMessage(error, 'Skill 预检失败'))
        return null
      } finally {
        setInspectingId((current) => (current === item.id ? null : current))
      }
    },
    [marketInspect],
  )

  const ensurePreview = useCallback(
    async (
      item: SkillMarketplaceItem,
      preferredPath?: string | null,
      inspectOverride?: SkillMarketplaceInspect | null,
    ) => {
      const inspect = inspectOverride ?? marketInspect[item.id] ?? (await ensureInspect(item))
      if (!inspect || inspect.previewFiles.length === 0) return null

      const filePath = preferredPath ?? marketPreviewPath[item.id] ?? inspect.previewFiles[0]
      if (!filePath) return null

      const key = getPreviewKey(item.id, filePath)
      const cached = marketPreviewCache[key]
      if (cached) return cached

      setPreviewingKey(key)
      try {
        const preview = await SkillsApi.previewMarketplace(item.id, filePath)
        setMarketPreviewCache((current) => ({ ...current, [key]: preview }))
        setMarketPreviewPath((current) => ({ ...current, [item.id]: preview.path }))
        return preview
      } catch (error) {
        setNotice(getErrorMessage(error, 'Skill 文件预览加载失败'))
        return null
      } finally {
        setPreviewingKey((current) => (current === key ? null : current))
      }
    },
    [ensureInspect, marketInspect, marketPreviewCache, marketPreviewPath],
  )

  const openInstallDialog = useCallback(
    async (item: SkillMarketplaceItem) => {
      const inspect = marketInspect[item.id] ?? (await ensureInspect(item))
      if (!inspect) return
      if (inspect.exceedsHardLimit) {
        setNotice('这个 Skill 超过了硬安全上限，当前禁止安装。')
        return
      }
      setDialog({ kind: 'install', item, inspect })
    },
    [ensureInspect, marketInspect],
  )

  const confirmInstall = useCallback(async () => {
    if (!dialog || dialog.kind !== 'install') return
    const { item, inspect } = dialog
    setInstallingId(item.id)
    try {
      const installed = await SkillsApi.installMarketplace(item.id, inspect.exceedsDefaultLimit)
      setDialog(null)
      await loadSkills()
      setSelectedSkillId(installed.id)
      setNotice(`Skill「${installed.name}」已安装。`)
    } catch (error) {
      setNotice(getErrorMessage(error, 'Skill 安装失败'))
    } finally {
      setInstallingId(null)
    }
  }, [dialog, loadSkills])

  const confirmDelete = useCallback(async () => {
    if (!dialog || dialog.kind !== 'delete') return
    const { item } = dialog
    setDeletingId(item.id)
    try {
      await SkillsApi.delete(item.id)
      setDialog(null)
      await loadSkills()
      setNotice(`Skill「${item.name}」已删除。`)
    } catch (error) {
      setNotice(getErrorMessage(error, 'Skill 删除失败'))
    } finally {
      setDeletingId(null)
    }
  }, [dialog, loadSkills])

  useEffect(() => {
    void loadSkills()
    void searchMarketplace('')
  }, [loadSkills, searchMarketplace])

  useEffect(() => {
    if (!selectedSkillId) {
      setSelectedSkill(null)
      return
    }

    let cancelled = false
    setDetailLoading(true)
    void SkillsApi.read(selectedSkillId)
      .then((detail) => {
        if (!cancelled) setSelectedSkill(detail)
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedSkill(null)
          setNotice(getErrorMessage(error, 'Skill 详情读取失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedSkillId])

  useEffect(() => {
    if (!selectedMarket || marketInspect[selectedMarket.id] || inspectingId === selectedMarket.id) return
    void ensureInspect(selectedMarket)
  }, [ensureInspect, inspectingId, marketInspect, selectedMarket])

  useEffect(() => {
    if (!selectedMarket || !selectedInspect) return
    const filePath = marketPreviewPath[selectedMarket.id] ?? selectedInspect.previewFiles[0]
    if (!filePath) return
    const key = getPreviewKey(selectedMarket.id, filePath)
    if (marketPreviewCache[key] || previewingKey === key) return
    void ensurePreview(selectedMarket, filePath, selectedInspect)
  }, [
    ensurePreview,
    marketPreviewCache,
    marketPreviewPath,
    previewingKey,
    selectedInspect,
    selectedMarket,
  ])

  const previewSampleFiles = selectedInspect ? sampleFilesPreview(selectedInspect.sampleFiles) : null

  return (
    <div className="page skills-page">
      <header className="page-header">
        <div>
          <h1>Skill 中心</h1>
          <p className="muted">
            查看本地 Skill，搜索市场能力包，并在安装前先看清目录结构、脚本情况和核心说明文件。
          </p>
        </div>
        <div className="toolbar">
          <button className="skill-btn subtle" type="button" onClick={() => void loadSkills()} disabled={loading}>
            <IconRefresh size={15} />
            {loading ? '刷新中...' : '刷新本地 Skill'}
          </button>
        </div>
      </header>

      {notice ? <div className="banner">{notice}</div> : null}

      <section className="skills-summary">
        <div className="skill-summary-card">
          <span>已安装 Skill</span>
          <strong>{counts.total}</strong>
        </div>
        <div className="skill-summary-card">
          <span>启用中</span>
          <strong>{counts.enabled}</strong>
        </div>
        <div className="skill-summary-card">
          <span>市场结果</span>
          <strong>{counts.market}</strong>
        </div>
      </section>

      <section className="skill-market-shell">
        <div className="skill-market-head">
          <div>
            <h2>Skill 市场</h2>
            <p>左侧挑选 Skill，右侧查看预检信息和文件预览，再决定是否安装。</p>
          </div>
          <span className="skill-pill">skills.sh / GitHub</span>
        </div>

        <div className="skill-market-toolbar">
          <label className="search skill-market-search">
            <IconSearch size={15} />
            <input
              value={marketQuery}
              onChange={(event) => setMarketQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchMarketplace(marketQuery)
              }}
              placeholder="搜索 frontend、browser、docs、design..."
            />
          </label>
          <button
            className="skill-btn primary"
            type="button"
            onClick={() => void searchMarketplace(marketQuery)}
            disabled={marketLoading}
          >
            {marketLoading ? '搜索中...' : '搜索市场'}
          </button>
        </div>

        <div className="skills-shortcuts">
          {MARKET_SHORTCUTS.map((keyword) => (
            <button
              key={keyword}
              className="skill-tag-button"
              type="button"
              onClick={() => {
                setMarketQuery(keyword)
                void searchMarketplace(keyword)
              }}
            >
              {keyword}
            </button>
          ))}
        </div>

        <div className="skill-market-body">
          <div className="skill-market-results-shell">
            {marketLoading && marketItems.length === 0 ? (
              <div className="empty-state">正在搜索 Skill 市场...</div>
            ) : marketItems.length === 0 ? (
              <div className="empty-state">先搜索一个关键词，或者直接点上方快捷标签。</div>
            ) : (
              <VirtualList
                items={marketItems}
                className="skill-market-results"
                itemHeight={MARKET_CARD_HEIGHT}
                gap={10}
                overscan={5}
                getKey={(item) => item.id}
                renderItem={(item) => {
                  const localId = getLocalSkillId(item)
                  return (
                    <SkillMarketCard
                      item={item}
                      active={item.id === selectedMarketId}
                      installed={installedIds.has(localId)}
                      fileCount={marketInspect[item.id]?.fileCount ?? null}
                      onSelect={handleSelectMarket}
                    />
                  )
                }}
              />
            )}
          </div>

          <div className="skill-market-preview">
            {!selectedMarket ? (
              <div className="empty-state">
                <div className="empty-title">选择一个市场 Skill</div>
                <p className="muted">右侧会展示它的来源、目录结构和可预览文件。</p>
              </div>
            ) : (
              <>
                <div className="skill-market-preview-head">
                  <div>
                    <h3>{selectedMarket.name}</h3>
                    <p>{selectedMarket.id}</p>
                  </div>
                  <div className="skill-market-actions">
                    <button
                      className="skill-btn subtle"
                      type="button"
                      onClick={() => void ensureInspect(selectedMarket)}
                      disabled={inspectingId === selectedMarket.id}
                    >
                      {inspectingId === selectedMarket.id ? '预检中...' : '刷新预检'}
                    </button>
                    <button
                      className="skill-btn primary"
                      type="button"
                      onClick={() => void openInstallDialog(selectedMarket)}
                      disabled={installingId === selectedMarket.id}
                    >
                      {installingId === selectedMarket.id ? '安装中...' : '安装 Skill'}
                    </button>
                  </div>
                </div>

                <div className="skill-market-preview-meta">
                  <span>{selectedMarket.owner}/{selectedMarket.repo}</span>
                  <span>{selectedMarket.downloads || '0'} 次下载</span>
                  {installedIds.has(getLocalSkillId(selectedMarket)) ? <span>本地已有同名 Skill，安装将覆盖</span> : null}
                </div>

                {!selectedInspect ? (
                  <div className="empty-state">正在拉取这个 Skill 的目录结构...</div>
                ) : (
                  <>
                    <div className="skill-market-stats">
                      <div className="skill-market-stat">
                        <span>文件数</span>
                        <strong>{selectedInspect.fileCount}</strong>
                      </div>
                      <div className="skill-market-stat">
                        <span>总体积</span>
                        <strong>{formatBytes(selectedInspect.totalBytes)}</strong>
                      </div>
                      <div className="skill-market-stat">
                        <span>目录数</span>
                        <strong>{selectedInspect.directories.length}</strong>
                      </div>
                    </div>

                    <div className="skill-market-flags">
                      <span className="skill-pill">{selectedInspect.ref}</span>
                      {selectedInspect.hasScripts ? <span className="skill-pill warning">包含 scripts</span> : null}
                      {selectedInspect.hasReferences ? <span className="skill-pill">包含 references</span> : null}
                      {selectedInspect.hasAssets ? <span className="skill-pill">包含 assets</span> : null}
                    </div>

                    {selectedInspect.exceedsHardLimit ? (
                      <div className="skill-market-warning danger">这个 Skill 超过硬安全上限，当前不允许安装。</div>
                    ) : selectedInspect.exceedsDefaultLimit ? (
                      <div className="skill-market-warning">这个 Skill 超过默认安装阈值，安装时会要求额外确认。</div>
                    ) : (
                      <div className="skill-market-note">这个 Skill 体积在默认阈值内，可以直接安装。</div>
                    )}

                    <div className="skill-market-grid">
                      <div className="skill-market-section">
                        <div className="skill-market-section-title">顶层目录</div>
                        <div className="skill-market-directory-list">
                          {selectedInspect.directories.length > 0 ? (
                            selectedInspect.directories.map((directory) => (
                              <span className="skill-pill" key={directory}>
                                {directory}
                              </span>
                            ))
                          ) : (
                            <span className="muted">没有额外子目录</span>
                          )}
                        </div>
                      </div>

                      <div className="skill-market-section">
                        <div className="skill-market-section-title">样例文件</div>
                        <ul className="skill-market-file-list">
                          {(previewSampleFiles?.visible ?? []).map((file) => (
                            <li key={file}>{file}</li>
                          ))}
                        </ul>
                        {previewSampleFiles && previewSampleFiles.hiddenCount > 0 ? (
                          <div className="muted">其余 {previewSampleFiles.hiddenCount} 个样例文件已折叠。</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="skill-market-section">
                      <div className="skill-market-section-title">可预览文件</div>
                      {selectedInspect.previewFiles.length === 0 ? (
                        <div className="muted">这个 Skill 没有适合前端直接预览的文本文件。</div>
                      ) : (
                        <div className="skill-preview-file-tabs">
                          {selectedInspect.previewFiles.map((file) => {
                            const active = file === selectedMarketFilePath
                            return (
                              <button
                                key={file}
                                className={`skill-file-chip${active ? ' active' : ''}`}
                                type="button"
                                onClick={() => {
                                  setMarketPreviewPath((current) => ({ ...current, [selectedMarket.id]: file }))
                                  void ensurePreview(selectedMarket, file, selectedInspect)
                                }}
                              >
                                {file}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="skill-preview-shell">
                      {!selectedMarketFilePath ? (
                        <div className="empty-state">当前没有可预览的文本文件。</div>
                      ) : !selectedMarketPreview && previewingKey === getPreviewKey(selectedMarket.id, selectedMarketFilePath) ? (
                        <div className="empty-state">正在加载 {selectedMarketFilePath} ...</div>
                      ) : !selectedMarketPreview ? (
                        <div className="empty-state">点击上方文件标签即可预览对应内容。</div>
                      ) : (
                        <>
                          <div className="skill-preview-head">
                            <div>
                              <div className="skill-market-section-title">文件预览</div>
                              <div className="skill-preview-path">{selectedMarketPreview.path}</div>
                            </div>
                            {selectedMarketPreview.truncated ? <span className="skill-pill warning">已截断</span> : null}
                          </div>
                          <div className={`skill-preview-content ${selectedMarketPreview.format}`}>
                            <CollapsibleContent
                              text={selectedMarketPreview.content}
                              format={selectedMarketPreview.format}
                              collapseMode="plain"
                              collapsedLines={selectedMarketPreview.format === 'markdown' ? 16 : 24}
                              collapsedChars={selectedMarketPreview.format === 'markdown' ? 1200 : 2200}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="skills-layout">
        <aside className="skills-panel">
          <div className="skills-panel-head">
            <div>
              <h2>本地 Skill</h2>
              <p>这里只展示已经安装到 `data/skills/` 的能力包。</p>
            </div>
          </div>

          <label className="search">
            <IconSearch size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索本地 Skill" />
          </label>

          <div className="skills-list-shell">
            {loading ? (
              <div className="empty-state">正在加载本地 Skill...</div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state">没有匹配的本地 Skill。</div>
            ) : (
              <VirtualList
                items={filteredItems}
                className="skills-list"
                itemHeight={LOCAL_SKILL_CARD_HEIGHT}
                gap={10}
                overscan={5}
                getKey={(item) => item.id}
                renderItem={(item) => (
                  <LocalSkillCard
                    item={item}
                    active={item.id === selectedSkillId}
                    onSelect={handleSelectSkill}
                  />
                )}
              />
            )}
          </div>
        </aside>

        <section className="skills-detail">
          {!selectedSkillId ? (
            <div className="empty-state">
              <div className="empty-title">还没有本地 Skill</div>
              <p className="muted">你可以先从上方市场安装，再回到这里查看完整 `SKILL.md`。</p>
            </div>
          ) : detailLoading ? (
            <div className="empty-state">正在读取 Skill 详情...</div>
          ) : !selectedSkill ? (
            <div className="empty-state">这个 Skill 的详情读取失败，请刷新后重试。</div>
          ) : (
            <>
              <div className="skills-detail-head">
                <div>
                  <h2>{selectedSkill.name}</h2>
                  <p>{selectedSkill.description}</p>
                </div>
                <div className="skills-detail-actions">
                  <span className="skill-pill">SKILL.md</span>
                  <span className="skill-pill">热更新</span>
                  <button
                    className="skill-btn danger"
                    type="button"
                    onClick={() => setDialog({ kind: 'delete', item: selectedSkill })}
                    disabled={deletingId === selectedSkill.id}
                  >
                    <IconTrash size={14} />
                    {deletingId === selectedSkill.id ? '删除中...' : '删除'}
                  </button>
                </div>
              </div>

              <div className="skill-bundles">
                <span>references {selectedSkill.references.length}</span>
                <span>scripts {selectedSkill.scripts.length}</span>
                <span>assets {selectedSkill.assets.length}</span>
              </div>

              <div className="skill-path">{selectedSkill.path}</div>

              <div className="skill-markdown">
                <CollapsibleContent
                  text={selectedSkill.body}
                  format="markdown"
                  collapseMode="plain"
                  collapsedLines={20}
                  collapsedChars={1800}
                />
              </div>
            </>
          )}
        </section>
      </section>

      <ActionDialog
        open={dialog?.kind === 'delete'}
        title={dialog?.kind === 'delete' ? `删除 ${dialog.item.name}` : ''}
        subtitle="删除后，Agent 在后续任务中将无法继续使用这个 Skill。"
        confirmLabel="确认删除"
        confirmTone="danger"
        busy={dialog?.kind === 'delete' && deletingId === dialog.item.id}
        onClose={() => setDialog(null)}
        onConfirm={() => void confirmDelete()}
      >
        {dialog?.kind === 'delete' ? (
          <div className="confirm-dialog-meta">
            <div>
              <span>Skill ID</span>
              <strong>{dialog.item.id}</strong>
            </div>
            <div>
              <span>最近更新时间</span>
              <strong>{formatTime(dialog.item.updatedAt)}</strong>
            </div>
            <div>
              <span>文件大小</span>
              <strong>{formatBytes(dialog.item.size)}</strong>
            </div>
          </div>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === 'install'}
        title={dialog?.kind === 'install' ? `安装 ${dialog.item.name}` : ''}
        subtitle="确认前先看清目录结构和脚本情况。安装会把同名本地 Skill 覆盖成市场版本。"
        confirmLabel="确认安装"
        busy={dialog?.kind === 'install' && installingId === dialog.item.id}
        onClose={() => setDialog(null)}
        onConfirm={() => void confirmInstall()}
      >
        {dialog?.kind === 'install' ? (
          <>
            <div className="confirm-dialog-meta">
              <div>
                <span>市场 ID</span>
                <strong>{dialog.item.id}</strong>
              </div>
              <div>
                <span>文件数</span>
                <strong>{dialog.inspect.fileCount}</strong>
              </div>
              <div>
                <span>总体积</span>
                <strong>{formatBytes(dialog.inspect.totalBytes)}</strong>
              </div>
            </div>

            {dialog.inspect.exceedsDefaultLimit ? (
              <div className="confirm-dialog-warning">这个 Skill 超过默认安装阈值，安装时将走“大体积 Skill”确认路径。</div>
            ) : null}

            {dialog.inspect.hasScripts ? (
              <div className="confirm-dialog-warning subtle">这个 Skill 包含 scripts 目录，请确认你信任它的来源。</div>
            ) : null}

            <div className="skill-market-section">
              <div className="skill-market-section-title">顶层目录</div>
              <div className="skill-market-directory-list">
                {dialog.inspect.directories.length > 0 ? (
                  dialog.inspect.directories.map((directory) => (
                    <span className="skill-pill" key={directory}>
                      {directory}
                    </span>
                  ))
                ) : (
                  <span className="muted">没有额外子目录</span>
                )}
              </div>
            </div>
          </>
        ) : null}
      </ActionDialog>
    </div>
  )
}
