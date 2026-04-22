import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import { getSettings } from '../settings/settings.service.js'
import {
  UAPIS_APIS,
  UAPIS_BASE_URL,
  UAPIS_CATEGORIES,
  UAPIS_CONSOLE,
  UAPIS_DOC_DECLARED_TOTAL,
  UAPIS_DOC_EXPLICIT_TOTAL,
  UAPIS_HOME,
  UAPIS_PRICING,
  UAPIS_STATUS,
} from './uapis.catalog.js'
import type {
  UapisApiDefinition,
  UapisApiItem,
  UapisBulkToggleInput,
  UapisCallInput,
  UapisCallResult,
  UapisCatalogResponse,
  UapisConfig,
  UapisToggleInput,
} from './uapis.types.js'

const CONFIG_FILE = 'uapis-config.json'
const FILES_DIR = path.join(config.dataDir, 'uapis', 'files')
const MAX_TEXT_RESPONSE_CHARS = 80_000
const UAPIS_SEARCH_API_ID = 'post-search-aggregate'
const UAPIS_SEARCH_ENGINES_API_ID = 'get-search-engines'

const API_MAP = new Map(UAPIS_APIS.map((api) => [api.id, api]))

function defaultConfig(): UapisConfig {
  return {
    disabledApiIds: [],
    updatedAt: Date.now(),
  }
}

function normalizeConfig(input: Partial<UapisConfig> | undefined): UapisConfig {
  const disabled = Array.isArray(input?.disabledApiIds)
    ? input.disabledApiIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id && API_MAP.has(id))
    : []

  return {
    disabledApiIds: [...new Set(disabled)],
    updatedAt:
      typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now(),
  }
}

async function readConfig() {
  return normalizeConfig(await readJson<Partial<UapisConfig>>(CONFIG_FILE, defaultConfig()))
}

async function writeConfig(next: UapisConfig) {
  await writeJson(CONFIG_FILE, normalizeConfig({ ...next, updatedAt: Date.now() }))
}

function withEnabled(config: UapisConfig, api: UapisApiDefinition): UapisApiItem {
  return {
    ...api,
    enabled: !config.disabledApiIds.includes(api.id),
  }
}

function assertBoolean(value: unknown) {
  if (typeof value !== 'boolean') throw new HttpError(400, 'enabled must be boolean')
  return value
}

export function findUapisApi(id: unknown): UapisApiDefinition {
  const apiId = typeof id === 'string' ? id.trim() : ''
  const api = API_MAP.get(apiId)
  if (!api) throw new HttpError(404, 'UAPIs API not found')
  return api
}

export async function getUapisCatalog(): Promise<UapisCatalogResponse> {
  const [cfg, settings] = await Promise.all([readConfig(), getSettings()])
  const apis = UAPIS_APIS.map((api) => withEnabled(cfg, api))
  const enabled = apis.filter((api) => api.enabled).length

  return {
    provider: {
      name: 'UapiPro / UAPIs.cn',
      home: UAPIS_HOME,
      console: UAPIS_CONSOLE,
      pricing: UAPIS_PRICING,
      status: UAPIS_STATUS,
      baseUrl: `${UAPIS_BASE_URL}/api/v1/`,
      declaredTotal: UAPIS_DOC_DECLARED_TOTAL,
      explicitTotal: UAPIS_DOC_EXPLICIT_TOTAL,
      hasApiKey: settings.uapis.apiKey.length > 0,
      apiKeyMode: settings.uapis.apiKey.length > 0 ? 'api-key' : 'free-ip-quota',
      freeQuota: {
        anonymousMonthlyCredits: 1500,
        apiKeyMonthlyCredits: 3500,
        note: '不填写 API Key 时使用免费 IP 额度；填写免费账号 API Key 后额度提升。',
      },
    },
    categories: UAPIS_CATEGORIES,
    apis,
    counts: {
      total: apis.length,
      enabled,
      disabled: apis.length - enabled,
      searchApis: apis.filter((api) => api.categoryId === 'search').length,
    },
  }
}

export async function readUapisApi(id: unknown) {
  const cfg = await readConfig()
  return withEnabled(cfg, findUapisApi(id))
}

