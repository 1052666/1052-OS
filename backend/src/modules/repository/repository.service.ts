import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { deflateRawSync } from 'node:zlib'
import { HttpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import type {
  PublicRepositoryConfig,
  RepositoryArchive,
  RepositoryConfig,
  RepositoryConfigInput,
  RepositoryDescriptionInput,
  RepositoryDetail,
  RepositoryFileContent,
  RepositoryFileResource,
  RepositoryPathInput,
  RepositoryReadme,
  RepositorySummary,
  RepositoryTreeNode,
} from './repository.types.js'

const execFile = promisify(execFileCallback)
const FILE = 'repository-config.json'
const DEFAULT_CONFIG: RepositoryConfig = { rootPath: '', manualPaths: [] }
const DESCRIPTION_FILE = '1052.md'
const MAX_SCAN_DEPTH = 4
const MAX_CANDIDATES = 500
const MAX_README_CHARS = 80_000
const MAX_DESCRIPTION_CHARS = 20_000
const MAX_FILE_CHARS = 160_000
const MAX_TREE_DEPTH = 4
const MAX_TREE_ENTRIES = 500
const MAX_CHILDREN_PER_DIR = 120
const ZIP_UTF8_FLAG = 0x0800

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.vite',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
  '__pycache__',
  'vendor',
])

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
  'mix.exs',
]

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  PHP: '#4f5d95',
  Ruby: '#701516',
  Markdown: '#083fa1',
  Unknown: '#94a3b8',
}

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.hpp': 'C++',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.md': 'Markdown',
}

const MIME_BY_EXT: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
}

const TEXT_EXTS = new Set([
  '.c',
  '.cc',
  '.cmd',
  '.cpp',
  '.cs',
  '.cxx',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.jsx',
  '.lock',
  '.log',
  '.php',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.svelte',
  '.toml',
  '.vue',
])

const TEXT_FILE_NAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  'dockerfile',
  'license',
])

type DirectoryEntry = {
  name: string
  isDirectory(): boolean
}

