import type { OrchestrationNode } from '../../../api/orchestration'
import type { DataSource, SqlFile } from '../../../api/sql'
import { FormField } from './FormField'

export function SqlNodeConfig({
  node,
  datasources,
  sqlFiles,
  onChange,
}: {
  node: OrchestrationNode
  datasources: DataSource[]
  sqlFiles: SqlFile[]
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
          {datasources.map((ds) => <option key={ds.id} value={ds.id}>{ds.name} ({ds.type})</option>)}
        </select>
      </FormField>
      <FormField label="导入SQL文件">
        <select className="orch-drawer-select" value={node.sqlFileId ?? ''}
          onChange={(e) => {
            if (!e.target.value) return
            const file = sqlFiles.find((f) => f.id === e.target.value)
            if (file) onChange({ sql: file.content, datasourceId: file.datasourceId, sqlFileId: file.id })
          }}>
          <option value="">选择文件</option>
          {sqlFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </FormField>
      <FormField label="SQL 语句">
        <textarea className="orch-drawer-textarea" placeholder="SELECT col1, col2 FROM ..."
          value={node.sql} onChange={(e) => onChange({ sql: e.target.value })} rows={6} />
      </FormField>
    </>
  )
}
