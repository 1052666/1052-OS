export type ThresholdOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'

export type ColumnMapping = { source: string; target: string; isPartition?: boolean }

export type OrchestrationNode = {
  id: string
  name: string
  type: 'sql' | 'debug' | 'load' | 'wait'
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
  waitIntervalSec?: number
  waitTimeoutSec?: number
  waitStableCount?: number
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

export type OrchestrationInput = {
  name?: unknown
  description?: unknown
  nodes?: unknown
  edges?: unknown
}

export type LogEntry = {
  nodeId: string
  nodeName: string
  nodeType: 'sql' | 'debug' | 'load' | 'wait'
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
  status: 'success' | 'failed' | 'warning'
  logs: LogEntry[]
  startTime: number
  endTime: number
}
