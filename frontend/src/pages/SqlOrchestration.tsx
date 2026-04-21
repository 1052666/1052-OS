import { useEffect, useState, useCallback } from 'react'
import { OrchestrationApi, type Orchestration, type OrchestrationNode, type OrchestrationExecution } from '../api/orchestration'
import { SqlApi, type DataSource, type SqlFile } from '../api/sql'
import { FlowEditor } from '../components/orchestration/FlowEditor'
import { useOrchestrationEditor, type OrchNodeType } from '../components/orchestration/hooks/useOrchestrationEditor'
import { useAutoLayout } from '../components/orchestration/hooks/useAutoLayout'
import { Toolbar } from '../components/orchestration/Toolbar'
import { NodeConfigDrawer } from '../components/orchestration/panels/NodeConfigDrawer'
import { LogPanel } from '../components/orchestration/LogPanel'
import { ContextMenu, type MenuItem } from '../components/orchestration/context-menus/ContextMenu'
import { AddNodeDialog } from '../components/orchestration/AddNodeDialog'

const EMPTY_ORCH: Orchestration = { id: '', name: '', description: '', nodes: [], edges: [], createdAt: 0, updatedAt: 0 }

export default function SqlOrchestration() {
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  const [datasources, setDatasources] = useState<DataSource[]>([])
  const [sqlFiles, setSqlFiles] = useState<SqlFile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Orchestration | null>(null)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [execution, setExecution] = useState<OrchestrationExecution | null>(null)
  const [error, setError] = useState('')
  const [logCollapsed, setLogCollapsed] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const editorHook = useOrchestrationEditor(editing ?? EMPTY_ORCH)
  const autoLayout = useAutoLayout()

  // Context menu & add node dialog state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: 'canvas' | 'node'; nodeId?: string } | null>(null)
  const [addNodePos, setAddNodePos] = useState<{ x: number; y: number } | null>(null)
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null)

  const load = async () => {
    try {
      const [orchs, ds, files] = await Promise.all([OrchestrationApi.list(), SqlApi.listDataSources(), SqlApi.listSqlFiles()])
      setOrchestrations(orchs); setDatasources(ds); setSqlFiles(files)
    } catch { setError('加载数据失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const selectedNode = selectedNodeId
    ? editorHook.nodes.find((n) => n.id === selectedNodeId)?.data as OrchestrationNode | undefined
    : null

  // ─── Actions ──────────────────────────────────────────

  const handleSave = async () => {
    if (!editing) return
    setSaving(true); setError('')
    try {
      const payload = editorHook.toPayload()
      if (editing.id) {
        const u = await OrchestrationApi.update(editing.id, { ...editing, ...payload })
        setEditing(u)
        editorHook.resetFrom(u)
      } else {
        const c = await OrchestrationApi.create({ name: editing.name, description: editing.description })
        const u = await OrchestrationApi.update(c.id, { ...editing, ...payload })
        setEditing(u)
        editorHook.resetFrom(u)
      }
      await load()
    } catch { setError('保存失败') }
    finally { setSaving(false) }
  }

  const handleExecute = async () => {
    if (!editing?.id) return
    try { await handleSave() } catch { /* auto-save */ }
    setExecuting(true); setExecution(null); setError(''); setLogCollapsed(false)
    try {
      const { executionId } = await OrchestrationApi.execute(editing.id)
      while (true) {
        const p = await OrchestrationApi.progress(editing.id, executionId)
        setExecution({ id: executionId, orchestrationId: editing.id, orchestrationName: editing.name, status: p.status, logs: p.logs, startTime: p.startTime, endTime: p.endTime })
        if (p.status !== 'running') break
        await new Promise((r) => setTimeout(r, 1000))
      }
      const final = await OrchestrationApi.progress(editing.id, executionId)
      setExecution({ id: executionId, orchestrationId: editing.id, orchestrationName: editing.name, status: final.status, logs: final.logs, startTime: final.startTime, endTime: final.endTime ?? Date.now() })
      if (final.status === 'failed') setError('编排执行失败')
      else if (final.status === 'warning') setError('编排执行完成，但有阈值警告')
    } catch (e) { setError(e instanceof Error ? e.message : '执行失败') }
    finally { setExecuting(false) }
  }

  const handleStop = async () => {
    if (!editing?.id) return
    try { await OrchestrationApi.stop(editing.id); setError('正在停止...') } catch { setError('停止失败') }
  }

  const handleDelete = async (id: string) => {
    try { await OrchestrationApi.delete(id); if (editing?.id === id) setEditing(null); await load() } catch { setError('删除失败') }
  }

  const handleAutoLayout = () => {
    const laid = autoLayout(editorHook.nodes, editorHook.edges)
    editorHook.setNodes(laid)
  }

  // ─── Context menu ──────────────────────────────────

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'canvas' })
  }, [])

  const canvasMenuItems: MenuItem[] = [
    { label: '添加 SQL 节点', action: 'add-sql' },
    { label: '添加 Debug 节点', action: 'add-debug' },
    { label: '添加 Load 节点', action: 'add-load' },
    { label: '添加 Wait 节点', action: 'add-wait' },
    { label: '自动布局', action: 'auto-layout' },
  ]

  const nodeMenuItems: MenuItem[] = [
    { label: '编辑配置', action: 'edit' },
    { label: '启用/禁用', action: 'toggle' },
    { label: '删除节点', action: 'delete', danger: true },
  ]

  const handleCtxSelect = (action: string) => {
    if (action.startsWith('add-')) editorHook.addNode(action.slice(4) as OrchNodeType)
    else if (action === 'auto-layout') handleAutoLayout()
    else if (action === 'edit' && ctxMenu?.nodeId) setSelectedNodeId(ctxMenu.nodeId)
    else if (action === 'toggle' && ctxMenu?.nodeId) {
      const node = editorHook.nodes.find((n) => n.id === ctxMenu.nodeId)
      if (node) editorHook.updateNodeData(ctxMenu.nodeId, { enabled: !(node.data as OrchestrationNode).enabled })
    }
    else if (action === 'delete' && ctxMenu?.nodeId) editorHook.removeNode(ctxMenu.nodeId)
  }

  // ─── Edge insert listener ──────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { edgeId: string; x: number; y: number }
      setInsertEdgeId(detail.edgeId)
      setAddNodePos({ x: detail.x + 200, y: detail.y })
    }
    window.addEventListener('orch-edge-insert', handler)
    return () => window.removeEventListener('orch-edge-insert', handler)
  }, [])

  const handleInsertNode = (type: OrchNodeType) => {
    if (!insertEdgeId) { setAddNodePos(null); return }
    const edge = editorHook.edges.find((e) => e.id === insertEdgeId)
    if (!edge) { setInsertEdgeId(null); setAddNodePos(null); return }
    editorHook.addNode(type)
    const newNodeId = editorHook.nodes[editorHook.nodes.length - 1]?.id
    if (newNodeId) {
      editorHook.removeEdge(insertEdgeId)
      editorHook.setEdges((eds) => [
        ...eds.filter((e) => e.id !== insertEdgeId),
        { id: `e-${Date.now().toString(36)}`, source: edge.source, target: newNodeId, type: 'custom' as const },
        { id: `e-${Date.now().toString(36)}-2`, source: newNodeId, target: edge.target, type: 'custom' as const },
      ])
    }
    setInsertEdgeId(null)
    setAddNodePos(null)
  }

  // ─── Render ───────────────────────────────────────────

  if (loading) return <div className="page"><p>加载中...</p></div>

  if (editing) return (
    <div className="page orch-editor-page" style={{ position: 'relative' }} onContextMenu={handleCanvasContextMenu}>
      <Toolbar
        name={editing.name}
        saving={saving}
        executing={executing}
        hasId={!!editing.id}
        onNameChange={(name) => setEditing({ ...editing, name })}
        onBack={() => { setEditing(null); setExecution(null); setError(''); setSelectedNodeId(null) }}
        onSave={handleSave}
        onExecute={handleExecute}
        onStop={handleStop}
        onAutoLayout={handleAutoLayout}
        onAddNode={(type) => editorHook.addNode(type)}
      />
      {error && <div className="orch-error">{error}</div>}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <FlowEditor
          orch={editing}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          editorHook={editorHook}
        />
        {selectedNode && (
          <NodeConfigDrawer
            node={selectedNode}
            datasources={datasources}
            sqlFiles={sqlFiles}
            onChange={(updates) => editorHook.updateNodeData(selectedNodeId!, updates)}
            onEnableToggle={() => editorHook.updateNodeData(selectedNodeId!, { enabled: !selectedNode.enabled })}
            onDelete={() => { editorHook.removeNode(selectedNodeId!); setSelectedNodeId(null) }}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      <LogPanel execution={execution} collapsed={logCollapsed} onToggle={() => setLogCollapsed(!logCollapsed)} />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={ctxMenu.type === 'canvas' ? canvasMenuItems : nodeMenuItems}
          onSelect={handleCtxSelect}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {addNodePos && (
        <AddNodeDialog
          position={addNodePos}
          onSelect={handleInsertNode}
          onClose={() => { setAddNodePos(null); setInsertEdgeId(null) }}
        />
      )}
    </div>
  )

  // ─── List view ────────────────────────────────────────
  return (
    <div className="page">
      <div className="orch-page-header">
        <h1>SQL 编排</h1>
        <button className="chip primary"
          onClick={() => setEditing(EMPTY_ORCH)}>
          + 新建编排
        </button>
      </div>
      {orchestrations.length === 0 ? (
        <div className="sql-var-empty card"><p>暂无编排</p></div>
      ) : (
        <div className="orch-list">
          {orchestrations.map((orch) => (
            <div key={orch.id} className="orch-card card">
              <div className="orch-card-header">
                <h3>{orch.name}</h3>
                <span className="orch-node-count">{orch.nodes.length} 节点</span>
              </div>
              {orch.description && <p className="orch-card-desc">{orch.description}</p>}
              <div className="orch-card-nodes">
                {orch.nodes.map((node) => <span key={node.id} className={`orch-mini-node ${node.type}`}>{node.name}</span>)}
              </div>
              <div className="orch-card-actions">
                <button className="chip" onClick={() => {
                  setEditing(orch); setExecution(null); setError(''); setSelectedNodeId(null)
                  editorHook.resetFrom(orch)
                }}>编辑</button>
                <button className="chip danger" onClick={() => handleDelete(orch.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
