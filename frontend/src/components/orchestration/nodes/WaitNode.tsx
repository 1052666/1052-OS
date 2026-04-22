import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type WaitNodeData = Node<OrchestrationNode, 'wait'>

export function WaitNode({ data, selected }: NodeProps<WaitNodeData>) {
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        间隔 {data.waitIntervalSec ?? 60}s / 超时 {data.waitTimeoutSec ?? 1800}s
      </div>
      <div style={{ color: 'var(--fg-4)', fontSize: 8 }}>
        稳定 {data.waitStableCount ?? 2} 次
        {data.thresholdOperator ? ` · 阈值 ${data.thresholdOperator} ${data.thresholdValue}` : ''}
      </div>
    </BaseNode>
  )
}
