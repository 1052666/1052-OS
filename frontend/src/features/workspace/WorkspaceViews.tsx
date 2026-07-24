import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CheckCircle2,
  Database,
  FileCode2,
  FileText,
  Folder,
  FolderGit2,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { DataSource, Repository, Server, ShellFile, SqlFile, SqlVariable } from '../../contracts/schemas'
import { repositoryApi, sqlApi } from '../../data/api'
import { useShellStore } from '../../state/shell'
import { MarkdownView } from '../../components/chat/MarkdownView'
import { DataTable } from '../../components/ui/DataTable'
import { AsyncState, Badge, Button, Dialog, Field, Input, Select, Surface, Textarea, uiStyles } from '../../components/ui'
import pageStyles from '../../pages/pages.module.css'
import styles from './workspace.module.css'

const SqlCodeEditor = lazy(() => import('../../components/editors/SqlCodeEditor'))

function formatDate(timestamp?: number) {
  return timestamp ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp) : '未知'
}

function flattenTree(nodes: Array<Record<string, unknown>>, depth = 0): Array<{ name: string; path: string; type: string; depth: number }> {
  const result: Array<{ name: string; path: string; type: string; depth: number }> = []
  for (const node of nodes) {
    result.push({ name: String(node.name ?? ''), path: String(node.relativePath ?? ''), type: String(node.type ?? 'file'), depth })
    if (Array.isArray(node.children)) result.push(...flattenTree(node.children as Array<Record<string, unknown>>, depth + 1))
  }
  return result
}

export function RepositoriesView() {
  const client = useQueryClient()
  const repositories = useQuery({ queryKey: ['repositories'], queryFn: repositoryApi.list })
  const [selectedId, setSelectedId] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [path, setPath] = useState('')
  useEffect(() => { if (!selectedId && repositories.data?.[0]) setSelectedId(repositories.data[0].id) }, [repositories.data, selectedId])
  const detail = useQuery({ queryKey: ['repository', selectedId], queryFn: () => repositoryApi.detail(selectedId), enabled: Boolean(selectedId) })
  const file = useQuery({ queryKey: ['repository', selectedId, 'file', selectedPath], queryFn: () => repositoryApi.file(selectedId, selectedPath), enabled: Boolean(selectedId && selectedPath) })
  const add = useMutation({ mutationFn: () => repositoryApi.add(path), onSuccess: (repo) => { setAddOpen(false); setPath(''); setSelectedId(repo.id); void client.invalidateQueries({ queryKey: ['repositories'] }) } })
  const remove = useMutation({ mutationFn: repositoryApi.remove, onSuccess: () => { setSelectedId(''); void client.invalidateQueries({ queryKey: ['repositories'] }) } })
  const tree = flattenTree((detail.data?.tree ?? []) as Array<Record<string, unknown>>).slice(0, 500)
  const selectedRepo = repositories.data?.find((repo) => repo.id === selectedId)
  return (
    <>
      <div className={pageStyles.split}>
        <aside className={pageStyles.splitAside}>
          <div className={pageStyles.toolbar}><strong>本地仓库</strong><Button size="small" onClick={() => setAddOpen(true)}><Plus size={14} />添加</Button></div>
          <AsyncState loading={repositories.isLoading} error={repositories.error} empty={!repositories.data?.length}>
            <div className={pageStyles.list}>{repositories.data?.map((repo) => <button type="button" key={repo.id} className={`${pageStyles.listItem} ${repo.id === selectedId ? pageStyles.listItemActive : ''}`} onClick={() => { setSelectedId(repo.id); setSelectedPath('') }}><span><strong>{repo.name}</strong><small>{repo.path}</small></span><Badge tone={repo.status === 'dirty' ? 'warning' : 'success'}>{repo.status === 'dirty' ? `${repo.changes} 项变化` : repo.status === 'clean' ? '干净' : '未知'}</Badge></button>)}</div>
          </AsyncState>
        </aside>
        <section className={pageStyles.splitMain}>
          <AsyncState loading={detail.isLoading} error={detail.error} empty={!selectedRepo}>
            <div className={styles.repoHeader}><span className={styles.repoIcon}><FolderGit2 size={20} /></span><div><h2>{selectedRepo?.name}</h2><p>{selectedRepo?.description || selectedRepo?.path}</p><div><Badge>{selectedRepo?.branch || 'no branch'}</Badge>{selectedRepo?.language ? <Badge>{selectedRepo.language}</Badge> : null}</div></div>{selectedRepo ? <Button variant="danger" size="small" onClick={() => remove.mutate(selectedRepo.id)}><Trash2 size={14} />移除</Button> : null}</div>
            <div className={styles.repoContent}>
              <div className={styles.fileTree}>
                <header>文件</header>
                {tree.map((node) => <button key={node.path} type="button" style={{ paddingLeft: 10 + node.depth * 14 }} disabled={node.type === 'dir'} onClick={() => setSelectedPath(node.path)} className={selectedPath === node.path ? styles.selectedFile : ''}>{node.type === 'dir' ? <Folder size={14} /> : <FileText size={14} />}<span>{node.name}</span></button>)}
              </div>
              <div className={styles.filePreview}>
                {selectedPath ? <AsyncState loading={file.isLoading} error={file.error}>{String((file.data as Record<string, unknown> | undefined)?.previewType) === 'markdown' ? <MarkdownView content={String((file.data as Record<string, unknown>).content ?? '')} /> : <pre>{String((file.data as Record<string, unknown> | undefined)?.content ?? '')}</pre>}</AsyncState> : detail.data?.readme ? <MarkdownView content={detail.data.readme.content} /> : <div className={styles.previewEmpty}>选择一个文件查看内容</div>}
              </div>
            </div>
          </AsyncState>
        </section>
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen} title="添加本地仓库" footer={<><Button onClick={() => setAddOpen(false)}>取消</Button><Button variant="primary" onClick={() => add.mutate()} disabled={!path.trim() || add.isPending}>添加仓库</Button></>}><Field label="仓库绝对路径"><Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\projects\my-repository" /></Field>{add.error ? <p className={styles.formError}>{add.error.message}</p> : null}</Dialog>
    </>
  )
}

