import { api } from './client'

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

export type ResourcePayload = {
  title?: string
  content?: string
  note?: string
  tags?: string[]
  status?: ResourceStatus
}

export const ResourcesApi = {
  list: (query = '', status = '') => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())
    if (status) params.set('status', status)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return api.get<ResourceItem[]>('/resources' + suffix)
  },
  create: (payload: ResourcePayload) => api.post<ResourceItem>('/resources', payload),
  update: (id: string, payload: ResourcePayload) =>
    api.put<ResourceItem>('/resources/' + encodeURIComponent(id), payload),
  strike: (id: string, struck: boolean) =>
    api.put<ResourceItem>('/resources/' + encodeURIComponent(id) + '/strike', { struck }),
  delete: (id: string) =>
    api.delete<{ ok: true; deleted: ResourceItem }>('/resources/' + encodeURIComponent(id)),
}
