import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'

type MigrationKind = 'file' | 'directory'
type MigrationStatus = 'planned' | 'copied' | 'staged' | 'skipped'

type MigrationEntry = {
  key: string
  kind: MigrationKind
  sourceRelativePath: string
  targetRelativePath: string
  exists: boolean
  sizeBytes: number
  fileCount?: number
  status: MigrationStatus
  reason?: string
}

export type AgentMigrationPreview = {
  sourcePath: string
  sourceDataDir: string
  targetDataDir: string
  entries: MigrationEntry[]
  totalFiles: number
  totalBytes: number
}

export type AgentMigrationResult = AgentMigrationPreview & {
  migrationId: string
  dryRun: boolean
  manifestPath: string
  createdAt: string
}

const MIGRATION_ITEMS: Array<{
  key: string
  kind: MigrationKind
  sourceRelativePath: string
  targetRelativePath: string
  collisionMode: 'copy-if-empty' | 'stage' | 'scoped-dir'
}> = [
  {
    key: 'chat-history',
    kind: 'file',
    sourceRelativePath: 'chat-history.json',
    targetRelativePath: 'chat-history.json',
    collisionMode: 'copy-if-empty',
  },
  {
    key: 'memories',
    kind: 'file',
    sourceRelativePath: 'memories.json',
    targetRelativePath: 'memories.json',
    collisionMode: 'copy-if-empty',
  },
  {
    key: 'suggestions',
    kind: 'file',
    sourceRelativePath: 'suggestions.json',
    targetRelativePath: 'suggestions.json',
    collisionMode: 'copy-if-empty',
  },
  {
    key: 'chat-history-backups',
    kind: 'directory',
    sourceRelativePath: 'chat-history-backups',
    targetRelativePath: 'chat-history-backups',
    collisionMode: 'scoped-dir',
  },
  {
    key: 'skills',
    kind: 'directory',
    sourceRelativePath: 'skills',
    targetRelativePath: 'skills',
    collisionMode: 'scoped-dir',
  },
  {
    key: 'generated-images',
    kind: 'directory',
    sourceRelativePath: 'generated-images',
    targetRelativePath: 'generated-images',
    collisionMode: 'scoped-dir',
  },
  {
    key: 'channels',
    kind: 'directory',
    sourceRelativePath: 'channels',
    targetRelativePath: 'channels',
    collisionMode: 'scoped-dir',
  },
  {
    key: '1052-checkpoints',
    kind: 'directory',
    sourceRelativePath: path.join('1052', 'checkpoints'),
    targetRelativePath: path.join('1052', 'checkpoints'),
    collisionMode: 'scoped-dir',
  },
  {
    key: '1052-uploads',
    kind: 'directory',
    sourceRelativePath: path.join('1052', 'uploads'),
    targetRelativePath: path.join('1052', 'uploads'),
    collisionMode: 'scoped-dir',
  },
]

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

async function statEntry(target: string, kind: MigrationKind) {
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) return { exists: false, sizeBytes: 0, fileCount: undefined }
  if (kind === 'file') {
    return { exists: stat.isFile(), sizeBytes: stat.isFile() ? stat.size : 0, fileCount: stat.isFile() ? 1 : undefined }
  }
  if (!stat.isDirectory()) return { exists: false, sizeBytes: 0, fileCount: undefined }
  return walkDirectoryStats(target)
}

async function walkDirectoryStats(root: string) {
  let sizeBytes = 0
  let fileCount = 0
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(next)
      } else if (entry.isFile()) {
        const stat = await fs.stat(next)
        sizeBytes += stat.size
        fileCount += 1
      }
    }
  }

  return { exists: true, sizeBytes, fileCount }
}

function assertPathInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new HttpError(400, '迁移路径越过了允许的目录范围。')
  }
  return resolvedCandidate
}

async function resolveSourceDataDir(sourcePathInput: unknown) {
  if (typeof sourcePathInput !== 'string' || !sourcePathInput.trim()) {
    throw new HttpError(400, 'sourcePath 不能为空。')
  }

  const sourcePath = path.resolve(sourcePathInput.trim())
  const sourceStat = await fs.stat(sourcePath).catch(() => null)
  if (!sourceStat?.isDirectory()) {
    throw new HttpError(400, `sourcePath 不是有效目录: ${sourcePath}`)
  }

  const nestedData = path.join(sourcePath, 'data')
  const sourceDataDir = (await exists(nestedData)) ? nestedData : sourcePath
  const targetDataDir = path.resolve(config.dataDir)
  if (path.resolve(sourceDataDir) === targetDataDir) {
    throw new HttpError(400, '源数据目录不能和当前运行数据目录相同。')
  }

  return { sourcePath, sourceDataDir, targetDataDir }
}

