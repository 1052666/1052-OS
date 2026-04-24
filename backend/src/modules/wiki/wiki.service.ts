import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { httpError } from '../../http-error.js'
import {
  buildPageRaw,
  normalizePageFromRaw,
  parseFrontmatter,
} from './wiki.markdown.js'
import type {
  WikiCategory,
  WikiFrontmatter,
  WikiLogType,
  WikiPage,
  WikiRawFile,
  WikiSummary,
} from './wiki.types.js'
import { lintWiki } from './wiki.lint.js'

const WIKI_ROOT = path.join(config.dataDir, 'wiki')
const RAW_ROOT = path.join(WIKI_ROOT, 'raw')
const PAGE_ROOT = path.join(WIKI_ROOT, 'wiki')
const AGENT_WORKSPACE_ROOT = path.join(config.dataDir, 'agent-workspace')
const INDEX_PATH = '索引.md'
const LOG_PATH = '操作日志.md'
const CATEGORY_DIRS: Record<WikiCategory, string> = {
  entity: '实体',
  concept: '核心理念',
  synthesis: '综合分析',
}
const READABLE_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml'])
const PAGE_EXTENSIONS = new Set(['.md'])
const INDEX_START = '<!-- 1052:wiki-index:start -->'
const INDEX_END = '<!-- 1052:wiki-index:end -->'

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function normalizeRelativePath(value: unknown, options: { allowEmpty?: boolean; md?: boolean } = {}) {
  if (typeof value !== 'string') throw httpError(400, '路径必须是字符串')
  const cleaned = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned && options.allowEmpty) return ''
  if (!cleaned) throw httpError(400, '路径不能为空')
  if (path.isAbsolute(cleaned) || cleaned.split('/').some((part) => part === '..')) {
    throw httpError(400, '路径不能越过 Wiki 数据目录')
  }
  return options.md && !cleaned.toLowerCase().endsWith('.md') ? `${cleaned}.md` : cleaned
}

function resolveInside(root: string, relativePath: string) {
  const target = path.resolve(root, relativePath)
  const rootResolved = path.resolve(root)
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw httpError(400, '路径不能越过 Wiki 数据目录')
  }
  return target
}

async function writeFileAtomic(target: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, content)
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

async function createFileIfMissing(target: string, content: string) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.writeFile(target, content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

async function walkFiles(root: string, extensions?: Set<string>) {
  await fs.mkdir(root, { recursive: true })
  const results: string[] = []
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (!extensions || extensions.has(path.extname(entry.name).toLowerCase())) {
        results.push(path.relative(root, absolute).replace(/\\/g, '/'))
      }
    }
  }
  await walk(root)
  return results.sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export async function ensureWikiStructure() {
  await Promise.all([
    fs.mkdir(RAW_ROOT, { recursive: true }),
    fs.mkdir(path.join(PAGE_ROOT, CATEGORY_DIRS.entity), { recursive: true }),
    fs.mkdir(path.join(PAGE_ROOT, CATEGORY_DIRS.concept), { recursive: true }),
    fs.mkdir(path.join(PAGE_ROOT, CATEGORY_DIRS.synthesis), { recursive: true }),
  ])

  const index = resolveInside(PAGE_ROOT, INDEX_PATH)
  await createFileIfMissing(index, `# 索引\n\n${INDEX_START}\n\n${INDEX_END}\n`)
  const log = resolveInside(PAGE_ROOT, LOG_PATH)
  await createFileIfMissing(log, '# 操作日志\n')
}

export function isWikiReadableRawPath(relativePath: string) {
  return READABLE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

export async function listWikiRawFiles(): Promise<WikiRawFile[]> {
  await ensureWikiStructure()
  const files = await walkFiles(RAW_ROOT)
  return Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(resolveInside(RAW_ROOT, file))
      return {
        path: file,
        name: path.basename(file),
        size: stat.size,
        updatedAt: stat.mtimeMs,
        readable: isWikiReadableRawPath(file),
      }
    }),
  )
}

export async function readWikiRawFile(inputPath: unknown, maxChars = 24000) {
  await ensureWikiStructure()
  const relativePath = normalizeRelativePath(inputPath)
  if (!isWikiReadableRawPath(relativePath)) throw httpError(400, '该 raw 文件类型暂不支持读取正文')
  const target = resolveInside(RAW_ROOT, relativePath)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat?.isFile()) throw httpError(404, 'raw 文件不存在')
  const content = await fs.readFile(target, 'utf-8')
  return {
    path: relativePath,
    name: path.basename(relativePath),
    size: stat.size,
    updatedAt: stat.mtimeMs,
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars,
  }
}

