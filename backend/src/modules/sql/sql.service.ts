import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { config } from '../../config.js'
import { testConnection, executeDbQuery } from './sql.client.js'
import { exec } from 'node:child_process'
import { Client, type ClientChannel } from 'ssh2'
import type {
  DataSource,
  DataSourceInput,
  SqlFile,
  SqlFileInput,
  QueryResult,
  QueryInput,
  DatabaseType,
  SqlVariable,
  SqlVariableInput,
  Server,
  ServerInput,
  ShellFile,
  ShellFileInput,
  ShellResult,
} from './sql.types.js'

const DS_DIR = 'sql-datasources'
const FILE_DIR = 'sql-files'
const SERVER_DIR = 'sql-servers'
const SHELL_DIR = 'sql-shell-files'
const SHELL_TIMEOUT_MS = 30_000
const VAR_DIR = 'sql-variables'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const QUERY_TIMEOUT_MS = 30_000

const VALID_TYPES: DatabaseType[] = ['mysql', 'oracle', 'sqlite', 'hive']
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  oracle: 1521,
  sqlite: 0,
  hive: 10000,
}

function dsDirPath() {
  return path.join(config.dataDir, DS_DIR)
}

function fileDirPath() {
  return path.join(config.dataDir, FILE_DIR)
}

function varDirPath() {
  return path.join(config.dataDir, VAR_DIR)
}

function serverDirPath() {
  return path.join(config.dataDir, SERVER_DIR)
}

