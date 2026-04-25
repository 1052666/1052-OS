import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the config module
vi.mock('../../../../config.js', () => ({
  config: { dataDir: '/test-data' },
}))

// Mock sql.client (not used in file storage, but imported by sql.service)
vi.mock('../sql.client.js', () => ({
  testConnection: vi.fn(),
  executeDbQuery: vi.fn(),
}))

// Mock ssh2
vi.mock('ssh2', () => ({
  Client: class {
    on() { return this }
    connect() { return this }
    end() {}
  },
}))

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

// Now import the module under test
import fs from 'node:fs/promises'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = (...args: any[]) => Promise<any>

describe('SQL File Storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('createSqlFile', () => {
    it('should create both .json metadata and .sql content files', async () => {
      const { createSqlFile } = await import('../sql.service.js')

      const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)

      const result = await createSqlFile({
        name: 'test query',
        datasourceId: 'ds-1',
        content: 'SELECT * FROM users',
      })

      // Should create directory
      expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('sql-files'), { recursive: true })

      // Should write two files
      expect(writeFileSpy).toHaveBeenCalledTimes(2)

      // JSON file should NOT contain content
      const jsonWriteCall = writeFileSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.json'),
      )
      expect(jsonWriteCall).toBeDefined()
      const jsonContent = JSON.parse(jsonWriteCall![1] as string)
      expect(jsonContent).not.toHaveProperty('content')
      expect(jsonContent.name).toBe('test query')
      expect(jsonContent.datasourceId).toBe('ds-1')

      // SQL file should contain the SQL text
      const sqlWriteCall = writeFileSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.sql'),
      )
      expect(sqlWriteCall).toBeDefined()
      expect(sqlWriteCall![1]).toBe('SELECT * FROM users')

      // Return value should include content
      expect(result.content).toBe('SELECT * FROM users')
      expect(result.name).toBe('test query')
    })
  })

  describe('readFileEntity / getSqlFile', () => {
    it('should read content from .sql file when both files exist', async () => {
      const { getSqlFile } = await import('../sql.service.js')

      const metadata = {
        id: 'file-1',
        name: 'test',
        datasourceId: 'ds-1',
        createdAt: 1000,
        updatedAt: 2000,
      }

      vi.spyOn(fs, 'readFile').mockImplementation(((filePath: string) => {
        if (filePath.endsWith('.json')) return Promise.resolve(JSON.stringify(metadata))
        if (filePath.endsWith('.sql')) return Promise.resolve('SELECT 1')
        return Promise.reject(new Error('not found'))
      }) as MockFn)

      const result = await getSqlFile('file-1')

      expect(result.id).toBe('file-1')
      expect(result.content).toBe('SELECT 1')
      expect(result.name).toBe('test')
    })

    it('should fall back to JSON content when .sql file does not exist (legacy)', async () => {
      const { getSqlFile } = await import('../sql.service.js')

      const legacyJson = {
        id: 'file-legacy',
        name: 'legacy query',
        datasourceId: 'ds-1',
        content: 'SELECT legacy_data',
        createdAt: 1000,
        updatedAt: 2000,
      }

      vi.spyOn(fs, 'readFile').mockImplementation(((filePath: string) => {
        if (filePath.endsWith('.json')) return Promise.resolve(JSON.stringify(legacyJson))
        return Promise.reject(new Error('ENOENT'))
      }) as MockFn)

      const result = await getSqlFile('file-legacy')

      expect(result.content).toBe('SELECT legacy_data')
    })

    it('should throw 404 when file does not exist', async () => {
      const { getSqlFile } = await import('../sql.service.js')

      vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'))

      await expect(getSqlFile('nonexistent')).rejects.toThrow('SQL 文件不存在')
    })
  })

  describe('updateSqlFile', () => {
    it('should update .sql file when content changes', async () => {
      const { updateSqlFile } = await import('../sql.service.js')

      const existing = {
        id: 'file-1',
        name: 'test',
        datasourceId: 'ds-1',
        content: 'SELECT 1',
        createdAt: 1000,
        updatedAt: 2000,
      }

      vi.spyOn(fs, 'readFile').mockImplementation(((filePath: string) => {
        if (filePath.endsWith('.json')) return Promise.resolve(JSON.stringify(existing))
        if (filePath.endsWith('.sql')) return Promise.resolve('SELECT 1')
        return Promise.reject(new Error('not found'))
      }) as MockFn)

      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)

      const result = await updateSqlFile('file-1', {
        content: 'SELECT 2',
      })

      // Should write both files (JSON metadata + SQL content)
      expect(writeFileSpy).toHaveBeenCalledTimes(2)

      // JSON should not have content
      const jsonWriteCall = writeFileSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.json'),
      )
      const jsonContent = JSON.parse(jsonWriteCall![1] as string)
      expect(jsonContent).not.toHaveProperty('content')

      // SQL file should have new content
      const sqlWriteCall = writeFileSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.sql'),
      )
      expect(sqlWriteCall![1]).toBe('SELECT 2')

      expect(result.content).toBe('SELECT 2')
    })

    it('should not touch .sql file when only name changes', async () => {
      const { updateSqlFile } = await import('../sql.service.js')

      const existing = {
        id: 'file-1',
        name: 'old name',
        datasourceId: 'ds-1',
        content: 'SELECT 1',
        createdAt: 1000,
        updatedAt: 2000,
      }

      vi.spyOn(fs, 'readFile').mockImplementation(((filePath: string) => {
        if (filePath.endsWith('.json')) return Promise.resolve(JSON.stringify(existing))
        if (filePath.endsWith('.sql')) return Promise.resolve('SELECT 1')
        return Promise.reject(new Error('not found'))
      }) as MockFn)

      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)

      await updateSqlFile('file-1', { name: 'new name' })

      // Should only write JSON metadata, NOT the .sql file
      expect(writeFileSpy).toHaveBeenCalledTimes(1)
      expect(writeFileSpy.mock.calls[0][0]).toMatch(/\.json$/)
    })
  })

  describe('deleteSqlFile', () => {
    it('should delete both .json and .sql files', async () => {
      const { deleteSqlFile } = await import('../sql.service.js')

      const existing = {
        id: 'file-1',
        name: 'test',
        datasourceId: 'ds-1',
        content: 'SELECT 1',
        createdAt: 1000,
        updatedAt: 2000,
      }

      vi.spyOn(fs, 'readFile').mockImplementation(((filePath: string) => {
        if (filePath.endsWith('.json')) return Promise.resolve(JSON.stringify(existing))
        if (filePath.endsWith('.sql')) return Promise.resolve('SELECT 1')
        return Promise.reject(new Error('not found'))
      }) as MockFn)

      const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined)

      await deleteSqlFile('file-1')

      // Should delete both files
      const unlinkPaths = unlinkSpy.mock.calls.map((call) => call[0] as string)
      expect(unlinkPaths).toHaveLength(2)
      expect(unlinkPaths.some((p) => p.endsWith('.json'))).toBe(true)
      expect(unlinkPaths.some((p) => p.endsWith('.sql'))).toBe(true)
    })
  })
})
