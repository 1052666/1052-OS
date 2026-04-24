import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { parseFrontmatter } from './wiki.markdown.js'
import type { WikiLintResult } from './wiki.types.js'

const PAGE_ROOT = path.join(config.dataDir, 'wiki', 'wiki')
const RAW_ROOT = path.join(config.dataDir, 'wiki', 'raw')
const INDEX_PATH = '索引.md'
const LOG_PATH = '操作日志.md'

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function walkMarkdown(root: string) {
  await fs.mkdir(root, { recursive: true })
  const results: string[] = []
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.name.toLowerCase().endsWith('.md')) {
        results.push(path.relative(root, absolute).replace(/\\/g, '/'))
      }
    }
  }
  await walk(root)
  return results.filter((item) => item !== INDEX_PATH && item !== LOG_PATH)
}

function parseLinks(content: string) {
  const links: string[] = []
  const pattern = /\[\[([^\]\r\n]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const link = match[1]?.trim().replace(/\\/g, '/')
    if (link) links.push(link.endsWith('.md') ? link : `${link}.md`)
  }
  return links
}

export async function lintWiki(): Promise<WikiLintResult> {
  const files = await walkMarkdown(PAGE_ROOT)
  const fileSet = new Set(files)
  const linked = new Set<string>()
  const result: WikiLintResult = {
    brokenLinks: [],
    orphanPages: [],
    missingFrontmatter: [],
    missingSources: [],
    sourceCountMismatches: [],
    indexMissingPages: [],
    autoFixable: [],
    warnings: [],
  }

  for (const file of files) {
    const raw = await fs.readFile(path.join(PAGE_ROOT, file), 'utf-8')
    const parsed = parseFrontmatter(raw)
    if (!parsed.frontmatter) {
      result.missingFrontmatter.push(file)
    } else {
      for (const source of parsed.frontmatter.sources) {
        const sourceTarget = path.resolve(RAW_ROOT, source.replace(/^raw\//, ''))
        if (!(await exists(sourceTarget))) result.missingSources.push({ page: file, source })
      }
      if (parsed.frontmatter.source_count !== parsed.frontmatter.sources.length) {
        result.sourceCountMismatches.push({
          page: file,
          expected: parsed.frontmatter.sources.length,
          actual: parsed.frontmatter.source_count,
        })
      }
    }

    for (const link of parseLinks(parsed.body)) {
      linked.add(link)
      if (!fileSet.has(link)) result.brokenLinks.push({ page: file, link })
    }
  }

  result.orphanPages = files.filter((file) => !linked.has(file))

  const indexContent = await fs.readFile(path.join(PAGE_ROOT, INDEX_PATH), 'utf-8').catch(() => '')
  result.indexMissingPages = files.filter((file) => !indexContent.includes(file.replace(/\.md$/i, '')))
  if (result.indexMissingPages.length > 0) result.autoFixable.push('index-rebuild')
  if (result.sourceCountMismatches.length > 0) result.autoFixable.push('source-count')
  return result
}
