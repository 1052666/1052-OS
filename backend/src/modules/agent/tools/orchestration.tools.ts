import {
  listOrchestrations,
  createOrchestration,
  updateOrchestration,
  deleteOrchestration,
  startExecution,
  getExecutionProgress,
  listExecutionLogs,
} from '../../orchestration/orchestration.service.js'
import type { AgentTool } from '../agent.tool.types.js'

export const orchestrationTools: AgentTool[] = [
  {
    name: 'orchestration_list',
    description: '列出所有 SQL 编排。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const items = await listOrchestrations()
      return { orchestrations: items }
    },
  },
  {
    name: 'orchestration_create',
    description: '创建一个新的 SQL 编排。编排由节点(nodes)和连线(edges)组成，支持 SQL 执行和 Debug 验证，支持并行分支。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '编排名称' },
        description: { type: 'string', description: '编排描述' },
        nodes: {
          type: 'array',
          description: '节点列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '节点ID' },
              name: { type: 'string', description: '节点名称' },
              type: { type: 'string', enum: ['sql', 'debug'], description: 'sql=执行SQL, debug=验证查询+阈值检查' },
              datasourceId: { type: 'string', description: '数据源ID' },
              sql: { type: 'string', description: 'SQL语句，支持 ${变量名} 引用变量' },
              enabled: { type: 'boolean', description: '是否启用' },
              position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: '画布位置' },
              thresholdOperator: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'], description: '阈值比较符(仅debug)' },
              thresholdValue: { type: 'string', description: '期望值(仅debug)' },
            },
            required: ['id', 'name', 'type', 'datasourceId', 'sql'],
          },
        },
        edges: {
          type: 'array',
          description: '连线列表，定义节点间的执行依赖关系。一个源节点连多个目标节点时并行执行。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '连线ID' },
              source: { type: 'string', description: '源节点ID' },
              target: { type: 'string', description: '目标节点ID' },
            },
            required: ['id', 'source', 'target'],
          },
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return createOrchestration(input)
    },
  },
  {
    name: 'orchestration_update',
    description: '更新已有编排的名称、描述、节点或连线。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '编排ID' },
        name: { type: 'string', description: '编排名称' },
        description: { type: 'string', description: '编排描述' },
        nodes: { type: 'array', description: '节点列表(完整替换)', items: { type: 'object' } },
        edges: { type: 'array', description: '连线列表(完整替换)', items: { type: 'object' } },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const { id, ...rest } = input
      return updateOrchestration(String(id), rest)
    },
  },
  {
    name: 'orchestration_delete',
    description: '删除一个编排。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '编排ID' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return deleteOrchestration(String(input.id ?? ''))
    },
  },
  {
    name: 'orchestration_execute',
    description: '执行一个编排。按照连线(DAG)拓扑顺序执行节点，无依赖的节点并行执行。支持 SQL 执行、Debug 验证和 Wait 等待。返回执行日志。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '编排ID' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const execId = await startExecution(String(input.id ?? ''))
      // Poll until done (max 30 min)
      for (let i = 0; i < 1800; i++) {
        const p = getExecutionProgress(execId)
        if (p && p.status !== 'running') return p
        await new Promise(r => setTimeout(r, 1000))
      }
      return { error: '等待执行结果超时' }
    },
  },
  {
    name: 'orchestration_logs',
    description: '查看编排的历史执行日志。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '编排ID' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return { logs: await listExecutionLogs(String(input.id ?? '')) }
    },
  },
]
