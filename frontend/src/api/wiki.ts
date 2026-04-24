import { api } from './client'

export type WikiCategory = 'entity' | 'concept' | 'synthesis'

export type WikiRawFile = {
  path: string
  name: string
  size: number
  updatedAt: number
  readable: boolean
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

export type WikiRawContent = WikiRawFile & {
  content: string
  truncated: boolean
}

export type WikiLog = {
  path: string
  content: string
  truncated: boolean
}

export type WikiPagePayload = {
  path?: string
  title?: string
  category?: WikiCategory
  tags?: string[]
  sources?: string[]
  summary?: string
  content: string
}

async function uploadRaw(files: File[], overwrite: boolean) {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  form.append('overwrite', String(overwrite))
  const res = await fetch('/api/wiki/raw/upload', {
    method: 'POST',
    body: form,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw {
      status: res.status,
      message:
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : res.statusText,
    }
  }
  return data as { items: WikiRawFile[] }
}

export const WikiApi = {
  summary: () => api.get<WikiSummary>('/wiki/summary'),
  listRaw: () => api.get<WikiRawFile[]>('/wiki/raw'),
  readRaw: (path: string) =>
    api.get<WikiRawContent>('/wiki/raw/content?path=' + encodeURIComponent(path)),
  uploadRaw,
  listPages: (query = '') =>
    api.get<WikiPage[]>('/wiki/pages' + (query ? '?query=' + encodeURIComponent(query) : '')),
  readPage: (path: string) =>
    api.get<WikiPage>('/wiki/pages/content?path=' + encodeURIComponent(path)),
  writePage: (payload: WikiPagePayload) => api.post<WikiPage>('/wiki/pages', payload),
  appendPage: (path: string, heading: string, content: string) =>
    api.post<WikiPage>('/wiki/pages/append', { path, heading, content }),
  ingestPreview: (rawPaths: string[]) =>
    api.post<{ rawFiles: Array<{ path: string; excerpt: string; truncated: boolean }>; suggestedWorkflow: string[] }>(
      '/wiki/ingest-preview',
      { rawPaths },
    ),
  lint: () => api.post<WikiLintResult>('/wiki/lint', {}),
  lintFix: () => api.post<{ ok: boolean; fixed: string[] }>('/wiki/lint/fix', {}),
  rebuildIndex: () => api.post<{ ok: boolean; pageCount: number; path: string }>('/wiki/index/rebuild', {}),
  logs: () => api.get<WikiLog>('/wiki/logs'),
}
