import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  RepositoryApi,
  type RepositoryConfig,
  type RepositoryDetail,
  type RepositoryFileContent,
  type RepositorySummary,
  type RepositoryTreeNode,
} from '../api/repository'
import {
  IconBranch,
  IconChevron,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
} from '../components/Icons'
import Markdown from '../components/Markdown'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

const AUTO_SCAN_MS = 5 * 60 * 1000

function relTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前'
  if (diff < 30 * 86400_000) return Math.floor(diff / 86400_000) + ' 天前'
  return new Date(ts).toLocaleDateString('zh-CN')
}

function scanTime(ts: number | null) {
  if (!ts) return '每 5 分钟自动扫描新增仓库'
  return `上次扫描 ${new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })} · 每 5 分钟自动扫描`
}

function statusText(repo: RepositorySummary) {
  if (!repo.isGit) return '非 Git'
  if (repo.status === 'clean') return '干净'
  if (repo.status === 'dirty') return `${repo.changes} 个变更`
  return '未知'
}

function sourceText(repo: RepositorySummary) {
  return repo.source === 'manual' ? '手动添加' : '目录扫描'
}

function countTreeNodes(nodes: RepositoryTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + (node.children ? countTreeNodes(node.children) : 0),
    0,
  )
}

function findNode(nodes: RepositoryTreeNode[], relativePath: string): RepositoryTreeNode | null {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node
    if (node.children) {
      const child = findNode(node.children, relativePath)
      if (child) return child
    }
  }
  return null
}

function getPathParts(relativePath: string) {
  return relativePath ? relativePath.split('/').filter(Boolean) : []
}

function dirname(relativePath: string) {
  const parts = getPathParts(relativePath)
  parts.pop()
  return parts.join('/')
}

function normalizeRepoPath(basePath: string, target: string) {
  const unixTarget = target.replace(/\\/g, '/')
  const isRootRelative = unixTarget.startsWith('/')
  const raw = unixTarget.replace(/^\/+/, '')
  const baseParts = getPathParts(basePath)
  const parts = isRootRelative ? [] : [...baseParts]

  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(decodeURIComponent(part))
  }

  return parts.join('/')
}

function splitLinkTarget(href: string) {
  const hashIndex = href.indexOf('#')
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const hash = hashIndex >= 0 ? href.slice(hashIndex + 1) : ''
  const queryIndex = beforeHash.indexOf('?')
  return {
    pathPart: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    hash,
  }
}