export async function saveWikiRawUpload(input: {
  buffer: Buffer
  fileName: string
  overwrite?: boolean
}) {
  await ensureWikiStructure()
  const name = normalizeRelativePath(input.fileName)
  const ext = path.extname(name).toLowerCase()
  if (!READABLE_EXTENSIONS.has(ext)) throw httpError(400, `暂不支持上传 ${ext || '无扩展名'} 文件`)
  const target = resolveInside(RAW_ROOT, name)
  if (!input.overwrite && (await exists(target))) throw httpError(409, '同名 raw 文件已存在')
  await writeFileAtomic(target, input.buffer)
  await appendWikiLog({
    type: 'raw-upload',
    summary: `上传 raw 文件 ${name}`,
    targets: [name],
  })
  const stat = await fs.stat(target)
  return { path: name, name: path.basename(name), size: stat.size, updatedAt: stat.mtimeMs, readable: true }
}

export async function copyAgentWorkspaceFileToRaw(input: {
  sourcePath: unknown
  targetPath?: unknown
  overwrite?: boolean
}) {
  await ensureWikiStructure()
  const sourceRelative = normalizeRelativePath(input.sourcePath)
  const source = resolveInside(AGENT_WORKSPACE_ROOT, sourceRelative)
  const stat = await fs.stat(source).catch(() => null)
  if (!stat?.isFile()) throw httpError(404, 'Agent 工作区文件不存在')
  const targetRelative = input.targetPath
    ? normalizeRelativePath(input.targetPath)
    : path.basename(sourceRelative)
  const buffer = await fs.readFile(source)
  return saveWikiRawUpload({
    buffer,
    fileName: targetRelative,
    overwrite: input.overwrite === true,
  })
}

function categoryFromPath(relativePath: string): WikiCategory {
  if (relativePath.startsWith(`${CATEGORY_DIRS.entity}/`)) return 'entity'
  if (relativePath.startsWith(`${CATEGORY_DIRS.synthesis}/`)) return 'synthesis'
  return 'concept'
}