export async function setUapisApiEnabled(id: unknown, input: UapisToggleInput) {
  const api = findUapisApi(id)
  const enabled = assertBoolean(input.enabled)
  const cfg = await readConfig()
  const disabled = new Set(cfg.disabledApiIds)
  if (enabled) disabled.delete(api.id)
  else disabled.add(api.id)
  await writeConfig({ disabledApiIds: [...disabled], updatedAt: Date.now() })
  return readUapisApi(api.id)
}

export async function setUapisApisEnabled(input: UapisBulkToggleInput) {
  const enabled = assertBoolean(input.enabled)
  const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : ''
  const targets = categoryId
    ? UAPIS_APIS.filter((api) => api.categoryId === categoryId)
    : UAPIS_APIS
  if (categoryId && targets.length === 0) throw new HttpError(404, 'UAPIs category not found')

  const cfg = await readConfig()
  const disabled = new Set(cfg.disabledApiIds)
  for (const api of targets) {
    if (enabled) disabled.delete(api.id)
    else disabled.add(api.id)
  }
  await writeConfig({ disabledApiIds: [...disabled], updatedAt: Date.now() })
  return getUapisCatalog()
}

export async function isUapisApiEnabled(apiId: string) {
  const cfg = await readConfig()
  return API_MAP.has(apiId) && !cfg.disabledApiIds.includes(apiId)
}

export async function listEnabledUapisIndex() {
  const cfg = await readConfig()
  return UAPIS_APIS.filter((api) => !cfg.disabledApiIds.includes(api.id)).map((api) => ({
    id: api.id,
    category: api.categoryName,
    name: api.name,
    method: api.method,
    path: api.path,
    description: api.description,
  }))
}

export async function formatUapisRuntimeContext() {
  const catalog = await getUapisCatalog()
  const lines = [
    'UAPIs 工具箱索引：',
    `- 平台：UapiPro / UAPIs.cn (${catalog.provider.home})`,
    `- 调用模式：${catalog.provider.apiKeyMode === 'api-key' ? 'API Key 模式，后端会自动携带 Authorization Bearer' : '免费 IP 额度模式，不携带 API Key'}`,
    `- 额度说明：未登录未注册每 IP 每月约 ${catalog.provider.freeQuota.anonymousMonthlyCredits} 积分；填写免费账号 API Key 后约 ${catalog.provider.freeQuota.apiKeyMonthlyCredits} 积分。`,
    `- 文档标称接口：${catalog.provider.declaredTotal}；当前可明确调用接口：${catalog.provider.explicitTotal}；已启用：${catalog.counts.enabled}；已禁用：${catalog.counts.disabled}。`,
    '- 使用方式（必须按顺序）：1) uapis_list_apis 查看索引 → 2) uapis_read_api 查看参数和调用方式 → 3) uapis_call 调用。跳过第 2 步会导致参数遗漏或传错位置。',
    '- 如果某个 API 被用户禁用，不要调用它；如果用户要管理启用状态，让用户在前端工具箱操作。',
  ]

  const enabled = catalog.apis.filter((api) => api.enabled)
  for (const category of catalog.categories) {
    const items = enabled.filter((api) => api.categoryId === category.id)
    if (items.length === 0) continue
    lines.push(`\n### ${category.name}`)
    for (const api of items) {
      lines.push(`- ${api.id}: ${api.name} (${api.method} ${api.path}) - ${api.description}`)
    }
  }

  return lines.join('\n')
}

