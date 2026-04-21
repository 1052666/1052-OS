import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { config } from '../../config.js'
import { testConnection, executeDbQuery } from './sql.client.js'
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
} from './sql.types.js'

const DS_DIR = 'sql-datasources'
const FILE_DIR = 'sql-files'
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

function isReadOnly(sql: string): boolean {
  const normalized = sql.trimStart().toLowerCase()
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
