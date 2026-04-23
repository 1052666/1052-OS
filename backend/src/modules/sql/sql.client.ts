import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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
