import '@xyflow/react/dist/style.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import { FilePlus2, LoaderCircle, Play, Save, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Orchestration } from '../../contracts/schemas'
import { orchestrationApi } from '../../data/api'
import { AsyncState, Badge, Button, Field, Input, Select, Surface, Switch, Textarea, uiStyles } from '../../components/ui'
import pageStyles from '../../pages/pages.module.css'
import styles from './automation.module.css'

type OrchestrationNodeData = Record<string, unknown> & {
  label: string
  kind: string
  enabled: boolean
  raw: Record<string, unknown>
}

type FlowNode = Node<OrchestrationNodeData>

const nodeTypes = ['sql', 'debug', 'load', 'wait', 'shell', 'loop'] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function flowNodes(workflow: Orchestration | null): FlowNode[] {
  return (workflow?.nodes ?? []).map((node, index) => {
    const raw = asRecord(node)
    const position = asRecord(raw.position)
    return {
      id: node.id,
      position: {
        x: numberValue(position.x, 80 + (index % 3) * 210),
        y: numberValue(position.y, 80 + Math.floor(index / 3) * 120),
      },
      data: {
        label: node.name,
        kind: node.type,
        enabled: node.enabled,
        raw,
      },
    }
  })
}

function flowEdges(workflow: Orchestration | null): Edge[] {
  return (workflow?.edges ?? []).map((edge) => ({ ...edge, animated: true }))
}

function nodePayload(node: FlowNode) {
  return {
    ...node.data.raw,
    id: node.id,
    name: node.data.label,
    type: node.data.kind,
    enabled: node.data.enabled,
    position: node.position,
  }
}

