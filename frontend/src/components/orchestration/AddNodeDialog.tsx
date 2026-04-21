import type { OrchNodeType } from './hooks/useOrchestrationEditor'

const NODE_OPTIONS: { type: OrchNodeType; label: string; desc: string; iconBg: string }[] = [
  { type: 'sql',   label: 'SQL 节点',   desc: '执行 SQL 语句',        iconBg: '#6366f1' },
  { type: 'debug', label: 'Debug 节点',  desc: '执行 SQL + 阈值检查',  iconBg: '#f59e0b' },
  { type: 'load',  label: '加载节点',    desc: '跨数据源数据传输',     iconBg: '#10b981' },
  { type: 'wait',  label: 'Wait 节点',   desc: '轮询等待 + 阈值检查',  iconBg: '#64748b' },
]

export function AddNodeDialog({
  position, onSelect, onClose,
}: {
  position?: { x: number; y: number }
  onSelect: (type: OrchNodeType) => void; onClose: () => void
}) {
  return (
    <div className="orch-add-node-overlay" onClick={onClose}>
      <div className="orch-add-node-dialog"
        style={position ? { position: 'fixed', left: position.x, top: position.y } : {}}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ color: 'var(--fg-3)', fontSize: 10, marginBottom: 6 }}>选择节点类型</div>
        {NODE_OPTIONS.map(({ type, label, desc, iconBg }) => (
          <button key={type} className="orch-add-node-item" onClick={() => onSelect(type)}>
            <div style={{
              width: 24, height: 24, borderRadius: 6, background: iconBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>{type[0].toUpperCase()}</div>
            <div>
              <div style={{ color: 'var(--fg)', fontSize: 11, fontWeight: 600 }}>{label}</div>
              <div style={{ color: 'var(--fg-4)', fontSize: 9 }}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