export function SqlWorkbenchView() {
  const theme = useShellStore((state) => state.theme)
  const sources = useQuery({ queryKey: ['sql', 'datasources'], queryFn: sqlApi.dataSources })
  const files = useQuery({ queryKey: ['sql', 'files'], queryFn: sqlApi.files })
  const [datasourceId, setDatasourceId] = useState('')
  const [sql, setSql] = useState('select 1 as ready;')
  useEffect(() => { if (!datasourceId && sources.data?.[0]) setDatasourceId(sources.data[0].id) }, [datasourceId, sources.data])
  const execute = useMutation({ mutationFn: () => sqlApi.query(datasourceId, sql) })
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => (execute.data?.columns ?? []).map((column) => ({ accessorKey: column, header: column, cell: ({ getValue }) => String(getValue() ?? '') })), [execute.data?.columns])
  return (
    <div className={styles.workbench}>
      <div className={styles.workbenchToolbar}>
        <div><Select value={datasourceId} onChange={(event) => setDatasourceId(event.target.value)} aria-label="选择数据源"><option value="">选择数据源</option>{sources.data?.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.type}</option>)}</Select><Select value="" onChange={(event) => { const file = files.data?.find((item) => item.id === event.target.value); if (file) { setSql(file.content); setDatasourceId(file.datasourceId) } }} aria-label="载入 SQL 文件"><option value="">载入 SQL 文件</option>{files.data?.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</Select></div>
        <Button variant="primary" onClick={() => execute.mutate()} disabled={!datasourceId || !sql.trim() || execute.isPending}>{execute.isPending ? <LoaderCircle size={15} className={styles.spin} /> : <Play size={15} />}运行查询</Button>
      </div>
      <div className={styles.editorPane}><Suspense fallback={<div className={pageStyles.loadingPanel}>正在载入 SQL 编辑器</div>}><SqlCodeEditor value={sql} height="100%" theme={theme} onChange={setSql} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }} /></Suspense></div>
      <section className={styles.resultPane}>
        <header><strong>查询结果</strong>{execute.data ? <Badge tone="success">{execute.data.rowCount} 行{execute.data.truncated ? ' · 已截断' : ''}</Badge> : null}</header>
        <AsyncState loading={execute.isPending} error={execute.error} empty={!execute.data}>
          <DataTable data={execute.data?.rows ?? []} columns={columns} empty="查询成功，没有返回数据" />
        </AsyncState>
      </section>
    </div>
  )
}

