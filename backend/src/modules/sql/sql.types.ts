export type DatabaseType = 'mysql' | 'oracle' | 'sqlite' | 'hive'

export type DataSource = {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  user: string
  password: string
  database: string
  filePath: string
  createdAt: number
  updatedAt: number
}

export type DataSourceInput = {
  name?: unknown
  type?: unknown
  host?: unknown
  port?: unknown
  user?: unknown
  password?: unknown
  database?: unknown
  filePath?: unknown
}

export type SqlFile = {
  id: string
  name: string
  datasourceId: string
  content: string
  createdAt: number
  updatedAt: number
}

export type SqlFileInput = {
  name?: unknown
  datasourceId?: unknown
  content?: unknown
}

export type QueryResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export type QueryInput = {
  datasourceId?: unknown
  sql?: unknown
  limit?: unknown
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

export type SqlVariableInput = {
  name?: unknown
  valueType?: unknown
  value?: unknown
  datasourceId?: unknown
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

export type ServerInput = {
  name?: unknown
  host?: unknown
  port?: unknown
  user?: unknown
  authType?: unknown
  password?: unknown
  privateKey?: unknown
  description?: unknown
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

export type ShellFileInput = {
  name?: unknown
  serverId?: unknown
  content?: unknown
  description?: unknown
}

export type ShellResult = {
  stdout: string
  stderr: string
  exitCode: number
  duration: number
}
