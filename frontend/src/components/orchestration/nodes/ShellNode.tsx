import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type ShellNodeData = Node<OrchestrationNode, 'shell'>

export function ShellNode({ data, selected }: NodeProps<ShellNodeData>) {
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        {data.serverId || '本地执行'}
      </div>
      {data.shellContent && (
        <div style={{ color: 'var(--fg-4)', fontSize: 8, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
          {data.shellContent.slice(0, 50)}{data.shellContent.length > 50 ? '...' : ''}
        </div>
      )}
    </BaseNode>
  )
}