function isExternalHref(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

function scrollToMarkdownAnchor(hash: string) {
  if (!hash) return
  const raw = decodeURIComponent(hash)
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .replace(/\s+/g, '-')
  const target =
    document.getElementById(raw) ||
    document.getElementById(slug) ||
    document.querySelector(`[name="${CSS.escape(raw)}"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const COMMON_CODE_KEYWORDS = [
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'while',
]

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  css: ['align-items', 'background', 'border', 'color', 'display', 'flex', 'grid', 'margin', 'padding', 'position'],
  go: ['chan', 'defer', 'fallthrough', 'func', 'go', 'map', 'package', 'range', 'select', 'struct', 'var'],
  java: ['abstract', 'boolean', 'implements', 'package', 'private', 'protected', 'public', 'static', 'void'],
  json: ['false', 'null', 'true'],
  md: [],
  php: ['echo', 'namespace', 'private', 'protected', 'public', 'use'],
  py: ['and', 'def', 'elif', 'except', 'global', 'lambda', 'not', 'or', 'pass', 'self', 'with', 'yield'],
  rs: ['crate', 'enum', 'impl', 'let', 'match', 'mod', 'mut', 'pub', 'self', 'struct', 'trait', 'use'],
  ts: ['declare', 'enum', 'implements', 'keyof', 'namespace', 'private', 'protected', 'public', 'readonly'],
  tsx: ['declare', 'enum', 'implements', 'keyof', 'namespace', 'private', 'protected', 'public', 'readonly'],
}

function keywordsForLanguage(language: string) {
  return new Set([...COMMON_CODE_KEYWORDS, ...(LANGUAGE_KEYWORDS[language] ?? [])])
}

function highlightLine(line: string, language: string) {
  const parts: ReactNode[] = []
  const keywords = keywordsForLanguage(language)
  const tokenPattern =
    /(\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(line))) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index))
    const token = match[0]
    const className =
      token.startsWith('//') || token.startsWith('#') || token.startsWith('/*')
        ? 'comment'
        : token.startsWith('"') || token.startsWith("'") || token.startsWith('`')
          ? 'string'
          : /^\d/.test(token)
            ? 'number'
            : keywords.has(token)
              ? 'keyword'
              : ''

    parts.push(
      className ? (
        <span className={'code-token ' + className} key={parts.length}>
          {token}
        </span>
      ) : (
        token
      ),
    )
    cursor = match.index + token.length
  }

  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts
}

function CodePreview({ content, language }: { content: string; language: string }) {
  const lines = content.split(/\r?\n/)

  return (
    <pre className="repo-file-code">
      <code>
        {lines.map((line, index) => (
          <Fragment key={index}>
            <span className="code-line">
              <span className="code-line-number">{index + 1}</span>
              <span className="code-line-text">{highlightLine(line, language)}</span>
            </span>
            {index < lines.length - 1 ? '\n' : null}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}

function formatJsonContent(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

function FilePreviewBody({
  file,
  repoId,
  resolveMarkdownUrl,
  onMarkdownLink,
}: {
  file: RepositoryFileContent
  repoId: string
  resolveMarkdownUrl: (basePath: string, url: string, kind: 'link' | 'image') => string
  onMarkdownLink: (
    basePath: string,
    href: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void
}) {
  if (file.previewType === 'image') {
    return (
      <div className="repo-image-preview">
        <img src={RepositoryApi.rawFileUrl(repoId, file.path)} alt={file.name} />
      </div>
    )
  }

  if (file.previewType === 'markdown') {
    const basePath = dirname(file.path)
    return (
      <div className="repo-preview-markdown">
        <Markdown
          text={file.content}
          resolveUrl={(url, kind) => resolveMarkdownUrl(basePath, url, kind)}
          onLinkClick={(href, event) => onMarkdownLink(basePath, href, event)}
        />
      </div>
    )
  }

  if (file.previewType === 'json') {
    return <CodePreview content={formatJsonContent(file.content)} language="json" />
  }

  if (file.previewType === 'binary') {
    return (
      <div className="repo-binary-preview">
        <div className="empty-title">这个文件不能直接文本预览</div>
        <a
          className="chip ghost"
          href={RepositoryApi.rawFileUrl(repoId, file.path)}
          download={file.name}
        >
          下载文件
        </a>
      </div>
    )
  }

  return <CodePreview content={file.content} language={file.language} />
}

function RepositoryBrowser({
  nodes,
  currentPath,
  onOpenDirectory,
  onOpenFile,
}: {
  nodes: RepositoryTreeNode[]
  currentPath: string
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const currentNode = currentPath ? findNode(nodes, currentPath) : null
  const visibleNodes = currentNode?.children ?? (currentPath ? [] : nodes)

  if (visibleNodes.length === 0) {
    return <div className="repo-file-empty">没有可显示的项目文件</div>
  }

  return (
    <div className="repo-file-list" role="list">
      {visibleNodes.map((node) => (
        <button
          className="repo-file-row"
          type="button"
          role="listitem"
          key={node.relativePath}
          onClick={() =>
            node.type === 'dir'
              ? onOpenDirectory(node.relativePath)
              : onOpenFile(node.relativePath)
          }
        >
          <div className="repo-file-main">
            {node.type === 'dir' ? (
              <IconFolder size={16} className="repo-tree-folder" />
            ) : (
              <span className="repo-tree-file" aria-hidden="true" />
            )}
            <span className="repo-file-name">{node.name}</span>
          </div>
          <div className="repo-file-note">
            {node.type === 'dir'
              ? `${node.children?.length ?? 0} 项 · ${relTime(node.updatedAt)}`
              : `${formatBytes(node.size)} · ${relTime(node.updatedAt)}`}
          </div>
        </button>
      ))}
    </div>
  )
}

export default function Repository() {
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const [config, setConfig] = useState<RepositoryConfig | null>(null)
  const [repos, setRepos] = useState<RepositorySummary[]>([])
  const [query, setQuery] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [editingConfig, setEditingConfig] = useState(false)
  const [addingRepo, setAddingRepo] = useState(false)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null)
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RepositoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const [fileContent, setFileContent] = useState<RepositoryFileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [descriptionSaving, setDescriptionSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)

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
    }, 5000)
    noticeRemoveTimer.current = window.setTimeout(() => setNotice(null), 5600)
  }

  const applyConfig = (nextConfig: RepositoryConfig) => {
    setConfig(nextConfig)
    setRootPath(nextConfig.rootPath)
  }

  const loadRepositories = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setScanning(true)
    try {
      const [list, nextConfig] = await Promise.all([
        RepositoryApi.listRepositories(),
        RepositoryApi.getConfig(),
      ])
      setRepos(list)
      applyConfig(nextConfig)
      setLastScannedAt(Date.now())
    } catch (e) {
      const err = e as { message?: string }
      if (!options?.silent) {
        showNotice(err.message ?? '仓库扫描失败')
        setRepos([])
      }
    } finally {
      if (!options?.silent) setScanning(false)
    }
  }

  const loadRepositoryDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const nextDetail = await RepositoryApi.getRepositoryDetail(id)
      setDetail(nextDetail)
    } catch (e) {
      const err = e as { message?: string }
      showNotice(err.message ?? '仓库详情加载失败')
      setActiveRepoId(null)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const openFile = async (relativePath: string) => {
    if (!activeRepoId) return

    setFileLoading(true)
    setFileContent(null)
    try {
      const file = await RepositoryApi.getFileContent(activeRepoId, relativePath)
      setFileContent(file)
    } catch (e) {
      const err = e as { message?: string }
      showNotice(err.message ?? '文件读取失败')
    } finally {
      setFileLoading(false)
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const nextConfig = await RepositoryApi.getConfig()
        applyConfig(nextConfig)
        setEditingConfig(!nextConfig.configured)
        if (nextConfig.configured) {
          const list = await RepositoryApi.listRepositories()
          setRepos(list)
          setLastScannedAt(Date.now())
        }
      } catch (e) {
        const err = e as { message?: string }
        showNotice(err.message ?? '仓库配置加载失败')
      } finally {
        setLoading(false)
      }
    }

    load()
    return clearNoticeTimers
  }, [])

  useEffect(() => {
    if (!config?.configured) return undefined

    const timer = window.setInterval(() => {
      loadRepositories({ silent: true })
    }, AUTO_SCAN_MS)

    return () => window.clearInterval(timer)
  }, [config?.configured])

  useEffect(() => {
    if (!activeRepoId) {
      setDetail(null)
      setCurrentPath('')
      setFileContent(null)
      setDescriptionDraft('')
      return
    }

    setDetail(null)
    setCurrentPath('')
    setFileContent(null)
    loadRepositoryDetail(activeRepoId)
  }, [activeRepoId])

  useEffect(() => {
    setDescriptionDraft(detail?.repository.descriptionContent ?? '')
  }, [detail?.repository.id, detail?.repository.descriptionContent])

  const filteredRepos = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return repos

    return repos.filter((repo) =>
      [
        repo.name,
        repo.description,
        repo.language,
        repo.branch,
        repo.relativePath,
        repo.path,
        statusText(repo),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [query, repos])

  const dirtyCount = repos.filter((repo) => repo.status === 'dirty').length
  const manualCount = repos.filter((repo) => repo.source === 'manual').length
  const configured = Boolean(config?.configured)
  const activeRepo = detail?.repository ?? repos.find((repo) => repo.id === activeRepoId)
  const linkedRepoId = params.id ?? searchParams.get('repo')

  useEffect(() => {
    if (!linkedRepoId || linkedRepoId === activeRepoId) return
    setActiveRepoId(linkedRepoId)
  }, [activeRepoId, linkedRepoId])

  const saveConfig = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const nextConfig = await RepositoryApi.updateConfig(rootPath)
      applyConfig(nextConfig)
      setEditingConfig(false)
      showNotice('仓库文件夹已保存', 'success')
      await loadRepositories()
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '仓库文件夹保存失败')
    } finally {
      setSaving(false)
    }
  }

  const addRepository = async (e: FormEvent) => {
    e.preventDefault()
    const value = repoPath.trim()
    if (!value) {
      showNotice('仓库路径不能为空')
      return
    }

    setAdding(true)
    try {
      const repo = await RepositoryApi.addRepository(value)
      const nextConfig = await RepositoryApi.getConfig()
      applyConfig(nextConfig)
      setRepos((list) => {
        const next = list.filter((item) => item.id !== repo.id)
        return [repo, ...next].sort((a, b) => b.updatedAt - a.updatedAt)
      })
      setRepoPath('')
      setAddingRepo(false)
      showNotice('仓库已添加', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '仓库添加失败')
    } finally {
      setAdding(false)
    }
  }

  const removeManualRepository = async (repo: RepositorySummary) => {
    try {
      const nextConfig = await RepositoryApi.removeRepository(repo.id)
      applyConfig(nextConfig)
      if (activeRepoId === repo.id) setActiveRepoId(null)
      await loadRepositories()
      showNotice('手动仓库已移除', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '仓库移除失败')
    }
  }

  const openRepository = (repo: RepositorySummary) => {
    setActiveRepoId(repo.id)
    navigate(`/repository/${repo.id}`)
  }

  const copyFileContent = async () => {
    if (!fileContent) return

    try {
      await navigator.clipboard.writeText(fileContent.content)
      showNotice('文件内容已复制', 'success')
    } catch {
      showNotice('复制失败')
    }
  }

  const saveRepositoryDescription = async () => {
    if (!activeRepoId) return

    setDescriptionSaving(true)
    try {
      const nextDetail = await RepositoryApi.updateRepositoryDescription(
        activeRepoId,
        descriptionDraft,
      )
      setDetail(nextDetail)
      setRepos((list) =>
        list.map((repo) =>
          repo.id === nextDetail.repository.id ? nextDetail.repository : repo,
        ),
      )
      showNotice('简介已保存到 1052.md', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '简介保存失败')
    } finally {
      setDescriptionSaving(false)
    }
  }

  const resolveRepositoryMarkdownUrl = (
    basePath: string,
    url: string,
    kind: 'link' | 'image',
  ) => {
    if (!url || url.startsWith('#') || isExternalHref(url) || !activeRepoId) return url
    const { pathPart } = splitLinkTarget(url)
    if (!pathPart) return url

    const targetPath = normalizeRepoPath(basePath, pathPart)
    if (kind === 'image') return RepositoryApi.rawFileUrl(activeRepoId, targetPath)
    return url
  }

  const handleRepositoryMarkdownLink = (
    basePath: string,
    href: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (!href || isExternalHref(href)) return

    const { pathPart, hash } = splitLinkTarget(href)
    if (!pathPart) {
      event.preventDefault()
      scrollToMarkdownAnchor(hash)
      return
    }

    if (!detail) return
    event.preventDefault()

    const targetPath = normalizeRepoPath(basePath, pathPart)
    const node = findNode(detail.tree, targetPath)
    if (!node) {
      showNotice('链接指向的仓库文件不存在')
      return
    }

    if (node.type === 'dir') {
      setCurrentPath(node.relativePath)
      setFileContent(null)
      return
    }

    setCurrentPath(dirname(node.relativePath))
    openFile(node.relativePath)
    window.setTimeout(() => {
      document.querySelector('.repo-file-preview')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
      if (hash) scrollToMarkdownAnchor(hash)
    }, 80)
  }

  const pathParts = getPathParts(currentPath)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>仓库</h1>
          <div className="muted">
            {activeRepo
              ? activeRepo.path
              : configured
                ? query.trim()
                  ? `找到 ${filteredRepos.length} / ${repos.length} 个仓库 · ${scanTime(lastScannedAt)}`
                  : `${repos.length} 个仓库 · ${dirtyCount} 个有变更 · ${manualCount} 个手动添加 · ${scanTime(lastScannedAt)}`
                : '尚未配置仓库文件夹'}
          </div>
        </div>
        <div className="toolbar">
          {activeRepoId ? (
            <>
              <a
                className="chip ghost repo-download"
                href={RepositoryApi.archiveUrl(activeRepoId)}
                download
              >
                <IconSend size={14} /> 下载 ZIP
              </a>
              <button
                className="chip ghost"
                type="button"
                onClick={() => {
                  setActiveRepoId(null)
                  navigate('/repository')
                }}
              >
                <IconChevron size={14} className="repo-back-icon" /> 返回列表
              </button>
            </>
          ) : (
            <>
              {configured && (
                <label className="search">
                  <IconSearch size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索仓库..."
                  />
                </label>
              )}
              {!loading && (
                <button
                  className="chip ghost"
                  type="button"
                  onClick={() => setAddingRepo((value) => !value)}
                >
                  <IconPlus size={14} /> 添加仓库
                </button>
              )}
              {configured && (
                <button
                  className="chip ghost"
                  type="button"
                  onClick={() => loadRepositories()}
                  disabled={scanning}
                >
                  <IconRefresh size={14} /> {scanning ? '扫描中' : '刷新'}
                </button>
              )}
              <button
                className="chip primary"
                type="button"
                onClick={() => setEditingConfig((value) => !value)}
              >
                <IconFolder size={14} /> {configured ? '目录' : '设置目录'}
              </button>
            </>
          )}
        </div>
      </header>

      {notice && (
        <div className={'toast ' + notice.type + (notice.leaving ? ' leaving' : '')}>
          {notice.message}
        </div>
      )}

      {!activeRepoId && editingConfig && (
        <form className="repo-config" onSubmit={saveConfig}>
          <label className="repo-config-field">
            <span>仓库文件夹</span>
            <input
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="C:\Users\用户名\Desktop\projects"
              autoFocus={!configured}
            />
          </label>
          <div className="repo-config-actions">
            {configured && (
              <button
                type="button"
                className="chip ghost"
                onClick={() => {
                  setRootPath(config?.rootPath ?? '')
                  setEditingConfig(false)
                }}
              >
                取消
              </button>
            )}
            <button type="submit" className="chip primary" disabled={saving}>
              {saving ? '保存中...' : '保存并扫描'}
            </button>
          </div>
        </form>
      )}

      {!activeRepoId && addingRepo && (
        <form className="repo-config repo-add" onSubmit={addRepository}>
          <label className="repo-config-field">
            <span>仓库路径</span>
            <input
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="C:\Users\用户名\Desktop\project-a"
              autoFocus
            />
          </label>
          <div className="repo-config-actions">
            <button
              type="button"
              className="chip ghost"
              onClick={() => {
                setRepoPath('')
                setAddingRepo(false)
              }}
              disabled={adding}
            >
              取消
            </button>
            <button type="submit" className="chip primary" disabled={adding}>
              {adding ? '添加中...' : '添加并保存'}
            </button>
          </div>
        </form>
      )}

      {!activeRepoId && config?.rootPath && (
        <div className="repo-root">
          <IconFolder size={14} />
          <span>{config?.rootPath}</span>
        </div>
      )}

      {activeRepoId ? (
        <section className="repo-detail github-like">
          {detailLoading && !detail ? (
            <div className="empty-state">
              <div className="empty-title">加载仓库详情中</div>
            </div>
          ) : detail && activeRepo ? (
            <>
              <div className="repo-repohead">
                <div className="repo-title-line">
                  <IconFolder size={18} />
                  <div className="repo-detail-title">
                    <h2>{activeRepo.name}</h2>
                    <div className="repo-detail-path">{activeRepo.path}</div>
                  </div>
                </div>
                <div className="repo-detail-desc">
                  {activeRepo.description || activeRepo.relativePath || '暂无简介'}
                </div>
                <div className="repo-detail-meta">
                  {activeRepo.isGit && activeRepo.branch && (
                    <span className="tag">
                      <IconBranch size={12} />
                      {activeRepo.branch}
                    </span>
                  )}
                  <span className={'tag repo-source ' + activeRepo.source}>
                    {sourceText(activeRepo)}
                  </span>
                  <span className={'repo-status ' + activeRepo.status}>
                    {statusText(activeRepo)}
                  </span>
                  <span className="tag">
                    <span
                      className="lang-dot"
                      style={{ background: activeRepo.languageColor }}
                    />
                    {activeRepo.language}
                  </span>
                  <span className="tag-muted">更新于 {relTime(activeRepo.updatedAt)}</span>
                </div>
              </div>

              <div className="repo-detail-layout">
                <div className="repo-main-column">
              <div className="repo-code-panel">
                <div className="repo-code-toolbar">
                  <div className="repo-branch-pill">
                    <IconBranch size={13} />
                    <span>{activeRepo.branch || 'main'}</span>
                  </div>
                  <div className="repo-code-summary">
                    {currentPath ? currentPath : '根目录'} · 已索引 {countTreeNodes(detail.tree)} 项
                  </div>
                </div>
                <div className="repo-commit-strip">
                  <span className="repo-commit-title">{activeRepo.name}</span>
                  <span className="repo-commit-message">
                    {activeRepo.description || '本地仓库快照'}
                  </span>
                  <span className="repo-commit-time">{relTime(activeRepo.updatedAt)}</span>
                </div>
                <div className="repo-breadcrumbs" aria-label="当前目录">
                  <button type="button" onClick={() => setCurrentPath('')}>
                    {activeRepo.name}
                  </button>
                  {pathParts.map((part, index) => {
                    const nextPath = pathParts.slice(0, index + 1).join('/')
                    return (
                      <span className="repo-crumb-part" key={nextPath}>
                        <IconChevron size={12} />
                        <button type="button" onClick={() => setCurrentPath(nextPath)}>
                          {part}
                        </button>
                      </span>
                    )
                  })}
                </div>
                <RepositoryBrowser
                  nodes={detail.tree}
                  currentPath={currentPath}
                  onOpenDirectory={(path) => {
                    setCurrentPath(path)
                    setFileContent(null)
                  }}
                  onOpenFile={openFile}
                />
              </div>

              {(fileLoading || fileContent) && (
                <div className="repo-file-preview">
                  {fileLoading ? (
                    <div className="empty-state">
                      <div className="empty-title">读取文件中</div>
                    </div>
                  ) : fileContent ? (
                    <>
                      <div className="repo-file-preview-head">
                        <div>
                          <div className="repo-file-preview-name">{fileContent.path}</div>
                          <div className="muted">
                            {formatBytes(fileContent.size)}
                            {fileContent.truncated ? ' · 已截断预览' : ''}
                          </div>
                        </div>
                        <button className="chip ghost" type="button" onClick={copyFileContent}>
                          复制
                        </button>
                      </div>
                      <FilePreviewBody
                        file={fileContent}
                        repoId={activeRepoId}
                        resolveMarkdownUrl={resolveRepositoryMarkdownUrl}
                        onMarkdownLink={handleRepositoryMarkdownLink}
                      />
                    </>
                  ) : null}
                </div>
              )}

              <div className="repo-readme">
                {detail.readme ? (
                  <>
                    <div className="repo-panel-title">{detail.readme.fileName}</div>
                    <Markdown
                      text={detail.readme.content}
                      resolveUrl={(url, kind) => resolveRepositoryMarkdownUrl('', url, kind)}
                      onLinkClick={(href, event) =>
                        handleRepositoryMarkdownLink('', href, event)
                      }
                    />
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-title">这个仓库没有 README</div>
                    <div className="muted">卡片简介会优先读取 package.json 描述</div>
                  </div>
                )}
              </div>
                </div>

                <aside className="repo-side-column">
                  <section className="repo-description-panel">
                    <div className="repo-description-head">
                      <div>
                        <div className="repo-panel-title compact">项目简介</div>
                        <div className="muted">
                          {activeRepo.hasDescriptionFile
                            ? activeRepo.descriptionFileName
                            : '保存后创建 1052.md'}
                        </div>
                      </div>
                      <button
                        className="chip primary"
                        type="button"
                        onClick={saveRepositoryDescription}
                        disabled={descriptionSaving}
                      >
                        {descriptionSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                    <textarea
                      className="repo-description-textarea"
                      value={descriptionDraft}
                      onChange={(event) => setDescriptionDraft(event.target.value)}
                      placeholder="写这个项目是做什么的、主要能力、运行入口等。内容会保存为项目根目录下的 1052.md。"
                    />
                    <div className="repo-description-preview">
                      <div className="repo-panel-title compact">卡片预览</div>
                      <div className="repo-preview-card">
                        {descriptionDraft.trim() ? (
                          <Markdown text={descriptionDraft} />
                        ) : (
                          <span className="muted">暂无简介</span>
                        )}
                      </div>
                    </div>
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-title">仓库详情不可用</div>
            </div>
          )}
        </section>
      ) : loading ? (
        <div className="empty-state">
          <div className="empty-title">加载仓库配置中</div>
        </div>
      ) : !configured ? (
        <div className="empty-state">
          <div className="empty-title">设置仓库文件夹或手动添加仓库</div>
          <div className="muted">配置会保存到后端，下次启动自动读取</div>
        </div>
      ) : filteredRepos.length > 0 ? (
        <div className="repo-grid">
          {filteredRepos.map((repo) => (
            <article
              key={repo.id}
              className="repo-card"
              role="button"
              tabIndex={0}
              onClick={() => openRepository(repo)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openRepository(repo)
                }
              }}
            >
              <div className="repo-top">
                <div className="repo-name">{repo.name}</div>
                <div className={'repo-status ' + repo.status}>{statusText(repo)}</div>
              </div>
              <div className="repo-card-preview">
                {repo.description || '暂无 1052.md 简介'}
              </div>
              <div className="repo-path">{repo.path}</div>
              <div className="repo-foot">
                <span className={'tag repo-source ' + repo.source}>{sourceText(repo)}</span>
                <span className="tag">
                  <span
                    className="lang-dot"
                    style={{ background: repo.languageColor }}
                  />
                  {repo.language}
                </span>
                {repo.isGit && (
                  <span className="tag">
                    <IconBranch size={12} />
                    {repo.branch || 'unknown'}
                  </span>
                )}
                <span className="tag-muted">· {relTime(repo.updatedAt)}</span>
              </div>
              {repo.source === 'manual' && (
                <button
                  type="button"
                  className="icon-btn ghost repo-remove"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeManualRepository(repo)
                  }}
                  title="移除手动仓库"
                  aria-label="移除手动仓库"
                >
                  <IconTrash size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-title">
            {query.trim() ? '没有匹配的仓库' : '没有扫描到仓库'}
          </div>
          <div className="muted">
            {query.trim() ? '换个关键词再试一次' : '可以调整仓库文件夹后重新扫描'}
          </div>
        </div>
      )}
    </div>
  )
}
