import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type LoadNodeData = Node<OrchestrationNode, 'load'>

export function LoadNode({ data, selected }: NodeProps<LoadNodeData>) {
  const modeLabel: Record<string, string> = { insert: 'INSERT', replace: 'REPLACE', truncate_insert: '清空+INSERT' }
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        {data.datasourceId || '源'} → {data.targetDatasourceId || '目标'}
      </div>
      <div style={{ color: 'var(--fg-4)', fontSize: 8 }}>
        {modeLabel[data.mode ?? 'insert'] ?? 'INSERT'}
        {data.columnMappings?.length ? ` · ${data.columnMappings.length}列` : ''}
        {data.loopVariableId ? ' · 循环' : ''}
      </div>
    </BaseNode>
  )
}
