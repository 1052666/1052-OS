import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Archive,
  BookOpen,
  BrainCircuit,
  Check,
  FileText,
  Folder,
  LoaderCircle,
  MemoryStick,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { MemoryItem, NoteTreeNode, OutputProfile, ResourceItem, WikiPage } from '../../contracts/schemas'
import { memoryApi, notesApi, outputProfilesApi, pkmApi, resourcesApi, wikiApi } from '../../data/api'
import { useShellStore } from '../../state/shell'
import { MarkdownView } from '../../components/chat/MarkdownView'
import { DataTable } from '../../components/ui/DataTable'
import { AsyncState, Badge, Button, Dialog, Field, Input, Select, Surface, Switch, Textarea, uiStyles } from '../../components/ui'
import pageStyles from '../../pages/pages.module.css'
import styles from './knowledge.module.css'

const MarkdownCodeEditor = lazy(() => import('../../components/editors/MarkdownCodeEditor'))

function flattenNotes(nodes: NoteTreeNode[], depth = 0): Array<NoteTreeNode & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...(node.children ? flattenNotes(node.children, depth + 1) : [])])
}

export function NotesView() {
  const client = useQueryClient()
  const theme = useShellStore((state) => state.theme)
  const tree = useQuery({ queryKey: ['notes', 'tree'], queryFn: () => notesApi.tree() })
  const [selectedPath, setSelectedPath] = useState('')
  const note = useQuery({ queryKey: ['notes', 'file', selectedPath], queryFn: () => notesApi.file(selectedPath), enabled: Boolean(selectedPath) })
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('新笔记.md')
  useEffect(() => { if (note.data) setDraft(note.data.content) }, [note.data])
  const save = useMutation({ mutationFn: () => notesApi.updateFile(selectedPath, draft), onSuccess: (data) => client.setQueryData(['notes', 'file', selectedPath], data) })
  const create = useMutation({ mutationFn: () => notesApi.createFile('', newName, '# 新笔记\n'), onSuccess: (data) => { setCreateOpen(false); setSelectedPath(data.path); void client.invalidateQueries({ queryKey: ['notes', 'tree'] }) } })
  const remove = useMutation({ mutationFn: () => notesApi.deleteFile(selectedPath), onSuccess: () => { setSelectedPath(''); setDraft(''); void client.invalidateQueries({ queryKey: ['notes', 'tree'] }) } })
  const nodes = flattenNotes(tree.data ?? [])
  return <><div className={pageStyles.split}><aside className={pageStyles.splitAside}><div className={pageStyles.toolbar}><strong>笔记目录</strong><Button size="small" onClick={() => setCreateOpen(true)}><Plus size={14} />新建</Button></div><AsyncState loading={tree.isLoading} error={tree.error} empty={!nodes.length}><div className={styles.treeList}>{nodes.map((node) => <button key={node.relativePath} type="button" style={{ paddingLeft: 10 + node.depth * 14 }} disabled={node.type === 'dir'} className={selectedPath === node.relativePath ? styles.treeActive : ''} onClick={() => node.type === 'file' && setSelectedPath(node.relativePath)}>{node.type === 'dir' ? <Folder size={14} /> : <FileText size={14} />}<span>{node.name}</span></button>)}</div></AsyncState></aside><section className={`${pageStyles.splitMain} ${styles.noteEditor}`}><div className={pageStyles.toolbar}><div className={pageStyles.toolbarGroup}><strong>{note.data?.name || '选择一篇笔记'}</strong>{selectedPath ? <Badge>{selectedPath}</Badge> : null}</div><div className={pageStyles.toolbarGroup}><Button size="small" onClick={() => setPreview(!preview)} disabled={!selectedPath}>{preview ? '编辑' : '预览'}</Button><Button size="small" variant="danger" onClick={() => remove.mutate()} disabled={!selectedPath}><Trash2 size={14} /></Button><Button size="small" variant="primary" onClick={() => save.mutate()} disabled={!selectedPath || save.isPending}><Save size={14} />保存</Button></div></div><AsyncState loading={note.isLoading} error={note.error} empty={!selectedPath}>{preview ? <div className={styles.markdownPreview}><MarkdownView content={draft} /></div> : <Suspense fallback={<div className={pageStyles.loadingPanel}>正在载入 Markdown 编辑器</div>}><MarkdownCodeEditor value={draft} onChange={setDraft} theme={theme} height="100%" /></Suspense>}</AsyncState></section></div><Dialog open={createOpen} onOpenChange={setCreateOpen} title="新建笔记" footer={<Button variant="primary" onClick={() => create.mutate()} disabled={!newName.trim()}>创建</Button>}><Field label="文件名"><Input value={newName} onChange={(event) => setNewName(event.target.value)} /></Field></Dialog></>
}