type SourceForm = { name: string; type: 'mysql' | 'oracle' | 'sqlite' | 'hive'; host: string; port: string; user: string; password: string; database: string; filePath: string }
const emptySource: SourceForm = { name: '', type: 'mysql', host: '', port: '3306', user: '', password: '', database: '', filePath: '' }

export function DataSourcesView() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sql', 'datasources'], queryFn: sqlApi.dataSources })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SourceForm>(emptySource)
  const create = useMutation({ mutationFn: () => sqlApi.createDataSource({ ...form, port: Number(form.port) || undefined }), onSuccess: () => { setOpen(false); setForm(emptySource); void client.invalidateQueries({ queryKey: ['sql', 'datasources'] }) } })
  const remove = useMutation({ mutationFn: sqlApi.deleteDataSource, onSuccess: () => void client.invalidateQueries({ queryKey: ['sql', 'datasources'] }) })
  const test = useMutation({ mutationFn: sqlApi.testDataSource })
  const columns = useMemo<ColumnDef<DataSource>[]>(() => [
    { accessorKey: 'name', header: '名称', cell: ({ row }) => <div className={styles.primaryCell}><Database size={15} /><span><strong>{row.original.name}</strong><small>{row.original.type}</small></span></div> },
    { header: '连接', cell: ({ row }) => row.original.type === 'sqlite' ? row.original.filePath : `${row.original.host}:${row.original.port}` },
    { accessorKey: 'database', header: '数据库' },
    { id: 'actions', header: '', cell: ({ row }) => <div className={uiStyles.rowActions}><Button size="small" onClick={() => test.mutate(row.original.id)}><CheckCircle2 size={13} />测试</Button><Button size="small" variant="danger" onClick={() => remove.mutate(row.original.id)}><Trash2 size={13} /></Button></div> },
  ], [remove, test])
  return <><Surface title="数据源" action={<Button size="small" variant="primary" onClick={() => setOpen(true)}><Plus size={14} />新建数据源</Button>}><AsyncState loading={query.isLoading} error={query.error}><DataTable data={query.data ?? []} columns={columns} /></AsyncState></Surface><Dialog open={open} onOpenChange={setOpen} title="新建数据源" footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" onClick={() => create.mutate()} disabled={!form.name.trim()}>创建</Button></>}><div className={pageStyles.formGrid}><Field label="名称"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="类型"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SourceForm['type'] })}><option value="mysql">MySQL</option><option value="oracle">Oracle</option><option value="sqlite">SQLite</option><option value="hive">Hive</option></Select></Field>{form.type === 'sqlite' ? <Field label="数据库文件"><Input value={form.filePath} onChange={(e) => setForm({ ...form, filePath: e.target.value })} /></Field> : <><Field label="主机"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field><Field label="端口"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field><Field label="用户"><Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></Field><Field label="密码"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field><Field label="数据库"><Input value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} /></Field></>}</div></Dialog></>
}