async function pathExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function isDirectory(target: string) {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function resolvePath(input: string) {
  return path.resolve(input.trim())
}

function pathKey(input: string) {
  const resolved = path.resolve(input)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function hasChild(target: string, child: string) {
  return pathExists(path.join(target, child))
}

async function isProjectDir(target: string) {
  for (const marker of PROJECT_MARKERS) {
    if (await hasChild(target, marker)) return true
  }
  return false
}

async function readPackageDescription(repoPath: string) {
  try {
    const text = await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(text) as { description?: unknown }
    return typeof pkg.description === 'string' ? pkg.description.slice(0, 220) : ''
  } catch {
    return ''
  }
}

async function readRepositoryDescription(repoPath: string) {
  try {
    const content = await fs.readFile(path.join(repoPath, DESCRIPTION_FILE), 'utf-8')
    return {
      content: content.slice(0, MAX_DESCRIPTION_CHARS),
      exists: true,
    }
  } catch {
    return {
      content: '',
      exists: false,
    }
  }
}

async function findReadmeName(repoPath: string) {
  try {
    const entries = await fs.readdir(repoPath, { withFileTypes: true })
    return (
      entries.find((entry) => {
        const name = entry.name.toLowerCase()
        return !entry.isDirectory() && (name === 'readme' || name.startsWith('readme.'))
      })?.name ?? ''
    )
  } catch {
    return ''
  }
}

async function readReadme(repoPath: string): Promise<RepositoryReadme | null> {
  try {
    const fileName = await findReadmeName(repoPath)
    if (!fileName) return null

    const content = await fs.readFile(path.join(repoPath, fileName), 'utf-8')
    return {
      fileName,
      content: content.slice(0, MAX_README_CHARS),
    }
  } catch {
    return null
  }
}

function stripInlineMarkdown(input: string) {
  return input
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeReadmeContent(content: string) {
  let firstHeading = ''
  let inFence = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || !line) continue

    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]
    if (heading && !firstHeading) {
      firstHeading = stripInlineMarkdown(heading)
      continue
    }

    if (/^[-*_]{3,}$/.test(line)) continue
    if (/^\|.*\|$/.test(line)) continue
    if (/^\[!\[/.test(line) || /^!\[/.test(line)) continue

    const text = stripInlineMarkdown(line.replace(/^>\s*/, ''))
    if (text) return text.slice(0, 220)
  }

  return firstHeading.slice(0, 220)
}

function summarizeDescriptionContent(content: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('```') || line.startsWith('~~~')) continue
    const text = stripInlineMarkdown(line.replace(/^#{1,6}\s+/, '').replace(/^>\s*/, ''))
    if (text) return text.slice(0, 260)
  }

  return stripInlineMarkdown(content).slice(0, 260)
}

async function readReadmeSummary(repoPath: string) {
  try {
    const readme = await readReadme(repoPath)
    return readme ? summarizeReadmeContent(readme.content) : ''
  } catch {
    return ''
  }
}

function sortDirectoryEntries(entries: DirectoryEntry[]) {
  return entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

function isSkippableDir(name: string) {
  return SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.github')
}

function decodeRepositoryId(id: string) {
  try {
    return Buffer.from(id, 'base64url').toString('utf-8')
  } catch {
    return ''
  }
}

function safeRepositoryPath(repoPath: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(repoPath, normalized)
  const root = path.resolve(repoPath)
  const relative = path.relative(root, target)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, '文件路径无效')
  }

  return target
}

function mimeForPath(target: string) {
  const ext = path.extname(target).toLowerCase()
  const name = path.basename(target).toLowerCase()
  return MIME_BY_EXT[ext] ?? (TEXT_EXTS.has(ext) || TEXT_FILE_NAMES.has(name) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
}

function previewTypeForPath(target: string): RepositoryFileContent['previewType'] {
  const ext = path.extname(target).toLowerCase()
  const mime = mimeForPath(target)
  if (mime.startsWith('image/')) return 'image'
  if (ext === '.md' || ext === '.markdown' || /^readme(\.|$)/i.test(path.basename(target))) return 'markdown'
  if (ext === '.json' || path.basename(target).toLowerCase().endsWith('rc')) return 'json'
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || TEXT_EXTS.has(ext)) return 'text'
  return 'binary'
}

async function buildRepositoryTree(
  repoPath: string,
  currentPath = repoPath,
  depth = 0,
  counter = { count: 0 },
): Promise<RepositoryTreeNode[]> {
  if (depth >= MAX_TREE_DEPTH || counter.count >= MAX_TREE_ENTRIES) return []

  let entries: DirectoryEntry[]
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: RepositoryTreeNode[] = []
  for (const entry of sortDirectoryEntries(entries).slice(0, MAX_CHILDREN_PER_DIR)) {
    if (counter.count >= MAX_TREE_ENTRIES) break
    if (entry.isDirectory() && isSkippableDir(entry.name)) continue

    const fullPath = path.join(currentPath, entry.name)
    const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/')
    const stat = await fs.stat(fullPath).catch(() => null)
    const node: RepositoryTreeNode = {
      name: entry.name,
      relativePath,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: stat?.size ?? 0,
      updatedAt: stat?.mtimeMs ?? 0,
    }
    counter.count += 1

    if (entry.isDirectory()) {
      node.children = await buildRepositoryTree(repoPath, fullPath, depth + 1, counter)
    }

    nodes.push(node)
  }

  return nodes
}

async function runGit(repoPath: string, args: string[]) {
  try {
    const { stdout } = await execFile('git', args, {
      cwd: repoPath,
      timeout: 2500,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function findCandidateDirs(rootPath: string) {
  if (await isProjectDir(rootPath)) return [rootPath]

  const candidates: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }]

  while (queue.length > 0 && candidates.length < MAX_CANDIDATES) {
    const current = queue.shift()
    if (!current) break

    let entries: DirectoryEntry[]
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (isSkippableDir(entry.name)) continue

      const full = path.join(current.dir, entry.name)
      if (await isProjectDir(full)) {
        candidates.push(full)
        if (candidates.length >= MAX_CANDIDATES) break
        continue
      }

      if (current.depth + 1 < MAX_SCAN_DEPTH) {
        queue.push({ dir: full, depth: current.depth + 1 })
      }
    }
  }

  return candidates
}

async function detectLanguage(repoPath: string) {
  const counts = new Map<string, number>()
  const queue: Array<{ dir: string; depth: number }> = [{ dir: repoPath, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break

    let entries: DirectoryEntry[]
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (current.depth < 2 && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 })
        }
        continue
      }

      const lang = EXT_LANG[path.extname(entry.name).toLowerCase()]
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
    }
  }

  const language =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown'
  return {
    language,
    languageColor: LANGUAGE_COLORS[language] ?? LANGUAGE_COLORS.Unknown,
  }
}

