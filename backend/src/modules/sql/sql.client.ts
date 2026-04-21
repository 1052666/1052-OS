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
        if (error && !out) {
          reject(new Error(err || error.message))
          return
        }
        try {
          const result = JSON.parse(out) as PythonTestOk | PythonQueryOk | PythonError
          if ('error' in result) {
            reject(new Error(result.error))
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