export default function OrchestrationsView() {
  const client = useQueryClient()
  const workflows = useQuery({ queryKey: ['orchestration'], queryFn: orchestrationApi.list })
  const [selectedId, setSelectedId] = useState('')
  const selected = workflows.data?.find((item) => item.id === selectedId) ?? workflows.data?.[0] ?? null
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [meta, setMeta] = useState({ name: '', description: '' })
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  useEffect(() => {
    setSelectedId((current) => current || workflows.data?.[0]?.id || '')
  }, [workflows.data])
  useEffect(() => {
    setNodes(flowNodes(selected))
    setEdges(flowEdges(selected))
    setMeta({ name: selected?.name ?? '', description: selected?.description ?? '' })
    setSelectedNodeId('')
  }, [selected, setEdges, setNodes])
  const refresh = () => void client.invalidateQueries({ queryKey: ['orchestration'] })
  const create = useMutation({
    mutationFn: () => orchestrationApi.create({ name: '新流程', description: '', nodes: [], edges: [] }),
    onSuccess: (workflow) => { setSelectedId(workflow.id); refresh() },
  })
  const save = useMutation({
    mutationFn: () => selected ? orchestrationApi.update(selected.id, { name: meta.name, description: meta.description, nodes: nodes.map(nodePayload), edges }) : Promise.reject(new Error('没有选中的流程')),
    onSuccess: (workflow) => { setSelectedId(workflow.id); refresh() },
  })
  const remove = useMutation({
    mutationFn: (id: string) => orchestrationApi.remove(id),
    onSuccess: () => { setSelectedId(''); refresh() },
  })
  const execute = useMutation({ mutationFn: (id: string) => orchestrationApi.execute(id), onSuccess: refresh })
  const stop = useMutation({ mutationFn: (id: string) => orchestrationApi.stop(id), onSuccess: refresh })
  const logs = useQuery({ queryKey: ['orchestration', selected?.id, 'logs'], queryFn: () => orchestrationApi.logs(selected!.id), enabled: Boolean(selected?.id), refetchInterval: 6000 })
  const active = useQuery({ queryKey: ['orchestration', selected?.id, 'active'], queryFn: () => orchestrationApi.active(selected!.id), enabled: Boolean(selected?.id), refetchInterval: 5000 })
  const onConnect = useCallback((connection: Connection) => setEdges((current) => addEdge({ ...connection, animated: true }, current)), [setEdges])
  const addNode = (kind: typeof nodeTypes[number]) => {
    const id = `node-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        position: { x: 100 + (current.length % 3) * 190, y: 100 + Math.floor(current.length / 3) * 120 },
        data: { label: `${kind} 节点`, kind, enabled: true, raw: { id, type: kind, datasourceId: '', sql: '', settings: {} } },
      },
    ])
    setSelectedNodeId(id)
  }
  const updateSelectedNode = (patch: Partial<OrchestrationNodeData>) => {
    if (!selectedNode) return
    setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node))
  }
  const removeSelectedNode = () => {
    if (!selectedNode) return
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id))
    setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id))
    setSelectedNodeId('')
  }
  return (
    <div className={styles.flowShell}>
      <aside className={styles.flowList}>
        <div className={pageStyles.toolbar}>
          <strong>流程</strong>
          <Button size="small" aria-label="新建流程" onClick={() => create.mutate()} disabled={create.isPending}><FilePlus2 size={14} /></Button>
        </div>
        <AsyncState loading={workflows.isLoading} error={workflows.error} empty={!workflows.data?.length}>
          <div className={pageStyles.list}>
            {workflows.data?.map((workflow) => (
              <button key={workflow.id} type="button" className={`${pageStyles.listItem} ${selected?.id === workflow.id ? pageStyles.listItemActive : ''}`} onClick={() => setSelectedId(workflow.id)}>
                <span><strong>{workflow.name}</strong><small>{workflow.description || `${workflow.nodes.length} 节点 · ${workflow.edges.length} 连接`}</small></span>
                <Badge>{workflow.nodes.length}</Badge>
              </button>
            ))}
          </div>
        </AsyncState>
      </aside>
      <main className={styles.flowCanvas}>
        <div className={`${pageStyles.toolbar} ${styles.flowToolbar}`}>
          <div className={pageStyles.toolbarGroup}>
            <Input value={meta.name} onChange={(event) => setMeta({ ...meta, name: event.target.value })} aria-label="流程名称" />
            <Badge tone={asRecord(active.data).active ? 'success' : 'default'}>{asRecord(active.data).active ? '运行中' : '空闲'}</Badge>
          </div>
          <div className={`${pageStyles.toolbarGroup} ${styles.flowActions}`}>
            {nodeTypes.map((type) => <Button key={type} size="small" onClick={() => addNode(type)}>{type}</Button>)}
            <Button size="small" aria-label="运行流程" onClick={() => selected && execute.mutate(selected.id)} disabled={!selected || execute.isPending}>{execute.isPending ? <LoaderCircle className={styles.statusWarn} size={13} /> : <Play size={13} />}</Button>
            <Button size="small" aria-label="停止流程" onClick={() => selected && stop.mutate(selected.id)} disabled={!selected}><Square size={13} /></Button>
            <Button size="small" aria-label="保存流程" variant="primary" onClick={() => save.mutate()} disabled={!selected || !meta.name.trim()}><Save size={13} /></Button>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </main>
      <aside className={styles.flowInspector}>
        <div className={pageStyles.toolbar}><strong>检查器</strong>{selected ? <Button size="small" aria-label="删除流程" variant="danger" onClick={() => remove.mutate(selected.id)}><Trash2 size={13} /></Button> : null}</div>
        <div className={styles.inspectorBody}>
          <Field label="描述"><Textarea value={meta.description} onChange={(event) => setMeta({ ...meta, description: event.target.value })} /></Field>
          {selectedNode ? (
            <>
              <Field label="节点名称"><Input value={selectedNode.data.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} /></Field>
              <Field label="节点类型"><Select value={selectedNode.data.kind} onChange={(event) => updateSelectedNode({ kind: event.target.value })}>{nodeTypes.map((type) => <option key={type} value={type}>{type}</option>)}</Select></Field>
              <Field label="启用"><Switch checked={selectedNode.data.enabled} onCheckedChange={(enabled) => updateSelectedNode({ enabled })} label="启用节点" /></Field>
              <Button variant="danger" onClick={removeSelectedNode}><Trash2 size={14} />删除节点</Button>
              <pre className={styles.jsonBox}>{JSON.stringify(selectedNode.data.raw, null, 2)}</pre>
            </>
          ) : (
            <div className={uiStyles.empty}>选择画布节点后查看参数</div>
          )}
          <Surface title="最近日志">
            <AsyncState loading={logs.isLoading} error={logs.error} empty={!logs.data?.length}>
              <pre className={styles.jsonBox}>{JSON.stringify((logs.data ?? []).slice(0, 6), null, 2)}</pre>
            </AsyncState>
          </Surface>
        </div>
      </aside>
    </div>
  )
}