async function summarizeRepository(
  rootPath: string,
  repoPath: string,
  source: RepositorySummary['source'],
): Promise<RepositorySummary> {
  const stat = await fs.stat(repoPath)
  const isGit = await hasChild(repoPath, '.git')
  const branch = isGit
    ? (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'unknown'
    : ''
  const statusText = isGit ? await runGit(repoPath, ['status', '--short']) : ''
  const gitUpdated = isGit ? await runGit(repoPath, ['log', '-1', '--format=%ct']) : ''
  const updatedAt = gitUpdated ? Number(gitUpdated) * 1000 : stat.mtimeMs
  const repositoryDescription = await readRepositoryDescription(repoPath)
  const fallbackDescription =
    (await readPackageDescription(repoPath)) ||
    (await readReadmeSummary(repoPath)) ||
    ''
  const description =
    summarizeDescriptionContent(repositoryDescription.content) || fallbackDescription
  const language = await detectLanguage(repoPath)
  const relativePath =
    source === 'root' && rootPath
      ? path.relative(rootPath, repoPath) || path.basename(repoPath)
      : path.basename(repoPath)

  return {
    id: Buffer.from(repoPath).toString('base64url'),
    name: path.basename(repoPath),
    path: repoPath,
    relativePath,
    description,
    descriptionContent: repositoryDescription.content,
    descriptionFileName: DESCRIPTION_FILE,
    hasDescriptionFile: repositoryDescription.exists,
    isGit,
    branch,
    status: isGit ? (statusText ? 'dirty' : 'clean') : 'unknown',
    changes: statusText ? statusText.split(/\r?\n/).filter(Boolean).length : 0,
    ...language,
    updatedAt,
    source,
  }
}

async function getRepositoryById(id: string) {
  const repos = await listRepositories()
  const repository = repos.find((repo) => repo.id === id)
  if (!repository) throw new HttpError(404, '仓库不存在')
  return repository
}

async function readConfig() {
  const raw = await readJson<Partial<RepositoryConfig>>(FILE, {})
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    manualPaths: Array.isArray(raw.manualPaths)
      ? raw.manualPaths.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function toPublicConfig(config: RepositoryConfig, exists: boolean): PublicRepositoryConfig {
  return {
    rootPath: config.rootPath,
    manualPaths: config.manualPaths,
    configured: Boolean((config.rootPath && exists) || config.manualPaths.length > 0),
    exists,
    manualCount: config.manualPaths.length,
  }
}

export async function getRepositoryConfig() {
  const config = await readConfig()
  return toPublicConfig(config, config.rootPath ? await isDirectory(config.rootPath) : false)
}

export async function updateRepositoryConfig(input: RepositoryConfigInput) {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) throw new HttpError(400, '仓库文件夹路径不能为空')

  const resolved = resolvePath(rootPath)
  if (!(await isDirectory(resolved))) {
    throw new HttpError(400, '仓库文件夹不存在或不是文件夹')
  }

  const current = await readConfig()
  const config: RepositoryConfig = { ...current, rootPath: resolved }
  await writeJson(FILE, config)
  return toPublicConfig(config, true)
}

export async function addManualRepository(input: RepositoryPathInput) {
  const repoPath = typeof input.path === 'string' ? input.path.trim() : ''
  if (!repoPath) throw new HttpError(400, '仓库路径不能为空')

  const resolved = resolvePath(repoPath)
  if (!(await isDirectory(resolved))) {
    throw new HttpError(400, '仓库路径不存在或不是文件夹')
  }

  const current = await readConfig()
  const existing = new Set(current.manualPaths.map(pathKey))
  if (!existing.has(pathKey(resolved))) {
    current.manualPaths = [...current.manualPaths, resolved]
    await writeJson(FILE, current)
  }

  return summarizeRepository(current.rootPath, resolved, 'manual')
}

export async function removeManualRepository(id: string) {
  const current = await readConfig()
  const next = current.manualPaths.filter(
    (repoPath) => Buffer.from(repoPath).toString('base64url') !== id,
  )
  if (next.length === current.manualPaths.length) {
    throw new HttpError(404, '手动仓库不存在')
  }

  const config: RepositoryConfig = { ...current, manualPaths: next }
  await writeJson(FILE, config)
  return toPublicConfig(
    config,
    config.rootPath ? await isDirectory(config.rootPath) : false,
  )
}

export async function listRepositories() {
  const config = await readConfig()
  const hasRoot = Boolean(config.rootPath)
  const rootExists = hasRoot ? await isDirectory(config.rootPath) : false
  if (!hasRoot && config.manualPaths.length === 0) {
    throw new HttpError(400, '尚未配置仓库文件夹或手动仓库')
  }
  if (hasRoot && !rootExists) {
    throw new HttpError(400, '已配置的仓库文件夹不存在')
  }

  const rootDirs = rootExists ? await findCandidateDirs(config.rootPath) : []
  const manualDirs = (
    await Promise.all(
      config.manualPaths.map(async (repoPath) =>
        (await isDirectory(repoPath)) ? repoPath : '',
      ),
    )
  ).filter(Boolean)

  const dirs = new Map<string, { dir: string; source: RepositorySummary['source'] }>()
  for (const dir of rootDirs) dirs.set(pathKey(dir), { dir, source: 'root' })
  for (const dir of manualDirs) dirs.set(pathKey(dir), { dir, source: 'manual' })

  const repos = await Promise.all(
    [...dirs.values()].map(({ dir, source }) =>
      summarizeRepository(config.rootPath, dir, source),
    ),
  )

  return repos.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getRepositoryDetail(id: string): Promise<RepositoryDetail> {
  const repository = await getRepositoryById(id)

  const [readme, tree] = await Promise.all([
    readReadme(repository.path),
    buildRepositoryTree(repository.path),
  ])

  return {
    repository,
    readme,
    tree,
  }
}

export async function updateRepositoryDescription(
  id: string,
  input: RepositoryDescriptionInput,
): Promise<RepositoryDetail> {
  const content = typeof input.content === 'string' ? input.content : ''
  if (content.length > MAX_DESCRIPTION_CHARS) {
    throw new HttpError(400, `简介不能超过 ${MAX_DESCRIPTION_CHARS} 个字符`)
  }

  const repository = await getRepositoryById(id)
  await fs.writeFile(path.join(repository.path, DESCRIPTION_FILE), content.trimEnd(), 'utf-8')
  return getRepositoryDetail(id)
}

export async function getRepositoryFileContent(
  id: string,
  relativePath: unknown,
): Promise<RepositoryFileContent> {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new HttpError(400, '文件路径不能为空')
  }

  const repository = await getRepositoryById(id)
  const target = safeRepositoryPath(repository.path, relativePath)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) throw new HttpError(404, '文件不存在')

  const previewType = previewTypeForPath(target)
  const ext = path.extname(target).slice(1).toLowerCase()
  const mime = mimeForPath(target)

  if (previewType === 'image' || previewType === 'binary') {
    return {
      path: relativePath.replace(/\\/g, '/'),
      name: path.basename(target),
      content: '',
      size: stat.size,
      truncated: false,
      language: ext || 'file',
      mime,
      previewType,
    }
  }

  const buffer = await fs.readFile(target)
  const truncated = buffer.length > MAX_FILE_CHARS
  const content = buffer.subarray(0, MAX_FILE_CHARS).toString('utf-8')

  return {
    path: relativePath.replace(/\\/g, '/'),
    name: path.basename(target),
    content,
    size: stat.size,
    truncated,
    language: ext || 'text',
    mime,
    previewType,
  }
}

