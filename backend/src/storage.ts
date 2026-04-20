import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const full = path.join(config.dataDir, file)
    const text = await fs.readFile(full, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export async function writeJson<T>(file: string, data: T): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true })
  const full = path.join(config.dataDir, file)
  await fs.writeFile(full, JSON.stringify(data, null, 2), 'utf-8')
}
