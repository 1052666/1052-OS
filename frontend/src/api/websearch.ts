import { api } from './client'

export type SearchEngineStatus = 'stable' | 'needs_work' | 'pass'
export type SearchSourceFamily = 'web-search' | 'skill-marketplace' | 'uapis'
export type SearchSourceKind = 'engine' | 'marketplace' | 'repository' | 'api'

export type SearchEngineInfo = {
  id: string
  name: string
  region: 'cn' | 'global'
  status: SearchEngineStatus
  statusReason: string | null
  supportsTime: boolean
  intents: string[]
  enabled: boolean
}

export type SearchSourceInfo = {
  id: string
  name: string
  family: SearchSourceFamily
  kind: SearchSourceKind
  status: SearchEngineStatus
  statusReason: string | null
  enabled: boolean
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
  setSourceEnabled: (family: SearchSourceFamily, id: string, enabled: boolean) =>
    api.patch<SearchSourcesResponse>(
      `/websearch/sources/${encodeURIComponent(family)}/${encodeURIComponent(id)}`,
      { enabled },
    ),
}
