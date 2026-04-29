import { useState, useEffect } from 'react'
import type { OrchestrationNode, LoopConfig, LoopSubTaskInline, LoopSubTaskReference } from '../../../api/orchestration'
import type { Orchestration } from '../../../api/orchestration'
import { OrchestrationApi } from '../../../api/orchestration'
import type { DataSource, SqlFile, SqlVariable, Server, ShellFile } from '../../../api/sql'
import { FormField } from './FormField'
import { SqlNodeConfig } from './SqlNodeConfig'
import { DebugNodeConfig } from './DebugNodeConfig'
import { LoadNodeConfig } from './LoadNodeConfig'
import { WaitNodeConfig } from './WaitNodeConfig'
import { ShellNodeConfig } from './ShellNodeConfig'

const DEFAULT_LOOP: LoopConfig = {
  variableId: '',
  failureStrategy: 'stop',
  subTask: { mode: 'inline', type: 'sql' },
}

const SUB_TASK_OPTIONS = [
  { key: 'inline-sql',   label: 'SQL',       mode: 'inline' as const, type: 'sql' as const },
  { key: 'inline-debug', label: 'Debug',      mode: 'inline' as const, type: 'debug' as const },
  { key: 'inline-load',  label: '加载',       mode: 'inline' as const, type: 'load' as const },
  { key: 'inline-wait',  label: 'Wait',       mode: 'inline' as const, type: 'wait' as const },
  { key: 'inline-shell', label: 'Shell',      mode: 'inline' as const, type: 'shell' as const },
  { key: 'ref-orch',     label: '编排',       mode: 'reference' as const, refType: 'orchestration' as const },
  { key: 'ref-sql',      label: 'SQL 文件',   mode: 'reference' as const, refType: 'sqlFile' as const },
  { key: 'ref-shell',    label: 'Shell 脚本', mode: 'reference' as const, refType: 'shellFile' as const },
]

