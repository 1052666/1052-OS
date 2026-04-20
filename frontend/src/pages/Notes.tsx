import {
  useEffect,
  useDeferredValue,
  useMemo,
  memo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'
import {
  NotesApi,
  type NoteFile,
  type NoteTreeNode,
  type NotesConfig,
} from '../api/notes'
import {
  IconChevron,
  IconFolder,
  IconNotes,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '../components/Icons'
import Markdown from '../components/Markdown'

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

type CreateKind = 'file' | 'folder'
type EntryKind = 'file' | 'dir'

type ContextMenu = {
  x: number
  y: number
  path: string
  type: EntryKind
  name: string
} | null

type CreateDraft = {
  kind: CreateKind
  path: string
}

const AUTO_SCAN_MS = 60 * 1000

type NotesPageCache = {
  config: NotesConfig | null
  rootPath: string
  tree: NoteTreeNode[]
  query: string
  activeFile: NoteFile | null
  selectedPath: string
  draft: string
  mode: 'source' | 'preview'
  expandedPaths: string[]
}

let notesPageCache: NotesPageCache = {
  config: null,
  rootPath: '',
  tree: [],
  query: '',
  activeFile: null,
  selectedPath: '',
  draft: '',
  mode: 'source',
  expandedPaths: [],
}

function joinPath(folder: string, name: string) {
  return [folder, name].filter(Boolean).join('/')
}

function relTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前'
  return Math.floor(diff / 86400_000) + ' 天前'
}

function countNotes(nodes: NoteTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.type === 'file' ? 1 : 0) + countNotes(node.children ?? []),
    0,
  )
}

function findNode(nodes: NoteTreeNode[], path: string): NoteTreeNode | null {
  for (const node of nodes) {
    if (node.relativePath === path) return node
    const child = findNode(node.children ?? [], path)
    if (child) return child
  }
  return null
}

function fileNameWithoutExt(name: string) {
  return name.replace(/\.(md|markdown)$/i, '')
}

const TreeNode = memo(function TreeNode({
  node,
  activePath,
  expandedPaths,
  searchActive,
  level,
  draggedPath,
  onToggle,
  onOpenFile,
  onContextMenu,
  onDragStart,
  onMove,
}: {
  node: NoteTreeNode
  activePath: string
  expandedPaths: Set<string>
  searchActive: boolean
  level: number
  draggedPath: string
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onContextMenu: (event: MouseEvent, node: NoteTreeNode) => void
  onDragStart: (node: NoteTreeNode) => void
  onMove: (source: string, targetDir: string) => void
}) {
  const open = node.type === 'dir' && (searchActive || expandedPaths.has(node.relativePath))
  const isDropTarget =
    node.type === 'dir' && draggedPath && draggedPath !== node.relativePath

  if (node.type === 'dir') {
    return (
      <div className="note-tree-group">
        <button
          className={'note-tree-row dir' + (isDropTarget ? ' drop-target' : '')}
          type="button"
          draggable
          style={{ paddingLeft: 8 + level * 14 }}
          onClick={() => onToggle(node.relativePath)}
          onContextMenu={(event) => onContextMenu(event, node)}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            onDragStart(node)
          }}
          onDragOver={(event) => {
            if (draggedPath && draggedPath !== node.relativePath) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (draggedPath) onMove(draggedPath, node.relativePath)
          }}
        >
          <IconChevron size={13} className={open ? 'open' : ''} />
          <IconFolder size={14} />
          <span>{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              activePath={activePath}
              expandedPaths={expandedPaths}
              searchActive={searchActive}
              level={level + 1}
              draggedPath={draggedPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onMove={onMove}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      className={'note-tree-row file' + (node.relativePath === activePath ? ' active' : '')}
      type="button"
      draggable
      style={{ paddingLeft: 26 + level * 14 }}
      onClick={() => onOpenFile(node.relativePath)}
      onContextMenu={(event) => onContextMenu(event, node)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart(node)
      }}
    >
      <IconNotes size={14} />
      <span>{fileNameWithoutExt(node.name)}</span>
    </button>
  )
})