export function WikiView() {
  const client = useQueryClient()
  const theme = useShellStore((state) => state.theme)
  const pages = useQuery({ queryKey: ['wiki', 'pages'], queryFn: () => wikiApi.pages() })
  const [selected, setSelected] = useState<WikiPage | null>(null)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('concept')
  const [preview, setPreview] = useState(true)
  useEffect(() => { if (!selected && pages.data?.[0]) { setSelected(pages.data[0]); setDraft(pages.data[0].content); setTitle(pages.data[0].title); setCategory(pages.data[0].category) } }, [pages.data, selected])
  const select = (page: WikiPage) => { setSelected(page); setDraft(page.content); setTitle(page.title); setCategory(page.category); setPreview(true) }
  const save = useMutation({ mutationFn: () => selected ? wikiApi.update({ path: selected.path, title, category, tags: selected.tags, summary: selected.summary, content: draft }) : wikiApi.create({ title, category, content: draft }), onSuccess: (page) => { setSelected(page); void client.invalidateQueries({ queryKey: ['wiki', 'pages'] }) } })
  const lint = useMutation({ mutationFn: wikiApi.lint })
  const rebuild = useMutation({ mutationFn: wikiApi.rebuild })
  return <div className={pageStyles.split}><aside className={pageStyles.splitAside}><div className={pageStyles.toolbar}><strong>Wiki 页面</strong><Button size="small" onClick={() => { setSelected(null); setTitle('新页面'); setCategory('concept'); setDraft('# 新页面\n'); setPreview(false) }}><Plus size={14} />新建</Button></div><AsyncState loading={pages.isLoading} error={pages.error} empty={!pages.data?.length}><div className={pageStyles.list}>{pages.data?.map((page) => <button key={page.path} type="button" className={`${pageStyles.listItem} ${selected?.path === page.path ? pageStyles.listItemActive : ''}`} onClick={() => select(page)}><span><strong>{page.title}</strong><small>{page.summary || page.path}</small></span><Badge>{page.category}</Badge></button>)}</div></AsyncState></aside><section className={`${pageStyles.splitMain} ${styles.wikiEditor}`}><div className={pageStyles.toolbar}><div className={pageStyles.toolbarGroup}><Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Wiki 标题" /><Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Wiki 分类"><option value="entity">实体</option><option value="concept">概念</option><option value="synthesis">综合</option><option value="experience">经验</option></Select></div><div className={pageStyles.toolbarGroup}><Button size="small" onClick={() => lint.mutate()}><ShieldCheck size={14} />检查</Button><Button size="small" onClick={() => rebuild.mutate()}><RefreshCw size={14} />重建索引</Button><Button size="small" onClick={() => setPreview(!preview)}>{preview ? '编辑' : '预览'}</Button><Button size="small" variant="primary" onClick={() => save.mutate()} disabled={!title.trim()}><Save size={14} />保存</Button></div></div>{preview ? <div className={styles.markdownPreview}><MarkdownView content={draft} /></div> : <Suspense fallback={<div className={pageStyles.loadingPanel}>正在载入 Markdown 编辑器</div>}><MarkdownCodeEditor value={draft} onChange={setDraft} theme={theme} height="100%" /></Suspense>}{lint.data ? <pre className={styles.lintResult}>{JSON.stringify(lint.data, null, 2)}</pre> : null}</section></div>
}

type MemoryForm = { title: string; content: string; category: string; scope: string; priority: string; tags: string }
const emptyMemory: MemoryForm = { title: '', content: '', category: 'preference', scope: 'global', priority: 'normal', tags: '' }