export async function getRepositoryFileResource(
  id: string,
  relativePath: unknown,
): Promise<RepositoryFileResource> {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new HttpError(400, '文件路径不能为空')
  }

  const repository = await getRepositoryById(id)
  const target = safeRepositoryPath(repository.path, relativePath)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) throw new HttpError(404, '文件不存在')

  return {
    filePath: target,
    fileName: path.basename(target),
    mime: mimeForPath(target),
  }
}

type ZipSourceEntry = {
  archivePath: string
  absolutePath: string
  isDirectory: boolean
  mtime: Date
}

const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(dateInput: Date) {
  const date = dateInput.getFullYear() < 1980 ? new Date('1980-01-01T00:00:00Z') : dateInput
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { dosDate, dosTime }
}

function normalizeArchivePath(relativePath: string, isDirectory: boolean) {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\/+/, '')
  return isDirectory && normalized && !normalized.endsWith('/') ? `${normalized}/` : normalized
}

async function collectZipEntries(root: string, relativeDir = ''): Promise<ZipSourceEntry[]> {
  const absoluteDir = path.join(root, relativeDir)
  const dirents = await fs.readdir(absoluteDir, { withFileTypes: true })
  const entries: ZipSourceEntry[] = []

  for (const dirent of dirents) {
    if (SKIP_DIRS.has(dirent.name)) continue
    const childRelative = path.join(relativeDir, dirent.name)
    const absolutePath = path.join(root, childRelative)
    const stat = await fs.stat(absolutePath).catch(() => null)
    if (!stat) continue

    if (dirent.isDirectory()) {
      entries.push({
        archivePath: normalizeArchivePath(childRelative, true),
        absolutePath,
        isDirectory: true,
        mtime: stat.mtime,
      })
      entries.push(...(await collectZipEntries(root, childRelative)))
    } else if (dirent.isFile()) {
      entries.push({
        archivePath: normalizeArchivePath(childRelative, false),
        absolutePath,
        isDirectory: false,
        mtime: stat.mtime,
      })
    }
  }

  return entries
}

