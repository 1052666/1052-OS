import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { config as appConfig } from '../../config.js'
import { readJson, writeJson } from '../../storage.js'
import type {
  NoteFile,
  NoteFileInput,
  NoteFolderInput,
  NoteMoveInput,
  NotesConfig,
  NotesConfigInput,
  PublicNotesConfig,
  NoteTreeNode,
} from './notes.types.js'

const FILE = 'notes-config.json'
const DEFAULT_NOTES_DIR = 'notes'
const DEFAULT_CONFIG: NotesConfig = { rootPath: '' }
const MAX_TREE_DEPTH = 12
const MAX_TREE_ENTRIES = 1600
const MAX_FILE_CHARS = 600_000

const NOTE_EXTS = new Set(['.md', '.markdown'])
const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.trash',
  'node_modules',
  'dist',
  'build',
  'out',
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

function defaultNotesRootPath() {
  return path.join(appConfig.dataDir, DEFAULT_NOTES_DIR)
}

function normalizeRelativePath(input: string) {
  return input.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function ensureMarkdownFileName(name: string) {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').trim()
  if (!clean) throw new HttpError(400, '文件名不能为空')
  return NOTE_EXTS.has(path.extname(clean).toLowerCase()) ? clean : clean + '.md'
}

function ensureFolderName(name: string) {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').trim()
  if (!clean) throw new HttpError(400, '文件夹名不能为空')
  return clean
}

function safeNotePath(rootPath: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath)
  const target = path.resolve(rootPath, normalized)
  const root = path.resolve(rootPath)
  const relative = path.relative(root, target)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, '笔记路径无效')
  }

  return target
}

function isMarkdownFile(fileName: string) {
  return NOTE_EXTS.has(path.extname(fileName).toLowerCase())
}

async function readConfig() {
  const raw = await readJson<Partial<NotesConfig>>(FILE, {})
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    rootPath: typeof raw.rootPath === 'string' ? raw.rootPath : '',
  }
}

function toPublicConfig(config: NotesConfig, exists: boolean): PublicNotesConfig {
  return {
    rootPath: config.rootPath,
    configured: Boolean(config.rootPath && exists),
    exists,
    defaultRootPath: defaultNotesRootPath(),
  }
}

async function getConfiguredRoot() {
  const config = await readConfig()
  if (!config.rootPath) throw new HttpError(400, '尚未配置笔记目录')
  if (!(await isDirectory(config.rootPath))) {
    throw new HttpError(400, '已配置的笔记目录不存在')
  }
  return config.rootPath
}

function sortNodes(nodes: NoteTreeNode[]) {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

async function nodeMatchesQuery(target: string, name: string, query: string) {
  if (!query) return true
  if (name.toLowerCase().includes(query)) return true
  if (!isMarkdownFile(name)) return false

  try {
    const content = await fs.readFile(target, 'utf-8')
    return content.toLowerCase().includes(query)
  } catch {
    return false
  }
}

async function buildTree(
  rootPath: string,
  currentPath = rootPath,
  depth = 0,
  counter = { count: 0 },
  query = '',
): Promise<NoteTreeNode[]> {
  if (depth >= MAX_TREE_DEPTH || counter.count >= MAX_TREE_ENTRIES) return []

  let entries: DirectoryEntry[]
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: NoteTreeNode[] = []
  for (const entry of entries) {
    if (counter.count >= MAX_TREE_ENTRIES) break
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    if (!entry.isDirectory() && !isMarkdownFile(entry.name)) continue

    const fullPath = path.join(currentPath, entry.name)
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/')
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) continue

    if (entry.isDirectory()) {
      const children = await buildTree(rootPath, fullPath, depth + 1, counter, query)
      if (query && children.length === 0 && !entry.name.toLowerCase().includes(query)) {
        continue
      }

      counter.count += 1
      nodes.push({
        name: entry.name,
        relativePath,
        type: 'dir',
        size: 0,
        updatedAt: stat.mtimeMs,
        children,
      })
      continue
    }

    if (!(await nodeMatchesQuery(fullPath, entry.name, query))) continue
    counter.count += 1
    nodes.push({
      name: entry.name,
      relativePath,
      type: 'file',
      size: stat.size,
      updatedAt: stat.mtimeMs,
    })
  }

  return sortNodes(nodes)
}

export async function getNotesConfig() {
  const config = await readConfig()
  return toPublicConfig(config, config.rootPath ? await isDirectory(config.rootPath) : false)
}

export async function updateNotesConfig(input: NotesConfigInput) {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath) throw new HttpError(400, '笔记目录不能为空')

  const resolved = resolvePath(rootPath)
  await fs.mkdir(resolved, { recursive: true })

  const config: NotesConfig = { rootPath: resolved }
  await writeJson(FILE, config)
  return toPublicConfig(config, true)
}

