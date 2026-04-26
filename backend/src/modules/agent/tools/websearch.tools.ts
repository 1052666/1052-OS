import {
  aggregateSearch,
  listSearchEngines,
  readWebPage,
  setSearchSourceEnabled,
} from '../../websearch/websearch.service.js'
import type { AgentTool } from '../agent.tool.types.js'

export const websearchTools: AgentTool[] = [
  {
    name: 'websearch_list_engines',
    description: 'List built-in usable web search engines and their capability metadata. Read-only.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      return {
        engines: await listSearchEngines(),
      }
    },
  },
  {
    name: 'websearch_set_source_enabled',
    description:
      'Enable or disable one search source. This is a configuration change and affects future web search, skill-marketplace, UAPIs, or Intel Center usage.',
    parameters: {
      type: 'object',
      properties: {
        family: {
          type: 'string',
          enum: ['web-search', 'skill-marketplace', 'uapis', 'intel-source'],
          description: 'Search source family.',
        },
        id: {
          type: 'string',
          description: 'Search source id.',
        },
        enabled: {
          type: 'boolean',
          description: 'true to enable, false to disable.',
        },
      },
      required: ['family', 'id', 'enabled'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return setSearchSourceEnabled({
        family: String(input.family ?? '') as 'web-search' | 'skill-marketplace' | 'uapis' | 'intel-source',
        id: String(input.id ?? ''),
        enabled: input.enabled as boolean,
      })
    },
  },
  {
    name: 'websearch_search',
    description:
      'Run a built-in aggregated web search across retained usable engines. Read-only. Supports auto language routing, optional engine selection, site: search, filetype: filter, and rough time filters.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Main search query.',
        },
        engines: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional engine ids to force, such as ["bing-cn","bing-int","duckduckgo","startpage","wechat"].',
        },
        region: {
          type: 'string',
          enum: ['auto', 'cn', 'global'],
          description: 'Engine region routing. Default auto.',
        },
        site: {
          type: 'string',
          description: 'Optional site filter, for example github.com.',
        },
        filetype: {
          type: 'string',
          description: 'Optional filetype filter, for example pdf.',
        },
        time: {
          type: 'string',
          enum: ['hour', 'day', 'week', 'month', 'year'],
          description: 'Optional recent-time filter for engines that support it.',
        },
        intent: {
          type: 'string',
          enum: ['general', 'development', 'privacy', 'news', 'academic', 'wechat', 'knowledge'],
          description: 'Optional search intent. If omitted, the backend infers it from the query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum merged results to return. Default 10, max 30.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return aggregateSearch({
        query: String(input.query ?? ''),
        engines: Array.isArray(input.engines)
          ? input.engines.map((item) => String(item))
          : undefined,
        region:
          input.region === 'cn' || input.region === 'global' || input.region === 'auto'
            ? input.region
            : undefined,
        site: typeof input.site === 'string' ? input.site : undefined,
        filetype: typeof input.filetype === 'string' ? input.filetype : undefined,
        time:
          input.time === 'hour' ||
          input.time === 'day' ||
          input.time === 'week' ||
          input.time === 'month' ||
          input.time === 'year'
            ? input.time
            : undefined,
        intent:
          input.intent === 'general' ||
          input.intent === 'development' ||
          input.intent === 'privacy' ||
          input.intent === 'news' ||
          input.intent === 'academic' ||
          input.intent === 'wechat' ||
          input.intent === 'knowledge'
            ? input.intent
            : undefined,
        limit: typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 30) : undefined,
      })
    },
  },
  {
    name: 'websearch_read_page',
    description:
      'Fetch and extract readable text from a public web page URL. Read-only. Use after websearch_search when the user needs page details rather than just result snippets.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Public http/https URL to read.',
        },
        maxChars: {
          type: 'number',
          description: 'Optional maximum extracted text length. Default 12000.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return readWebPage(
        String(input.url ?? ''),
        typeof input.maxChars === 'number' ? input.maxChars : undefined,
      )
    },
  },
]
