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

export type MemoryConfidence = 'confirmed' | 'suggested'

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

export type MemoryInput = {
  category?: unknown
  title?: unknown
  content?: unknown
  tags?: unknown
  scope?: unknown
  priority?: unknown
  source?: unknown
  active?: unknown
}

export type MemoryQuery = {
  query?: unknown
  category?: unknown
  scope?: unknown
  priority?: unknown
  active?: unknown
  limit?: unknown
}

export type SecureMemoryType =
  | 'api_key'
  | 'token'
  | 'password'
  | 'config'
  | 'certificate'
  | 'other'

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

export type SecureMemoryInput = {
  title?: unknown
  type?: unknown
  tags?: unknown
  allowedUse?: unknown
  exposureMode?: unknown
  content?: unknown
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

export type RuntimeMemorySelection = {
  always: MemoryItem[]
  relevant: MemoryItem[]
  secureCatalog: SecureMemoryIndexItem[]
}
