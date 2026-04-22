import { type OrchNodeType } from './hooks/useOrchestrationEditor'

const NODE_TYPES: { type: OrchNodeType; label: string }[] = [
  { type: 'sql', label: '+ SQL' },
  { type: 'debug', label: '+ Debug' },
  { type: 'load', label: '+ 加载' },
  { type: 'wait', label: '+ Wait' },
  { type: 'shell', label: '+ Shell' },
]

export function Toolbar({
  name,
  saving,
  executing,
  hasId,
  onNameChange,
  onBack,
  onSave,
  onExecute,
  onStop,
  onAutoLayout,
  onAddNode,
}: {
  name: string
  saving: boolean
  executing: boolean
  hasId: boolean
  onNameChange: (name: string) => void
  onBack: () => void
  onSave: () => void
  onExecute: () => void
  onStop: () => void
  onAutoLayout: () => void
  onAddNode: (type: OrchNodeType) => void
}) {
  return (
    <div className="orch-rf-toolbar">
      <div className="orch-rf-toolbar-left">
        <button className="chip" onClick={onBack}>&larr; 返回</button>
        <input
          className="orch-name-input"
          type="text"
          placeholder="编排名称"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
      <div className="orch-rf-toolbar-right">
        <button className="chip" onClick={onAutoLayout} title="自动布局">⊞ 自动布局</button>
        {NODE_TYPES.map(({ type, label }) => (
          <button key={type} className="chip" onClick={() => onAddNode(type)}>{label}</button>
        ))}
        <button className="chip primary" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        {hasId && !executing && (
          <button className="chip accent" onClick={onExecute}>执行</button>
        )}
        {hasId && executing && (
          <button className="chip danger" onClick={onStop}>停止</button>
        )}
      </div>
    </div>
  )
}
