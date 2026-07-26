import {
  aggregateSearch,
  listSearchEngines,
  readWebPage,
  setSearchSourceEnabled,
  type SearchRequest,
} from '../../websearch/websearch.service.js'
import {
  getResearchSessionStore,
  runResearchSearch,
  type ResearchResultDecision,
  type ResearchResultStatus,
} from '../../websearch/research-session.service.js'
import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

function searchRequestFromInput(input: Record<string, unknown>): SearchRequest {
  return {
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
  }
}

const researchSearchProperties = {
  query: {
    type: 'string',
    description: 'Main search query.',
  },
  engines: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional enabled search engine ids to force.',
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
    description: 'Optional recent-time filter.',
  },
  intent: {
    type: 'string',
    enum: ['general', 'development', 'privacy', 'news', 'academic', 'wechat', 'knowledge'],
    description: 'Optional search intent.',
  },
  limit: {
    type: 'number',
    description: 'Maximum merged results to retain from this round. Default 10, max 30.',
  },
} as const

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
      return aggregateSearch(searchRequestFromInput(input))
    },
  },
  {
    name: 'websearch_research_start',
    description:
      'Create one persistent research session for a multi-round, multi-source investigation. Reuse the returned sessionId for every later research search and review in the same topic.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short research topic title.',
        },
        description: {
          type: 'string',
          description: 'Optional scope, questions, or evidence requirements.',
        },
        owner: {
          type: 'string',
          description: 'Optional stable owner label, such as web, wechat, feishu, or scheduler.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return getResearchSessionStore().createSession({
        title: String(input.title ?? ''),
        description: typeof input.description === 'string' ? input.description : undefined,
        owner: typeof input.owner === 'string' ? input.owner : undefined,
      })
    },
  },
  {
    name: 'websearch_research_search',
    description:
      'Run one search round inside an existing research session. Results are URL-normalized, deduplicated, ranked with accumulated reciprocal-rank fusion, and stored as pending for Agent review.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Research session id returned by websearch_research_start.',
        },
        ...researchSearchProperties,
      },
      required: ['sessionId', 'query'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return runResearchSearch(
        String(input.sessionId ?? ''),
        searchRequestFromInput(input),
      )
    },
  },
  {
    name: 'websearch_research_status',
    description:
      'Inspect research sessions and their pending, approved, or rejected results. Omit sessionId to list recent sessions.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional research session id.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'rejected'],
          description: 'Optional result status filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum sessions or results to return. Default 20, max 100.',
        },
        offset: {
          type: 'number',
          description: 'Result offset for pagination.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const store = getResearchSessionStore()
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
      const limit = typeof input.limit === 'number' ? input.limit : undefined
      if (!sessionId) {
        return { sessions: store.listSessions(limit) }
      }
      const status =
        input.status === 'pending' || input.status === 'approved' || input.status === 'rejected'
          ? input.status
          : undefined
      return {
        session: store.getSession(sessionId),
        results: store.listResults(sessionId, {
          status,
          limit,
          offset: typeof input.offset === 'number' ? input.offset : undefined,
        }),
      }
    },
  },
  {
    name: 'websearch_research_review',
    description:
      'Review staged research results. Mark each result pending, approved, or rejected; approved results become eligible for later evidence and knowledge workflows.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Research session id.',
        },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              resultId: {
                type: 'string',
                description: 'Research result id.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'approved', 'rejected'],
                description: 'New review status.',
              },
            },
            required: ['resultId', 'status'],
            additionalProperties: false,
          },
          description: 'One or more result review decisions.',
        },
        completeSession: {
          type: 'boolean',
          description: 'When true, close the session after applying the decisions.',
        },
      },
      required: ['sessionId', 'decisions'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const sessionId = String(input.sessionId ?? '')
      const decisions: ResearchResultDecision[] = []
      for (const raw of Array.isArray(input.decisions) ? input.decisions : []) {
        if (!raw || typeof raw !== 'object') {
          throw new HttpError(400, '研究审核决定格式不正确。')
        }
        const item = raw as Record<string, unknown>
        const status = item.status
        if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
          throw new HttpError(400, '研究审核状态不正确。')
        }
        decisions.push({
          resultId: String(item.resultId ?? ''),
          status: status as ResearchResultStatus,
        })
      }
      const store = getResearchSessionStore()
      const review = store.reviewResults(sessionId, decisions)
      return input.completeSession === true
        ? { ...review, session: store.completeSession(sessionId) }
        : review
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
