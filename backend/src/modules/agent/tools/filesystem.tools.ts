import fs from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

const MAX_READ_CHARS = 600_000
const MAX_TEXT_SEARCH_CHARS = 1_000_000
const MAX_LIST_ENTRIES = 1_000
const DEFAULT_LIST_ENTRIES = 200
const DEFAULT_SEARCH_RESULTS = 100
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out'])

type FileEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  updatedAt: number
}

type WalkEntry = FileEntry & {
  absolutePath: string
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function workspaceRoot() {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === 'backend' ? path.dirname(cwd) : cwd
}

function normalizePath(value: unknown) {
  const input = normalizeText(value).trim()
  if (!input) throw new HttpError(400, 'File path cannot be empty')
  return path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot(), input)
}

function normalizeOptionalPath(value: unknown) {
  const input = normalizeText(value).trim()
  return input ? normalizePath(input) : workspaceRoot()
}

function normalizeLimit(value: unknown, fallback: number, max: number) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(raw, 1), max)
}

function assertConfirmed(value: unknown) {
  if (value !== true) {
    throw new HttpError(
      400,
      'Local file changes require explicit user confirmation after explaining the path, operation type, and expected change.',
    )
  }
}

async function pathExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function statOrNull(target: string): Promise<Stats | null> {
  return fs.stat(target).catch(() => null)
}

function toPublicPath(target: string) {
  return path.resolve(target)
}

function toEntry(fullPath: string, itemStat: Stats): FileEntry {
  return {
    name: path.basename(fullPath),
    path: toPublicPath(fullPath),
    type: itemStat.isDirectory() ? 'directory' : 'file',
    size: itemStat.size,
    updatedAt: itemStat.mtimeMs,
  }
}

function isLikelyBinary(buffer: Buffer) {
  return buffer.includes(0)
}

async function readUtf8File(target: string, maxSize = MAX_READ_CHARS) {
  const stat = await statOrNull(target)
  if (!stat || !stat.isFile()) throw new HttpError(404, 'File does not exist')
  if (stat.size > maxSize) {
    throw new HttpError(400, `File is too large (${Math.round(stat.size / 1024)}KB); use offset/limit or a narrower search`)
  }

  const buffer = await fs.readFile(target)
  if (isLikelyBinary(buffer.subarray(0, Math.min(buffer.length, 4096)))) {
    throw new HttpError(400, 'Binary files are not supported by this text reader')
  }

  return {
    stat,
    content: buffer.toString('utf-8'),
  }
}

function sliceLines(content: string, offsetInput: unknown, limitInput: unknown) {
  const lines = content.split(/\r?\n/)
  const offset = normalizeLimit(offsetInput, 1, Math.max(lines.length, 1))
  const limit =
    typeof limitInput === 'number' && Number.isFinite(limitInput)
      ? Math.max(Math.min(Math.round(limitInput), lines.length), 1)
      : lines.length
  const start = Math.max(offset - 1, 0)
  const selected = lines.slice(start, start + limit)
  return {
    content: selected.join('\n'),
    startLine: offset,
    lineCount: selected.length,
    totalLines: lines.length,
    truncated: start > 0 || start + selected.length < lines.length,
  }
}

function makeSnippet(content: string, changedStartLine: number) {
  const lines = content.split(/\r?\n/)
  const start = Math.max(0, changedStartLine - 4)
  const end = Math.min(lines.length, changedStartLine + 5)
  return {
    startLine: start + 1,
    content: lines.slice(start, end).join('\n'),
  }
}

function editableLines(content: string) {
  return content.length === 0 ? [] : content.split(/\r?\n/)
}

function normalizeLineNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer line number`)
  }
  if (value < 1) throw new HttpError(400, `${field} must be greater than or equal to 1`)
  return value
}

function splitLineEditContent(value: unknown, allowEmpty: boolean) {
  const text = normalizeText(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!text) {
    if (allowEmpty) return []
    throw new HttpError(400, 'Line edit content cannot be empty')
  }
  const withoutSingleTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text
  return withoutSingleTrailingNewline.split('\n')
}

function detectLineEnding(content: string) {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

async function writeTextPreservingLineEndings(target: string, content: string, previousContent?: string) {
  const lineEnding = previousContent ? detectLineEnding(previousContent) : '\n'
  const normalized = lineEnding === '\r\n' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n')
  await fs.writeFile(target, normalized, 'utf-8')
}

function assertExpectedUpdatedAt(stat: Stats, expectedUpdatedAt: unknown, action: string) {
  if (
    typeof expectedUpdatedAt === 'number' &&
    Number.isFinite(expectedUpdatedAt) &&
    Math.abs(stat.mtimeMs - expectedUpdatedAt) > 1
  ) {
    throw new HttpError(409, `File changed since the previous read; read it again before ${action}`)
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wildcardToRegExp(pattern: string) {
  const normalized = pattern.replace(/\\/g, '/')
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else if (char) {
      source += escapeRegExp(char)
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function matchesInclude(relativePath: string, include: unknown) {
  const pattern = normalizeText(include).trim()
  if (!pattern) return true
  const normalized = relativePath.replace(/\\/g, '/')
  const basename = path.basename(normalized)
  if (!pattern.includes('/') && wildcardToRegExp(pattern).test(basename)) return true
  const matcher = wildcardToRegExp(pattern.includes('/') ? pattern : `**/${pattern}`)
  return matcher.test(normalized) || wildcardToRegExp(pattern).test(normalized)
}

function assertCanMove(source: string, destination: string) {
  const sourceResolved = path.resolve(source)
  const destinationResolved = path.resolve(destination)
  if (sourceResolved === destinationResolved) {
    throw new HttpError(400, 'Source and destination are the same path')
  }
  const relativeToSource = path.relative(sourceResolved, destinationResolved)
  if (relativeToSource && !relativeToSource.startsWith('..') && !path.isAbsolute(relativeToSource)) {
    throw new HttpError(400, 'Cannot move a directory into itself')
  }
}

async function walkDirectory(root: string, maxEntries: number, includeDirectories: boolean) {
  const rootStat = await statOrNull(root)
  if (!rootStat) throw new HttpError(404, 'Path does not exist')
  if (rootStat.isFile()) {
    return [{ ...toEntry(root, rootStat), absolutePath: root }]
  }
  if (!rootStat.isDirectory()) throw new HttpError(400, 'Path is not a file or directory')

  const results: WalkEntry[] = []
  const queue = [root]

  while (queue.length > 0 && results.length < maxEntries) {
    const current = queue.shift()!
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (results.length >= maxEntries) break
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue

      const fullPath = path.join(current, entry.name)
      const itemStat = await statOrNull(fullPath)
      if (!itemStat) continue

      if (includeDirectories || itemStat.isFile()) {
        results.push({ ...toEntry(fullPath, itemStat), absolutePath: fullPath })
      }

      if (entry.isDirectory()) queue.push(fullPath)
    }
  }

  return results
}

async function listDirectory(target: string, recursive: boolean, maxEntries: number) {
  const stat = await statOrNull(target)
  if (!stat || !stat.isDirectory()) throw new HttpError(404, 'Directory does not exist')

  const results: FileEntry[] = []
  const queue = [target]

  while (queue.length > 0 && results.length < maxEntries) {
    const current = queue.shift()!
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (results.length >= maxEntries) break
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue

      const fullPath = path.join(current, entry.name)
      const itemStat = await statOrNull(fullPath)
      if (!itemStat) continue

      results.push(toEntry(fullPath, itemStat))

      if (recursive && entry.isDirectory()) queue.push(fullPath)
    }
  }

  return {
    path: toPublicPath(target),
    recursive,
    entries: results,
    truncated: results.length >= maxEntries,
  }
}

async function copyPath(source: string, destination: string, recursive: boolean, overwrite: boolean) {
  const sourceStat = await statOrNull(source)
  if (!sourceStat) throw new HttpError(404, 'Source path does not exist')
  if (sourceStat.isDirectory() && !recursive) {
    throw new HttpError(400, 'Copying a directory requires recursive:true')
  }
  if (sourceStat.isDirectory()) assertCanMove(source, destination)
  if ((await pathExists(destination)) && !overwrite) {
    throw new HttpError(400, 'Destination already exists; set overwrite:true only after user confirmation')
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(source, destination, {
    recursive: sourceStat.isDirectory(),
    force: overwrite,
    errorOnExist: !overwrite,
  })
  const nextStat = await fs.stat(destination)
  return {
    ok: true,
    source: toPublicPath(source),
    destination: toPublicPath(destination),
    type: nextStat.isDirectory() ? 'directory' : 'file',
    size: nextStat.size,
    updatedAt: nextStat.mtimeMs,
  }
}

export const filesystemTools: AgentTool[] = [
  {
    name: 'filesystem_stat_path',
    description: 'Inspect metadata for a local file or directory. Read-only. Use this before risky operations to verify the target.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file/folder path.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const target = normalizePath(input.path)
      const stat = await statOrNull(target)
      if (!stat) throw new HttpError(404, 'Path does not exist')
      return {
        ...toEntry(target, stat),
        createdAt: stat.birthtimeMs,
        isEmptyDirectory: stat.isDirectory() ? (await fs.readdir(target)).length === 0 : undefined,
      }
    },
  },
  {
    name: 'filesystem_list_directory',
    description:
      'List files and folders in a local directory. Read-only. Use this to inspect local folders before reading or modifying files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative directory path.' },
        recursive: { type: 'boolean', description: 'Whether to recursively list nested entries. Default false.' },
        limit: { type: 'number', description: 'Maximum entries to return. Default 200, max 1000.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return listDirectory(
        normalizePath(input.path),
        input.recursive === true,
        normalizeLimit(input.limit, DEFAULT_LIST_ENTRIES, MAX_LIST_ENTRIES),
      )
    },
  },
  {
    name: 'filesystem_search_files',
    description:
      'Search local file and folder paths by wildcard pattern. Read-only. Supports * and ** patterns and returns recent filesystem matches.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in. Defaults to workspace root.' },
        pattern: { type: 'string', description: 'Wildcard path pattern, for example "*.md", "**/*.ts", or "notes/**".' },
        includeDirectories: { type: 'boolean', description: 'Whether directory matches should be returned. Default false.' },
        limit: { type: 'number', description: 'Maximum matches to return. Default 100, max 1000.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const root = normalizeOptionalPath(input.path)
      const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_RESULTS, MAX_LIST_ENTRIES)
      const entries = await walkDirectory(root, MAX_LIST_ENTRIES, input.includeDirectories === true)
      const matcher = wildcardToRegExp(normalizeText(input.pattern).trim())
      const matches = entries
        .filter((entry) => {
          const relativePath = path.relative(root, entry.absolutePath).replace(/\\/g, '/')
          return matcher.test(relativePath) || matchesInclude(relativePath, input.pattern)
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map(({ absolutePath: _absolutePath, ...entry }) => entry)
      return {
        path: toPublicPath(root),
        pattern: normalizeText(input.pattern).trim(),
        matches,
        truncated: matches.length >= limit,
      }
    },
  },
  {
    name: 'filesystem_search_content',
    description:
      'Search text content in local UTF-8 files. Read-only. Use this instead of scanning many files manually.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory or file to search in. Defaults to workspace root.' },
        query: { type: 'string', description: 'Text or regular expression to search for.' },
        useRegex: { type: 'boolean', description: 'Treat query as a regular expression. Default false.' },
        caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive. Default false.' },
        include: { type: 'string', description: 'Optional file wildcard, for example "*.md" or "**/*.ts".' },
        limit: { type: 'number', description: 'Maximum matching files to return. Default 100, max 1000.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const root = normalizeOptionalPath(input.path)
      const query = normalizeText(input.query)
      if (!query) throw new HttpError(400, 'Search query cannot be empty')
      const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_RESULTS, MAX_LIST_ENTRIES)
      const flags = input.caseSensitive === true ? 'm' : 'im'
      const matcher = new RegExp(input.useRegex === true ? query : escapeRegExp(query), flags)
      const entries = await walkDirectory(root, MAX_LIST_ENTRIES, false)
      const matches = []

      for (const entry of entries) {
        if (matches.length >= limit) break
        const relativePath = path.relative(root, entry.absolutePath)
        if (!matchesInclude(relativePath, input.include)) continue
        if (entry.size > MAX_TEXT_SEARCH_CHARS) continue

        try {
          const { content } = await readUtf8File(entry.absolutePath, MAX_TEXT_SEARCH_CHARS)
          const lines = content.split(/\r?\n/)
          const matchedLineIndex = lines.findIndex((line) => matcher.test(line))
          if (matchedLineIndex === -1) continue
          matches.push({
            path: entry.path,
            size: entry.size,
            updatedAt: entry.updatedAt,
            line: matchedLineIndex + 1,
            preview: lines[matchedLineIndex]?.slice(0, 240) ?? '',
          })
        } catch {
          continue
        }
      }

      return {
        path: toPublicPath(root),
        query,
        matches,
        truncated: matches.length >= limit,
      }
    },
  },
  {
    name: 'filesystem_read_file',
    description:
      'Read a UTF-8 text file from the local filesystem. Read-only. Supports offset/limit by line for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path.' },
        offset: { type: 'number', description: '1-based start line. Default 1.' },
        limit: { type: 'number', description: 'Number of lines to read.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const target = normalizePath(input.path)
      const { stat, content } = await readUtf8File(target)
      const slice = sliceLines(content, input.offset, input.limit)
      return {
        path: toPublicPath(target),
        size: stat.size,
        updatedAt: stat.mtimeMs,
        ...slice,
      }
    },
  },
  {
    name: 'filesystem_create_directory',
    description:
      'Create a local directory. Before calling, tell the user the target path and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative directory path to create.' },
        recursive: { type: 'boolean', description: 'Create parent directories as needed. Default true.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      await fs.mkdir(target, { recursive: input.recursive !== false })
      const stat = await fs.stat(target)
      return { ok: true, path: toPublicPath(target), type: 'directory', updatedAt: stat.mtimeMs }
    },
  },
  {
    name: 'filesystem_create_file',
    description:
      'Create a new UTF-8 text file. Before calling, tell the user the target path and content summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to create.' },
        content: { type: 'string', description: 'File content.' },
        overwrite: { type: 'boolean', description: 'When true, allow replacing an existing file.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const exists = await pathExists(target)
      if (exists && input.overwrite !== true) throw new HttpError(400, 'File already exists; set overwrite:true only after user confirmation')
      const previous = exists ? await readUtf8File(target).catch(() => null) : null
      await fs.mkdir(path.dirname(target), { recursive: true })
      await writeTextPreservingLineEndings(target, normalizeText(input.content), previous?.content)
      const stat = await fs.stat(target)
      return { ok: true, path: toPublicPath(target), created: !exists, updatedAt: stat.mtimeMs, size: stat.size }
    },
  },
  {
    name: 'filesystem_write_file',
    description:
      'Replace the complete content of an existing UTF-8 text file. Before calling, tell the user the target path and change summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to update.' },
        content: { type: 'string', description: 'Complete replacement content.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional updatedAt value from a previous read; rejects if file changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const { stat, content } = await readUtf8File(target)
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'writing')
      await writeTextPreservingLineEndings(target, normalizeText(input.content), content)
      const nextStat = await fs.stat(target)
      return { ok: true, path: toPublicPath(target), updatedAt: nextStat.mtimeMs, size: nextStat.size }
    },
  },
  {
    name: 'filesystem_replace_in_file',
    description:
      'Safely edit one UTF-8 text file by replacing exactly one occurrence of oldString with newString. Before calling, tell the user the target path and exact change, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to edit.' },
        oldString: { type: 'string', description: 'Exact text to replace. Must appear exactly once.' },
        newString: { type: 'string', description: 'Replacement text.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional updatedAt value from a previous read; rejects if file changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'oldString', 'newString', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const oldString = normalizeText(input.oldString)
      const newString = normalizeText(input.newString)
      if (oldString === newString) throw new HttpError(400, 'oldString and newString are identical; no edit is needed')

      const { stat, content } = await readUtf8File(target)
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'editing')

      if (!oldString) throw new HttpError(400, 'oldString must not be empty')
      const matches = content.split(oldString).length - 1
      if (matches === 0) throw new HttpError(400, 'oldString was not found in the file')
      if (matches > 1) throw new HttpError(400, `oldString matched ${matches} locations; provide more specific surrounding context`)

      const before = content.slice(0, content.indexOf(oldString))
      const changedLine = before.split(/\r?\n/).length
      const updated = content.replace(oldString, newString)
      await writeTextPreservingLineEndings(target, updated, content)
      const nextStat = await fs.stat(target)
      return {
        ok: true,
        path: toPublicPath(target),
        updatedAt: nextStat.mtimeMs,
        size: nextStat.size,
        snippet: makeSnippet(updated, changedLine),
      }
    },
  },
  {
    name: 'filesystem_replace_lines',
    description:
      'Edit a UTF-8 text file by replacing or deleting an exact 1-based line range. Prefer this when the user gives line numbers. Before calling, tell the user the target path, line range, and change summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to edit.' },
        startLine: { type: 'number', description: '1-based first line to replace.' },
        endLine: { type: 'number', description: '1-based last line to replace. Inclusive.' },
        content: {
          type: 'string',
          description: 'Replacement text for the line range. Use an empty string to delete the range.',
        },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional updatedAt value from a previous read; rejects if file changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'startLine', 'endLine', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const startLine = normalizeLineNumber(input.startLine, 'startLine')
      const endLine = normalizeLineNumber(input.endLine, 'endLine')
      if (endLine < startLine) throw new HttpError(400, 'endLine must be greater than or equal to startLine')

      const { stat, content } = await readUtf8File(target)
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'editing lines')

      const lines = editableLines(content)
      const maxLine = Math.max(lines.length, 1)
      if (startLine > maxLine) throw new HttpError(400, `startLine exceeds file line count (${maxLine})`)
      if (endLine > maxLine) throw new HttpError(400, `endLine exceeds file line count (${maxLine})`)

      const replacementLines = splitLineEditContent(input.content, true)
      const nextLines = [...lines]
      nextLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines)
      const updated = nextLines.join('\n')
      if (updated === content) throw new HttpError(400, 'Line edit does not change the file')

      await writeTextPreservingLineEndings(target, updated, content)
      const nextStat = await fs.stat(target)
      return {
        ok: true,
        path: toPublicPath(target),
        startLine,
        endLine,
        insertedLines: replacementLines.length,
        deletedLines: endLine - startLine + 1,
        totalLinesBefore: lines.length,
        totalLinesAfter: nextLines.length,
        updatedAt: nextStat.mtimeMs,
        size: nextStat.size,
        snippet: makeSnippet(updated, startLine),
      }
    },
  },
  {
    name: 'filesystem_insert_lines',
    description:
      'Insert text before or after a precise 1-based line in a UTF-8 text file. Prefer this for line-numbered insertions. Before calling, tell the user the target path, insertion point, and content summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to edit.' },
        line: { type: 'number', description: '1-based anchor line for insertion.' },
        position: {
          type: 'string',
          enum: ['before', 'after'],
          description: 'Insert before or after the anchor line.',
        },
        content: { type: 'string', description: 'Text to insert.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional updatedAt value from a previous read; rejects if file changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'line', 'position', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const line = normalizeLineNumber(input.line, 'line')
      const position = input.position === 'after' ? 'after' : input.position === 'before' ? 'before' : ''
      if (!position) throw new HttpError(400, 'position must be "before" or "after"')

      const { stat, content } = await readUtf8File(target)
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'inserting lines')

      const lines = editableLines(content)
      const maxLine = Math.max(lines.length, 1)
      if (line > maxLine) throw new HttpError(400, `line exceeds file line count (${maxLine})`)

      const insertLines = splitLineEditContent(input.content, false)
      const nextLines = [...lines]
      const insertIndex = lines.length === 0 ? 0 : position === 'before' ? line - 1 : line
      nextLines.splice(insertIndex, 0, ...insertLines)
      const updated = nextLines.join('\n')
      if (updated === content) throw new HttpError(400, 'Line insertion does not change the file')

      await writeTextPreservingLineEndings(target, updated, content)
      const nextStat = await fs.stat(target)
      const insertedStartLine = insertIndex + 1
      return {
        ok: true,
        path: toPublicPath(target),
        line,
        position,
        insertedLines: insertLines.length,
        totalLinesBefore: lines.length,
        totalLinesAfter: nextLines.length,
        updatedAt: nextStat.mtimeMs,
        size: nextStat.size,
        snippet: makeSnippet(updated, insertedStartLine),
      }
    },
  },
  {
    name: 'filesystem_move_path',
    description:
      'Move or rename a local file or directory. Before calling, tell the user the source, destination, overwrite behavior, and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Absolute or relative source file/folder path.' },
        destinationPath: { type: 'string', description: 'Absolute or relative destination file/folder path.' },
        overwrite: { type: 'boolean', description: 'When true, replace an existing destination. Default false.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional source updatedAt from a previous stat/read; rejects if source changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['sourcePath', 'destinationPath', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const source = normalizePath(input.sourcePath)
      const destination = normalizePath(input.destinationPath)
      assertCanMove(source, destination)
      const stat = await statOrNull(source)
      if (!stat) throw new HttpError(404, 'Source path does not exist')
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'moving')
      if ((await pathExists(destination)) && input.overwrite !== true) {
        throw new HttpError(400, 'Destination already exists; set overwrite:true only after user confirmation')
      }
      if ((await pathExists(destination)) && input.overwrite === true) {
        await fs.rm(destination, { recursive: true, force: true })
      }
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.rename(source, destination)
      const nextStat = await fs.stat(destination)
      return {
        ok: true,
        source: toPublicPath(source),
        destination: toPublicPath(destination),
        type: nextStat.isDirectory() ? 'directory' : 'file',
        size: nextStat.size,
        updatedAt: nextStat.mtimeMs,
      }
    },
  },
  {
    name: 'filesystem_copy_path',
    description:
      'Copy a local file or directory. Before calling, tell the user the source, destination, recursive/overwrite behavior, and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Absolute or relative source file/folder path.' },
        destinationPath: { type: 'string', description: 'Absolute or relative destination file/folder path.' },
        recursive: { type: 'boolean', description: 'Required true for copying directories.' },
        overwrite: { type: 'boolean', description: 'When true, replace an existing destination. Default false.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['sourcePath', 'destinationPath', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return copyPath(
        normalizePath(input.sourcePath),
        normalizePath(input.destinationPath),
        input.recursive === true,
        input.overwrite === true,
      )
    },
  },
  {
    name: 'filesystem_delete_path',
    description:
      'Delete a local file or directory. Before calling, tell the user the exact path and whether recursive deletion is involved, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file/folder path to delete.' },
        recursive: { type: 'boolean', description: 'Required true when deleting a non-empty directory.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Optional updatedAt value from a previous stat/read; rejects if path changed since then.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['path', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const target = normalizePath(input.path)
      const stat = await statOrNull(target)
      if (!stat) throw new HttpError(404, 'Path does not exist')
      assertExpectedUpdatedAt(stat, input.expectedUpdatedAt, 'deleting')
      if (stat.isDirectory()) {
        await fs.rm(target, { recursive: input.recursive === true, force: false })
      } else {
        await fs.unlink(target)
      }
      return { ok: true, path: toPublicPath(target), type: stat.isDirectory() ? 'directory' : 'file' }
    },
  },
]
