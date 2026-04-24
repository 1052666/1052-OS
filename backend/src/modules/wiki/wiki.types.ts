export type WikiCategory = 'entity' | 'concept' | 'synthesis'

export type WikiFrontmatter = {
  tags: string[]
  category: WikiCategory
  source_count: number
  last_updated: string
  sources: string[]
  summary: string
}

export type WikiPage = {
  path: string
  title: string
  category: WikiCategory
  tags: string[]
  sourceCount: number
  sources: string[]
  summary: string
  lastUpdated: string
  links: string[]
  backlinks: string[]
  content: string
  raw: string
  size: number
  updatedAt: number
  hasFrontmatter: boolean
}

export type WikiRawFile = {
  path: string
  name: string
  size: number
  updatedAt: number
  readable: boolean
}

export type WikiSummary = {
  rawCount: number
  pageCount: number
  brokenLinkCount: number
  orphanPageCount: number
  lastUpdated: number | null
}

export type WikiLintResult = {
  brokenLinks: Array<{ page: string; link: string }>
  orphanPages: string[]
  missingFrontmatter: string[]
  missingSources: Array<{ page: string; source: string }>
  sourceCountMismatches: Array<{ page: string; expected: number; actual: number }>
  indexMissingPages: string[]
  autoFixable: string[]
  warnings: string[]
}

export type WikiLogType =
  | 'ingest'
  | 'query-writeback'
  | 'lint'
  | 'manual-update'
  | 'index-rebuild'
  | 'raw-upload'