async function writeZipArchive(root: string, filePath: string) {
  const entries = await collectZipEntries(root)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath, 'utf-8')
    const content = entry.isDirectory ? Buffer.alloc(0) : await fs.readFile(entry.absolutePath)
    const compressed = entry.isDirectory ? content : deflateRawSync(content)
    const method = entry.isDirectory ? 0 : 8
    const crc = entry.isDirectory ? 0 : crc32(content)
    const { dosDate, dosTime } = dosDateTime(entry.mtime)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)

    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  await fs.writeFile(filePath, Buffer.concat([...localParts, centralDirectory, end]))
}

export async function createRepositoryArchive(id: string): Promise<RepositoryArchive> {
  const repository = await getRepositoryById(id)
  const decodedPath = decodeRepositoryId(id)
  if (!decodedPath || pathKey(decodedPath) !== pathKey(repository.path)) {
    throw new HttpError(400, '仓库标识无效')
  }

  const archiveDir = path.join(os.tmpdir(), '1052os-repository-archives')
  await fs.mkdir(archiveDir, { recursive: true })
  const safeName = repository.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'repository'
  const fileName = `${safeName}.zip`
  const filePath = path.join(archiveDir, `${safeName}-${randomUUID()}.zip`)
  await writeZipArchive(repository.path, filePath)

  return { filePath, fileName }
}
