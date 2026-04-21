import { Handle, Position } from '@xyflow/react'
import type { OrchestrationNode } from '../../../api/orchestration'

const TYPE_CONFIG: Record<string, { label: string; icon: string; bg: string; border: string; iconBg: string }> = {
  sql:   { label: 'SQL',   icon: 'S', bg: 'var(--node-sql-bg)',   border: 'var(--node-sql-border)',   iconBg: '#6366f1' },
  debug: { label: 'Debug', icon: 'D', bg: 'var(--node-debug-bg)', border: 'var(--node-debug-border)', iconBg: '#f59e0b' },
  load:  { label: '加载',  icon: 'L', bg: 'var(--node-load-bg)',  border: 'var(--node-load-border)',  iconBg: '#10b981' },
  wait:  { label: 'Wait',  icon: 'W', bg: 'var(--node-wait-bg)',  border: 'var(--node-wait-border)',  iconBg: '#64748b' },
}

export function BaseNode({ data, selected, children }: {
  data: OrchestrationNode
  selected: boolean
  children: React.ReactNode
}) {
  const cfg = TYPE_CONFIG[data.type] ?? TYPE_CONFIG.sql
  return (
    <div
      className={`orch-rf-node ${data.type} ${selected ? 'selected' : ''} ${!data.enabled ? 'disabled' : ''}`}
      style={{
        background: 'var(--surface-1)',
        border: `1.5px solid ${selected ? cfg.border : 'var(--hairline-2)'}`,
        borderRadius: 'var(--r-md)',
        width: 200,
        fontSize: 11,
        overflow: 'hidden',
        opacity: data.enabled ? 1 : 0.5,
      }}
    >
      <Handle type="target" position={Position.Left} className="orch-rf-handle" />
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          background: cfg.bg, borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: 3, background: cfg.iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 8, fontWeight: 700,
        }}>
          {cfg.icon}
        </div>
        <span style={{ color: 'var(--fg-2)', fontSize: 10, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.name}
        </span>
      </div>
      <div style={{ padding: '6px 10px' }}>{children}</div>
      <Handle type="source" position={Position.Right} className="orch-rf-handle" />
    </div>
  )
}