export async function useDefaultNotesConfig() {
  const resolved = defaultNotesRootPath()
  await fs.mkdir(resolved, { recursive: true })

  const readmePath = path.join(resolved, 'README.md')
  if (!(await pathExists(readmePath))) {
    await fs.writeFile(
      readmePath,
      [
        '# 我的笔记',
        '',
        '这是 1052 OS 自动创建的默认笔记目录。',
        '',
        '- 你可以在这里创建 Markdown 笔记和文件夹。',
        '- 也可以随时在笔记页面切换为其他本地文件夹。',
        '- Agent 可以读取和管理这个目录下的全部笔记；默认权限下写入、删除或移动前仍需先告知并等待确认。',
        '',
      ].join('\n'),
      'utf-8',
    )
  }

  const config: NotesConfig = { rootPath: resolved }
  await writeJson(FILE, config)
  return toPublicConfig(config, true)
}

export async function getNotesTree(queryInput?: unknown) {
  const rootPath = await getConfiguredRoot()
  const query = typeof queryInput === 'string' ? queryInput.trim().toLowerCase() : ''
  return buildTree(rootPath, rootPath, 0, { count: 0 }, query)
}

export async function getNoteFile(relativePath: unknown): Promise<NoteFile> {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new HttpError(400, '笔记路径不能为空')
  }

  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, relativePath)
  if (!isMarkdownFile(target)) throw new HttpError(400, '只能读取 Markdown 笔记')

  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) throw new HttpError(404, '笔记不存在')
  if (stat.size > MAX_FILE_CHARS) throw new HttpError(400, '笔记文件过大')

  return {
    path: normalizeRelativePath(relativePath),
    name: path.basename(target),
    content: await fs.readFile(target, 'utf-8'),
    size: stat.size,
    updatedAt: stat.mtimeMs,
  }
}

export async function createNoteFile(input: NoteFileInput): Promise<NoteFile> {
  const folder = typeof input.path === 'string' ? normalizeRelativePath(input.path) : ''
  const name = ensureMarkdownFileName(typeof input.name === 'string' ? input.name : '未命名')
  const content = typeof input.content === 'string' ? input.content : ''
  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, path.posix.join(folder, name))

  if (await pathExists(target)) throw new HttpError(400, '笔记已存在')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf-8')
  return getNoteFile(path.relative(rootPath, target).replace(/\\/g, '/'))
}

export async function updateNoteFile(input: NoteFileInput): Promise<NoteFile> {
  if (typeof input.path !== 'string' || !input.path.trim()) {
    throw new HttpError(400, '笔记路径不能为空')
  }

  const content = typeof input.content === 'string' ? input.content : ''
  if (content.length > MAX_FILE_CHARS) throw new HttpError(400, '笔记内容过大')

  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, input.path)
  if (!isMarkdownFile(target)) throw new HttpError(400, '只能保存 Markdown 笔记')

  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) throw new HttpError(404, '笔记不存在')

  await fs.writeFile(target, content, 'utf-8')
  return getNoteFile(input.path)
}

export async function deleteNoteFile(relativePath: unknown) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new HttpError(400, '笔记路径不能为空')
  }

  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, relativePath)
  if (!isMarkdownFile(target)) throw new HttpError(400, '只能删除 Markdown 笔记')

  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) throw new HttpError(404, '笔记不存在')
  await fs.unlink(target)
  return { ok: true }
}

export async function createNoteFolder(input: NoteFolderInput) {
  const folder = typeof input.path === 'string' ? normalizeRelativePath(input.path) : ''
  const name = ensureFolderName(typeof input.name === 'string' ? input.name : '')
  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, path.posix.join(folder, name))

  if (await pathExists(target)) throw new HttpError(400, '文件夹已存在')
  await fs.mkdir(target, { recursive: true })
  return { ok: true }
}

export async function deleteNoteFolder(relativePath: unknown) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new HttpError(400, '文件夹路径不能为空')
  }

  const rootPath = await getConfiguredRoot()
  const target = safeNotePath(rootPath, relativePath)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isDirectory()) throw new HttpError(404, '文件夹不存在')
  await fs.rm(target, { recursive: true, force: true })
  return { ok: true }
}

export async function moveNoteEntry(input: NoteMoveInput) {
  if (typeof input.path !== 'string' || !input.path.trim()) {
    throw new HttpError(400, '源路径不能为空')
  }

  const targetDirInput = typeof input.targetDir === 'string' ? input.targetDir : ''
  const rootPath = await getConfiguredRoot()
  const source = safeNotePath(rootPath, input.path)
  const targetDir = targetDirInput ? safeNotePath(rootPath, targetDirInput) : rootPath
  const sourceStat = await fs.stat(source).catch(() => null)
  const targetDirStat = await fs.stat(targetDir).catch(() => null)

  if (!sourceStat) throw new HttpError(404, '源文件或文件夹不存在')
  if (!targetDirStat || !targetDirStat.isDirectory()) {
    throw new HttpError(400, '目标文件夹不存在')
  }

  if (sourceStat.isFile() && !isMarkdownFile(source)) {
    throw new HttpError(400, '只能移动 Markdown 笔记')
  }

  const destination = path.join(targetDir, path.basename(source))
  if (path.resolve(source) === path.resolve(destination)) return { ok: true }
  if (sourceStat.isDirectory()) {
    const relative = path.relative(source, destination)
    if (!relative || relative.startsWith('..') === false) {
      throw new HttpError(400, '不能把文件夹移动到自身或子文件夹')
    }
  }
  if (await pathExists(destination)) throw new HttpError(400, '目标位置已存在同名项目')

  await fs.rename(source, destination)
  return { ok: true }
}
