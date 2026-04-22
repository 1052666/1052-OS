import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import type {
  SkillDetail,
  SkillInput,
  SkillInstallInput,
  SkillItem,
  SkillMarketplaceInstallInput,
  SkillMarketplaceItem,
  SkillMarketplacePreview,
  SkillMarketplacePreviewInput,
  SkillMarketplaceSearchInput,
} from './skills.types.js'

const SKILLS_DIR = 'skills'
const SKILL_FILE = 'SKILL.md'
const BUNDLED_SKILLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../builtin-skills',
)
const BUNDLED_SEED_STATE_FILE = '.bundled-seeded.json'
const MAX_SKILL_CHARS = 80_000
const SKILLS_SH = 'https://skills.sh'
const DEFAULT_MARKETPLACE_FILE_LIMIT = 1000
const DEFAULT_MARKETPLACE_BYTE_LIMIT = 100 * 1024 * 1024
const HARD_MARKETPLACE_FILE_LIMIT = 5000
const HARD_MARKETPLACE_BYTE_LIMIT = 500 * 1024 * 1024
const MARKETPLACE_ZIP_DOWNLOAD_LIMIT = 500 * 1024 * 1024
const MARKETPLACE_INDEX_TTL_MS = 5 * 60 * 1000
const MARKETPLACE_PREVIEW_FILE_LIMIT = 512 * 1024
const MARKETPLACE_PREVIEW_CHAR_LIMIT = 60_000

const MARKETPLACE_PREVIEW_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.sh',
  '.ps1',
  '.bat',
  '.sql',
  '.csv',
  '.env',
])

const MARKETPLACE_PREVIEW_FILENAMES = new Set([
  'skill.md',
  'readme',
  'readme.md',
  'license',
  'license.txt',
  'requirements.txt',
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'dockerfile',
  'makefile',
])

type RepositoryArchiveEntry = {
  repoPath: string
  type: 'file' | 'directory'
  size: number
}

type RepositoryArchiveIndex = {
  entries: RepositoryArchiveEntry[]
  ref: string
}

type MarketplaceDirectory = {
  owner: string
  repo: string
  skill: string
  ref: string
  dir: string
  files: MarketplaceFile[]
  directories: string[]
  totalBytes: number
}

type MarketplaceFile = {
  path: string
  relativePath: string
  size: number
}

type BundledSeedState = {
  installedIds: string[]
}

const marketplaceIndexCache = new Map<string, { expiresAt: number; index: RepositoryArchiveIndex }>()

function skillsRoot() {
  return path.join(config.dataDir, SKILLS_DIR)
}

function bundledSeedStatePath() {
  return path.join(skillsRoot(), BUNDLED_SEED_STATE_FILE)
}

function normalizeId(value: string) {
  const id = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/gu, '-')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new HttpError(400, 'Skill id cannot be empty')
  if (id === '.' || id === '..' || id.includes('..') || /[\\/]/.test(id)) {
    throw new HttpError(400, 'Skill id is invalid')
  }
  return id
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLimit(value: unknown) {
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(limit)) return 20
  return Math.max(1, Math.min(50, Math.floor(limit)))
}

function normalizeMarketplaceRelativePath(value: unknown) {
  const relativePath = normalizeText(value).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relativePath) return SKILL_FILE
  if (relativePath.includes('..')) throw new HttpError(400, 'Marketplace preview path is invalid')
  return relativePath
}

function parseMarketplaceId(idInput: unknown) {
  const id = normalizeText(idInput)
  const parts = id.split('/')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new HttpError(400, 'Marketplace skill id must be owner/repo/skill')
  }
  return { id, owner: parts[0]!, repo: parts[1]!, skill: parts[2]! }
}

function looksLikeTextBuffer(bytes: Buffer) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048))
  for (const byte of sample) {
    if (byte === 0) return false
  }
  return true
}