export function MemoryView() {
  const client = useQueryClient()
  const [mode, setMode] = useState<'confirmed' | 'suggestions' | 'secure'>('confirmed')
  const memories = useQuery({ queryKey: ['memory', 'items'], queryFn: () => memoryApi.list() })
  const suggestions = useQuery({ queryKey: ['memory', 'suggestions'], queryFn: () => memoryApi.suggestions() })
  const secure = useQuery({ queryKey: ['memory', 'secure'], queryFn: memoryApi.secure })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MemoryItem | null>(null)
  const [form, setForm] = useState<MemoryForm>(emptyMemory)
  const refresh = () => { void client.invalidateQueries({ queryKey: ['memory'] }) }
  const save = useMutation({ mutationFn: () => editing ? memoryApi.update(editing.id, { ...form, tags: form.tags.split(',').map((item) => item.trim()).filter(Boolean) }) : memoryApi.create({ ...form, tags: form.tags.split(',').map((item) => item.trim()).filter(Boolean) }), onSuccess: () => { setOpen(false); setEditing(null); setForm(emptyMemory); refresh() } })
  const remove = useMutation({ mutationFn: memoryApi.remove, onSuccess: refresh })
  const confirm = useMutation({ mutationFn: memoryApi.confirm, onSuccess: refresh })
  const reject = useMutation({ mutationFn: memoryApi.reject, onSuccess: refresh })
  const edit = (item: MemoryItem) => { setEditing(item); setForm({ title: item.title, content: item.content, category: item.category, scope: item.scope, priority: item.priority, tags: item.tags.join(', ') }); setOpen(true) }
  const rows = mode === 'confirmed' ? memories.data ?? [] : mode === 'suggestions' ? suggestions.data ?? [] : secure.data ?? []
  return <><div className={styles.segmented}><button type="button" className={mode === 'confirmed' ? styles.segmentActive : ''} onClick={() => setMode('confirmed')}>已确认</button><button type="button" className={mode === 'suggestions' ? styles.segmentActive : ''} onClick={() => setMode('suggestions')}>待确认建议</button><button type="button" className={mode === 'secure' ? styles.segmentActive : ''} onClick={() => setMode('secure')}>安全记忆</button><Button size="small" variant="primary" onClick={() => { setEditing(null); setForm(emptyMemory); setOpen(true) }}><Plus size={14} />新建记忆</Button></div><Surface><AsyncState loading={memories.isLoading || suggestions.isLoading || secure.isLoading} error={memories.error || suggestions.error || secure.error} empty={!rows.length}><div className={styles.memoryGrid}>{rows.map((raw) => { const item = raw as MemoryItem & Record<string, unknown>; return <article key={item.id}><header><span className={styles.memoryIcon}>{mode === 'secure' ? <ShieldCheck size={16} /> : <MemoryStick size={16} />}</span><div><strong>{item.title}</strong><small>{String(item.category ?? item.type ?? '')} · {String(item.scope ?? item.mask ?? '')}</small></div>{mode === 'confirmed' ? <Badge tone={item.active ? 'success' : 'default'}>{item.active ? '启用' : '停用'}</Badge> : mode === 'suggestions' ? <Badge tone="warning">建议</Badge> : <Badge>受保护</Badge>}</header><p>{String(item.content ?? item.mask ?? '')}</p><footer>{Array.isArray(item.tags) ? item.tags.slice(0, 4).map((tag) => <Badge key={tag}>{tag}</Badge>) : null}<span />{mode === 'confirmed' ? <><Button size="small" onClick={() => edit(item)}>编辑</Button><Button size="small" variant="danger" onClick={() => remove.mutate(item.id)}><Trash2 size={13} /></Button></> : mode === 'suggestions' ? <><Button size="small" onClick={() => reject.mutate(item.id)}>忽略</Button><Button size="small" variant="primary" onClick={() => confirm.mutate(item.id)}><Check size={13} />确认</Button></> : null}</footer></article> })}</div></AsyncState></Surface><Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑记忆' : '新建记忆'} footer={<Button variant="primary" onClick={() => save.mutate()} disabled={!form.title.trim() || !form.content.trim()}>保存</Button>}><div className={pageStyles.formGrid}><Field label="标题"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="分类"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="preference">偏好</option><option value="hard_rule">硬规则</option><option value="habit">习惯</option><option value="workflow">工作流</option><option value="project_context">项目上下文</option><option value="identity">身份</option></Select></Field><Field label="范围"><Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option value="global">全局</option><option value="repository">仓库</option><option value="notes">笔记</option><option value="workspace">工作区</option></Select></Field><Field label="优先级"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></Select></Field><Field label="标签（逗号分隔）"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field><Field label="内容"><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field></div></Dialog></>
}

