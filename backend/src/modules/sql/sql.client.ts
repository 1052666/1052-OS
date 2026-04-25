import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import mysql from 'mysql2/promise'
import BetterSqlite3 from 'better-sqlite3'
import type { DatabaseType, QueryResult } from './sql.types.js'

export type DbConfig = {
  type: DatabaseType
  host: string
  port: number
  user: string
  password: string
  database: string
  filePath: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER_PATH = path.join(__dirname, 'db_runner.py')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

type PythonInput = {
  action: 'test' | 'query'
  config: Record<string, unknown>
  sql?: string
  limit?: number
}

type PythonTestOk = { ok: true }
type PythonQueryOk = QueryResult
type PythonError = { error: string }

function extractShortError(stderr: string): string {
  const lines = stderr.split('\n').filter(l => l.trim())
  return lines.slice(-2).join('\n')
}

function classifyDbError(dbErr: string): string {
  if (dbErr.includes('DPI-1047') || dbErr.includes('Oracle Client')) {
    return 'Oracle 连接失败：未找到 Oracle Instant Client。\n' +
      '请安装 Oracle Instant Client 并配置 ORACLE_CLIENT_PATH 环境变量。'
  }
  if (dbErr.includes("Can't connect") || dbErr.includes('Connection refused') ||
      dbErr.includes('timed out') || dbErr.includes('ORA-12170')) {
    return '数据库连接失败，请检查网络和数据库配置。\n' + dbErr
  }
  if (dbErr.includes('Access denied') || dbErr.includes('authentication') || dbErr.includes('28000')) {
    return '数据库认证失败，请检查用户名和密码'
  }
  return dbErr
}

function classifyNodeDbError(err: unknown, dbType: DatabaseType): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (dbType === 'mysql') {
    if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') || msg.includes('PROTOCOL_CONNECTION_LOST')) {
      return '数据库连接失败，请检查网络和数据库配置。\n' + msg
    }
    if (msg.includes('ACCESS_DENIED') || msg.includes('ER_ACCESS_DENIED_ERROR')) {
      return '数据库认证失败，请检查用户名和密码'
    }
  }
  if (dbType === 'sqlite') {
    if (msg.includes('SQLITE_CANTOPEN') || msg.includes('Unable to open')) {
      return 'SQLite 文件无法打开: ' + msg
    }
    if (msg.includes('SQLITE_NOTADB') || msg.includes('file is not a database')) {
      return 'SQLite 文件格式不正确或已加密'
    }
  }
  return msg
}

// ─── Node.js Native Connectors (MySQL & SQLite) ────────────────

async function testNodeConnection(config: DbConfig): Promise<void> {
  if (config.type === 'mysql') {
    const conn = await mysql.createConnection({
      host: config.host || '127.0.0.1',
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      connectTimeout: 10_000,
    })
    try {
      await conn.execute('SELECT 1')
    } finally {
      await conn.end()
    }
  } else if (config.type === 'sqlite') {
    if (!config.filePath) throw new Error('SQLite filePath is required')
    const db = new BetterSqlite3(config.filePath, { readonly: true })
    try {
      db.prepare('SELECT 1').get()
    } finally {
      db.close()
    }
  }
}

async function executeNodeQuery(
  config: DbConfig,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  if (config.type === 'mysql') {
    return executeMySqlQuery(config, sql, limit)
  }
  if (config.type === 'sqlite') {
    return executeSqliteQuery(config, sql, limit)
  }
  throw new Error(`Unsupported Node.js db type: ${config.type}`)
}

async function executeMySqlQuery(
  config: DbConfig,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  const conn = await mysql.createConnection({
    host: config.host || '127.0.0.1',
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 10_000,
  })
  try {
    const [result] = await conn.execute(sql)
    // DML statements return ResultSetHeader
    if (result && typeof result === 'object' && 'affectedRows' in result) {
      const header = result as mysql.ResultSetHeader
      return {
        columns: ['affectedRows'],
        rows: [{ affectedRows: header.affectedRows }],
        rowCount: 1,
        truncated: false,
      }
    }
    const rows = result as Record<string, unknown>[]
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    const truncated = rows.length > limit
    const trimmedRows = truncated ? rows.slice(0, limit) : rows
    return {
      columns,
      rows: trimmedRows,
      rowCount: trimmedRows.length,
      truncated,
    }
  } finally {
    await conn.end()
  }
}