function normalizeObject(value: unknown, field: string) {
  if (value === undefined || value === null) return {}
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through to the unified validation error below
    }
    throw new HttpError(400, `${field} must be an object`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeCallInput(
  rawInput: UapisCallInput,
  api: UapisApiDefinition,
): {
  params: Record<string, unknown>
  body: Record<string, unknown>
} {
  const input = normalizeObject(rawInput, 'input')
  const params = normalizeObject(input.params ?? input.query, 'params')
  const body = normalizeObject(input.body ?? input.data ?? input.payload, 'body')
  const reserved = new Set([
    'apiId',
    'id',
    'params',
    'query',
    'body',
    'data',
    'payload',
    'confirmed',
    '__runtimeContext',
  ])
  const extras = Object.entries(input).filter(([key]) => !reserved.has(key))
  if (extras.length === 0) return { params, body }

  if (api.method === 'GET') {
    return {
      params: { ...params, ...Object.fromEntries(extras) },
      body,
    }
  }

  const declaredParamNames = new Set(api.params.map((param) => param.name))
  const extraParams: Record<string, unknown> = {}
  const extraBody: Record<string, unknown> = {}
  for (const [key, value] of extras) {
    if (declaredParamNames.has(key)) extraParams[key] = value
    else extraBody[key] = value
  }

  return {
    params: { ...params, ...extraParams },
    body: { ...body, ...extraBody },
  }
}

function normalizeQueryValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function extensionForContentType(contentType: string) {
  if (/png/i.test(contentType)) return '.png'
  if (/jpe?g/i.test(contentType)) return '.jpg'
  if (/gif/i.test(contentType)) return '.gif'
  if (/webp/i.test(contentType)) return '.webp'
  if (/pdf/i.test(contentType)) return '.pdf'
  if (/svg/i.test(contentType)) return '.svg'
  if (/json/i.test(contentType)) return '.json'
  if (/html/i.test(contentType)) return '.html'
  if (/text/i.test(contentType)) return '.txt'
  return '.bin'
}

async function saveBinaryResponse(contentType: string, buffer: ArrayBuffer) {
  await fs.mkdir(FILES_DIR, { recursive: true })
  const fileName = `${Date.now()}-${randomUUID()}${extensionForContentType(contentType)}`
  const filePath = path.join(FILES_DIR, fileName)
  await fs.writeFile(filePath, Buffer.from(buffer))
  return {
    filePath,
    fileUrl: `/api/uapis/files/${encodeURIComponent(fileName)}`,
  }
}

export async function callUapis(input: UapisCallInput): Promise<UapisCallResult> {
  const normalizedInput = normalizeObject(input, 'input')
  const api = findUapisApi(normalizedInput.apiId ?? normalizedInput.id)
  if (!(await isUapisApiEnabled(api.id))) {
    throw new HttpError(403, `UAPIs API is disabled: ${api.id}`)
  }

  const settings = await getSettings()
  const { params, body } = normalizeCallInput(normalizedInput, api)
  const url = new URL(api.path, UAPIS_BASE_URL)
  Object.entries(params).forEach(([key, value]) => {
    const normalized = normalizeQueryValue(value)
    if (normalized) url.searchParams.set(key, normalized)
  })

  const headers: Record<string, string> = {
    accept: 'application/json,text/plain,image/*,*/*',
  }
  if (settings.uapis.apiKey) {
    headers.authorization = `Bearer ${settings.uapis.apiKey}`
  }

  const response = await fetch(url, {
    method: api.method,
    headers:
      api.method === 'POST'
        ? {
            ...headers,
            'content-type': 'application/json',
          }
        : headers,
    body: api.method === 'POST' ? JSON.stringify(body) : undefined,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const baseResult = {
    apiId: api.id,
    name: api.name,
    method: api.method,
    url: url.toString(),
    usedApiKey: settings.uapis.apiKey.length > 0,
    status: response.status,
    contentType,
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new HttpError(response.status, text || `UAPIs request failed: HTTP ${response.status}`)
  }

  if (/application\/json|\+json/i.test(contentType)) {
    return {
      ...baseResult,
      data: await response.json(),
    }
  }

  if (/^text\/|html|xml|markdown/i.test(contentType)) {
    const text = await response.text()
    return {
      ...baseResult,
      text:
        text.length > MAX_TEXT_RESPONSE_CHARS
          ? text.slice(0, MAX_TEXT_RESPONSE_CHARS) + '\n...[response truncated]'
          : text,
    }
  }

  const saved = await saveBinaryResponse(contentType, await response.arrayBuffer())
  return {
    ...baseResult,
    ...saved,
  }
}

export async function callUapisSearch(query: string, limit = 10) {
  if (!(await isUapisApiEnabled(UAPIS_SEARCH_API_ID))) return null
  const result = await callUapis({
    apiId: UAPIS_SEARCH_API_ID,
    body: { query, limit },
  })
  return result.data
}

export async function getUapisSearchSourceState() {
  return {
    aggregateEnabled: await isUapisApiEnabled(UAPIS_SEARCH_API_ID),
    enginesEnabled: await isUapisApiEnabled(UAPIS_SEARCH_ENGINES_API_ID),
  }
}
