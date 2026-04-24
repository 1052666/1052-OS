import type { WikiCategory, WikiFrontmatter, WikiPage } from './wiki.types.js'

const VALID_CATEGORIES = new Set<WikiCategory>(['entity', 'concept', 'synthesis'])

function parseArray(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function formatArray(values: readonly string[]) {
  return `[${values.map((item) => item.replace(/[\r\n]/g, ' ').trim()).filter(Boolean).join(', ')}]`
}

export function parseWikiLinks(content: string) {
  const links = new Set<string>()
  const pattern = /\[\[([^\]\r\n]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const link = match[1]?.trim().replace(/\\/g, '/')
    if (link) links.add(link.endsWith('.md') ? link.slice(0, -3) : link)
  }
  return [...links]
}

export function parseFrontmatter(raw: string): {
  frontmatter: WikiFrontmatter | null
  body: string
} {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: null, body: raw }
  }

  const normalized = raw.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: null, body: raw }

  const block = normalized.slice(4, end)
  const body = normalized.slice(end + '\n---\n'.length)
  const data: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    data[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }

  const category = data.category as WikiCategory
  if (!VALID_CATEGORIES.has(category)) return { frontmatter: null, body: raw }

  const sources = parseArray(data.sources ?? '')
  const tags = parseArray(data.tags ?? '')
  const sourceCount = Number(data.source_count)

  return {
    frontmatter: {
      tags,
      category,
      source_count: Number.isFinite(sourceCount) ? sourceCount : sources.length,
      last_updated: data.last_updated || new Date().toISOString().slice(0, 10),
      sources,
      summary: (data.summary ?? '').replace(/^['"]|['"]$/g, ''),
    },
    body,
  }
}

export function renderFrontmatter(frontmatter: WikiFrontmatter) {
  return [
    '---',
    `tags: ${formatArray(frontmatter.tags)}`,
    `category: ${frontmatter.category}`,
    `source_count: ${frontmatter.sources.length}`,
    `last_updated: ${frontmatter.last_updated}`,
    `sources: ${formatArray(frontmatter.sources)}`,
    `summary: ${frontmatter.summary.replace(/[\r\n]/g, ' ').trim()}`,
    '---',
    '',
  ].join('\n')
}

export function buildPageRaw(frontmatter: WikiFrontmatter, body: string) {
  return `${renderFrontmatter(frontmatter)}${body.replace(/^\s+/, '')}`
}

export function inferTitle(path: string, body: string) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

export function normalizePageFromRaw(input: {
  path: string
  raw: string
  size: number
  updatedAt: number
  backlinks?: string[]
}): WikiPage {
  const parsed = parseFrontmatter(input.raw)
  const body = parsed.body
  const links = parseWikiLinks(body)
  const fallbackCategory = input.path.startsWith('实体/')
    ? 'entity'
    : input.path.startsWith('综合分析/')
      ? 'synthesis'
      : 'concept'

  return {
    path: input.path,
    title: inferTitle(input.path, body),
    category: parsed.frontmatter?.category ?? fallbackCategory,
    tags: parsed.frontmatter?.tags ?? [],
    sourceCount: parsed.frontmatter?.source_count ?? 0,
    sources: parsed.frontmatter?.sources ?? [],
    summary: parsed.frontmatter?.summary ?? '',
    lastUpdated: parsed.frontmatter?.last_updated ?? '',
    links,
    backlinks: input.backlinks ?? [],
    content: body,
    raw: input.raw,
    size: input.size,
    updatedAt: input.updatedAt,
    hasFrontmatter: parsed.frontmatter !== null,
  }
}