export function SqlFilesView() {
  const client = useQueryClient()
  const theme = useShellStore((state) => state.theme)
  const files = useQuery({ queryKey: ['sql', 'files'], queryFn: sqlApi.files })
  const sources = useQuery({ queryKey: ['sql', 'datasources'], queryFn: sqlApi.dataSources })
  const [selected, setSelected] = useState<SqlFile | null>(null)
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('新查询.sql')
  const [sourceId, setSourceId] = useState('')
  useEffect(() => { if (!selected && files.data?.[0]) { setSelected(files.data[0]); setDraft(files.data[0].content); setName(files.data[0].name); setSourceId(files.data[0].datasourceId) } }, [files.data, selected])
  const select = (file: SqlFile) => { setSelected(file); setDraft(file.content); setName(file.name); setSourceId(file.datasourceId) }
  const save = useMutation({ mutationFn: () => selected ? sqlApi.updateFile(selected.id, { name, datasourceId: sourceId, content: draft }) : sqlApi.createFile({ name, datasourceId: sourceId, content: draft }), onSuccess: (file) => { setSelected(file); void client.invalidateQueries({ queryKey: ['sql', 'files'] }) } })
  const remove = useMutation({ mutationFn: sqlApi.deleteFile, onSuccess: () => { setSelected(null); setDraft(''); void client.invalidateQueries({ queryKey: ['sql', 'files'] }) } })
  return <div className={pageStyles.split}><aside className={pageStyles.splitAside}><div className={pageStyles.toolbar}><strong>SQL 文件</strong><Button size="small" onClick={() => { setSelected(null); setName('新查询.sql'); setDraft(''); setSourceId(sources.data?.[0]?.id ?? '') }}><Plus size={14} />新建</Button></div><div className={pageStyles.list}>{files.data?.map((file) => <button key={file.id} type="button" className={`${pageStyles.listItem} ${selected?.id === file.id ? pageStyles.listItemActive : ''}`} onClick={() => select(file)}><span><strong>{file.name}</strong><small>{formatDate(file.updatedAt)}</small></span><FileCode2 size={15} /></button>)}</div></aside><section className={`${pageStyles.splitMain} ${styles.fileEditor}`}><div className={pageStyles.toolbar}><div className={pageStyles.toolbarGroup}><Input value={name} onChange={(e) => setName(e.target.value)} aria-label="SQL 文件名" /><Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="数据源"><option value="">未绑定数据源</option>{sources.data?.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</Select></div><div className={pageStyles.toolbarGroup}>{selected ? <Button size="small" variant="danger" onClick={() => remove.mutate(selected.id)}><Trash2 size={14} /></Button> : null}<Button size="small" variant="primary" onClick={() => save.mutate()} disabled={!name.trim()}><Save size={14} />保存</Button></div></div><Suspense fallback={<div className={pageStyles.loadingPanel}>正在载入 SQL 编辑器</div>}><SqlCodeEditor value={draft} theme={theme} onChange={setDraft} height="100%" /></Suspense></section></div>
}

export function VariablesView() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sql', 'variables'], queryFn: sqlApi.variables })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', valueType: 'static', value: '', datasourceId: '' })
  const create = useMutation({ mutationFn: () => sqlApi.createVariable(form), onSuccess: () => { setOpen(false); setForm({ name: '', valueType: 'static', value: '', datasourceId: '' }); void client.invalidateQueries({ queryKey: ['sql', 'variables'] }) } })
  const remove = useMutation({ mutationFn: sqlApi.deleteVariable, onSuccess: () => void client.invalidateQueries({ queryKey: ['sql', 'variables'] }) })
  const columns = useMemo<ColumnDef<SqlVariable>[]>(() => [{ accessorKey: 'name', header: '变量名', cell: ({ row }) => <code>{`{{${row.original.name}}}`}</code> }, { accessorKey: 'valueType', header: '类型' }, { accessorKey: 'value', header: '值' }, { id: 'actions', header: '', cell: ({ row }) => <div className={uiStyles.rowActions}><Button size="small" variant="danger" onClick={() => remove.mutate(row.original.id)}><Trash2 size={13} /></Button></div> }], [remove])
  return <><Surface title="SQL 变量" action={<Button size="small" variant="primary" onClick={() => setOpen(true)}><Plus size={14} />新建变量</Button>}><AsyncState loading={query.isLoading} error={query.error}><DataTable data={query.data ?? []} columns={columns} /></AsyncState></Surface><Dialog open={open} onOpenChange={setOpen} title="新建变量" footer={<Button variant="primary" onClick={() => create.mutate()} disabled={!form.name.trim()}>创建</Button>}><Field label="变量名"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="值类型"><Select value={form.valueType} onChange={(e) => setForm({ ...form, valueType: e.target.value })}><option value="static">静态值</option><option value="sql">SQL 查询</option></Select></Field><Field label="值"><Textarea value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field></Dialog></>
}

