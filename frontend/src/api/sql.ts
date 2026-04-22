import { api } from './client'

export type DataSource = {
  id: string
  name: string
  type: 'mysql' | 'oracle' | 'sqlite' | 'hive'
  host: string
  port: number
  user: string
  password: string
  database: string
  filePath: string
  createdAt: number
  updatedAt: number
}

export type DataSourcePayload = {
  name: string
  type: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  filePath?: string
}

export type SqlFile = {
  id: string
  name: string
  datasourceId: string
  content: string
  createdAt: number
  updatedAt: number
}

export type SqlFilePayload = {
  name: string
  datasourceId?: string
  content?: string
}

export type QueryResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export type SqlVariable = {
  id: string
  name: string
  valueType: 'static' | 'sql'
  value: string
  datasourceId: string
  createdAt: number
  updatedAt: number
}

export type SqlVariablePayload = {
  name: string
  valueType: 'static' | 'sql'
  value: string
  datasourceId?: string
}

export type Server = {
  id: string
  name: string
  host: string
  port: number
  user: string
  authType: 'password' | 'privateKey'
  password: string
  privateKey: string
  description: string
  createdAt: number
  updatedAt: number
}

export type ServerPayload = {
  name: string
  host: string
  port?: number
  user?: string
  authType?: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  description?: string
}

export type ShellFile = {
  id: string
  name: string
  serverId: string
  content: string
  description: string
  createdAt: number
  updatedAt: number
}

export type ShellFilePayload = {
  name: string
  serverId?: string
  content?: string
  description?: string
}

export type ShellResult = {
  stdout: string
  stderr: string
  exitCode: number
  duration: number
}

export const SqlApi = {
  // Data sources
  listDataSources: () => api.get<DataSource[]>('/sql/datasources'),
  createDataSource: (payload: DataSourcePayload) =>
    api.post<DataSource>('/sql/datasources', payload),
  updateDataSource: (id: string, payload: Partial<DataSourcePayload>) =>
    api.put<DataSource>('/sql/datasources/' + encodeURIComponent(id), payload),
  deleteDataSource: (id: string) =>
    api.delete<{ ok: true }>('/sql/datasources/' + encodeURIComponent(id)),
  testConnection: (id: string) =>
    api.post<{ ok: true }>('/sql/datasources/' + encodeURIComponent(id) + '/test', {}),

  // SQL files
  listSqlFiles: () => api.get<SqlFile[]>('/sql/files'),
  createSqlFile: (payload: SqlFilePayload) =>
    api.post<SqlFile>('/sql/files', payload),
  updateSqlFile: (id: string, payload: Partial<SqlFilePayload>) =>
    api.put<SqlFile>('/sql/files/' + encodeURIComponent(id), payload),
  deleteSqlFile: (id: string) =>
    api.delete<{ ok: true }>('/sql/files/' + encodeURIComponent(id)),

  // Query
  executeQuery: (datasourceId: string, sql: string, limit?: number) =>
    api.post<QueryResult>('/sql/query', { datasourceId, sql, limit }),

  // Variables
  listVariables: () => api.get<SqlVariable[]>('/sql/variables'),
  createVariable: (payload: SqlVariablePayload) =>
    api.post<SqlVariable>('/sql/variables', payload),
  updateVariable: (id: string, payload: Partial<SqlVariablePayload>) =>
    api.put<SqlVariable>('/sql/variables/' + encodeURIComponent(id), payload),
  deleteVariable: (id: string) =>
    api.delete<{ ok: true }>('/sql/variables/' + encodeURIComponent(id)),

  // Servers
  listServers: () => api.get<Server[]>('/sql/servers'),
  createServer: (payload: ServerPayload) =>
    api.post<Server>('/sql/servers', payload),
  updateServer: (id: string, payload: Partial<ServerPayload>) =>
    api.put<Server>('/sql/servers/' + encodeURIComponent(id), payload),
  deleteServer: (id: string) =>
    api.delete<{ ok: true }>('/sql/servers/' + encodeURIComponent(id)),
  testServer: (id: string) =>
    api.post<{ ok: true }>('/sql/servers/' + encodeURIComponent(id) + '/test', {}),

  // Shell Files
  listShellFiles: () => api.get<ShellFile[]>('/sql/shell-files'),
  createShellFile: (payload: ShellFilePayload) =>
    api.post<ShellFile>('/sql/shell-files', payload),
  updateShellFile: (id: string, payload: Partial<ShellFilePayload>) =>
    api.put<ShellFile>('/sql/shell-files/' + encodeURIComponent(id), payload),
  deleteShellFile: (id: string) =>
    api.delete<{ ok: true }>('/sql/shell-files/' + encodeURIComponent(id)),
  executeShellFile: (id: string) =>
    api.post<ShellResult>('/sql/shell-files/' + encodeURIComponent(id) + '/execute', {}),
}