function executeSqliteQuery(
  config: DbConfig,
  sql: string,
  limit: number,
): QueryResult {
  if (!config.filePath) throw new Error('SQLite filePath is required')
  const db = new BetterSqlite3(config.filePath, { readonly: true })
  try {
    const stmt = db.prepare(sql)
    if (stmt.reader) {
      const allRows = stmt.all() as Record<string, unknown>[]
      const columns = allRows.length > 0 ? Object.keys(allRows[0]) : []
      const truncated = allRows.length > limit
      const rows = truncated ? allRows.slice(0, limit) : allRows
      return { columns, rows, rowCount: rows.length, truncated }
    } else {
      const info = stmt.run()
      return {
        columns: ['affectedRows'],
        rows: [{ affectedRows: info.changes }],
        rowCount: 1,
        truncated: false,
      }
    }
  } finally {
    db.close()
  }
}

function callPython(input: PythonInput): Promise<PythonTestOk | PythonQueryOk> {
  return new Promise((resolve, reject) => {
    const stdin = JSON.stringify(input)
    const proc = execFile(
      'uv',
      ['run', RUNNER_PATH],
      { cwd: PROJECT_ROOT, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = stdout?.trim() || ''
        const err = stderr?.trim() || ''

        // ENOENT → uv 未安装
        if (error?.code === 'ENOENT') {
          reject(new Error(
            'SQL 功能需要 uv（Python 包管理器），当前系统未安装。\n' +
            '安装方法：pip install uv\n' +
            '或访问 https://docs.astral.sh/uv/getting-started/installation/',
          ))
          return
        }

        // killed → 超时
        if (error?.killed) {
          reject(new Error('查询执行超时（30秒），请优化 SQL 或检查数据库连接'))
          return
        }

        // 其他错误（Python 缺失 / 依赖安装失败）
        if (error && !out) {
          if (err.includes('No Python') || err.includes('python not found') || err.includes('is not supported')) {
            reject(new Error(
              'SQL 功能需要 Python >= 3.10，当前系统未检测到 Python。\n' +
              '安装方法：https://www.python.org/downloads/',
            ))
          } else if (err.includes('pip') || err.includes('install') || err.includes('dependency') || err.includes('is required')) {
            reject(new Error(
              'SQL 功能的 Python 依赖安装失败，请在项目 backend 目录下手动执行：\n' +
              '  uv sync\n' +
              '错误详情：' + extractShortError(err),
            ))
          } else {
            reject(new Error(err || error.message))
          }
          return
        }
        try {
          const result = JSON.parse(out) as PythonTestOk | PythonQueryOk | PythonError
          if ('error' in result) {
            reject(new Error(classifyDbError(result.error)))
            return
          }
          resolve(result)
        } catch {
          reject(new Error(err || out.slice(0, 500) || error?.message || 'Unknown error'))
        }
      },
    )
    proc.stdin?.end(stdin)
  })
}

export async function testConnection(config: DbConfig): Promise<void> {
  if (config.type === 'mysql' || config.type === 'sqlite') {
    try {
      await testNodeConnection(config)
    } catch (err) {
      throw new Error(classifyNodeDbError(err, config.type))
    }
    return
  }
  // Oracle and Hive: use Python bridge
  await callPython({
    action: 'test',
    config: {
      type: config.type,
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      filePath: config.filePath,
    },
  })
}

export async function executeDbQuery(
  config: DbConfig,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  if (config.type === 'mysql' || config.type === 'sqlite') {
    try {
      return await executeNodeQuery(config, sql, limit)
    } catch (err) {
      throw new Error(classifyNodeDbError(err, config.type))
    }
  }
  // Oracle and Hive: use Python bridge
  const result = await callPython({
    action: 'query',
    config: {
      type: config.type,
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      filePath: config.filePath,
    },
    sql,
    limit,
  })
  return result as QueryResult
}
