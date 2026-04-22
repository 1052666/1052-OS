import {
  listDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
  listSqlFiles,
  createSqlFile,
  updateSqlFile,
  deleteSqlFile,
  executeQuery,
} from '../../sql/sql.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function maskPassword(ds: { password?: string }) {
  return ds.password ? '****' : ''
}

export const sqlTools: AgentTool[] = [
  // ─── Data Source CRUD ──────────────────────────────────
  {
    name: 'sql_datasource_list',
    description: '列出所有已配置的 SQL 数据源。只读。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      const items = await listDataSources()
      return {
        datasources: items.map((ds) => ({
          id: ds.id,
          name: ds.name,
          type: ds.type,
          host: ds.host,
          port: ds.port,
          database: ds.database,
          filePath: ds.filePath,
          user: ds.user,
          password: maskPassword(ds),
        })),
      }
    },
  },
  {
    name: 'sql_datasource_create',
    description: '创建一个新的 SQL 数据源连接配置。支持 mysql、oracle、sqlite、hive 四种类型。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '数据源名称' },
        type: { type: 'string', enum: ['mysql', 'oracle', 'sqlite', 'hive'], description: '数据库类型' },
        host: { type: 'string', description: '主机地址（sqlite 不需要）' },
        port: { type: 'number', description: '端口号（mysql 默认 3306，oracle 默认 1521，hive 默认 10000）' },
        user: { type: 'string', description: '用户名' },
        password: { type: 'string', description: '密码' },
        database: { type: 'string', description: '数据库名（mysql/oracle/hive）' },
        filePath: { type: 'string', description: 'SQLite 数据库文件路径（仅 sqlite 需要）' },
      },
      required: ['name', 'type'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return createDataSource(input)
    },
  },
  {
    name: 'sql_datasource_update',
    description: '更新已有 SQL 数据源的配置。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '数据源 ID' },
        name: { type: 'string', description: '数据源名称' },
        type: { type: 'string', enum: ['mysql', 'oracle', 'sqlite', 'hive'], description: '数据库类型' },
        host: { type: 'string', description: '主机地址' },
        port: { type: 'number', description: '端口号' },
        user: { type: 'string', description: '用户名' },
        password: { type: 'string', description: '密码' },
        database: { type: 'string', description: '数据库名' },
        filePath: { type: 'string', description: 'SQLite 文件路径' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const { id, ...rest } = input
      return updateDataSource(String(id), rest)
    },
  },
  {
    name: 'sql_datasource_delete',
    description: '删除一个 SQL 数据源配置。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '数据源 ID' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return deleteDataSource(String(input.id ?? ''))
    },
  },
  {
    name: 'sql_datasource_test',
    description: '测试 SQL 数据源的连接是否可用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '数据源 ID' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return testDataSource(String(input.id ?? ''))
    },
  },

  // ─── SQL File CRUD ─────────────────────────────────────
  {
    name: 'sql_file_list',
    description: '列出所有 SQL 文件。只读。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      return { files: await listSqlFiles() }
    },
  },
  {
    name: 'sql_file_create',
    description: '创建一个新的 SQL 文件。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名' },
        datasourceId: { type: 'string', description: '绑定的数据源 ID' },
        content: { type: 'string', description: 'SQL 内容' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return createSqlFile(input)
    },
  },
  {
    name: 'sql_file_update',
    description: '更新 SQL 文件的名称、绑定数据源或 SQL 内容。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文件 ID' },
        name: { type: 'string', description: '文件名' },
        datasourceId: { type: 'string', description: '绑定的数据源 ID' },
        content: { type: 'string', description: 'SQL 内容' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const { id, ...rest } = input
      return updateSqlFile(String(id), rest)
    },
  },
  {
    name: 'sql_file_delete',
    description: '删除一个 SQL 文件。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文件 ID' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return deleteSqlFile(String(input.id ?? ''))
    },
  },

  // ─── Query Execution ───────────────────────────────────
  {
    name: 'sql_query',
    description:
      '在指定数据源上执行 SQL 查询。只允许 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH 语句。limit 参数必填，最小 1，最大 500，默认 50。如果没有 LIMIT 子句会自动追加。',
    parameters: {
      type: 'object',
      properties: {
        datasourceId: { type: 'string', description: '数据源 ID' },
        sql: { type: 'string', description: '要执行的 SQL 查询语句' },
        limit: { type: 'number', description: '返回行数限制，默认 50，最大 500' },
      },
      required: ['datasourceId', 'sql'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const limit = typeof input.limit === 'number' ? Math.min(input.limit, 500) : 50
      return executeQuery({
        datasourceId: input.datasourceId,
        sql: input.sql,
        limit,
      })
    },
  },
]