export function ServersView() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sql', 'servers'], queryFn: sqlApi.servers })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', host: '', port: '22', user: '', authType: 'password', password: '', privateKey: '', description: '' })
  const create = useMutation({ mutationFn: () => sqlApi.createServer({ ...form, port: Number(form.port) }), onSuccess: () => { setOpen(false); void client.invalidateQueries({ queryKey: ['sql', 'servers'] }) } })
  const remove = useMutation({ mutationFn: sqlApi.deleteServer, onSuccess: () => void client.invalidateQueries({ queryKey: ['sql', 'servers'] }) })
  const test = useMutation({ mutationFn: sqlApi.testServer })
  const columns = useMemo<ColumnDef<Server>[]>(() => [{ accessorKey: 'name', header: '服务器', cell: ({ row }) => <div className={styles.primaryCell}><ServerIcon size={15} /><span><strong>{row.original.name}</strong><small>{row.original.description}</small></span></div> }, { header: '连接', cell: ({ row }) => `${row.original.user}@${row.original.host}:${row.original.port}` }, { accessorKey: 'authType', header: '认证' }, { id: 'actions', header: '', cell: ({ row }) => <div className={uiStyles.rowActions}><Button size="small" onClick={() => test.mutate(row.original.id)}>测试</Button><Button size="small" variant="danger" onClick={() => remove.mutate(row.original.id)}><Trash2 size={13} /></Button></div> }], [remove, test])
  return <><Surface title="远程服务器" action={<Button size="small" variant="primary" onClick={() => setOpen(true)}><Plus size={14} />添加服务器</Button>}><AsyncState loading={query.isLoading} error={query.error}><DataTable data={query.data ?? []} columns={columns} /></AsyncState></Surface><Dialog open={open} onOpenChange={setOpen} title="添加服务器" footer={<Button variant="primary" onClick={() => create.mutate()} disabled={!form.name || !form.host}>添加</Button>}><div className={pageStyles.formGrid}><Field label="名称"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="主机"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field><Field label="端口"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field><Field label="用户"><Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></Field><Field label="认证"><Select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })}><option value="password">密码</option><option value="privateKey">私钥</option></Select></Field><Field label={form.authType === 'password' ? '密码' : '私钥'}>{form.authType === 'password' ? <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /> : <Textarea value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} />}</Field></div></Dialog></>
}

export function ShellFilesView() {
  const client = useQueryClient()
  const files = useQuery({ queryKey: ['sql', 'shell-files'], queryFn: sqlApi.shellFiles })
  const servers = useQuery({ queryKey: ['sql', 'servers'], queryFn: sqlApi.servers })
  const [selected, setSelected] = useState<ShellFile | null>(null)
  const [form, setForm] = useState({ name: '', serverId: '', content: '', description: '' })
  const select = (file: ShellFile) => { setSelected(file); setForm({ name: file.name, serverId: file.serverId, content: file.content, description: file.description }) }
  const save = useMutation({ mutationFn: () => selected ? sqlApi.updateShellFile(selected.id, form) : sqlApi.createShellFile(form), onSuccess: (file) => { setSelected(file); void client.invalidateQueries({ queryKey: ['sql', 'shell-files'] }) } })
  const execute = useMutation({ mutationFn: () => selected ? sqlApi.executeShellFile(selected.id) : Promise.reject(new Error('请先保存文件')) })
  const remove = useMutation({ mutationFn: sqlApi.deleteShellFile, onSuccess: () => { setSelected(null); setForm({ name: '', serverId: '', content: '', description: '' }); void client.invalidateQueries({ queryKey: ['sql', 'shell-files'] }) } })
  return <div className={pageStyles.split}><aside className={pageStyles.splitAside}><div className={pageStyles.toolbar}><strong>Shell 文件</strong><Button size="small" onClick={() => { setSelected(null); setForm({ name: '', serverId: servers.data?.[0]?.id ?? '', content: '', description: '' }) }}><Plus size={14} />新建</Button></div><div className={pageStyles.list}>{files.data?.map((file) => <button key={file.id} type="button" className={`${pageStyles.listItem} ${selected?.id === file.id ? pageStyles.listItemActive : ''}`} onClick={() => select(file)}><span><strong>{file.name}</strong><small>{file.description || formatDate(file.updatedAt)}</small></span><FileCode2 size={15} /></button>)}</div></aside><section className={pageStyles.splitMain}><div className={pageStyles.detail}><div className={pageStyles.formGrid}><Field label="名称"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="服务器"><Select value={form.serverId} onChange={(e) => setForm({ ...form, serverId: e.target.value })}><option value="">选择服务器</option>{servers.data?.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</Select></Field><Field label="说明"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><Field label="脚本内容"><Textarea className={styles.shellEditor} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field></div><div className={styles.editorActions}>{selected ? <Button variant="danger" onClick={() => remove.mutate(selected.id)}><Trash2 size={14} />删除</Button> : null}<Button onClick={() => execute.mutate()} disabled={!selected}><Play size={14} />运行</Button><Button variant="primary" onClick={() => save.mutate()} disabled={!form.name || !form.serverId}><Save size={14} />保存</Button></div>{execute.data ? <pre className={pageStyles.codeBlock}>{JSON.stringify(execute.data, null, 2)}</pre> : null}</div></section></div>
}

export function WorkspaceOverviewStat({ repositories }: { repositories: Repository[] }) {
  return <div>{repositories.length}</div>
}
