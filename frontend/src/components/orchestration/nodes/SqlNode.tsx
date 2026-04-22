import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type SqlNodeData = Node<OrchestrationNode, 'sql'>

export function SqlNode({ data, selected }: NodeProps<SqlNodeData>) {
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        {data.datasourceId || '未选择数据源'}
      </div>
      {data.sql && (
        <div style={{ color: 'var(--fg-4)', fontSize: 8, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
          {data.sql.slice(0, 50)}{data.sql.length > 50 ? '...' : ''}
        </div>
      )}
    </BaseNode>
  )
}
