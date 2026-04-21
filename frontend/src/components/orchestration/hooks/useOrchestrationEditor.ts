import { useCallback, useState } from 'react'
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
} from '@xyflow/react'
import {
  type Orchestration,
  type OrchestrationNode,
  type OrchestrationEdge,
} from '../../../api/orchestration'

export type OrchNodeType = 'sql' | 'debug' | 'load' | 'wait'

function nid() { return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }

function toRfNode(n: OrchestrationNode): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 0, y: 0 },
    data: { ...n },
  }
}

function toOrchNode(n: Node): OrchestrationNode {
  const d = n.data as OrchestrationNode
  return { ...d, id: n.id, type: d.type, position: { x: n.position.x, y: n.position.y } }
}

function toRfEdge(e: OrchestrationEdge): Edge {
  return { id: e.id, source: e.source, target: e.target, type: 'custom' }
}

export function useOrchestrationEditor(orch: Orchestration) {
  const [nodes, setNodes] = useState<Node[]>(() => orch.nodes.map(toRfNode))
  const [edges, setEdges] = useState<Edge[]>(() => orch.edges.map(toRfEdge))

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  const onConnect: OnConnect = useCallback((connection) => {
    setEdges((eds) => rfAddEdge({ ...connection, type: 'custom' }, eds))
  }, [])

  const addNode = useCallback((type: OrchNodeType) => {
    const offset = Math.random() * 300
    const nameMap: Record<OrchNodeType, string> = { sql: 'SQL 节点', debug: 'Debug 节点', load: '加载节点', wait: 'Wait 节点' }
    const newNode: OrchestrationNode = {
      id: nid(),
      name: nameMap[type],
      type,
      datasourceId: '',
      sql: '',
      enabled: true,
      position: { x: 100 + offset, y: 100 + offset },
      ...(type === 'load' ? { targetDatasourceId: '', targetTable: '', mode: 'insert' as const } : {}),
      ...(type === 'wait' ? { waitIntervalSec: 60, waitTimeoutSec: 1800, waitStableCount: 2 } : {}),
    }
    setNodes((nds) => [...nds, toRfNode(newNode)])
  }, [])

  const removeNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
  }, [])

  const updateNodeData = useCallback((nodeId: string, updates: Partial<OrchestrationNode>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...(n.data as OrchestrationNode), ...updates } } : n
      )
    )
  }, [])

  const removeEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
  }, [])

  const toPayload = useCallback((): Pick<Orchestration, 'nodes' | 'edges'> => ({
    nodes: nodes.map(toOrchNode),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  }), [nodes, edges])

  const resetFrom = useCallback((newOrch: Orchestration) => {
    setNodes(newOrch.nodes.map(toRfNode))
    setEdges(newOrch.edges.map(toRfEdge))
  }, [])

  return {
    nodes, edges,
    setNodes, setEdges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, removeNode, updateNodeData, removeEdge,
    toPayload, resetFrom,
  }
}
