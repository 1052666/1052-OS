import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

const writeQueues = new Map<string, Promise<void>>()

function resolveDataPath(file: string) {
  return path.join(config.dataDir, file)
}

function backupPath(filePath: string) {
  return `${filePath}.bak`
}

function tempPath(filePath: string) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

async function readParsedJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(text) as T
}

async function replaceFile(tempFilePath: string, filePath: string) {
  try {
    await fs.rename(tempFilePath, filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    await fs.rm(filePath, { force: true })
    await fs.rename(tempFilePath, filePath)
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const full = resolveDataPath(file)
  try {
    return await readParsedJson<T>(full)
  } catch {
    try {
      const recovered = await readParsedJson<T>(backupPath(full))
      console.warn(`[storage] recovered ${file} from backup`)
      return recovered
    } catch {
      return fallback
    }
  }
}

export async function writeJson<T>(file: string, data: T): Promise<void> {
  const full = resolveDataPath(file)
  const queue = writeQueues.get(full) ?? Promise.resolve()
  const task = queue.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(full), { recursive: true })

    const tempFilePath = tempPath(full)
    const serialized = JSON.stringify(data, null, 2)

    await fs.writeFile(tempFilePath, serialized, 'utf-8')
    try {
      await replaceFile(tempFilePath, full)
      await fs.copyFile(full, backupPath(full))
    } finally {
      await fs.rm(tempFilePath, { force: true }).catch(() => {})
    }
  })

  writeQueues.set(full, task)
  try {
    await task
  } finally {
    if (writeQueues.get(full) === task) writeQueues.delete(full)
  }
}
