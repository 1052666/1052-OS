import { api } from './client'

export type SkillItem = {
  id: string
  name: string
  description: string
  enabled: boolean
  path: string
  updatedAt: number
  size: number
}

export type SkillDetail = SkillItem & {
  body: string
  references: string[]
  scripts: string[]
  assets: string[]
}

export type SkillPayload = {
  id?: string
  name: string
  description: string
  body: string
  enabled?: boolean
}

export type SkillMarketplaceItem = {
  id: string
  name: string
  owner: string
  repo: string
  source: 'skills.sh'
  url: string
  installCommand: string
  downloads?: string
}

export type SkillMarketplaceSearchResult = {
  source: 'skills.sh'
  query: string
  items: SkillMarketplaceItem[]
}

export type SkillMarketplaceInspect = {
  id: string
  owner: string
  repo: string
  skill: string
  ref: string
  directory: string
  fileCount: number
  totalBytes: number
  directories: string[]
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
  exceedsDefaultLimit: boolean
  exceedsHardLimit: boolean
  defaultLimit: { files: number; bytes: number }
  hardLimit: { files: number; bytes: number }
  previewFiles: string[]
  sampleFiles: string[]
}

export type SkillMarketplacePreview = {
  id: string
  owner: string
  repo: string
  skill: string
  ref: string
  directory: string
  path: string
  format: 'markdown' | 'code' | 'text'
  truncated: boolean
  content: string
  availableFiles: string[]
}

export const SkillsApi = {
  list: () => api.get<SkillItem[]>('/skills'),
  read: (id: string) => api.get<SkillDetail>('/skills/' + encodeURIComponent(id)),
  create: (payload: SkillPayload) => api.post<SkillDetail>('/skills', payload),
  install: (url: string, id?: string) => api.post<SkillDetail>('/skills/install', { url, id }),
  searchMarketplace: (query: string, limit = 20) =>
    api.get<SkillMarketplaceSearchResult>(
      '/skills/marketplace/search?q=' + encodeURIComponent(query) + '&limit=' + limit,
    ),
  inspectMarketplace: (id: string) =>
    api.get<SkillMarketplaceInspect>('/skills/marketplace/inspect?id=' + encodeURIComponent(id)),
  previewMarketplace: (id: string, path?: string) =>
    api.get<SkillMarketplacePreview>(
      '/skills/marketplace/preview?id=' +
        encodeURIComponent(id) +
        (path ? '&path=' + encodeURIComponent(path) : ''),
    ),
  installMarketplace: (id: string, allowLarge = false) =>
    api.post<SkillDetail>('/skills/marketplace/install', { id, allowLarge }),
  delete: (id: string) => api.delete<{ ok: true; id: string }>('/skills/' + encodeURIComponent(id)),
}
