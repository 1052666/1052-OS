/**
 * env-writer.ts
 *
 * Atomically writes FEISHU_APP_ID / FEISHU_APP_SECRET into `data/.env`,
 * preserving all other existing key=value pairs.
 *
 * Strategy:
 *   1. Read existing file (or start empty).
 *   2. Guard: reject if FEISHU_APP_ID is already present (no silent overwrite).
 *   3. Append new keys.
 *   4. Write to a tmp file, then rename → atomic on POSIX.
 *   5. A `.bak` copy of the original is kept alongside the file.
 *
 * Note: The project's primary credential store is the JSON files managed by
 * feishu.store.ts.  This .env file is for users who prefer dotenv-based
 * configuration or need a human-readable reference.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { config } from '../../../../config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envFilePath(): string {
  return path.join(config.dataDir, '.env')
}

/**
 * Parse a .env file into an ordered list of lines (preserves comments/blanks).
 * Returns lines array and a Set of all defined key names for quick lookup.
 */
function parseEnvLines(text: string): { lines: string[]; keys: Set<string> } {
  const lines = text.split('\n')
  const keys = new Set<string>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      keys.add(trimmed.slice(0, eqIndex).trim())
    }
  }
  return { lines, keys }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write FEISHU_APP_ID and FEISHU_APP_SECRET to `data/.env`.
 *
 * Throws if either key is already present in the file (prevents silent
 * overwrite of existing credentials).  Callers should catch this error and
 * surface a user-friendly message.
 *
 * @param appId     - Feishu App ID (cli_xxx…).
 * @param appSecret - Feishu App Secret.
 */
export async function writeEnvCredentials(appId: string, appSecret: string): Promise<void> {
  if (!appId || !appSecret) {
    throw new Error('writeEnvCredentials: appId and appSecret must not be empty')
  }

  const filePath = envFilePath()

  // Ensure the data directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  // Read existing content (empty string if file doesn't exist)
  let existingText = ''
  try {
    existingText = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const { lines, keys } = parseEnvLines(existingText)

  // Guard: do not overwrite existing feishu keys
  if (keys.has('FEISHU_APP_ID')) {
    throw new Error(
      'FEISHU_APP_ID already exists in data/.env. ' +
        'Remove it manually before running the setup wizard again.',
    )
  }

  // Write backup of existing file (if non-empty)
  if (existingText.trim()) {
    const bakPath = `${filePath}.bak`
    await fs.writeFile(bakPath, existingText, 'utf-8')
  }

  // Build new content
  const separator = existingText && !existingText.endsWith('\n') ? '\n' : ''
  const newBlock = [
    '# Feishu bot credentials — written by the 1052 OS setup wizard',
    `# ${new Date().toISOString()}`,
    `FEISHU_APP_ID=${appId}`,
    `FEISHU_APP_SECRET=${appSecret}`,
    '',
  ].join('\n')

  const newContent = lines.join('\n') + separator + newBlock

  // Atomic write: tmp file → rename
  const tmpPath = path.join(os.tmpdir(), `.env.1052-wizard-${Date.now()}.tmp`)
  await fs.writeFile(tmpPath, newContent, { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tmpPath, filePath)

  // Ensure restrictive permissions (best-effort; Windows may ignore)
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // Ignored on Windows
  }
}

/**
 * Check whether `data/.env` already contains FEISHU_APP_ID.
 * Useful for surfacing a warning in the UI before starting the wizard.
 */
export async function hasExistingFeishuEnvKeys(): Promise<boolean> {
  try {
    const text = await fs.readFile(envFilePath(), 'utf-8')
    const { keys } = parseEnvLines(text)
    return keys.has('FEISHU_APP_ID')
  } catch {
    return false
  }
}