function isMarketplacePreviewableFile(file: MarketplaceFile) {
  if (file.size > MARKETPLACE_PREVIEW_FILE_LIMIT) return false
  const normalized = file.relativePath.toLowerCase()
  const basename = path.posix.basename(normalized)
  if (MARKETPLACE_PREVIEW_FILENAMES.has(basename)) return true
  const extension = path.posix.extname(basename)
  return MARKETPLACE_PREVIEW_EXTENSIONS.has(extension)
}

function marketplacePreviewPriority(relativePath: string) {
  const normalized = relativePath.toLowerCase()
  if (normalized === SKILL_FILE.toLowerCase()) return 0
  if (normalized === 'readme.md' || normalized === 'readme') return 1
  if (normalized === 'license.txt' || normalized === 'license') return 2
  if (normalized.startsWith('references/')) return 3
  if (normalized.startsWith('scripts/')) return 4
  if (normalized.startsWith('assets/')) return 5
  return 6
}

function listMarketplacePreviewFiles(files: MarketplaceFile[]) {
  return files
    .filter(isMarketplacePreviewableFile)
    .sort((a, b) => {
      const priorityDiff = marketplacePreviewPriority(a.relativePath) - marketplacePreviewPriority(b.relativePath)
      if (priorityDiff !== 0) return priorityDiff
      return a.relativePath.localeCompare(b.relativePath, 'zh-CN')
    })
    .slice(0, 24)
    .map((file) => file.relativePath)
}

function inferMarketplacePreviewFormat(relativePath: string): SkillMarketplacePreview['format'] {
  const normalized = relativePath.toLowerCase()
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'markdown'
  const extension = path.posix.extname(normalized)
  if (
    [
      '.json',
      '.jsonc',
      '.yaml',
      '.yml',
      '.toml',
      '.xml',
      '.html',
      '.css',
      '.js',
      '.mjs',
      '.cjs',
      '.ts',
      '.tsx',
      '.jsx',
      '.py',
      '.rb',
      '.go',
      '.rs',
      '.java',
      '.kt',
      '.swift',
      '.php',
      '.sh',
      '.ps1',
      '.bat',
      '.sql',
      '.env',
    ].includes(extension)
  ) {
    return 'code'
  }
  return 'text'
}

function skillDir(id: string) {
  return path.join(skillsRoot(), normalizeId(id))
}

function skillFilePath(id: string) {
  return path.join(skillDir(id), SKILL_FILE)
}

function assertInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, 'Skill file path is invalid')
  }
}

async function ensureSkillsRoot() {
  await fs.mkdir(skillsRoot(), { recursive: true })
}

async function readBundledSeedState(): Promise<Set<string>> {
  const raw = await fs
    .readFile(bundledSeedStatePath(), 'utf-8')
    .then((content) => JSON.parse(content) as Partial<BundledSeedState>)
    .catch(() => null)
  const installedIds = Array.isArray(raw?.installedIds)
    ? raw.installedIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    : []
  return new Set(installedIds)
}

async function writeBundledSeedState(installedIds: Set<string>) {
  await fs.writeFile(
    bundledSeedStatePath(),
    JSON.stringify(
      {
        installedIds: [...installedIds].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      } satisfies BundledSeedState,
      null,
      2,
    ),
    'utf-8',
  )
}

async function resetDir(target: string) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
}

async function fileExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseFrontmatter(body: string) {
  if (!body.startsWith('---')) return {}
  const end = body.indexOf('\n---', 3)
  if (end === -1) return {}
  const raw = body.slice(3, end).trim()
  const result: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    result[match[1]!.trim()] = match[2]!.trim().replace(/^["']|["']$/g, '')
  }
  return result
}

function stripFrontmatter(body: string) {
  if (!body.startsWith('---')) return body.trim()
  const end = body.indexOf('\n---', 3)
  return end === -1 ? body.trim() : body.slice(end + 4).trim()
}

function titleFromBody(body: string) {
  const title = stripFrontmatter(body).match(/^#\s+(.+)$/m)?.[1]?.trim()
  return title || ''
}

function descriptionFromBody(body: string) {
  const content = stripFrontmatter(body)
  const paragraph = content
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+/gm, '').trim())
    .find(Boolean)
  return paragraph?.slice(0, 220) ?? ''
}

