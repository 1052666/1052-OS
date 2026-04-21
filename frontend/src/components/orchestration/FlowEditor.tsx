import { useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowProvider,
  type OnSelectionChangeFunc,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { SqlNode } from './nodes/SqlNode'
import { DebugNode } from './nodes/DebugNode'
import { LoadNode } from './nodes/LoadNode'
import { WaitNode } from './nodes/WaitNode'
import { CustomEdge } from './edges/CustomEdge'
import { CustomConnectionLine } from './edges/CustomConnectionLine'
import { useOrchestrationEditor } from './hooks/useOrchestrationEditor'
import type { Orchestration } from '../../api/orchestration'

const nodeTypes = {
  sql: SqlNode,
  debug: DebugNode,
  load: LoadNode,
  wait: WaitNode,
}

const edgeTypes = { custom: CustomEdge }

function FlowEditorInner({
  onSelectNode,
  editorHook,
}: {
  orch: Orchestration
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  editorHook: ReturnType<typeof useOrchestrationEditor>
}) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = editorHook

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selNodes }) => {
    if (selNodes.length === 1) onSelectNode(selNodes[0].id)
    else onSelectNode(null)
  }, [onSelectNode])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={CustomConnectionLine}
        defaultEdgeOptions={{ type: 'custom' }}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        deleteKeyCode={['Backspace', 'Delete']}
        className="orch-rf-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--fg-5)" />
        <Controls className="orch-rf-controls" />
        <MiniMap
          className="orch-rf-minimap"
          nodeStrokeWidth={2}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}

export function FlowEditor(props: {
  orch: Orchestration
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  editorHook: ReturnType<typeof useOrchestrationEditor>
}) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  )
}
