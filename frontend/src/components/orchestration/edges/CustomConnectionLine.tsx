import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react'

export function CustomConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition,
    curvature: 0.2,
  })

  return (
    <g>
      <path
        d={edgePath}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeDasharray="6 3"
        opacity={0.6}
      />
    </g>
  )
}