function buildSkillMarkdown(input: SkillInput) {
  const name = normalizeText(input.name)
  const description = normalizeText(input.description)
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!name) throw new HttpError(400, 'Skill name cannot be empty')
  if (!description) throw new HttpError(400, 'Skill description cannot be empty')

  if (body.startsWith('---')) return body

  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `enabled: ${input.enabled === false ? 'false' : 'true'}`,
    '---',
    '',
    `# ${name}`,
    '',
    description,
    '',
    '## Workflow',
    '',
    body || '- Follow the user request using this skill when its description matches the task.',
    '',
    '## Progressive Disclosure',
    '',
    '- Keep this SKILL.md concise.',
    '- Put detailed references in references/ and load them only when needed.',
    '- Put deterministic helpers in scripts/ and static templates/assets in assets/.',
    '',
  ].join('\n')
}

async function listNames(target: string) {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true })
    return entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  } catch {
    return []
  }
}

async function readSkillSummary(id: string): Promise<SkillItem | null> {
  const file = skillFilePath(id)
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) return null
  const body = await fs.readFile(file, 'utf-8')
  const meta = parseFrontmatter(body)
  return {
    id,
    name: meta.name || titleFromBody(body) || id,
    description: meta.description || descriptionFromBody(body),
    enabled: meta.enabled !== 'false',
    path: file,
    updatedAt: stat.mtimeMs,
    size: stat.size,
  }
}

export async function listSkills() {
  await ensureSkillsRoot()
  const entries = await fs.readdir(skillsRoot(), { withFileTypes: true }).catch(() => [])
  const items = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readSkillSummary(entry.name)),
  )
  return items
    .filter((item): item is SkillItem => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export async function ensureBundledSkillsInstalled() {
  await ensureSkillsRoot()
  const bundledEntries = await fs
    .readdir(BUNDLED_SKILLS_DIR, { withFileTypes: true })
    .catch(() => [])
  if (bundledEntries.length === 0) {
    return { installed: [] as string[], skipped: [] as string[] }
  }

  const seededIds = await readBundledSeedState()
  const installed: string[] = []
  const skipped: string[] = []
  let stateChanged = false

  for (const entry of bundledEntries) {
    if (!entry.isDirectory()) continue
    const id = normalizeId(entry.name)
    const sourceDir = path.join(BUNDLED_SKILLS_DIR, entry.name)
    const sourceSkillFile = path.join(sourceDir, SKILL_FILE)
    if (!(await fileExists(sourceSkillFile))) continue
    if (seededIds.has(id)) {
      skipped.push(id)
      continue
    }

    const targetDir = skillDir(id)
    const targetSkillFile = path.join(targetDir, SKILL_FILE)
    if (await fileExists(targetSkillFile)) {
      seededIds.add(id)
      skipped.push(id)
      stateChanged = true
      continue
    }

    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    })
    seededIds.add(id)
    installed.push(id)
    stateChanged = true
  }

  if (stateChanged) {
    await writeBundledSeedState(seededIds)
  }

  return { installed, skipped }
}

export async function getEnabledSkillIndex() {
  const skills = (await listSkills()).filter((skill) => skill.enabled)
  return skills.map(({ id, name, description, updatedAt }) => ({ id, name, description, updatedAt }))
}

export async function readSkill(idInput: unknown): Promise<SkillDetail> {
  const id = normalizeId(normalizeText(idInput))
  const summary = await readSkillSummary(id)
  if (!summary) throw new HttpError(404, 'Skill does not exist')
  if (summary.size > MAX_SKILL_CHARS) throw new HttpError(400, 'Skill file is too large')
  const dir = skillDir(id)
  return {
    ...summary,
    body: await fs.readFile(skillFilePath(id), 'utf-8'),
    references: await listNames(path.join(dir, 'references')),
    scripts: await listNames(path.join(dir, 'scripts')),
    assets: await listNames(path.join(dir, 'assets')),
  }
}

