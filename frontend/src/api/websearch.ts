import { api } from './client'

export type SearchEngineStatus = 'stable' | 'needs_work' | 'pass'
export type SearchSourceFamily = 'web-search' | 'skill-marketplace'
export type SearchSourceKind = 'engine' | 'marketplace' | 'repository'

export type SearchEngineInfo = {
  id: string
  name: string
  region: 'cn' | 'global'
  status: SearchEngineStatus
  statusReason: string | null
  supportsTime: boolean
  intents: string[]
}

export type SearchSourceInfo = {
  id: string
  name: string
  family: SearchSourceFamily
  kind: SearchSourceKind
  status: SearchEngineStatus
  statusReason: string | null
  homepage: string
  region: 'cn' | 'global' | 'shared' | null
  supportsTime: boolean
  intents: string[]
  tags: string[]
}

export type SearchSourceGroup = {
  id: SearchSourceFamily
  title: string
  description: string
  items: SearchSourceInfo[]
}

export type SearchSourcesResponse = {
  engines: SearchEngineInfo[]
  sourceGroups: SearchSourceGroup[]
}

export const WebsearchApi = {
  listEngines: () => api.get<SearchSourcesResponse>('/websearch/engines'),
  listSources: () => api.get<SearchSourcesResponse>('/websearch/engines'),
}