function shellDirPath() {
  return path.join(config.dataDir, SHELL_DIR)
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ─── Data Source CRUD ──────────────────────────────────────

function validateDsInput(input: DataSourceInput, requireAll: boolean): {
  name: string
  type: DatabaseType
  host: string
  port: number
  user: string
  password: string
  database: string
  filePath: string
} {
  const name = normalizeString(input.name)
  const rawType = normalizeString(input.type)
  if (!rawType || !VALID_TYPES.includes(rawType as DatabaseType)) {
    throw new HttpError(400, `数据库类型必须是: ${VALID_TYPES.join(', ')}`)
  }
  const type = rawType as DatabaseType
  const host = normalizeString(input.host)
  const port = normalizeNumber(input.port, DEFAULT_PORTS[type])
  const user = normalizeString(input.user)
  const password = normalizeString(input.password)
  const database = normalizeString(input.database)
  const filePath = normalizeString(input.filePath)

  if (requireAll && !name) throw new HttpError(400, '数据源名称不能为空')

  if (type !== 'sqlite') {
    if (requireAll && !host) throw new HttpError(400, '主机地址不能为空')
  } else {
    if (requireAll && !filePath) throw new HttpError(400, 'SQLite 文件路径不能为空')
  }

  return { name, type, host, port, user, password, database, filePath }
}

async function readDsFile(id: string): Promise<DataSource> {
  const filePath = path.join(dsDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as DataSource
  } catch {
    throw new HttpError(404, `数据源不存在: ${id}`)
  }
}

export async function listDataSources(): Promise<DataSource[]> {
  const dir = dsDirPath()
  try {
    await fs.access(dir)
  } catch {
    return []
  }
  const files = await fs.readdir(dir)
  const items: DataSource[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as DataSource)
    } catch {
      // skip broken files
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getDataSource(id: string): Promise<DataSource> {
  return readDsFile(id)
}

export async function createDataSource(input: DataSourceInput): Promise<DataSource> {
  const validated = validateDsInput(input, true)
  const now = Date.now()
  const item: DataSource = {
    id: createId(),
    ...validated,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(dsDirPath(), { recursive: true })
  await fs.writeFile(
    path.join(dsDirPath(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8',
  )
  return item
}

export async function updateDataSource(
  id: string,
  input: DataSourceInput,
): Promise<DataSource> {
  const current = await readDsFile(id)
  const validated = validateDsInput(input, false)
  const updated: DataSource = {
    ...current,
    name: validated.name || current.name,
    type: validated.type || current.type,
    host: validated.host || current.host,
    port: input.port !== undefined ? validated.port : current.port,
    user: validated.user || current.user,
    password: validated.password || current.password,
    database: validated.database || current.database,
    filePath: validated.filePath || current.filePath,
    updatedAt: Date.now(),
  }
  await fs.writeFile(
    path.join(dsDirPath(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )
  return updated
}

export async function deleteDataSource(id: string) {
  const item = await readDsFile(id)
  await fs.unlink(path.join(dsDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}

export async function testDataSource(id: string) {
  const ds = await readDsFile(id)
  await testConnection({
    type: ds.type,
    host: ds.host,
    port: ds.port,
    user: ds.user,
    password: ds.password,
    database: ds.database,
    filePath: ds.filePath,
  })
  return { ok: true as const }
}

// ─── SQL File CRUD ─────────────────────────────────────────

function validateFileInput(input: SqlFileInput, requireName: boolean): {
  name: string
  datasourceId: string
  content: string
} {
  const name = normalizeString(input.name)
  const datasourceId = normalizeString(input.datasourceId)
  const content = normalizeString(input.content)

  if (requireName && !name) throw new HttpError(400, '文件名不能为空')

  return { name, datasourceId, content }
}

async function readFileEntity(id: string): Promise<SqlFile> {
  const filePath = path.join(fileDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as SqlFile
  } catch {
    throw new HttpError(404, `SQL 文件不存在: ${id}`)
  }
}

export async function listSqlFiles(): Promise<SqlFile[]> {
  const dir = fileDirPath()
  try {
    await fs.access(dir)
  } catch {
    return []
  }
  const files = await fs.readdir(dir)
  const items: SqlFile[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as SqlFile)
    } catch {
      // skip broken files
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getSqlFile(id: string): Promise<SqlFile> {
  return readFileEntity(id)
}

export async function createSqlFile(input: SqlFileInput): Promise<SqlFile> {
  const validated = validateFileInput(input, true)
  const now = Date.now()
  const item: SqlFile = {
    id: createId(),
    ...validated,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(fileDirPath(), { recursive: true })
  await fs.writeFile(
    path.join(fileDirPath(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8',
  )
  return item
}

export async function updateSqlFile(id: string, input: SqlFileInput): Promise<SqlFile> {
  const current = await readFileEntity(id)
  const validated = validateFileInput(input, false)
  const updated: SqlFile = {
    ...current,
    name: validated.name || current.name,
    datasourceId: validated.datasourceId || current.datasourceId,
    content: input.content !== undefined ? validated.content : current.content,
    updatedAt: Date.now(),
  }
  await fs.writeFile(
    path.join(fileDirPath(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )
  return updated
}

export async function deleteSqlFile(id: string) {
  const item = await readFileEntity(id)
  await fs.unlink(path.join(fileDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}

// ─── Query Execution ───────────────────────────────────────

const READ_ONLY_PREFIXES = ['select', 'show', 'describe', 'explain', 'with']

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim()
}

function isReadOnly(sql: string): boolean {
  const cleaned = stripComments(sql)
  if (!cleaned) return false
  const normalized = cleaned.toLowerCase()
  return READ_ONLY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function hasLimit(sql: string, dbType?: DatabaseType): boolean {
  const normalized = sql.toLowerCase()
  if (/\blimit\s+\d+/i.test(normalized)) return true
  if (dbType === 'oracle' && /\bfetch\s+(first|next)\s+\d+\s+rows?\s+only\b/i.test(normalized)) return true
  if (dbType === 'oracle' && /\brownum\s*<=\s*\d+/i.test(normalized)) return true
  return false
}

function appendLimit(sql: string, limit: number, dbType: DatabaseType): string {
  if (dbType === 'oracle') {
    // Oracle 11g doesn't support FETCH FIRST, Python fetchmany handles row limit
    return sql.trimEnd().replace(/;$/, '')
  }
  const trimmed = sql.trimEnd().replace(/;$/, '')
  return `${trimmed} LIMIT ${limit}`
}

export async function executeQuery(input: QueryInput): Promise<QueryResult> {
  const datasourceId = normalizeString(input.datasourceId)
  let sql = normalizeString(input.sql)
  const limit = Math.min(
    Math.max(normalizeNumber(input.limit, DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  )

  if (!datasourceId) throw new HttpError(400, '数据源 ID 不能为空')
  if (!sql) throw new HttpError(400, 'SQL 不能为空')

  // Resolve ${var_name} placeholders
  sql = await resolveVariables(sql)

  if (!isReadOnly(sql)) throw new HttpError(400, '只允许执行 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH 查询')

  const ds = await readDsFile(datasourceId)
  const finalSql = hasLimit(sql, ds.type) ? sql : appendLimit(sql, limit, ds.type)

  const result = await Promise.race([
    executeDbQuery(
      {
        type: ds.type,
        host: ds.host,
        port: ds.port,
        user: ds.user,
        password: ds.password,
        database: ds.database,
        filePath: ds.filePath,
      },
      finalSql,
      limit,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new HttpError(504, '查询超时 (30s)')), QUERY_TIMEOUT_MS),
    ),
  ])

  return result
}

// ─── Variable Resolution ──────────────────────────────────────

const VAR_PATTERN = /\$\{(\w+)\}/g

export async function resolveVariables(sql: string): Promise<string> {
  const matches = [...sql.matchAll(VAR_PATTERN)]
  if (matches.length === 0) return sql

  const vars = await listVariables()
  const varMap = new Map(vars.map((v) => [v.name, v]))

  let result = sql
  for (const match of matches) {
    const varName = match[1]
    const variable = varMap.get(varName)
    if (!variable) continue

    let resolvedValue: string
    if (variable.valueType === 'static') {
      resolvedValue = variable.value
    } else {
      // SQL type: execute the query to get the value
      if (!variable.datasourceId) continue
      resolvedValue = await resolveSqlVariable(variable)
    }

    result = result.replaceAll(`\${${varName}}`, resolvedValue)
  }
  return result
}

async function resolveSqlVariable(variable: SqlVariable): Promise<string> {
  const ds = await readDsFile(variable.datasourceId)
  const result = await Promise.race([
    executeDbQuery(
      {
        type: ds.type,
        host: ds.host,
        port: ds.port,
        user: ds.user,
        password: ds.password,
        database: ds.database,
        filePath: ds.filePath,
      },
      variable.value,
      2,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new HttpError(504, '变量查询超时 (30s)')), QUERY_TIMEOUT_MS),
    ),
  ])
  if (result.rows.length === 0) return ''
  const firstRow = result.rows[0]
  const firstCol = result.columns[0]
  return String(firstRow[firstCol] ?? '')
}

// ─── Server CRUD ──────────────────────────────────────────

function validateServerInput(input: ServerInput, requireAll: boolean): {
  name: string
  host: string
  port: number
  user: string
  authType: 'password' | 'privateKey'
  password: string
  privateKey: string
  description: string
} {
  const name = normalizeString(input.name)
  const host = normalizeString(input.host)
  const port = normalizeNumber(input.port, 22)
  const user = normalizeString(input.user)
  const rawAuthType = normalizeString(input.authType)
  if (rawAuthType && rawAuthType !== 'password' && rawAuthType !== 'privateKey') {
    throw new HttpError(400, '认证类型必须是 password 或 privateKey')
  }
  const authType = (rawAuthType || 'password') as 'password' | 'privateKey'
  const password = normalizeString(input.password)
  const privateKey = normalizeString(input.privateKey)
  const description = normalizeString(input.description)

  if (requireAll && !name) throw new HttpError(400, '服务器名称不能为空')
  if (requireAll && !host) throw new HttpError(400, '主机地址不能为空')

  return { name, host, port, user, authType, password, privateKey, description }
}

async function readServerFile(id: string): Promise<Server> {
  const filePath = path.join(serverDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as Server
  } catch {
    throw new HttpError(404, `服务器不存在: ${id}`)
  }
}

export async function listServers(): Promise<Server[]> {
  const dir = serverDirPath()
  try {
    await fs.access(dir)
  } catch {
    return []
  }
  const files = await fs.readdir(dir)
  const items: Server[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as Server)
    } catch { /* skip broken files */ }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getServer(id: string): Promise<Server> {
  return readServerFile(id)
}

export async function createServer(input: ServerInput): Promise<Server> {
  const validated = validateServerInput(input, true)
  const now = Date.now()
  const item: Server = {
    id: createId(),
    ...validated,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(serverDirPath(), { recursive: true })
  await fs.writeFile(
    path.join(serverDirPath(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8',
  )
  return item
}

export async function updateServer(id: string, input: ServerInput): Promise<Server> {
  const current = await readServerFile(id)
  const validated = validateServerInput(input, false)
  const updated: Server = {
    ...current,
    name: validated.name || current.name,
    host: validated.host || current.host,
    port: input.port !== undefined ? validated.port : current.port,
    user: validated.user || current.user,
    authType: input.authType !== undefined ? validated.authType : current.authType,
    password: validated.password || current.password,
    privateKey: validated.privateKey || current.privateKey,
    description: input.description !== undefined ? validated.description : current.description,
    updatedAt: Date.now(),
  }
  await fs.writeFile(
    path.join(serverDirPath(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )
  return updated
}

export async function deleteServer(id: string) {
  const item = await readServerFile(id)
  await fs.unlink(path.join(serverDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}

export async function testServer(id: string) {
  const server = await readServerFile(id)
  const result = await executeShellOnServer(server, 'echo ok')
  if (result.exitCode !== 0) {
    throw new Error(`连接测试失败: ${result.stderr || result.stdout}`)
  }
  return { ok: true as const }
}

// ─── Shell Execution ──────────────────────────────────────

function executeLocalShell(script: string): Promise<ShellResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    exec(script, { timeout: SHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.slice(0, 10_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: error ? 1 : 0,
        duration: Date.now() - start,
      })
    })
  })
}

function executeRemoteShell(server: Server, script: string): Promise<ShellResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const conn = new Client()
    const connectConfig: {
      host: string
      port: number
      username: string
      password?: string
      privateKey?: string | Buffer
      readyTimeout: number
    } = {
      host: server.host,
      port: server.port,
      username: server.user,
      readyTimeout: SHELL_TIMEOUT_MS,
    }
    if (server.authType === 'privateKey') {
      connectConfig.privateKey = server.privateKey
    } else {
      connectConfig.password = server.password
    }

    let stdout = ''
    let stderr = ''

    conn
      .on('ready', () => {
        conn.exec(script, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            conn.end()
            resolve({
              stdout: '',
              stderr: err.message,
              exitCode: -1,
              duration: Date.now() - start,
            })
            return
          }
          stream
            .on('data', (data: Buffer) => { stdout += data.toString() })
            .on('close', (code: number | null) => {
              conn.end()
              resolve({
                stdout: stdout.slice(0, 10_000),
                stderr: stderr.slice(0, 10_000),
                exitCode: code ?? 0,
                duration: Date.now() - start,
              })
            })
            .stderr.on('data', (data: Buffer) => { stderr += data.toString() })
        })
      })
      .on('error', (err: Error) => {
        conn.end()
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: -1,
          duration: Date.now() - start,
        })
      })
      .connect(connectConfig)
  })
}

export async function executeShellOnServer(server: Server, script: string): Promise<ShellResult> {
  return executeRemoteShell(server, script)
}

export async function executeLocal(script: string): Promise<ShellResult> {
  return executeLocalShell(script)
}

// ─── Shell File CRUD ──────────────────────────────────────

function validateShellFileInput(input: ShellFileInput, requireName: boolean): {
  name: string
  serverId: string
  content: string
  description: string
} {
  const name = normalizeString(input.name)
  const serverId = normalizeString(input.serverId)
  const content = normalizeString(input.content)
  const description = normalizeString(input.description)

  if (requireName && !name) throw new HttpError(400, '脚本名称不能为空')

  return { name, serverId, content, description }
}

async function readShellFileEntity(id: string): Promise<ShellFile> {
  const filePath = path.join(shellDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as ShellFile
  } catch {
    throw new HttpError(404, `Shell 脚本不存在: ${id}`)
  }
}

export async function listShellFiles(): Promise<ShellFile[]> {
  const dir = shellDirPath()
  try {
    await fs.access(dir)
  } catch {
    return []
  }
  const files = await fs.readdir(dir)
  const items: ShellFile[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as ShellFile)
    } catch { /* skip broken files */ }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getShellFile(id: string): Promise<ShellFile> {
  return readShellFileEntity(id)
}

export async function createShellFile(input: ShellFileInput): Promise<ShellFile> {
  const validated = validateShellFileInput(input, true)
  const now = Date.now()
  const item: ShellFile = {
    id: createId(),
    ...validated,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(shellDirPath(), { recursive: true })
  await fs.writeFile(
    path.join(shellDirPath(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8',
  )
  return item
}

export async function updateShellFile(id: string, input: ShellFileInput): Promise<ShellFile> {
  const current = await readShellFileEntity(id)
  const validated = validateShellFileInput(input, false)
  const updated: ShellFile = {
    ...current,
    name: validated.name || current.name,
    serverId: input.serverId !== undefined ? validated.serverId : current.serverId,
    content: input.content !== undefined ? validated.content : current.content,
    description: input.description !== undefined ? validated.description : current.description,
    updatedAt: Date.now(),
  }
  await fs.writeFile(
    path.join(shellDirPath(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )
  return updated
}

export async function deleteShellFile(id: string) {
  const item = await readShellFileEntity(id)
  await fs.unlink(path.join(shellDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}

export async function executeShellFile(id: string): Promise<ShellResult> {
  const file = await readShellFileEntity(id)
  if (!file.content.trim()) throw new HttpError(400, '脚本内容不能为空')

  if (file.serverId) {
    const server = await readServerFile(file.serverId)
    return executeRemoteShell(server, file.content)
  }
  return executeLocalShell(file.content)
}

// ─── Variable CRUD ────────────────────────────────────────────

function validateVarInput(input: SqlVariableInput, requireAll: boolean): {
  name: string
  valueType: 'static' | 'sql'
  value: string
  datasourceId: string
} {
  const name = normalizeString(input.name)
  const rawType = normalizeString(input.valueType)
  const value = normalizeString(input.value)
  const datasourceId = normalizeString(input.datasourceId)

  if (requireAll && !name) throw new HttpError(400, '变量名不能为空')
  if (rawType && rawType !== 'static' && rawType !== 'sql') {
    throw new HttpError(400, '变量类型必须是 static 或 sql')
  }
  if (requireAll && !rawType) throw new HttpError(400, '变量类型不能为空')

  return {
    name,
    valueType: (rawType || 'static') as 'static' | 'sql',
    value,
    datasourceId,
  }
}

async function readVarFile(id: string): Promise<SqlVariable> {
  const filePath = path.join(varDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as SqlVariable
  } catch {
    throw new HttpError(404, `变量不存在: ${id}`)
  }
}

export async function listVariables(): Promise<SqlVariable[]> {
  const dir = varDirPath()
  try {
    await fs.access(dir)
  } catch {
    return []
  }
  const files = await fs.readdir(dir)
  const items: SqlVariable[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as SqlVariable)
    } catch {
      // skip broken files
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createVariable(input: SqlVariableInput): Promise<SqlVariable> {
  const validated = validateVarInput(input, true)
  if (!validated.value && validated.valueType === 'static') {
    throw new HttpError(400, '静态变量的值不能为空')
  }
  if (!validated.value && validated.valueType === 'sql') {
    throw new HttpError(400, 'SQL 变量的查询语句不能为空')
  }
  if (validated.valueType === 'sql' && !validated.datasourceId) {
    throw new HttpError(400, 'SQL 变量必须指定数据源')
  }
  const now = Date.now()
  const item: SqlVariable = {
    id: createId(),
    ...validated,
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(varDirPath(), { recursive: true })
  await fs.writeFile(
    path.join(varDirPath(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8',
  )
  return item
}

export async function updateVariable(id: string, input: SqlVariableInput): Promise<SqlVariable> {
  const current = await readVarFile(id)
  const validated = validateVarInput(input, false)
  const updated: SqlVariable = {
    ...current,
    name: validated.name || current.name,
    valueType: input.valueType !== undefined ? validated.valueType : current.valueType,
    value: input.value !== undefined ? validated.value : current.value,
    datasourceId: validated.datasourceId || current.datasourceId,
    updatedAt: Date.now(),
  }
  await fs.writeFile(
    path.join(varDirPath(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )
  return updated
}

export async function deleteVariable(id: string) {
  const item = await readVarFile(id)
  await fs.unlink(path.join(varDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}
