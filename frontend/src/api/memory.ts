import { api } from './client'

export type MemoryCategory =
  | 'hard_rule'
  | 'preference'
  | 'habit'
  | 'style'
  | 'workflow'
  | 'constraint'
  | 'identity'
  | 'project_context'

export type MemoryScope = 'global' | 'repository' | 'notes' | 'workspace'

export type MemoryPriority = 'high' | 'normal' | 'low'

export type MemorySource = 'user_explicit' | 'agent_inferred' | 'imported'

export type MemoryItem = {
  id: string
  category: MemoryCategory
  title: string
  content: string
  tags: string[]
  scope: MemoryScope
  priority: MemoryPriority
  source: MemorySource
  confidence: 'confirmed'
  active: boolean
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export type MemorySuggestion = Omit<MemoryItem, 'confidence'> & {
  confidence: 'suggested'
}

export type SecureMemoryType = 'api_key' | 'token' | 'password' | 'config' | 'certificate' | 'other'
export type SecureMemoryExposureMode = 'tool_only' | 'raw_on_demand'

export type SecureMemoryIndexItem = {
  id: string
  title: string
  type: SecureMemoryType
  tags: string[]
  allowedUse: string[]
  exposureMode: SecureMemoryExposureMode
  mask: string
  path: string
  createdAt: number
  updatedAt: number
}

export type SecureMemoryDetail = SecureMemoryIndexItem & {
  content: string
}

export type MemoryPayload = {
  category?: MemoryCategory
  title?: string
  content?: string
  tags?: string[]
  scope?: MemoryScope
  priority?: MemoryPriority
  source?: MemorySource
  active?: boolean
}

export type SecureMemoryPayload = {
  title?: string
  type?: SecureMemoryType
  tags?: string[]
  allowedUse?: string[]
  exposureMode?: SecureMemoryExposureMode
  content?: string
}

export type MemorySummary = {
  counts: {
    confirmed: number
    active: number
    suggestions: number
    secure: number
    highPriority: number
  }
  recent: MemoryItem[]
  secure: SecureMemoryIndexItem[]
  profileUpdatedAt: number | null
  secureProfileUpdatedAt: number | null
}

export type MemoryProfileResponse = {
  profile: string
  secureProfile: string
}

export type RuntimePreview = {
  request: string
  always: MemoryItem[]
  relevant: MemoryItem[]
  secureCatalog: SecureMemoryIndexItem[]
  rendered: string
}

export const MemoryApi = {
  summary: () => api.get<MemorySummary>('/memory/summary'),
  runtimePreview: (request = '') =>
    api.get<RuntimePreview>('/memory/runtime-preview?q=' + encodeURIComponent(request)),
  profile: () => api.get<MemoryProfileResponse>('/memory/profile'),
  list: (query = '') =>
    api.get<MemoryItem[]>('/memory' + (query.trim() ? '?query=' + encodeURIComponent(query.trim()) : '')),
  create: (payload: MemoryPayload) => api.post<MemoryItem>('/memory', payload),
  read: (id: string) => api.get<MemoryItem>('/memory/' + encodeURIComponent(id)),
  update: (id: string, payload: MemoryPayload) =>
    api.put<MemoryItem>('/memory/' + encodeURIComponent(id), payload),
  delete: (id: string) =>
    api.delete<{ ok: true; deleted: MemoryItem }>('/memory/' + encodeURIComponent(id)),
  listSuggestions: (query = '') =>
    api.get<MemorySuggestion[]>(
      '/memory/suggestions' + (query.trim() ? '?query=' + encodeURIComponent(query.trim()) : ''),
    ),
  suggest: (payload: MemoryPayload) => api.post<MemorySuggestion>('/memory/suggestions', payload),
  confirmSuggestion: (id: string, payload: MemoryPayload = {}) =>
    api.post<MemoryItem>('/memory/suggestions/' + encodeURIComponent(id) + '/confirm', payload),
  rejectSuggestion: (id: string) =>
    api.delete<{ ok: true; rejected: MemorySuggestion }>(
      '/memory/suggestions/' + encodeURIComponent(id),
    ),
  listSecure: (query = '') =>
    api.get<SecureMemoryIndexItem[]>(
      '/memory/secure' + (query.trim() ? '?query=' + encodeURIComponent(query.trim()) : ''),
    ),
  createSecure: (payload: SecureMemoryPayload) => api.post<SecureMemoryDetail>('/memory/secure', payload),
  readSecure: (id: string) => api.get<SecureMemoryDetail>('/memory/secure/' + encodeURIComponent(id)),
  updateSecure: (id: string, payload: SecureMemoryPayload) =>
    api.put<SecureMemoryDetail>('/memory/secure/' + encodeURIComponent(id), payload),
  deleteSecure: (id: string) =>
    api.delete<{ ok: true; deleted: SecureMemoryIndexItem }>('/memory/secure/' + encodeURIComponent(id)),
}
