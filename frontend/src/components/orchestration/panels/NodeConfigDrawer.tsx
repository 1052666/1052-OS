import type { OrchestrationNode } from '../../../api/orchestration'
import type { DataSource, SqlFile } from '../../../api/sql'
import { SqlNodeConfig } from './SqlNodeConfig'
import { DebugNodeConfig } from './DebugNodeConfig'
import { LoadNodeConfig } from './LoadNodeConfig'
import { WaitNodeConfig } from './WaitNodeConfig'

const TYPE_CONFIG: Record<string, { label: string; icon: string; iconBg: string }> = {
  sql:   { label: 'SQL',   icon: 'S', iconBg: '#6366f1' },
  debug: { label: 'Debug', icon: 'D', iconBg: '#f59e0b' },
  load:  { label: '加载',  icon: 'L', iconBg: '#10b981' },
  wait:  { label: 'Wait',  icon: 'W', iconBg: '#64748b' },
}

export function NodeConfigDrawer({
  node,
  datasources,
  sqlFiles,
  onChange,
  onEnableToggle,
  onDelete,
  onClose,
}: {
  node: OrchestrationNode
  datasources: DataSource[]
  sqlFiles: SqlFile[]
  onChange: (updates: Partial<OrchestrationNode>) => void
  onEnableToggle: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const cfg = TYPE_CONFIG[node.type] ?? TYPE_CONFIG.sql

  const renderForm = () => {
    const props = { node, datasources, sqlFiles, onChange }
    switch (node.type) {
      case 'debug': return <DebugNodeConfig {...props} />
      case 'load':  return <LoadNodeConfig {...props} datasources={datasources} />
      case 'wait':  return <WaitNodeConfig {...props} />
      default:      return <SqlNodeConfig {...props} />
    }
  }

  return (
    <div className="orch-drawer">
      <div className="orch-drawer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          <div style={{
            width: 18, height: 18, borderRadius: 4, background: cfg.iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 9, fontWeight: 700,
          }}>{cfg.icon}</div>
          <span style={{ color: 'var(--fg)', fontSize: 12, fontWeight: 600 }}>{cfg.label} 节点配置</span>
        </div>
        <button className="chip small" onClick={onClose}>✕</button>
      </div>
      <div className="orch-drawer-body">{renderForm()}</div>
      <div className="orch-drawer-footer">
        <div className="orch-drawer-toggle">
          <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>启用状态</span>
          <button className={`chip small ${node.enabled ? '' : 'inactive'}`} onClick={onEnableToggle}>
            {node.enabled ? '已启用' : '已禁用'}
          </button>
        </div>
        <button className="chip danger" style={{ width: '100%' }} onClick={onDelete}>删除节点</button>
      </div>
    </div>
  )
}
