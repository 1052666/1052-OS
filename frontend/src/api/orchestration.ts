import { api } from './client'

export type ThresholdOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'

export type ColumnMapping = { source: string; target: string; isPartition?: boolean }

export type OrchestrationNode = {
  id: string
  name: string
  type: 'sql' | 'debug' | 'load' | 'wait' | 'shell'
  datasourceId: string
  sql: string
  sqlFileId?: string
  enabled: boolean
  thresholdOperator?: ThresholdOperator
  thresholdValue?: string
  targetDatasourceId?: string
  targetTable?: string
  mode?: 'insert' | 'replace' | 'truncate_insert'
  columnMappings?: ColumnMapping[]
  partitionColumns?: string
  loopVariableId?: string
  waitIntervalSec?: number
  waitTimeoutSec?: number
  waitStableCount?: number
  serverId?: string
  shellContent?: string
  shellFileId?: string
  position?: { x: number; y: number }
}

export type OrchestrationEdge = {
  id: string
  source: string
  target: string
}

export type Orchestration = {
  id: string
  name: string
  description: string
  nodes: OrchestrationNode[]
  edges: OrchestrationEdge[]
  createdAt: number
  updatedAt: number
}

export type LogEntry = {
  nodeId: string
  nodeName: string
  nodeType: 'sql' | 'debug' | 'load' | 'wait' | 'shell'
  status: 'success' | 'failed' | 'warning' | 'skipped' | 'running'
  sql: string
  affectedRows?: number
  result?: { columns: string[]; rows: Record<string, unknown>[] }
  thresholdPassed?: boolean
  actualValue?: string
  expectedValue?: string
  error?: string
  timestamp: number
  duration: number
}

export type OrchestrationExecution = {
  id: string
  orchestrationId: string
  orchestrationName: string
  status: 'success' | 'failed' | 'warning' | 'running'
  logs: LogEntry[]
  startTime: number
  endTime: number | null
}

type ExecutionProgress = {
  orchestrationId: string
  orchestrationName: string
  status: 'running' | 'success' | 'failed' | 'warning'
  logs: LogEntry[]
  startTime: number
  endTime: number | null
}

export const OrchestrationApi = {
  list: () => api.get<Orchestration[]>('/orchestration'),
  create: (payload: { name: string; description?: string }) =>
    api.post<Orchestration>('/orchestration', payload),
  update: (id: string, payload: Partial<Orchestration>) =>
    api.put<Orchestration>('/orchestration/' + encodeURIComponent(id), payload),
  delete: (id: string) =>
    api.delete<{ ok: true }>('/orchestration/' + encodeURIComponent(id)),
  execute: (orchId: string) =>
    api.post<{ executionId: string }>('/orchestration/' + encodeURIComponent(orchId) + '/execute', {}),
  progress: (orchId: string, execId: string) =>
    api.get<ExecutionProgress>('/orchestration/' + encodeURIComponent(orchId) + '/progress/' + encodeURIComponent(execId)),
  stop: (id: string) =>
    api.post<{ ok: boolean; stopped: boolean }>('/orchestration/' + encodeURIComponent(id) + '/stop', {}),
  listLogs: (id: string) =>
    api.get<OrchestrationExecution[]>('/orchestration/' + encodeURIComponent(id) + '/logs'),
}
