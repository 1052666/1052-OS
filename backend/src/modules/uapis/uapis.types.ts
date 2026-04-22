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

export type UapisApiDefinition = {
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
}

export type UapisApiItem = UapisApiDefinition & {
  enabled: boolean
}

export type UapisConfig = {
  disabledApiIds: string[]
  updatedAt: number
}

export type UapisCatalogResponse = {
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

export type UapisToggleInput = {
  enabled?: unknown
}

export type UapisBulkToggleInput = {
  enabled?: unknown
  categoryId?: unknown
}

export type UapisCallInput = {
  apiId?: unknown
  params?: unknown
  body?: unknown
}

export type UapisCallResult = {
  apiId: string
  name: string
  method: UapisMethod
  url: string
  usedApiKey: boolean
  status: number
  contentType: string
  data?: unknown
  text?: string
  fileUrl?: string
  filePath?: string
}
