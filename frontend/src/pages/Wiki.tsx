import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { WikiApi, type WikiCategory, type WikiLintResult, type WikiPage, type WikiRawFile, type WikiSummary } from '../api/wiki'
import Markdown from '../components/Markdown'
import {
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconUpload,
  IconWiki,
} from '../components/Icons'

type Notice = { type: 'success' | 'error'; message: string }
type ViewMode = 'preview' | 'source'
type ActiveItem =
  | { type: 'page'; path: string }
  | { type: 'raw'; path: string }
  | { type: 'log'; path: string }
  | null

const categoryLabels: Record<WikiCategory, string> = {
  entity: '实体',
  concept: '核心理念',
  synthesis: '综合分析',
}

const emptyDraft = {
  path: '',
  title: '',
  category: 'concept' as WikiCategory,
  tags: '',
  sources: '',
  summary: '',
  content: '# 新页面\n\n## 概述\n\n## 关键观点\n\n## 关联\n\n## 来源\n',
}

function formatTime(ts: number | null | undefined) {
  if (!ts) return '未记录'
  return new Date(ts).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '')
    if (message) return message
  }
  return fallback
}

function parseList(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
}

function groupPages(pages: WikiPage[], category: WikiCategory) {
  return pages.filter((page) => page.category === category)
}

