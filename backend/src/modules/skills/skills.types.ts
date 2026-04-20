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

export type SkillInput = {
  id?: unknown
  name?: unknown
  description?: unknown
  body?: unknown
  enabled?: unknown
}

export type SkillInstallInput = {
  url?: unknown
  id?: unknown
  enabled?: unknown
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

export type SkillMarketplaceSearchInput = {
  query?: unknown
  limit?: unknown
}

export type SkillMarketplaceInstallInput = {
  id?: unknown
  confirmed?: unknown
  allowLarge?: unknown
}

export type SkillMarketplacePreviewInput = {
  id?: unknown
  path?: unknown
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