function defaultPagePath(title: string, category: WikiCategory) {
  const safeTitle = title.trim().replace(/[<>:"|?*\r\n]/g, '-').replace(/\/+/g, '-')
  return `${CATEGORY_DIRS[category]}/${safeTitle || '未命名'}.md`
}

function normalizePagePath(value: unknown, category?: WikiCategory, title?: string) {
  if (typeof value === 'string' && value.trim()) {
    return normalizeRelativePath(value, { md: true })
  }
  if (!category || !title) throw httpError(400, '缺少 Wiki 页面路径或标题')
  return normalizeRelativePath(defaultPagePath(title, category), { md: true })
}

export async function listWikiPages(query?: unknown): Promise<WikiPage[]> {
  await ensureWikiStructure()
  const files = (await walkFiles(PAGE_ROOT, PAGE_EXTENSIONS)).filter(
    (file) => file !== INDEX_PATH && file !== LOG_PATH,
  )
  const pages = await Promise.all(
    files.map(async (file) => {
      const target = resolveInside(PAGE_ROOT, file)
      const stat = await fs.stat(target)
      const raw = await fs.readFile(target, 'utf-8')
      return normalizePageFromRaw({ path: file, raw, size: stat.size, updatedAt: stat.mtimeMs })
    }),
  )
  const pathSet = new Set(pages.map((page) => page.path.replace(/\.md$/i, '')))
  const withBacklinks = pages.map((page) => ({
    ...page,
    backlinks: pages
      .filter((candidate) => candidate.links.some((link) => link === page.path.replace(/\.md$/i, '')))
      .map((candidate) => candidate.path),
  }))
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return withBacklinks
    .filter((page) => !keyword || JSON.stringify(page).toLowerCase().includes(keyword))
    .map((page) => ({
      ...page,
      links: page.links.filter((link) => pathSet.has(link) || pathSet.has(`${link}.md`)),
    }))
}

export async function readWikiPage(inputPath: unknown) {
  await ensureWikiStructure()
  const relativePath = normalizeRelativePath(inputPath, { md: true })
  const target = resolveInside(PAGE_ROOT, relativePath)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat?.isFile()) throw httpError(404, 'Wiki 页面不存在')
  const raw = await fs.readFile(target, 'utf-8')
  const pages = await listWikiPages()
  const backlinks = pages
    .filter((page) => page.links.some((link) => link === relativePath.replace(/\.md$/i, '')))
    .map((page) => page.path)
  return normalizePageFromRaw({ path: relativePath, raw, size: stat.size, updatedAt: stat.mtimeMs, backlinks })
}

function normalizeFrontmatter(input: {
  path: string
  title?: unknown
  category?: unknown
  tags?: unknown
  sources?: unknown
  summary?: unknown
  raw?: string
}): WikiFrontmatter {
  const parsed = input.raw ? parseFrontmatter(input.raw).frontmatter : null
  const category =
    input.category === 'entity' || input.category === 'concept' || input.category === 'synthesis'
      ? input.category
      : parsed?.category ?? categoryFromPath(input.path)
  const sources = Array.isArray(input.sources)
    ? input.sources.map(String).map((item) => item.trim()).filter(Boolean)
    : parsed?.sources ?? []
  return {
    tags: Array.isArray(input.tags)
      ? input.tags.map(String).map((item) => item.trim()).filter(Boolean)
      : parsed?.tags ?? [],
    category,
    source_count: sources.length,
    last_updated: new Date().toISOString().slice(0, 10),
    sources,
    summary:
      typeof input.summary === 'string' && input.summary.trim()
        ? input.summary.trim()
        : parsed?.summary ?? (typeof input.title === 'string' ? input.title.trim() : ''),
  }
}

export async function writeWikiPage(input: {
  path?: unknown
  title?: unknown
  category?: unknown
  tags?: unknown
  sources?: unknown
  summary?: unknown
  content?: unknown
}) {
  await ensureWikiStructure()
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const category =
    input.category === 'entity' || input.category === 'concept' || input.category === 'synthesis'
      ? input.category
      : undefined
  const relativePath = normalizePagePath(input.path, category, title)
  const body =
    typeof input.content === 'string' && input.content.trim()
      ? input.content
      : `# ${title || path.basename(relativePath, '.md')}\n\n## 概述\n\n## 关键观点\n\n## 关联\n\n## 来源\n`
  const frontmatter = normalizeFrontmatter({ ...input, path: relativePath })
  const raw = buildPageRaw(frontmatter, body)
  await writeFileAtomic(resolveInside(PAGE_ROOT, relativePath), raw)
  await rebuildWikiIndex()
  await appendWikiLog({ type: 'manual-update', summary: `写入 Wiki 页面 ${relativePath}`, targets: [relativePath] })
  return readWikiPage(relativePath)
}

export async function appendWikiPageSection(input: {
  path: unknown
  heading?: unknown
  content: unknown
}) {
  await ensureWikiStructure()
  const page = await readWikiPage(input.path)
  const heading = typeof input.heading === 'string' && input.heading.trim() ? input.heading.trim() : '补充'
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) throw httpError(400, '追加内容不能为空')
  const parsed = parseFrontmatter(page.raw)
  const frontmatter = normalizeFrontmatter({
    path: page.path,
    raw: page.raw,
    sources: parsed.frontmatter?.sources,
    tags: parsed.frontmatter?.tags,
    summary: parsed.frontmatter?.summary,
  })
  const body = `${parsed.body.trimEnd()}\n\n## ${heading}\n\n${content}\n`
  await writeFileAtomic(resolveInside(PAGE_ROOT, page.path), buildPageRaw(frontmatter, body))
  await rebuildWikiIndex()
  await appendWikiLog({ type: 'manual-update', summary: `追加 Wiki 页面 ${page.path}`, targets: [page.path] })
  return readWikiPage(page.path)
}

export async function rebuildWikiIndex() {
  await ensureWikiStructure()
  const pages = await listWikiPages()
  const generated = [
    INDEX_START,
    '',
    '| 页面 | 标题 | 分类 | 摘要 | 来源数 | 最近更新 | Tags |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...pages.map((page) =>
      [
        `[[${page.path.replace(/\.md$/i, '')}]]`,
        page.title,
        page.category,
        page.summary || '-',
        String(page.sources.length),
        page.lastUpdated || '-',
        page.tags.join(', ') || '-',
      ].join(' | '),
    ).map((line) => `| ${line} |`),
    '',
    INDEX_END,
    '',
  ].join('\n')
  const target = resolveInside(PAGE_ROOT, INDEX_PATH)
  const current = (await fs.readFile(target, 'utf-8').catch(() => '# 索引\n\n')).trimEnd()
  const next =
    current.includes(INDEX_START) && current.includes(INDEX_END)
      ? current.replace(new RegExp(`${INDEX_START}[\\s\\S]*${INDEX_END}`), generated.trimEnd())
      : `${current}\n\n${generated}`
  await writeFileAtomic(target, `${next.trimEnd()}\n`)
  return { ok: true, pageCount: pages.length, path: INDEX_PATH }
}

