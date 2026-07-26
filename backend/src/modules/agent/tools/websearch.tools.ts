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
import {
  addResearchEvidence,
  assessResearchRound,
  createResearchClaims,
  extractResearchResults,
  getResearchEvidenceCandidates,
  getResearchSessionState,
  writeResearchToWiki,
} from '../../websearch/research-workflow.service.js'
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
      'Inspect research sessions, persisted query rounds, engine outcomes, and pending, approved, or rejected results. Omit sessionId to list recent sessions.',
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
        roundLimit: {
          type: 'number',
          description: 'Maximum newest search rounds to return. Default 20, max 100.',
        },
        roundOffset: {
          type: 'number',
          description: 'Search-round offset for pagination.',
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
      const workflow = getResearchSessionState(sessionId)
      return {
        ...workflow,
        rounds: store.listRounds(sessionId, {
          limit: typeof input.roundLimit === 'number' ? input.roundLimit : undefined,
          offset: typeof input.roundOffset === 'number' ? input.roundOffset : undefined,
        }),
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
    name: 'websearch_research_extract',
    description:
      'Fetch public pages for selected research results and store immutable source snapshots. Every request and redirect is protected against private-network access, oversized bodies, unsupported content types, and timeouts.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Research session id.',
        },
        resultIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pending or approved research result ids to extract. Maximum 12.',
        },
        maxChars: {
          type: 'number',
          description: 'Maximum readable characters per snapshot. Default 12000, max 50000.',
        },
      },
      required: ['sessionId', 'resultIds'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return extractResearchResults({
        sessionId: String(input.sessionId ?? ''),
        resultIds: Array.isArray(input.resultIds) ? input.resultIds.map(String) : [],
        maxChars: typeof input.maxChars === 'number' ? input.maxChars : undefined,
      })
    },
  },
  {
    name: 'websearch_research_assess',
    description:
      'Assess one persisted search round using independent content-depth, source-diversity, and novelty thresholds, then return deterministic follow-up query suggestions.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Research session id.',
        },
        queryId: {
          type: 'string',
          description: 'Optional query round id. Omit to assess the newest round.',
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return assessResearchRound({
        sessionId: String(input.sessionId ?? ''),
        queryId: typeof input.queryId === 'string' ? input.queryId : undefined,
      })
    },
  },
  {
    name: 'websearch_research_claim_create',
    description:
      'Create one or more atomic claims inside a research session for evidence verification. Claim ids are collision-safe and remain scoped to the session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Research session id.',
        },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Atomic claim text.' },
              subject: { type: 'string' },
              predicate: { type: 'string' },
              object: { type: 'string' },
              timeConstraint: { type: 'string' },
              riskLevel: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Use high for consequential factual claims.',
              },
            },
            required: ['text'],
            additionalProperties: false,
          },
        },
      },
      required: ['sessionId', 'claims'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const claims = (Array.isArray(input.claims) ? input.claims : [])
        .map((value) => value && typeof value === 'object' ? value as Record<string, unknown> : {})
        .map((claim) => ({
          text: String(claim.text ?? ''),
          subject: typeof claim.subject === 'string' ? claim.subject : undefined,
          predicate: typeof claim.predicate === 'string' ? claim.predicate : undefined,
          object: typeof claim.object === 'string' ? claim.object : undefined,
          timeConstraint: typeof claim.timeConstraint === 'string' ? claim.timeConstraint : undefined,
          riskLevel:
            claim.riskLevel === 'low' || claim.riskLevel === 'medium' || claim.riskLevel === 'high'
              ? claim.riskLevel as 'low' | 'medium' | 'high'
              : undefined,
        }))
      return {
        claims: createResearchClaims({
          sessionId: String(input.sessionId ?? ''),
          claims,
        }),
      }
    },
  },
  {
    name: 'websearch_research_evidence_candidates',
    description:
      'Find exact sentence candidates for one claim from approved results with ready source snapshots. Returns result ids, offsets, hashes, publisher clusters, and similarity scores without persisting evidence.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        claimId: { type: 'string' },
        limit: { type: 'number', description: 'Maximum candidates. Default 8, max 20.' },
      },
      required: ['sessionId', 'claimId'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return getResearchEvidenceCandidates({
        sessionId: String(input.sessionId ?? ''),
        claimId: String(input.claimId ?? ''),
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      })
    },
  },
  {
    name: 'websearch_research_evidence_add',
    description:
      'Attach one verified quote to a claim. The backend requires an approved result and validates snapshot id, exact UTF-16 offsets, quote equality, SHA-256, and publisher cluster before persisting.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        claimId: { type: 'string' },
        resultId: { type: 'string' },
        snapshotId: { type: 'string', description: 'Optional immutable snapshot id.' },
        quote: { type: 'string', description: 'Exact verbatim quote.' },
        charStart: { type: 'number' },
        charEnd: { type: 'number' },
        stance: {
          type: 'string',
          enum: ['support', 'refute', 'insufficient'],
        },
        confidence: {
          type: 'number',
          description: 'Optional confidence from 0 to 1.',
        },
        reason: { type: 'string' },
      },
      required: [
        'sessionId',
        'claimId',
        'resultId',
        'quote',
        'charStart',
        'charEnd',
        'stance',
      ],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      if (
        input.stance !== 'support'
        && input.stance !== 'refute'
        && input.stance !== 'insufficient'
      ) {
        throw new HttpError(400, '证据 stance 不正确。')
      }
      return addResearchEvidence({
        sessionId: String(input.sessionId ?? ''),
        claimId: String(input.claimId ?? ''),
        resultId: String(input.resultId ?? ''),
        snapshotId: typeof input.snapshotId === 'string' ? input.snapshotId : undefined,
        quote: String(input.quote ?? ''),
        charStart: Number(input.charStart),
        charEnd: Number(input.charEnd),
        stance: input.stance,
        confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
        reason: typeof input.reason === 'string' ? input.reason : undefined,
      })
    },
  },
  {
    name: 'websearch_research_claim_review',
    description:
      'Run deterministic Claim-Evidence-Review policy. Refuting evidence creates a conflict; high-risk claims and automatic approval require at least two independent publisher domains.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        claimId: { type: 'string' },
      },
      required: ['sessionId', 'claimId'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return getResearchSessionStore().reviewClaim(
        String(input.sessionId ?? ''),
        String(input.claimId ?? ''),
      )
    },
  },
  {
    name: 'websearch_research_writeback',
    description:
      'Write only approved claims and their anchored evidence into a structured Wiki synthesis page, rebuild PKM synchronously, record the writeback, and optionally complete the research session. Requires user approval under the default permission profile.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        content: {
          type: 'string',
          description: 'Optional analysis body. Verified claims, evidence, and sources are appended by the backend.',
        },
        claimIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Approved claim ids. Omit to include every approved claim.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
        completeSession: { type: 'boolean' },
      },
      required: ['sessionId', 'summary'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return writeResearchToWiki({
        sessionId: String(input.sessionId ?? ''),
        title: typeof input.title === 'string' ? input.title : undefined,
        summary: String(input.summary ?? ''),
        content: typeof input.content === 'string' ? input.content : undefined,
        claimIds: Array.isArray(input.claimIds) ? input.claimIds.map(String) : undefined,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
        completeSession: input.completeSession === true,
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
