import Dagre from '@dagrejs/dagre'
import { type Node, type Edge, Position } from '@xyflow/react'
import { useCallback } from 'react'

export function useAutoLayout() {
  const layout = useCallback((nodes: Node[], edges: Edge[]): Node[] => {
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 60 })
    nodes.forEach((node) => {
      g.setNode(node.id, { width: 200, height: 70 })
    })
    edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target)
    })
    Dagre.layout(g)
    return nodes.map((node) => {
      const pos = g.node(node.id)
      return {
        ...node,
        position: { x: pos.x - 100, y: pos.y - 35 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    })
  }, [])
  return layout
}
