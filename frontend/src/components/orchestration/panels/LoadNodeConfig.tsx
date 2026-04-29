import type { OrchestrationNode, ColumnMapping } from '../../../api/orchestration'
import type { DataSource } from '../../../api/sql'
import { FormField } from './FormField'

export function LoadNodeConfig({
  node, datasources, onChange,
}: {
  node: OrchestrationNode; datasources: DataSource[]
  onChange: (updates: Partial<OrchestrationNode>) => void
}) {
  const mappings = node.columnMappings ?? []
  const addMapping = () => onChange({ columnMappings: [...mappings, { source: '', target: '' }] })
  const updateMapping = (idx: number, updates: Partial<ColumnMapping>) => {
    const next = mappings.map((m, i) => i === idx ? { ...m, ...updates } : m)
    onChange({ columnMappings: next })
  }
  const removeMapping = (idx: number) => {
    onChange({ columnMappings: mappings.filter((_, i) => i !== idx) })
  }

  return (
    <>
      <FormField label="节点名称">
        <input className="orch-drawer-input" value={node.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormField>
      <FormField label="源数据源">
        <select className="orch-drawer-select" value={node.datasourceId} onChange={(e) => onChange({ datasourceId: e.target.value })}>
          <option value="">选择源</option>
          {datasources.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
        </select>
      </FormField>
      <FormField label="目标数据源">
        <select className="orch-drawer-select" value={node.targetDatasourceId ?? ''} onChange={(e) => onChange({ targetDatasourceId: e.target.value })}>
          <option value="">选择目标</option>
          {datasources.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
        </select>
      </FormField>
      <FormField label="目标表">
        <input className="orch-drawer-input" placeholder="table_name" value={node.targetTable ?? ''} onChange={(e) => onChange({ targetTable: e.target.value })} />
      </FormField>
      <FormField label="写入模式">
        <select className="orch-drawer-select" value={node.mode ?? 'insert'} onChange={(e) => onChange({ mode: e.target.value as OrchestrationNode['mode'] })}>
          <option value="insert">INSERT 追加</option>
          <option value="replace">REPLACE 替换</option>
          <option value="truncate_insert">清空+INSERT</option>
        </select>
      </FormField>
      <FormField label="分区字段">
        <input className="orch-drawer-input" placeholder="如: dt, region (逗号分隔)" value={node.partitionColumns ?? ''} onChange={(e) => onChange({ partitionColumns: e.target.value })} />
      </FormField>
      <FormField label="字段映射">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mappings.length === 0 && <div style={{ color: 'var(--fg-4)', fontSize: 10 }}>未配置时按同名自动映射</div>}
          {mappings.map((m, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input className="orch-drawer-input" style={{ flex: 1 }} placeholder="源字段" value={m.source}
                onChange={(e) => updateMapping(idx, { source: e.target.value })} />
              <span style={{ color: 'var(--fg-4)' }}>→</span>
              <input className="orch-drawer-input" style={{ flex: 1 }} placeholder="目标字段" value={m.target}
                onChange={(e) => updateMapping(idx, { target: e.target.value })} />
              <button className={`chip small ${m.isPartition ? 'accent' : ''}`} title="分区字段"
                onClick={() => updateMapping(idx, { isPartition: !m.isPartition })}>P</button>
              <button className="chip small danger" onClick={() => removeMapping(idx)}>x</button>
            </div>
          ))}
          <button className="chip small" onClick={addMapping}>+ 添加映射</button>
        </div>
      </FormField>
      <FormField label="SQL 语句（源查询）">
        <textarea className="orch-drawer-textarea" placeholder="SELECT col1, col2 FROM ..." value={node.sql} onChange={(e) => onChange({ sql: e.target.value })} rows={4} />
      </FormField>
    </>
  )
}
