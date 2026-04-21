import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.2,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--accent)' : 'var(--fg-5)',
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="orch-rf-edge-plus"
        >
          <button
            className="orch-rf-edge-btn nodrag nopan"
            title="插入节点"
            onClick={(e) => {
              e.stopPropagation()
              const detail = { edgeId: id, x: labelX, y: labelY }
              window.dispatchEvent(new CustomEvent('orch-edge-insert', { detail }))
            }}
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
