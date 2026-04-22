import type { OrchestrationNode } from '../../../api/orchestration'
import type { Server, ShellFile } from '../../../api/sql'
import { FormField } from './FormField'

export function ShellNodeConfig({
  node,
  servers,
  shellFiles,
  onChange,
}: {
  node: OrchestrationNode
  servers: Server[]
  shellFiles: ShellFile[]
  onChange: (updates: Partial<OrchestrationNode>) => void
}) {
  return (
    <>
      <FormField label="节点名称">
        <input className="orch-drawer-input" value={node.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormField>
      <FormField label="目标服务器">
        <select className="orch-drawer-select" value={node.serverId ?? ''} onChange={(e) => onChange({ serverId: e.target.value })}>
          <option value="">本地执行</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
        </select>
      </FormField>
      <FormField label="导入脚本文件">
        <select className="orch-drawer-select" value={node.shellFileId ?? ''}
          onChange={(e) => {
            if (!e.target.value) return
            const file = shellFiles.find((f) => f.id === e.target.value)
            if (file) onChange({ shellContent: file.content, serverId: file.serverId, shellFileId: file.id })
          }}>
          <option value="">选择文件</option>
          {shellFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </FormField>
      <FormField label="脚本内容">
        <textarea className="orch-drawer-textarea" placeholder="#!/bin/bash&#10;echo hello"
          value={node.shellContent ?? ''} onChange={(e) => onChange({ shellContent: e.target.value })} rows={6}
          style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
      </FormField>
    </>
  )
}
