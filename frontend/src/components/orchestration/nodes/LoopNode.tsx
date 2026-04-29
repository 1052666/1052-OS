import type { NodeProps, Node } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'
import { BaseNode } from './BaseNode'

type LoopNodeData = Node<OrchestrationNode, 'loop'>

const INLINE_LABEL: Record<string, string> = { sql: 'SQL', debug: 'Debug', load: '加载', wait: 'Wait', shell: 'Shell' }
const REF_LABEL: Record<string, string> = { orchestration: '编排', sqlFile: 'SQL文件', shellFile: 'Shell脚本' }

export function LoopNode({ data, selected }: NodeProps<LoopNodeData>) {
  const loop = data.loop
  let subTaskDesc = '未配置'
  if (loop?.subTask.mode === 'inline') {
    subTaskDesc = INLINE_LABEL[loop.subTask.type] ?? loop.subTask.type
  } else if (loop?.subTask.mode === 'reference') {
    subTaskDesc = REF_LABEL[loop.subTask.refType] ?? loop.subTask.refType
  }
  return (
    <BaseNode data={data} selected={!!selected}>
      <div style={{ color: 'var(--fg-3)', fontSize: 9, marginBottom: 2 }}>
        {loop ? `子任务: ${subTaskDesc}` : '未配置子任务'}
      </div>
      {loop?.variableId && (
        <div style={{ color: 'var(--fg-4)', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
          循环变量: {loop.variableId}
        </div>
      )}
    </BaseNode>
  )
}