export function LoopNodeConfig({
  node, datasources, sqlFiles, servers, shellFiles, variables, onChange,
}: {
  node: OrchestrationNode
  datasources: DataSource[]
  sqlFiles: SqlFile[]
  servers: Server[]
  shellFiles: ShellFile[]
  variables: SqlVariable[]
  onChange: (updates: Partial<OrchestrationNode>) => void
}) {
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  useEffect(() => { OrchestrationApi.list().then(setOrchestrations).catch(() => {}) }, [])

  const loop = node.loop
  const listVars = variables.filter(v => v.valueType === 'sql' || v.isList)
  const loopVarName = loop?.variableId ? (variables.find(v => v.id === loop.variableId)?.name ?? '') : ''

  const updateLoop = (updates: Partial<LoopConfig>) => {
    onChange({ loop: { ...DEFAULT_LOOP, ...loop, ...updates } as LoopConfig })
  }

  const updateSubTask = (updates: Record<string, unknown>) => {
    const current = loop?.subTask ?? DEFAULT_LOOP.subTask
    updateLoop({ subTask: { ...current, ...updates } as LoopSubTaskInline | LoopSubTaskReference })
  }

  const inlineConfigProps = { node, datasources, sqlFiles, onChange }
  const subTask = loop?.subTask ?? DEFAULT_LOOP.subTask

  const getSelectedKey = () => {
    if (subTask.mode === 'inline') return `inline-${subTask.type}`
    return `ref-${(subTask as LoopSubTaskReference).refType}`
  }

  return (
    <>
      <FormField label="节点名称">
        <input className="orch-drawer-input" value={node.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormField>

      <FormField label="循环变量">
        <select className="orch-drawer-select" value={loop?.variableId ?? ''} onChange={(e) => updateLoop({ variableId: e.target.value })}>
          <option value="">选择列表变量</option>
          {listVars.map(v => (
            <option key={v.id} value={v.id}>{v.name} ({v.valueType}{v.isList ? ' / 列表' : ''})</option>
          ))}
        </select>
        <div style={{ color: 'var(--fg-4)', fontSize: 9, marginTop: 2 }}>
          选择返回列表的 SQL 变量，循环节点会按每个值循环执行子任务
        </div>
      </FormField>

      <FormField label="失败策略">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['stop', 'continue'] as const).map(s => (
            <button key={s} className={`chip small ${(loop?.failureStrategy ?? 'stop') === s ? '' : 'inactive'}`}
              onClick={() => updateLoop({ failureStrategy: s })}>
              {s === 'stop' ? '停止' : '继续'}
            </button>
          ))}
        </div>
      </FormField>

      <FormField label="子任务类型">
        <select className="orch-drawer-select" value={getSelectedKey()}
          onChange={(e) => {
            const opt = SUB_TASK_OPTIONS.find(o => o.key === e.target.value)
            if (!opt) return
            if (opt.mode === 'inline') updateSubTask({ mode: 'inline', type: opt.type })
            else updateSubTask({ mode: 'reference', refType: opt.refType, refId: '', variableName: '' })
          }}>
          {SUB_TASK_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </FormField>

      {subTask.mode === 'inline' ? (
        <>
          <div style={{ borderTop: '1px solid var(--hairline)', margin: '6px 0' }} />
          {subTask.type === 'sql' && <SqlNodeConfig {...inlineConfigProps} />}
          {subTask.type === 'debug' && <DebugNodeConfig {...inlineConfigProps} />}
          {subTask.type === 'load' && <LoadNodeConfig node={node} datasources={datasources} onChange={onChange} />}
          {subTask.type === 'wait' && <WaitNodeConfig {...inlineConfigProps} />}
          {subTask.type === 'shell' && <ShellNodeConfig node={node} servers={servers} shellFiles={shellFiles} onChange={onChange} />}
        </>
      ) : (
        <>
          {(subTask as LoopSubTaskReference).refType === 'orchestration' && (
            <>
              <FormField label="选择编排">
                <select className="orch-drawer-select" value={(subTask as LoopSubTaskReference).refId}
                  onChange={(e) => updateSubTask({ refId: e.target.value })}>
                  <option value="">选择编排</option>
                  {orchestrations.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="传递变量名">
                <input className="orch-drawer-input" placeholder="子编排中的变量名"
                  value={(subTask as LoopSubTaskReference).variableName ?? ''}
                  onChange={(e) => updateSubTask({ variableName: e.target.value })} />
                <div style={{ color: 'var(--fg-4)', fontSize: 9, marginTop: 2 }}>
                  循环变量的值会注入到子编排中此变量名的位置
                </div>
              </FormField>
            </>
          )}

          {(subTask as LoopSubTaskReference).refType === 'sqlFile' && (
            <>
              <FormField label="选择 SQL 文件">
                <select className="orch-drawer-select" value={(subTask as LoopSubTaskReference).refId}
                  onChange={(e) => updateSubTask({ refId: e.target.value })}>
                  <option value="">选择文件</option>
                  {sqlFiles.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="数据源（执行用）">
                <select className="orch-drawer-select" value={node.datasourceId}
                  onChange={(e) => onChange({ datasourceId: e.target.value })}>
                  <option value="">选择数据源</option>
                  {datasources.map(ds => (
                    <option key={ds.id} value={ds.id}>{ds.name} ({ds.type})</option>
                  ))}
                </select>
              </FormField>
            </>
          )}

          {(subTask as LoopSubTaskReference).refType === 'shellFile' && (
            <>
              <FormField label="选择 Shell 脚本">
                <select className="orch-drawer-select" value={(subTask as LoopSubTaskReference).refId}
                  onChange={(e) => updateSubTask({ refId: e.target.value })}>
                  <option value="">选择脚本</option>
                  {shellFiles.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="目标服务器">
                <select className="orch-drawer-select" value={node.serverId ?? ''}
                  onChange={(e) => onChange({ serverId: e.target.value })}>
                  <option value="">本地执行</option>
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                  ))}
                </select>
              </FormField>
            </>
          )}

          <div style={{ color: 'var(--fg-4)', fontSize: 9, marginTop: 4 }}>
            循环时变量 ${`{`}{loopVarName || '变量名'}${`}`} 会替换为当前值
          </div>
        </>
      )}
    </>
  )
}