export async function createSkill(input: SkillInput) {
  await ensureSkillsRoot()
  const name = normalizeText(input.name)
  const id = normalizeId(normalizeText(input.id) || name)
  const dir = skillDir(id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(skillFilePath(id), buildSkillMarkdown(input), 'utf-8')
  return readSkill(id)
}

export async function deleteSkill(idInput: unknown) {
  const id = normalizeId(normalizeText(idInput))
  const dir = skillDir(id)
  if (!(await fileExists(skillFilePath(id)))) throw new HttpError(404, 'Skill does not exist')
  await fs.rm(dir, { recursive: true, force: true })
  return { ok: true, id }
}

function normalizeInstallUrl(raw: string) {
  const url = raw.trim()
  if (!url) throw new HttpError(400, 'URL cannot be empty')
  const githubBlob = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (githubBlob) {
    return `https://raw.githubusercontent.com/${githubBlob[1]}/${githubBlob[2]}/${githubBlob[3]}`
  }
  return url
}

export async function installSkillFromUrl(input: SkillInstallInput) {
  const url = normalizeInstallUrl(normalizeText(input.url))
  const response = await fetch(url, { headers: { 'user-agent': '1052-os-skill-installer' } })
  if (!response.ok) throw new HttpError(400, `Failed to download skill: HTTP ${response.status}`)
  const body = (await response.text()).trim()
  if (!body) throw new HttpError(400, 'Downloaded skill is empty')
  if (body.length > MAX_SKILL_CHARS) throw new HttpError(400, 'Downloaded skill is too large')
  const meta = parseFrontmatter(body)
  const name = meta.name || titleFromBody(body)
  const id = normalizeId(normalizeText(input.id) || name || path.basename(new URL(url).pathname, '.md'))
  return createSkill({
    id,
    name: name || id,
    description: meta.description || descriptionFromBody(body) || `Installed from ${url}`,
    body,
    enabled: input.enabled,
  })
}

function parseSkillsShSearch(html: string, limit: number): SkillMarketplaceItem[] {
  const results: SkillMarketplaceItem[] = []
  const seen = new Set<string>()
  const regex =
    /href="\/([^"\/]+)\/([^"\/]+)\/([^"\/]+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<p[^>]*>([^<]+)<\/p>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g

  for (const match of html.matchAll(regex)) {
    const owner = decodeHtml(match[1] ?? '')
    const repo = decodeHtml(match[2] ?? '')
    const skill = decodeHtml(match[3] ?? '')
    const name = decodeHtml(match[4] ?? skill)
    const repoLabel = decodeHtml(match[5] ?? `${owner}/${repo}`)
    const downloads = decodeHtml(match[6] ?? '')
    const id = `${owner}/${repo}/${skill}`
    if (!owner || !repo || !skill || seen.has(id)) continue
    seen.add(id)
    results.push({
      id,
      name,
      owner,
      repo,
      source: 'skills.sh',
      url: `${SKILLS_SH}/${id}`,
      installCommand: `npx skills add https://github.com/${repoLabel} --skill ${skill}`,
      downloads,
    })
    if (results.length >= limit) break
  }

  return results
}

export async function searchSkillMarketplace(input: SkillMarketplaceSearchInput = {}) {
  const query = normalizeText(input.query)
  const limit = normalizeLimit(input.limit)
  const url = new URL(SKILLS_SH)
  if (query) url.searchParams.set('q', query)

  const response = await fetch(url, { headers: { 'user-agent': '1052-os-skill-installer' } })
  if (!response.ok) throw new HttpError(502, `Skill marketplace search failed: HTTP ${response.status}`)
  const html = await response.text()
  return {
    source: 'skills.sh' as const,
    query,
    items: parseSkillsShSearch(html, limit),
  }
}

function marketplaceCacheKey(owner: string, repo: string, ref: string) {
  return `${owner}/${repo}@${ref}`
}