export default function Wiki() {
  const [summary, setSummary] = useState<WikiSummary | null>(null)
  const [rawFiles, setRawFiles] = useState<WikiRawFile[]>([])
  const [pages, setPages] = useState<WikiPage[]>([])
  const [active, setActive] = useState<ActiveItem>(null)
  const [activePage, setActivePage] = useState<WikiPage | null>(null)
  const [activeText, setActiveText] = useState('')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [lint, setLint] = useState<WikiLintResult | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [showDraft, setShowDraft] = useState(false)
  const [appendText, setAppendText] = useState('')

  const filteredRaw = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rawFiles
    return rawFiles.filter((item) => item.path.toLowerCase().includes(keyword))
  }, [query, rawFiles])

  const filteredPages = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return pages
    return pages.filter((page) => JSON.stringify(page).toLowerCase().includes(keyword))
  }, [pages, query])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [summaryResult, rawResult, pageResult, lintResult] = await Promise.all([
        WikiApi.summary(),
        WikiApi.listRaw(),
        WikiApi.listPages(),
        WikiApi.lint(),
      ])
      setSummary(summaryResult)
      setRawFiles(rawResult)
      setPages(pageResult)
      setLint(lintResult)
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'Wiki 加载失败') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const openRaw = async (path: string) => {
    setActive({ type: 'raw', path })
    setActivePage(null)
    setViewMode('source')
    try {
      const raw = await WikiApi.readRaw(path)
      setActiveText(raw.content)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'raw 文件读取失败') })
    }
  }

  const openPage = async (path: string) => {
    setActive({ type: 'page', path })
    setViewMode('preview')
    try {
      const page = await WikiApi.readPage(path)
      setActivePage(page)
      setActiveText(page.content)
      setDraft({
        path: page.path,
        title: page.title,
        category: page.category,
        tags: page.tags.join(', '),
        sources: page.sources.join(', '),
        summary: page.summary,
        content: page.content,
      })
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'Wiki 页面读取失败') })
    }
  }

  const openLogs = async () => {
    setActive({ type: 'log', path: '操作日志.md' })
    setActivePage(null)
    setViewMode('source')
    try {
      const log = await WikiApi.logs()
      setActiveText(log.content)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '操作日志读取失败') })
    }
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    try {
      const result = await WikiApi.uploadRaw(files, overwrite)
      setNotice({ type: 'success', message: `已上传 ${result.items.length} 个 raw 文件` })
      await loadAll()
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'raw 上传失败') })
    } finally {
      setUploading(false)
    }
  }

  const runIngestPreview = async () => {
    const selected = active?.type === 'raw' ? [active.path] : filteredRaw.slice(0, 3).map((item) => item.path)
    if (selected.length === 0) {
      setNotice({ type: 'error', message: '需要先选择或上传 raw 文件' })
      return
    }
    try {
      const preview = await WikiApi.ingestPreview(selected)
      setActive(null)
      setActivePage(null)
      setViewMode('source')
      setActiveText(
        [
          '# Ingest Preview',
          '',
          ...preview.rawFiles.flatMap((file) => [
            `## ${file.path}`,
            '',
            file.excerpt,
            file.truncated ? '\n(已截断)' : '',
          ]),
          '',
          '## 建议流程',
          '',
          ...preview.suggestedWorkflow.map((item) => `- ${item}`),
        ].join('\n'),
      )
      setNotice({ type: 'success', message: '摄取预览已生成' })
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '摄取预览失败') })
    }
  }

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const page = await WikiApi.writePage({
        path: draft.path || undefined,
        title: draft.title,
        category: draft.category,
        tags: parseList(draft.tags),
        sources: parseList(draft.sources),
        summary: draft.summary,
        content: draft.content,
      })
      setNotice({ type: 'success', message: `Wiki 页面已保存：${page.path}` })
      setShowDraft(false)
      await loadAll()
      await openPage(page.path)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'Wiki 页面保存失败') })
    }
  }

  const appendToPage = async () => {
    if (!activePage || !appendText.trim()) return
    try {
      const page = await WikiApi.appendPage(activePage.path, '补充', appendText)
      setAppendText('')
      setNotice({ type: 'success', message: '补充内容已追加' })
      await loadAll()
      await openPage(page.path)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '追加失败') })
    }
  }

  const rebuildIndex = async () => {
    try {
      const result = await WikiApi.rebuildIndex()
      setNotice({ type: 'success', message: `索引已重建：${result.pageCount} 个页面` })
      await loadAll()
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '索引重建失败') })
    }
  }

  const runLintFix = async () => {
    try {
      const result = await WikiApi.lintFix()
      setNotice({ type: 'success', message: `已修复：${result.fixed.join(', ') || '无'}` })
      await loadAll()
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, 'lint 修复失败') })
    }
  }

  return (
    <div className="page wiki-page">
      <header className="page-header">
        <div>
          <h1>Wiki</h1>
          <div className="muted">维护 raw 来源、结构化知识页、索引、操作日志和健康检查。</div>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={() => void loadAll()}>
            <IconRefresh size={14} /> 刷新
          </button>
          <button className="chip" type="button" onClick={() => {
            setDraft(emptyDraft)
            setShowDraft(true)
          }}>
            <IconPlus size={14} /> 新建页面
          </button>
          <button className="chip primary" type="button" onClick={() => void runIngestPreview()}>
            <IconSparkle size={14} /> 摄取预览
          </button>
        </div>
      </header>

      {notice ? <div className={'banner' + (notice.type === 'error' ? ' error' : '')}>{notice.message}</div> : null}

      <div className="wiki-stats">
        <div className="wiki-stat"><span>raw 文件</span><strong>{summary?.rawCount ?? 0}</strong></div>
        <div className="wiki-stat"><span>知识页</span><strong>{summary?.pageCount ?? 0}</strong></div>
        <div className="wiki-stat"><span>断链</span><strong>{summary?.brokenLinkCount ?? 0}</strong></div>
        <div className="wiki-stat"><span>孤立页</span><strong>{summary?.orphanPageCount ?? 0}</strong></div>
        <div className="wiki-stat wide"><span>最近更新</span><strong>{formatTime(summary?.lastUpdated)}</strong></div>
      </div>

      <div className="wiki-layout">
        <aside className="wiki-sidebar">
          <label className="wiki-search">
            <IconSearch size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Wiki" />
          </label>

          <section className="wiki-nav-section">
            <button className="wiki-nav-title" type="button" onClick={openLogs}>
              <IconWiki size={15} /> 操作日志
            </button>
            <button className="wiki-nav-title" type="button" onClick={() => void rebuildIndex()}>
              <IconRefresh size={15} /> 重建索引
            </button>
          </section>

          <section className="wiki-nav-section">
            <h2>原始资料</h2>
            <div className="wiki-file-list">
              {loading && filteredRaw.length === 0 ? <div className="wiki-empty">加载中...</div> : null}
              {filteredRaw.map((item) => (
                <button key={item.path} type="button" className="wiki-file-row" onClick={() => void openRaw(item.path)}>
                  <span>{item.path}</span>
                  <small>{Math.ceil(item.size / 1024)} KB</small>
                </button>
              ))}
              {!loading && filteredRaw.length === 0 ? <div className="wiki-empty">暂无 raw 文件</div> : null}
            </div>
          </section>

          {(['entity', 'concept', 'synthesis'] as WikiCategory[]).map((category) => (
            <section className="wiki-nav-section" key={category}>
              <h2>{categoryLabels[category]}</h2>
              <div className="wiki-file-list">
                {groupPages(filteredPages, category).map((page) => (
                  <button key={page.path} type="button" className="wiki-file-row" onClick={() => void openPage(page.path)}>
                    <span>{page.title}</span>
                    <small>{page.sources.length} sources</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <main className="wiki-main">
          {showDraft ? (
            <form className="wiki-editor" onSubmit={submitDraft}>
              <div className="wiki-editor-head">
                <h2>{draft.path ? '编辑 Wiki 页面' : '新建 Wiki 页面'}</h2>
                <div className="toolbar">
                  <button className="chip" type="button" onClick={() => setShowDraft(false)}>取消</button>
                  <button className="chip primary" type="submit"><IconEdit size={14} /> 保存</button>
                </div>
              </div>
              <div className="wiki-form-grid">
                <input className="settings-input" placeholder="路径，可留空" value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))} />
                <input className="settings-input" placeholder="标题" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                <select className="settings-input" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as WikiCategory }))}>
                  <option value="entity">实体</option>
                  <option value="concept">核心理念</option>
                  <option value="synthesis">综合分析</option>
                </select>
                <input className="settings-input" placeholder="标签，逗号分隔" value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} />
                <input className="settings-input" placeholder="来源，逗号分隔" value={draft.sources} onChange={(event) => setDraft((current) => ({ ...current, sources: event.target.value }))} />
                <input className="settings-input" placeholder="一句话摘要" value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} />
              </div>
              <textarea className="settings-input wiki-textarea" value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} />
            </form>
          ) : (
            <section className="wiki-viewer">
              <div className="wiki-viewer-head">
                <div>
                  <h2>{activePage?.title ?? active?.path ?? '未选择内容'}</h2>
                  <p>{activePage?.summary || '从左侧选择 raw 文件或 Wiki 页面。'}</p>
                </div>
                <div className="toolbar">
                  <button className={'chip' + (viewMode === 'preview' ? ' primary' : '')} type="button" onClick={() => setViewMode('preview')}>预览</button>
                  <button className={'chip' + (viewMode === 'source' ? ' primary' : '')} type="button" onClick={() => setViewMode('source')}>源码</button>
                  {activePage ? <button className="chip" type="button" onClick={() => setShowDraft(true)}><IconEdit size={14} /> 编辑</button> : null}
                </div>
              </div>
              {activePage ? (
                <div className="wiki-meta">
                  <span>{categoryLabels[activePage.category]}</span>
                  <span>{activePage.lastUpdated || '未记录日期'}</span>
                  <span>{activePage.sources.length} sources</span>
                  <span>{activePage.links.length} links</span>
                  <span>{activePage.backlinks.length} backlinks</span>
                </div>
              ) : null}
              <div className="wiki-content">
                {activeText ? (
                  viewMode === 'preview' ? <Markdown text={activeText} /> : <pre>{activeText}</pre>
                ) : (
                  <div className="wiki-empty large">Wiki 会在这里显示选中的内容。</div>
                )}
              </div>
              {activePage ? (
                <div className="wiki-append">
                  <textarea className="settings-input" rows={4} placeholder="追加到当前页面的补充内容" value={appendText} onChange={(event) => setAppendText(event.target.value)} />
                  <button className="chip primary" type="button" onClick={() => void appendToPage()} disabled={!appendText.trim()}>
                    追加补充
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </main>

        <aside className="wiki-sidepanel">
          <section className="wiki-panel">
            <h2>上传 raw</h2>
            <label className="wiki-upload">
              <IconUpload size={16} />
              <span>{uploading ? '上传中...' : '选择文件'}</span>
              <input type="file" multiple accept=".md,.txt,.csv,.json,.yaml,.yml" onChange={(event) => void handleUpload(event)} disabled={uploading} />
            </label>
            <label className="wiki-check">
              <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
              <span>允许覆盖同名文件</span>
            </label>
          </section>

          <section className="wiki-panel">
            <h2>健康检查</h2>
            <div className="wiki-lint-list">
              <span>断链：{lint?.brokenLinks.length ?? 0}</span>
              <span>孤立页：{lint?.orphanPages.length ?? 0}</span>
              <span>缺 frontmatter：{lint?.missingFrontmatter.length ?? 0}</span>
              <span>缺来源：{lint?.missingSources.length ?? 0}</span>
              <span>索引缺项：{lint?.indexMissingPages.length ?? 0}</span>
            </div>
            <button className="chip" type="button" onClick={() => void runLintFix()}>
              自动修复小问题
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
