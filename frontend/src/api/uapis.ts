import { api } from './client'

export type UapisMethod = 'GET' | 'POST'

export type UapisParamDefinition = {
  name: string
  type: string
  required: boolean
  description: string
}

export type UapisCategory = {
  id: string
  name: string
  declaredCount: number
}

export type UapisApiItem = {
  id: string
  categoryId: string
  categoryName: string
  order: number
  name: string
  method: UapisMethod
  path: string
  description: string
  params: UapisParamDefinition[]
  bodyExample: string
  documentation: string
  enabled: boolean
}

export type UapisCatalog = {
  provider: {
    name: string
    home: string
    console: string
    pricing: string
    status: string
    baseUrl: string
    declaredTotal: number
    explicitTotal: number
    hasApiKey: boolean
    apiKeyMode: 'free-ip-quota' | 'api-key'
    freeQuota: {
      anonymousMonthlyCredits: number
      apiKeyMonthlyCredits: number
      note: string
    }
  }
  categories: UapisCategory[]
  apis: UapisApiItem[]
  counts: {
    total: number
    enabled: number
    disabled: number
    searchApis: number
  }
}

export const UapisApi = {
  catalog: () => api.get<UapisCatalog>('/uapis/catalog'),
  read: (id: string) => api.get<UapisApiItem>('/uapis/apis/' + encodeURIComponent(id)),
  setEnabled: (id: string, enabled: boolean) =>
    api.patch<UapisApiItem>('/uapis/apis/' + encodeURIComponent(id), { enabled }),
  bulkToggle: (enabled: boolean, categoryId?: string) =>
    api.post<UapisCatalog>('/uapis/bulk-toggle', { enabled, categoryId }),
}