async function buildPreview(sourcePathInput: unknown): Promise<AgentMigrationPreview> {
  const resolved = await resolveSourceDataDir(sourcePathInput)
  const entries: MigrationEntry[] = []

  for (const item of MIGRATION_ITEMS) {
    const source = path.join(resolved.sourceDataDir, item.sourceRelativePath)
    const stats = await statEntry(source, item.kind)
    const target = path.join(resolved.targetDataDir, item.targetRelativePath)
    const targetExists = await exists(target)
    const status: MigrationStatus = !stats.exists
      ? 'skipped'
      : targetExists && item.collisionMode !== 'scoped-dir'
        ? 'staged'
        : 'planned'

    entries.push({
      key: item.key,
      kind: item.kind,
      sourceRelativePath: item.sourceRelativePath,
      targetRelativePath: item.targetRelativePath,
      exists: stats.exists,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      status,
      reason: stats.exists ? undefined : '源路径不存在',
    })
  }

  return {
    ...resolved,
    entries,
    totalFiles: entries.reduce((sum, item) => sum + (item.fileCount ?? 0), 0),
    totalBytes: entries.reduce((sum, item) => sum + item.sizeBytes, 0),
  }
}

async function copyItem(source: string, target: string, kind: MigrationKind) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (kind === 'file') {
    await fs.copyFile(source, target)
  } else {
    await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false })
  }
}

function fingerprintManifest(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
}

export async function previewAgentMigration(sourcePath: unknown) {
  return buildPreview(sourcePath)
}

export async function runAgentMigration(input: { sourcePath?: unknown; dryRun?: unknown }) {
  const preview = await buildPreview(input.sourcePath)
  const migrationId = `${safeTimestamp()}-${randomUUID().slice(0, 8)}`
  const migrationRoot = path.join(preview.targetDataDir, '1052', 'migrations', migrationId)
  const importedRoot = path.join(migrationRoot, 'imported')
  const dryRun = input.dryRun === true
  const entries: MigrationEntry[] = []

  for (const item of MIGRATION_ITEMS) {
    const planned = preview.entries.find((entry) => entry.key === item.key)
    if (!planned?.exists) {
      if (planned) entries.push(planned)
      continue
    }

    const source = assertPathInside(
      preview.sourceDataDir,
      path.join(preview.sourceDataDir, item.sourceRelativePath),
    )
    const targetBase = path.join(preview.targetDataDir, item.targetRelativePath)
    const targetExists = await exists(targetBase)
    const nextEntry = { ...planned }

    if (dryRun) {
      entries.push(nextEntry)
      continue
    }

    if (item.collisionMode === 'scoped-dir') {
      const target = assertPathInside(
        preview.targetDataDir,
        path.join(targetBase, `migration-${migrationId}`),
      )
      await copyItem(source, target, item.kind)
      nextEntry.status = 'copied'
      nextEntry.targetRelativePath = path.relative(preview.targetDataDir, target)
    } else if (!targetExists) {
      const target = assertPathInside(preview.targetDataDir, targetBase)
      await copyItem(source, target, item.kind)
      nextEntry.status = 'copied'
    } else {
      const stagedTarget = assertPathInside(
        importedRoot,
        path.join(importedRoot, item.sourceRelativePath),
      )
      await copyItem(source, stagedTarget, item.kind)
      nextEntry.status = 'staged'
      nextEntry.reason = '目标已存在，已放入迁移归档，未覆盖当前数据。'
      nextEntry.targetRelativePath = path.relative(preview.targetDataDir, stagedTarget)
    }

    entries.push(nextEntry)
  }

  const manifest = {
    migrationId,
    dryRun,
    createdAt: new Date().toISOString(),
    sourcePath: preview.sourcePath,
    sourceDataDir: preview.sourceDataDir,
    targetDataDir: preview.targetDataDir,
    entries,
  }
  const manifestPath = path.join(migrationRoot, 'manifest.json')

  if (!dryRun) {
    await fs.mkdir(migrationRoot, { recursive: true })
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, fingerprint: fingerprintManifest(manifest) }, null, 2)}\n`,
      'utf-8',
    )
  }

  return {
    ...preview,
    entries,
    migrationId,
    dryRun,
    manifestPath,
    createdAt: manifest.createdAt,
  } satisfies AgentMigrationResult
}