export async function appendWikiLog(input: {
  type: WikiLogType
  summary: string
  targets?: string[]
}) {
  await ensureWikiStructure()
  const target = resolveInside(PAGE_ROOT, LOG_PATH)
  const line = `\n- ${new Date().toISOString()} | ${input.type} | ${input.summary}${
    input.targets?.length ? ` | ${input.targets.join(', ')}` : ''
  }\n`
  await fs.appendFile(target, line)
  return { ok: true, path: LOG_PATH }
}

export async function readWikiLog(maxChars = 20000) {
  await ensureWikiStructure()
  const content = await fs.readFile(resolveInside(PAGE_ROOT, LOG_PATH), 'utf-8')
  return { path: LOG_PATH, content: content.slice(-maxChars), truncated: content.length > maxChars }
}

export async function getWikiSummary(): Promise<WikiSummary> {
  const [raw, pages, lint] = await Promise.all([listWikiRawFiles(), listWikiPages(), lintWiki()])
  const lastUpdated = [...raw.map((item) => item.updatedAt), ...pages.map((item) => item.updatedAt)]
    .filter((item) => Number.isFinite(item))
    .sort((a, b) => b - a)[0]
  return {
    rawCount: raw.length,
    pageCount: pages.length,
    brokenLinkCount: lint.brokenLinks.length,
    orphanPageCount: lint.orphanPages.length,
    lastUpdated: lastUpdated ?? null,
  }
}

export async function buildWikiIngestPreview(input: { rawPaths?: unknown; maxChars?: unknown }) {
  const rawPaths = Array.isArray(input.rawPaths) ? input.rawPaths.map(String) : []
  if (rawPaths.length === 0) throw httpError(400, '需要提供 rawPaths')
  const files = await Promise.all(rawPaths.slice(0, 10).map((item) => readWikiRawFile(item, 6000)))
  return {
    rawFiles: files.map((file) => ({
      path: file.path,
      size: file.size,
      truncated: file.truncated,
      excerpt: file.content.slice(0, typeof input.maxChars === 'number' ? input.maxChars : 1200),
    })),
    suggestedWorkflow: [
      '先提炼 3-5 个关键点给用户确认。',
      '按实体、核心理念、综合分析拆分页面。',
      '写入后重建索引并追加操作日志。',
    ],
  }
}

export async function commitWikiIngest(input: { pages?: unknown; rawPaths?: unknown }) {
  const pages = Array.isArray(input.pages) ? input.pages : []
  if (pages.length === 0) throw httpError(400, '需要提供 pages')
  const written: WikiPage[] = []
  for (const page of pages) {
    written.push(await writeWikiPage((page ?? {}) as Record<string, unknown>))
  }
  await appendWikiLog({
    type: 'ingest',
    summary: `摄取 raw 并写入 ${written.length} 个 Wiki 页面`,
    targets: written.map((page) => page.path),
  })
  return { pages: written, rawPaths: Array.isArray(input.rawPaths) ? input.rawPaths : [] }
}

export async function writeWikiQueryBack(input: {
  title?: unknown
  content?: unknown
  sources?: unknown
  tags?: unknown
  summary?: unknown
}) {
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '综合分析'
  const page = await writeWikiPage({
    path: defaultPagePath(title, 'synthesis'),
    title,
    category: 'synthesis',
    tags: input.tags,
    sources: input.sources,
    summary: input.summary,
    content:
      typeof input.content === 'string' && input.content.trim()
        ? input.content
        : `# ${title}\n\n## 结论\n\n## 依据\n\n## 后续\n`,
  })
  await appendWikiLog({ type: 'query-writeback', summary: `回写综合分析 ${page.path}`, targets: [page.path] })
  return page
}

export async function fixWikiLint() {
  const index = await rebuildWikiIndex()
  await appendWikiLog({ type: 'lint', summary: '执行 lint 自动修复：重建索引' })
  return { ok: true, fixed: ['index-rebuild'], index }
}

export const wikiPaths = {
  root: WIKI_ROOT,
  rawRoot: RAW_ROOT,
  pageRoot: PAGE_ROOT,
  indexPath: INDEX_PATH,
  logPath: LOG_PATH,
  categoryDirs: CATEGORY_DIRS,
}
