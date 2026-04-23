import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

import { execFile } from 'node:child_process'
import { testConnection, executeDbQuery } from '../sql.client.js'

const mockConfig = {
  type: 'mysql' as const,
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'pass',
  database: 'test',
  filePath: '',
}

function mockExecResult(error: any, stdout: string, stderr: string) {
  ;(execFile as Mock).mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      const proc = { stdin: { end: vi.fn() } }
      cb(error, stdout, stderr)
      return proc
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── A 组：环境缺失类 ──────────────────────────────────────────

describe('A 组：环境缺失类错误', () => {
  it('A1: uv 未安装 (ENOENT)', async () => {
    mockExecResult({ code: 'ENOENT' }, '', '')

    await expect(testConnection(mockConfig)).rejects.toThrow('SQL 功能需要 uv')
  })

  it('A2: Python 未安装', async () => {
    mockExecResult({}, '', 'No Python installation found')

    await expect(testConnection(mockConfig)).rejects.toThrow('Python >= 3.10')
  })

  it('A3: Python 版本过低', async () => {
    mockExecResult({}, '', 'python 3.8 is not supported')

    await expect(testConnection(mockConfig)).rejects.toThrow('Python >= 3.10')
  })

  it('A4: 依赖安装失败-网络', async () => {
    mockExecResult({}, '', 'pip install failed: timeout')

    await expect(testConnection(mockConfig)).rejects.toThrow('uv sync')
  })

  it('A5: 依赖安装失败-编译', async () => {
    mockExecResult({}, '', 'error: Microsoft Visual C++ 14.0 is required')

    await expect(testConnection(mockConfig)).rejects.toThrow('uv sync')
  })
})

// ── B 组：数据库连接类 ──────────────────────────────────────────

describe('B 组：数据库连接类错误', () => {
  it('B1: Oracle Client 缺失', async () => {
    mockExecResult(null, '{"error":"DPI-1047: Cannot locate a 64-bit Oracle Client library"}', '')

    await expect(testConnection(mockConfig)).rejects.toThrow('Oracle Instant Client')
  })

  it('B2: 连接超时', async () => {
    mockExecResult(null, '{"error":"ORA-12170: TNS:Connect timeout occurred"}', '')

    await expect(testConnection(mockConfig)).rejects.toThrow(/连接失败|网络/)
  })

  it('B3: 认证失败', async () => {
    mockExecResult(null, '{"error":"Access denied for user \'root\'@\'172.19.161.62\'}"}', '')

    await expect(testConnection(mockConfig)).rejects.toThrow(/认证失败|用户名和密码/)
  })

  it('B4: 连接被拒', async () => {
    mockExecResult(null, '{"error":"Can\'t connect to MySQL server on \'172.19.171.101\' (111)"}', '')

    await expect(testConnection(mockConfig)).rejects.toThrow(/连接失败|网络/)
  })

  it('B5: 未知数据库错误', async () => {
    mockExecResult(null, '{"error":"Unknown column \'xxx\' in \'field list\'"}', '')

    await expect(testConnection(mockConfig)).rejects.toThrow('Unknown column')
  })
})

// ── C 组：超时与边界类 ──────────────────────────────────────────

describe('C 组：超时与边界类', () => {
  it('C1: 查询超时', async () => {
    mockExecResult({ killed: true }, '', '')

    await expect(testConnection(mockConfig)).rejects.toThrow('超时')
  })

  it('C2: 正常查询成功', async () => {
    mockExecResult(null, '{"columns":["id","name"],"rows":[{"id":1,"name":"test"}],"rowCount":1,"truncated":false}', '')

    const result = await executeDbQuery(mockConfig, 'SELECT 1', 100)
    expect(result.rowCount).toBe(1)
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows[0]).toEqual({ id: 1, name: 'test' })
  })
})