async function fetchRepositoryArchive(owner: string, repo: string, ref: string) {
  const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${ref}`
  const response = await fetch(zipUrl, { headers: { 'user-agent': '1052-os-skill-installer' } }).catch(() => null)
  if (!response?.ok) {
    throw new HttpError(400, `Failed to download repository archive: HTTP ${response?.status ?? 'network'}`)
  }

  const zipBuffer = await readResponseBufferLimited(response, MARKETPLACE_ZIP_DOWNLOAD_LIMIT)
  return unzipper.Open.buffer(zipBuffer)
}

async function readRepositoryArchiveIndex(owner: string, repo: string, ref: string) {
  const cacheKey = marketplaceCacheKey(owner, repo, ref)
  const cached = marketplaceIndexCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.index

  const archive = await fetchRepositoryArchive(owner, repo, ref)
  const entries: RepositoryArchiveEntry[] = []

  for (const entry of archive.files) {
    const normalizedPath = entry.path.replace(/\\/g, '/')
    const slashIndex = normalizedPath.indexOf('/')
    if (slashIndex === -1) continue
    const repoPath = normalizedPath
      .slice(slashIndex + 1)
      .replace(/\/$/, '')
      .trim()
    if (!repoPath) continue
    entries.push({
      repoPath,
      type: entry.type === 'Directory' ? 'directory' : 'file',
      size: entry.type === 'File' ? (entry.uncompressedSize ?? 0) : 0,
    })
  }

  const index = { ref, entries }
  marketplaceIndexCache.set(cacheKey, {
    expiresAt: Date.now() + MARKETPLACE_INDEX_TTL_MS,
    index,
  })
  return index
}

function collectMarketplaceDirectory(index: RepositoryArchiveIndex, dir: string) {
  const prefix = `${dir}/`
  const files = index.entries
    .filter((entry) => entry.type === 'file' && entry.repoPath.startsWith(prefix))
    .map((entry) => ({
      path: entry.repoPath,
      relativePath: entry.repoPath.slice(prefix.length),
      size: entry.size,
    }))
    .filter((file) => file.relativePath.length > 0)

  if (!files.some((file) => file.relativePath.toLowerCase() === SKILL_FILE.toLowerCase())) {
    return null
  }

  const directories = new Set<string>()
  let totalBytes = 0
  for (const file of files) {
    totalBytes += file.size
    if (file.relativePath.includes('/')) {
      directories.add(file.relativePath.split('/')[0]!)
    }
  }

  return {
    files,
    directories: [...directories].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    totalBytes,
  }
}

async function findGithubSkillDirectory(owner: string, repo: string, skill: string): Promise<MarketplaceDirectory | null> {
  const candidates = [
    { ref: 'main', dir: `skills/${skill}` },
    { ref: 'master', dir: `skills/${skill}` },
    { ref: 'main', dir: skill },
    { ref: 'master', dir: skill },
  ]
  for (const candidate of candidates) {
    const index = await readRepositoryArchiveIndex(owner, repo, candidate.ref).catch(() => null)
    if (!index) continue
    const collected = collectMarketplaceDirectory(index, candidate.dir)
    if (!collected) continue
    return {
      owner,
      repo,
      skill,
      ref: candidate.ref,
      dir: candidate.dir,
      files: collected.files,
      directories: collected.directories,
      totalBytes: collected.totalBytes,
    }
  }
  return null
}

export async function inspectSkillMarketplaceInstall(input: SkillMarketplaceInstallInput) {
  const { id, owner, repo, skill } = parseMarketplaceId(input.id)
  const directory = await findGithubSkillDirectory(owner, repo, skill)
  if (!directory) throw new HttpError(400, `Could not locate Skill directory for marketplace skill ${id}`)
  const previewFiles = listMarketplacePreviewFiles(directory.files)

  const exceedsDefaultLimit =
    directory.files.length > DEFAULT_MARKETPLACE_FILE_LIMIT ||
    directory.totalBytes > DEFAULT_MARKETPLACE_BYTE_LIMIT
  const exceedsHardLimit =
    directory.files.length > HARD_MARKETPLACE_FILE_LIMIT ||
    directory.totalBytes > HARD_MARKETPLACE_BYTE_LIMIT

  return {
    id,
    owner,
    repo,
    skill,
    ref: directory.ref,
    directory: directory.dir,
    fileCount: directory.files.length,
    totalBytes: directory.totalBytes,
    directories: directory.directories,
    hasScripts: directory.directories.includes('scripts'),
    hasReferences: directory.directories.includes('references'),
    hasAssets: directory.directories.includes('assets'),
    exceedsDefaultLimit,
    exceedsHardLimit,
    defaultLimit: {
      files: DEFAULT_MARKETPLACE_FILE_LIMIT,
      bytes: DEFAULT_MARKETPLACE_BYTE_LIMIT,
    },
    hardLimit: {
      files: HARD_MARKETPLACE_FILE_LIMIT,
      bytes: HARD_MARKETPLACE_BYTE_LIMIT,
    },
    previewFiles,
    sampleFiles: directory.files.slice(0, 20).map((file) => file.relativePath),
  }
}

export async function previewSkillMarketplaceFile(input: SkillMarketplacePreviewInput): Promise<SkillMarketplacePreview> {
  const { id, owner, repo, skill } = parseMarketplaceId(input.id)
  const directory = await findGithubSkillDirectory(owner, repo, skill)
  if (!directory) throw new HttpError(400, `Could not locate Skill directory for marketplace skill ${id}`)

  const availableFiles = listMarketplacePreviewFiles(directory.files)
  if (availableFiles.length === 0) {
    throw new HttpError(404, 'This marketplace skill does not expose previewable text files')
  }

  const relativePath = normalizeMarketplaceRelativePath(input.path)
  if (!availableFiles.includes(relativePath)) {
    throw new HttpError(404, `Marketplace preview file not found: ${relativePath}`)
  }

  const targetFile = directory.files.find((file) => file.relativePath === relativePath)
  if (!targetFile) {
    throw new HttpError(404, `Marketplace preview file not found: ${relativePath}`)
  }

  const archive = await fetchRepositoryArchive(directory.owner, directory.repo, directory.ref)
  const archiveEntry = archive.files.find((entry) => {
    if (entry.type !== 'File') return false
    const normalizedPath = entry.path.replace(/\\/g, '/')
    const slashIndex = normalizedPath.indexOf('/')
    const repoRelativePath = slashIndex === -1 ? normalizedPath : normalizedPath.slice(slashIndex + 1)
    return repoRelativePath === targetFile.path
  })

  if (!archiveEntry) {
    throw new HttpError(404, `Marketplace preview file not found in archive: ${relativePath}`)
  }

  const bytes = await archiveEntry.buffer()
  if (bytes.length > MARKETPLACE_PREVIEW_FILE_LIMIT) {
    throw new HttpError(400, 'Marketplace preview file is too large to display safely')
  }
  if (!looksLikeTextBuffer(bytes)) {
    throw new HttpError(400, 'Marketplace preview only supports text-based files')
  }

  const fullContent = bytes.toString('utf-8').replace(/^\uFEFF/, '').replace(/\u0000/g, '')
  const truncated = fullContent.length > MARKETPLACE_PREVIEW_CHAR_LIMIT
  const content = truncated ? `${fullContent.slice(0, MARKETPLACE_PREVIEW_CHAR_LIMIT)}\n\n[truncated]` : fullContent

  return {
    id,
    owner,
    repo,
    skill,
    ref: directory.ref,
    directory: directory.dir,
    path: relativePath,
    format: inferMarketplacePreviewFormat(relativePath),
    truncated,
    content: content.trimEnd(),
    availableFiles,
  }
}

async function readResponseBufferLimited(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw new HttpError(400, 'Marketplace archive is too large to download safely')
    return bytes
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > limit) {
      throw new HttpError(400, 'Marketplace archive is too large to download safely')
    }
    chunks.push(Buffer.from(value))
  }

  return Buffer.concat(chunks)
}

async function downloadMarketplaceDirectory(directory: MarketplaceDirectory, targetDir: string) {
  const archive = await fetchRepositoryArchive(directory.owner, directory.repo, directory.ref)
  const pending = new Map(directory.files.map((file) => [file.path, file]))
  let downloadedBytes = 0

  for (const entry of archive.files) {
    if (entry.type !== 'File') continue
    const normalizedPath = entry.path.replace(/\\/g, '/')
    const slashIndex = normalizedPath.indexOf('/')
    const repoRelativePath = slashIndex === -1 ? normalizedPath : normalizedPath.slice(slashIndex + 1)
    const file = pending.get(repoRelativePath)
    if (!file) continue

    const target = path.join(targetDir, file.relativePath)
    assertInside(targetDir, target)
    const bytes = await entry.buffer()
    downloadedBytes += bytes.length
    if (downloadedBytes > HARD_MARKETPLACE_BYTE_LIMIT) {
      throw new HttpError(400, 'Marketplace skill is too large')
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
    pending.delete(repoRelativePath)
  }

  if (pending.size > 0) {
    const missing = [...pending.values()]
      .slice(0, 5)
      .map((file) => file.relativePath)
      .join(', ')
    throw new HttpError(400, `Failed to extract marketplace skill files: ${missing}`)
  }

  return { fileCount: directory.files.length, totalBytes: downloadedBytes }
}

export async function installSkillFromMarketplace(input: SkillMarketplaceInstallInput) {
  const { id, owner, repo, skill } = parseMarketplaceId(input.id)
  const directory = await findGithubSkillDirectory(owner, repo, skill)
  if (!directory) throw new HttpError(400, `Could not locate Skill directory for marketplace skill ${id}`)

  const preview = await inspectSkillMarketplaceInstall(input)
  if (preview.exceedsHardLimit) {
    throw new HttpError(400, 'Marketplace skill exceeds hard safety limit')
  }
  if (preview.exceedsDefaultLimit && input.allowLarge !== true) {
    throw new HttpError(
      400,
      'Marketplace skill is large; inspect it first and call install with allowLarge:true after explicit confirmation',
    )
  }

  await ensureSkillsRoot()
  const localId = normalizeId(skill)
  const finalDir = skillDir(localId)
  const tempDir = path.join(skillsRoot(), `.${localId}-${Date.now()}.tmp`)
  await resetDir(tempDir)

  try {
    await downloadMarketplaceDirectory(directory, tempDir)
    if (!(await fileExists(path.join(tempDir, SKILL_FILE)))) {
      throw new HttpError(400, `Downloaded marketplace skill is missing ${SKILL_FILE}`)
    }
    await fs.rm(finalDir, { recursive: true, force: true })
    await fs.rename(tempDir, finalDir)
    return readSkill(localId)
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

export async function formatSkillsRuntimeContext() {
  const skills = await getEnabledSkillIndex()
  const marketplaceRule =
    '- If the user wants to discover or install new Skills, use skills_marketplace_search first, then skills_marketplace_inspect to review file count, total size, directories, and whether scripts are included. Marketplace install downloads the full Skill directory, including SKILL.md, references, scripts, assets, and other bundled files. In default permission mode, explain the source, size, scripts, and expected effect before installing and wait for confirmation. In full-access mode, installation may proceed directly.'

  if (skills.length === 0) {
    return [
      'Skill capabilities:',
      '- There are currently no enabled Skills.',
      '- Use the skills_* tools when the user wants to create, install, inspect, or delete Skills.',
      marketplaceRule,
    ].join('\n')
  }

  return [
    'Skill capabilities:',
    '- Skills use progressive disclosure. This context only includes the name and description index. Before relying on a Skill in detail, call skills_read and read its SKILL.md.',
    '- Do not claim you are following a Skill workflow unless you have actually read that Skill.md in the current task.',
    marketplaceRule,
    '- Enabled Skills:',
    ...skills.map((skill) => `  - ${skill.id}: ${skill.name} - ${skill.description}`),
  ].join('\n')
}