export default function Notes() {
  const [config, setConfig] = useState<NotesConfig | null>(notesPageCache.config)
  const [rootPath, setRootPath] = useState(notesPageCache.rootPath)
  const [tree, setTree] = useState<NoteTreeNode[]>(notesPageCache.tree)
  const [query, setQuery] = useState(notesPageCache.query)
  const [activeFile, setActiveFile] = useState<NoteFile | null>(notesPageCache.activeFile)
  const [selectedPath, setSelectedPath] = useState(notesPageCache.selectedPath)
  const [draft, setDraft] = useState(notesPageCache.draft)
  const [mode, setMode] = useState<'source' | 'preview'>(notesPageCache.mode)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(notesPageCache.expandedPaths),
  )
  const [loading, setLoading] = useState(!notesPageCache.config)
  const [treeLoading, setTreeLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingConfig, setEditingConfig] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [createName, setCreateName] = useState('')
  const [draggedPath, setDraggedPath] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)
  const fileRequestRef = useRef(0)

  const configured = Boolean(config?.configured)
  const visibleActivePath = selectedPath || activeFile?.path || ''
  const searchActive = Boolean(query.trim())
  const deferredDraft = useDeferredValue(draft)
  const noteCount = useMemo(() => countNotes(tree), [tree])
  const activeNodeExists = useMemo(
    () => Boolean(visibleActivePath && findNode(tree, visibleActivePath)),
    [tree, visibleActivePath],
  )

  useEffect(() => {
    notesPageCache = {
      config,
      rootPath,
      tree,
      query,
      activeFile,
      selectedPath,
      draft,
      mode,
      expandedPaths: [...expandedPaths],
    }
  }, [activeFile, config, draft, expandedPaths, mode, query, rootPath, selectedPath, tree])

  useEffect(() => {
    const close = () => {
      setContextMenu(null)
      setCreateDraft(null)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

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

  const loadTree = async (nextQuery = query, options?: { silent?: boolean }) => {
    if (!config?.configured) return
    if (!options?.silent) setTreeLoading(true)
    try {
      const nextTree = await NotesApi.getTree(nextQuery)
      setTree(nextTree)
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '笔记目录读取失败')
    } finally {
      if (!options?.silent) setTreeLoading(false)
    }
  }

  const openFile = async (path: string) => {
    const requestId = fileRequestRef.current + 1
    fileRequestRef.current = requestId
    setSelectedPath(path)
    if (!activeFile) setFileLoading(true)
    try {
      const file = await NotesApi.getFile(path)
      if (fileRequestRef.current !== requestId) return
      setActiveFile(file)
      setSelectedPath(file.path)
      setDraft(file.content)
    } catch (err) {
      if (fileRequestRef.current !== requestId) return
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '笔记读取失败')
    } finally {
      if (fileRequestRef.current === requestId) setFileLoading(false)
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const nextConfig = await NotesApi.getConfig()
        setConfig(nextConfig)
        setRootPath(nextConfig.rootPath)
        setEditingConfig(!nextConfig.configured)
        if (nextConfig.configured) {
          setTree(await NotesApi.getTree())
        }
      } catch (err) {
        const apiErr = err as { message?: string }
        showNotice(apiErr.message ?? '笔记配置读取失败')
      } finally {
        setLoading(false)
      }
    }

    load()
    return clearNoticeTimers
  }, [])

  useEffect(() => {
    if (!configured) return undefined
    const timer = window.setTimeout(() => {
      loadTree(query)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, configured])

  useEffect(() => {
    if (!configured) return undefined
    const timer = window.setInterval(() => {
      loadTree(query, { silent: true })
    }, AUTO_SCAN_MS)
    return () => window.clearInterval(timer)
  }, [configured, query, config?.rootPath])

  const toggleFolder = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const saveConfig = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const nextConfig = await NotesApi.updateConfig(rootPath)
      setConfig(nextConfig)
      setEditingConfig(false)
      setActiveFile(null)
      setSelectedPath('')
      setDraft('')
      setExpandedPaths(new Set())
      showNotice('笔记目录已保存', 'success')
      setTree(await NotesApi.getTree())
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '笔记目录保存失败')
    } finally {
      setSaving(false)
    }
  }

  const useDefaultConfig = async () => {
    setSaving(true)
    try {
      const nextConfig = await NotesApi.useDefaultConfig()
      setConfig(nextConfig)
      setRootPath(nextConfig.rootPath)
      setEditingConfig(false)
      setActiveFile(null)
      setSelectedPath('')
      setDraft('')
      setExpandedPaths(new Set())
      setTree(await NotesApi.getTree())
      showNotice('已使用系统默认笔记目录', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '默认笔记目录创建失败')
    } finally {
      setSaving(false)
    }
  }

  const saveFile = async () => {
    if (!activeFile) return
    setSaving(true)
    try {
      const file = await NotesApi.updateFile(activeFile.path, draft)
      setActiveFile(file)
      setSelectedPath(file.path)
      setDraft(file.content)
      await loadTree()
      showNotice('笔记已保存', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '笔记保存失败')
    } finally {
      setSaving(false)
    }
  }

  const showContextMenu = (event: MouseEvent, node?: NoteTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setCreateDraft(null)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path: node?.relativePath ?? '',
      type: node?.type ?? 'dir',
      name: node?.name ?? '根目录',
    })
  }

  const beginCreate = (kind: CreateKind, path: string) => {
    setCreateDraft({ kind, path })
    setCreateName('')
  }

  const createItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!createDraft) return
    const name = createName.trim()
    if (!name) {
      showNotice(createDraft.kind === 'file' ? '文件名不能为空' : '文件夹名不能为空')
      return
    }

    setSaving(true)
    try {
      if (createDraft.kind === 'file') {
        const file = await NotesApi.createFile(createDraft.path, name, '')
        setActiveFile(file)
        setSelectedPath(file.path)
        setDraft(file.content)
      } else {
        await NotesApi.createFolder(createDraft.path, name)
      }
      if (createDraft.path) {
        setExpandedPaths((current) => new Set(current).add(createDraft.path))
      }
      setContextMenu(null)
      setCreateDraft(null)
      setCreateName('')
      await loadTree(query, { silent: true })
      showNotice(createDraft.kind === 'file' ? '笔记已创建' : '文件夹已创建', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (path: string, type: EntryKind) => {
    if (!path) return
    setSaving(true)
    try {
      if (type === 'file') await NotesApi.deleteFile(path)
      else await NotesApi.deleteFolder(path)
      if (activeFile?.path === path || activeFile?.path.startsWith(path + '/')) {
        setActiveFile(null)
        setSelectedPath('')
        setDraft('')
      }
      setContextMenu(null)
      setCreateDraft(null)
      await loadTree(query, { silent: true })
      showNotice(type === 'file' ? '笔记已删除' : '文件夹已删除', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '删除失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteCurrentFile = async () => {
    if (!activeFile) return
    await deleteEntry(activeFile.path, 'file')
  }

  const moveEntry = async (source: string, targetDir: string) => {
    if (!source) return
    setDraggedPath('')
    setSaving(true)
    try {
      await NotesApi.moveEntry(source, targetDir)
      const sourceName = source.split('/').filter(Boolean).pop() ?? ''
      const nextPath = joinPath(targetDir, sourceName)
      if (activeFile?.path === source) {
        setSelectedPath(nextPath)
        setActiveFile({ ...activeFile, path: nextPath })
      } else if (activeFile?.path.startsWith(source + '/')) {
        const nestedPath = nextPath + activeFile.path.slice(source.length)
        setSelectedPath(nestedPath)
        setActiveFile({ ...activeFile, path: nestedPath })
      }
      if (targetDir) setExpandedPaths((current) => new Set(current).add(targetDir))
      await loadTree(query, { silent: true })
      showNotice('已移动', 'success')
    } catch (err) {
      const apiErr = err as { message?: string }
      showNotice(apiErr.message ?? '移动失败')
    } finally {
      setSaving(false)
    }
  }

  const dropOnRoot = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedPath) return
    event.preventDefault()
    moveEntry(draggedPath, '')
  }

  return (
    <div className="notes-page">
      {notice && (
        <div className={'toast ' + notice.type + (notice.leaving ? ' leaving' : '')}>
          {notice.message}
        </div>
      )}

      <aside className="notes-aside">
        <div className="notes-aside-head">
          <div className="search">
            <IconSearch size={14} />
            <input
              placeholder="搜索文件名和正文..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!configured}
            />
          </div>
        </div>

        <div className="notes-root-row">
          <IconFolder size={14} />
          <span>{config?.rootPath || '尚未配置笔记目录'}</span>
          <button type="button" onClick={() => setEditingConfig((value) => !value)}>
            目录
          </button>
        </div>

        <div
          className="note-tree"
          onContextMenu={(event) => showContextMenu(event)}
          onDragOver={(event) => {
            if (draggedPath) event.preventDefault()
          }}
          onDrop={dropOnRoot}
          onDragEnd={() => setDraggedPath('')}
        >
          {loading ? (
            <div className="note-tree-empty">正在加载笔记</div>
          ) : !configured ? (
            <div className="note-tree-empty">选择本地目录或使用系统默认笔记目录</div>
          ) : treeLoading && tree.length === 0 ? (
            <div className="note-tree-empty">正在搜索</div>
          ) : tree.length > 0 ? (
            tree.map((node) => (
              <TreeNode
                key={node.relativePath}
                node={node}
                activePath={visibleActivePath}
                expandedPaths={expandedPaths}
                searchActive={searchActive}
                level={0}
                draggedPath={draggedPath}
                onToggle={toggleFolder}
                onOpenFile={openFile}
                onContextMenu={showContextMenu}
                onDragStart={(dragNode) => setDraggedPath(dragNode.relativePath)}
                onMove={moveEntry}
              />
            ))
          ) : (
            <div className="note-tree-empty">
              {query.trim() ? '没有匹配的笔记' : '右键空白处新建笔记或文件夹'}
            </div>
          )}
        </div>
      </aside>

      {contextMenu && (
        <div
          className="note-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="note-context-title">{contextMenu.name}</div>
          {contextMenu.type === 'dir' && (
            <>
              <button type="button" onClick={() => beginCreate('file', contextMenu.path)}>
                新建笔记
              </button>
              <button type="button" onClick={() => beginCreate('folder', contextMenu.path)}>
                新建文件夹
              </button>
            </>
          )}
          <button type="button" onClick={() => loadTree(query)}>
            刷新目录
          </button>
          {contextMenu.path && (
            <button
              type="button"
              className="danger"
              onClick={() => deleteEntry(contextMenu.path, contextMenu.type)}
            >
              删除{contextMenu.type === 'file' ? '笔记' : '文件夹'}
            </button>
          )}
          {createDraft && (
            <form className="note-context-create" onSubmit={createItem}>
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={createDraft.kind === 'file' ? '文件名，例如 inbox.md' : '文件夹名'}
                autoFocus
              />
              <button type="submit" disabled={saving}>
                创建
              </button>
            </form>
          )}
        </div>
      )}

      <section className="notes-editor-pane">
        {editingConfig && (
          <form className="notes-config" onSubmit={saveConfig}>
            <label>
              <span>笔记目录</span>
              <input
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="C:\\Users\\用户名\\Documents\\Notes"
                autoFocus={!configured}
              />
              <small>
                可以填写任意本地文件夹路径；也可以使用系统默认目录：
                {config?.defaultRootPath || 'data/notes'}
              </small>
            </label>
            <div className="notes-config-actions">
              <button
                className="chip ghost"
                type="button"
                onClick={useDefaultConfig}
                disabled={saving}
              >
                使用系统默认目录
              </button>
              {configured && (
                <button
                  className="chip ghost"
                  type="button"
                  onClick={() => {
                    setRootPath(config?.rootPath ?? '')
                    setEditingConfig(false)
                  }}
                >
                  取消
                </button>
              )}
              <button className="chip primary" type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存目录'}
              </button>
            </div>
          </form>
        )}

        {!configured && !editingConfig ? (
          <div className="empty-state">
            <div className="empty-title">尚未配置笔记目录</div>
            <p className="empty-copy">你可以选择已有本地文件夹，或让系统在 data 目录下自动创建一个笔记库。</p>
            <button
              className="chip primary"
              type="button"
              onClick={() => setEditingConfig(true)}
            >
              配置笔记目录
            </button>
          </div>
        ) : fileLoading ? (
          <div className="empty-state">
            <div className="empty-title">正在读取笔记</div>
          </div>
        ) : activeFile ? (
          <>
            <div className="notes-editor-head">
              <div>
                <div className="notes-title">{activeFile.name}</div>
                <div className="notes-sub">
                  {activeFile.path} · {relTime(activeFile.updatedAt)} 更新 · {noteCount} 篇
                  {!activeNodeExists && query.trim() ? ' · 当前笔记不在搜索结果中' : ''}
                </div>
              </div>
              <div className="notes-actions">
                <button
                  className="chip ghost"
                  type="button"
                  onClick={() => loadTree()}
                  disabled={treeLoading}
                >
                  <IconRefresh size={14} /> 刷新
                </button>
                <div className="notes-mode">
                  <button
                    type="button"
                    className={mode === 'source' ? 'active' : ''}
                    onClick={() => setMode('source')}
                  >
                    源码
                  </button>
                  <button
                    type="button"
                    className={mode === 'preview' ? 'active' : ''}
                    onClick={() => setMode('preview')}
                  >
                    预览
                  </button>
                </div>
                <button className="chip primary" type="button" onClick={saveFile} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  className="icon-btn ghost danger"
                  type="button"
                  onClick={deleteCurrentFile}
                  disabled={saving}
                  title="删除当前笔记"
                  aria-label="删除当前笔记"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>

            {mode === 'source' ? (
              <textarea
                className="notes-body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="开始写 Markdown..."
              />
            ) : (
              <div className="notes-preview">
                <Markdown text={deferredDraft} />
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-title">右键左侧空白处新建笔记，或选择一个 Markdown 文件</div>
          </div>
        )}
      </section>
    </div>
  )
}
