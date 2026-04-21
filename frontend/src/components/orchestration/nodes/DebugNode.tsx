import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type DebugNodeData = Node<OrchestrationNode, 'debug'>

export function DebugNode({ data, selected }: NodeProps<DebugNodeData>) {
  const threshold = data.thresholdOperator && data.thresholdValue
    ? `${data.thresholdOperator} ${data.thresholdValue}`
    : null
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        {data.datasourceId || '未选择数据源'}
      </div>
      {threshold && (
        <div style={{ color: 'var(--fg-4)', fontSize: 8 }}>阈值: {threshold}</div>
      )}
    </BaseNode>
  )
}
