import type { OrchestrationNode, ThresholdOperator } from '../../../api/orchestration'
import type { DataSource, SqlFile } from '../../../api/sql'
import { FormField } from './FormField'

const THRESHOLD_OPTIONS: { value: ThresholdOperator; label: string }[] = [
  { value: 'eq', label: '= 等于' }, { value: 'ne', label: '!= 不等于' },
  { value: 'gt', label: '> 大于' }, { value: 'gte', label: '>= 大于等于' },
  { value: 'lt', label: '< 小于' }, { value: 'lte', label: '<= 小于等于' },
]

export function WaitNodeConfig({
  node, datasources, sqlFiles, onChange,
}: {
  node: OrchestrationNode; datasources: DataSource[]; sqlFiles: SqlFile[]
  onChange: (updates: Partial<OrchestrationNode>) => void
}) {
  return (
    <>
      <FormField label="节点名称">
        <input className="orch-drawer-input" value={node.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormField>
      <FormField label="数据源">
        <select className="orch-drawer-select" value={node.datasourceId} onChange={(e) => onChange({ datasourceId: e.target.value })}>
          <option value="">选择数据源</option>
          {datasources.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
        </select>
      </FormField>
      <FormField label="导入SQL文件">
        <select className="orch-drawer-select" value={node.sqlFileId ?? ''}
          onChange={(e) => { if (!e.target.value) return; const f = sqlFiles.find((x) => x.id === e.target.value); if (f) onChange({ sql: f.content, datasourceId: f.datasourceId, sqlFileId: f.id }) }}>
          <option value="">选择文件</option>
          {sqlFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </FormField>
      <FormField label="SQL 语句">
        <textarea className="orch-drawer-textarea" placeholder="SELECT COUNT(*) ..." value={node.sql} onChange={(e) => onChange({ sql: e.target.value })} rows={4} />
      </FormField>
      <FormField label="轮询间隔（秒）">
        <input className="orch-drawer-input" type="number" min={5} value={node.waitIntervalSec ?? 60} onChange={(e) => onChange({ waitIntervalSec: Number(e.target.value) })} />
      </FormField>
      <FormField label="超时（秒）">
        <input className="orch-drawer-input" type="number" min={10} value={node.waitTimeoutSec ?? 1800} onChange={(e) => onChange({ waitTimeoutSec: Number(e.target.value) })} />
      </FormField>
      <FormField label="稳定次数">
        <input className="orch-drawer-input" type="number" min={2} value={node.waitStableCount ?? 2} onChange={(e) => onChange({ waitStableCount: Number(e.target.value) })} />
      </FormField>
      <FormField label="阈值检查">
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="orch-drawer-select" style={{ flex: 1 }} value={node.thresholdOperator ?? ''}
            onChange={(e) => onChange({ thresholdOperator: (e.target.value || undefined) as ThresholdOperator | undefined })}>
            <option value="">不检查</option>
            {THRESHOLD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input className="orch-drawer-input" style={{ flex: 1 }} placeholder="期望值" value={node.thresholdValue ?? ''}
            onChange={(e) => onChange({ thresholdValue: e.target.value })} />
        </div>
      </FormField>
    </>
  )
}
