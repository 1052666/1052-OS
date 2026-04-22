import type { AgentTool } from '../agent.tool.types.js'
import {
  callUapis,
  getUapisCatalog,
  readUapisApi,
  setUapisApiEnabled,
  setUapisApisEnabled,
} from '../../uapis/uapis.service.js'

export const uapisTools: AgentTool[] = [
  {
    name: 'uapis_list_apis',
    description:
      'List the enabled/disabled UAPIs built-in API catalog as a lightweight index. Read-only. Use before choosing a UAPIs API.',
    parameters: {
      type: 'object',
      properties: {
        enabledOnly: {
          type: 'boolean',
          description: 'When true, only return enabled APIs. Default true.',
        },
        categoryId: {
          type: 'string',
          description: 'Optional category id filter, such as search, network, image, translate.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const enabledOnly = input.enabledOnly === false ? false : true
      const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : ''
      const catalog = await getUapisCatalog()
      const apis = catalog.apis
        .filter((api) => (!enabledOnly ? true : api.enabled))
        .filter((api) => (!categoryId ? true : api.categoryId === categoryId))
        .map(({ id, categoryId, categoryName, name, method, path, description, enabled }) => ({
          id,
          categoryId,
          categoryName,
          name,
          method,
          path,
          description,
          enabled,
        }))
      return {
        provider: catalog.provider,
        categories: catalog.categories,
        counts: catalog.counts,
        apis,
      }
    },
  },
  {
    name: 'uapis_read_api',
    description:
      'Read detailed documentation for one UAPIs API, including parameters, their types, and whether they are required. Always call this before uapis_call to learn how to pass parameters correctly.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
      },
      required: ['apiId'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const api = await readUapisApi(input.apiId)
      const required = api.params.filter((p) => p.required)
      const optional = api.params.filter((p) => !p.required)
      const paramTarget = api.method === 'POST' ? 'body' : 'params'
      const lines = [
        `API: ${api.name} (${api.id})`,
        `Method: ${api.method}  Path: ${api.path}`,
        `Description: ${api.description}`,
        '',
        required.length > 0
          ? `Required params (pass these in uapis_call.${paramTarget}): ${required.map((p) => `${p.name}: ${p.type} - ${p.description}`).join('; ')}`
          : 'No required params.',
      ]
      if (optional.length > 0) {
        lines.push(
          `Optional params (pass in uapis_call.${paramTarget}): ${optional.map((p) => `${p.name}: ${p.type} - ${p.description}`).join('; ')}`,
        )
      }
      if (api.method === 'POST' && api.bodyExample) {
        lines.push(`Body example: ${api.bodyExample}`)
      }
      lines.push('')
      lines.push(`When calling uapis_call, pass all parameters in the "${paramTarget}" field.`)
      if (api.documentation) {
        lines.push('')
        lines.push(api.documentation)
      }
      return { ...api, _agentHint: lines.join('\n') }
    },
  },
  {
    name: 'uapis_set_api_enabled',
    description:
      'Enable or disable one UAPIs toolbox API. This is a configuration change. Use when the user asks Agent to manage toolbox capabilities.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
      },
      required: ['apiId', 'enabled'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return setUapisApiEnabled(input.apiId, { enabled: input.enabled as boolean })
    },
  },
  {
    name: 'uapis_bulk_set_enabled',
    description:
      'Enable or disable multiple UAPIs toolbox APIs, optionally limited to one category. This is a configuration change.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
        categoryId: {
          type: 'string',
          description: 'Optional UAPIs category id. Leave empty to affect every API.',
        },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return setUapisApisEnabled({
        enabled: input.enabled as boolean,
        categoryId: typeof input.categoryId === 'string' ? input.categoryId : undefined,
      })
    },
  },
  {
    name: 'uapis_call',
    description:
      'Call one enabled UAPIs API. IMPORTANT: you MUST call uapis_read_api first to check required params and their types. For GET APIs, pass all params in the "params" object; for POST APIs, pass body params in "body" and query params in "params". API Key is optional: the backend adds Bearer API Key only when configured in Settings. This consumes quota.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
        params: {
          type: 'object',
          description: 'Query string parameters for GET APIs, or optional query parameters for POST APIs.',
          additionalProperties: true,
        },
        body: {
          type: 'object',
          description: 'JSON body for POST APIs. Leave empty for GET APIs.',
          additionalProperties: true,
        },
      },
      required: ['apiId'],
      additionalProperties: false,
    },
    execute: async (args) => callUapis((args ?? {}) as Record<string, unknown>),
  },
]
