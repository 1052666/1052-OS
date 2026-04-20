export type ResourceStatus = 'active' | 'struck'

export type ResourceItem = {
  id: string
  title: string
  content: string
  note: string
  tags: string[]
  status: ResourceStatus
  createdAt: number
  updatedAt: number
}

export type ResourceInput = {
  title?: unknown
  content?: unknown
  note?: unknown
  tags?: unknown
  status?: unknown
}