type ResourceForm = { title: string; content: string; note: string; tags: string }
export function ResourcesView() {
  const client = useQueryClient()
  const [queryText, setQueryText] = useState('')
  const query = useQuery({ queryKey: ['resources', queryText], queryFn: () => resourcesApi.list(queryText) })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ResourceItem | null>(null)
  const [form, setForm] = useState<ResourceForm>({ title: '', content: '', note: '', tags: '' })
  const refresh = () => void client.invalidateQueries({ queryKey: ['resources'] })
  const save = useMutation({ mutationFn: () => { const body = { ...form, tags: form.tags.split(',').map((item) => item.trim()).filter(Boolean) }; return editing ? resourcesApi.update(editing.id, body) : resourcesApi.create(body) }, onSuccess: () => { setOpen(false); refresh() } })
  const strike = useMutation({ mutationFn: ({ id, struck }: { id: string; struck: boolean }) => resourcesApi.strike(id, struck), onSuccess: refresh })
  const remove = useMutation({ mutationFn: resourcesApi.remove, onSuccess: refresh })
  const edit = (item: ResourceItem) => { setEditing(item); setForm({ title: item.title, content: item.content, note: item.note, tags: item.tags.join(', ') }); setOpen(true) }
  const columns = useMemo<ColumnDef<ResourceItem>[]>(() => [{ accessorKey: 'title', header: '资源', cell: ({ row }) => <div className={styles.primaryResource}><Archive size={15} /><span><strong>{row.original.title}</strong><small>{row.original.note || row.original.content}</small></span></div> }, { accessorKey: 'tags', header: '标签', cell: ({ row }) => <div className={styles.tagLine}>{row.original.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div> }, { accessorKey: 'status', header: '状态', cell: ({ getValue }) => <Badge tone={getValue() === 'active' ? 'success' : 'default'}>{getValue() === 'active' ? '使用中' : '已划掉'}</Badge> }, { id: 'actions', header: '', cell: ({ row }) => <div className={uiStyles.rowActions}><Button size="small" onClick={() => edit(row.original)}>编辑</Button><Button size="small" onClick={() => strike.mutate({ id: row.original.id, struck: row.original.status === 'active' })}>{row.original.status === 'active' ? '划掉' : '恢复'}</Button><Button size="small" aria-label={`删除 ${row.original.title}`} variant="danger" onClick={() => remove.mutate(row.original.id)}><Trash2 size={13} /></Button></div> }], [remove, strike])
  return <><Surface title="资源库" action={<div className={pageStyles.toolbarGroup}><Input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="搜索资源" /><Button size="small" variant="primary" onClick={() => { setEditing(null); setForm({ title: '', content: '', note: '', tags: '' }); setOpen(true) }}><Plus size={14} />新建</Button></div>}><AsyncState loading={query.isLoading} error={query.error}><DataTable data={query.data ?? []} columns={columns} /></AsyncState></Surface><Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑资源' : '新建资源'} footer={<Button variant="primary" onClick={() => save.mutate()} disabled={!form.title.trim()}>保存</Button>}><Field label="标题"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="内容或链接"><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field><Field label="备注"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field><Field label="标签"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field></Dialog></>
}

export function PkmView() {
  const summary = useQuery({ queryKey: ['pkm', 'summary'], queryFn: pkmApi.summary })
  const [expression, setExpression] = useState('')
  const search = useMutation({ mutationFn: () => pkmApi.search(expression) })
  const reindex = useMutation({ mutationFn: pkmApi.reindex })
  const results = (search.data?.results ?? []) as Array<Record<string, unknown>>
  return <div className={styles.knowledgeSearch}><div className={pageStyles.statStrip}><div><strong>{summary.data?.totalEntries ?? 0}</strong><span>索引条目</span></div><div><strong>{Object.keys(summary.data?.bySource ?? {}).length}</strong><span>内容来源</span></div><div><strong>{summary.data?.thesaurusSize ?? 0}</strong><span>同义词</span></div><div><strong>{summary.data?.lastIndexAt ? '正常' : '待建立'}</strong><span>索引状态</span></div></div><section className={styles.searchDeck}><Search size={19} /><Input value={expression} onChange={(e) => setExpression(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && expression.trim() && search.mutate()} placeholder="使用自然语言搜索记忆、Wiki、Skill、资源和日程" /><Button variant="primary" onClick={() => search.mutate()} disabled={!expression.trim() || search.isPending}>{search.isPending ? <LoaderCircle className={styles.spin} size={15} /> : <Search size={15} />}搜索</Button><Button onClick={() => reindex.mutate()}><RefreshCw size={15} />重建索引</Button></section><div className={styles.searchResults}>{results.map((result, index) => { const entry = (result.entry ?? {}) as Record<string, unknown>; return <article key={String(entry.id ?? index)}><header><span><BookOpen size={15} /></span><div><strong>{String(entry.title ?? '未命名结果')}</strong><small>{String(result.sourceLabel ?? entry.source ?? '')}</small></div><Badge>{Number(result.score ?? 0).toFixed(2)}</Badge></header><p>{String(entry.summary ?? entry.content ?? '')}</p>{Array.isArray(entry.tags) ? <footer>{entry.tags.slice(0, 5).map((tag) => <Badge key={String(tag)}>{String(tag)}</Badge>)}</footer> : null}</article> })}{search.data && !results.length ? <div className={styles.searchEmpty}>没有找到匹配内容</div> : null}</div></div>
}

type ProfileForm = { title: string; description: string; priority: 'high' | 'normal' | 'low'; instructions: string; tags: string; active: boolean }
export function OutputProfilesView() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['output-profiles'], queryFn: () => outputProfilesApi.list() })
  const [selected, setSelected] = useState<OutputProfile | null>(null)
  const [form, setForm] = useState<ProfileForm>({ title: '', description: '', priority: 'normal', instructions: '', tags: '', active: true })
  useEffect(() => { if (!selected && query.data?.[0]) { const item = query.data[0]; setSelected(item); setForm({ title: item.title, description: item.description, priority: item.priority, instructions: item.instructions, tags: item.tags.join(', '), active: item.active }) } }, [query.data, selected])
  const choose = (item: OutputProfile) => { setSelected(item); setForm({ title: item.title, description: item.description, priority: item.priority, instructions: item.instructions, tags: item.tags.join(', '), active: item.active }) }
  const save = useMutation({ mutationFn: () => { const body = { ...form, tags: form.tags.split(',').map((item) => item.trim()).filter(Boolean) }; return selected ? outputProfilesApi.update(selected.id, body) : outputProfilesApi.create(body) }, onSuccess: (item) => { setSelected(item); void client.invalidateQueries({ queryKey: ['output-profiles'] }) } })
  const remove = useMutation({ mutationFn: outputProfilesApi.remove, onSuccess: () => { setSelected(null); void client.invalidateQueries({ queryKey: ['output-profiles'] }) } })
  return <div className={pageStyles.split}><aside className={pageStyles.splitAside}><div className={pageStyles.toolbar}><strong>输出配置</strong><Button size="small" onClick={() => { setSelected(null); setForm({ title: '', description: '', priority: 'normal', instructions: '', tags: '', active: true }) }}><Plus size={14} />新建</Button></div><div className={pageStyles.list}>{query.data?.map((item) => <button key={item.id} type="button" className={`${pageStyles.listItem} ${selected?.id === item.id ? pageStyles.listItemActive : ''}`} onClick={() => choose(item)}><span><strong>{item.title}</strong><small>{item.description}</small></span><Badge tone={item.active ? 'success' : 'default'}>{item.active ? '启用' : '停用'}</Badge></button>)}</div></aside><section className={pageStyles.splitMain}><div className={pageStyles.detail}><div className={styles.profileHeading}><span><BrainCircuit size={19} /></span><div><h2>{form.title || '新输出配置'}</h2><p>定义 Agent 在特定场景中的表达方式和约束。</p></div></div><div className={pageStyles.formGrid}><Field label="名称"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="优先级"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ProfileForm['priority'] })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></Select></Field><Field label="说明"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><Field label="标签"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field><Field label="输出指令"><Textarea className={styles.instructions} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field><div className={styles.activeSwitch}><span><strong>启用配置</strong><small>允许 Runtime 在匹配场景中使用</small></span><Switch label="启用输出配置" checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} /></div></div><div className={styles.editorActions}>{selected ? <Button variant="danger" onClick={() => remove.mutate(selected.id)}><Trash2 size={14} />删除</Button> : null}<Button variant="primary" onClick={() => save.mutate()} disabled={!form.title.trim()}><Save size={14} />保存配置</Button></div></div></section></div>
}
