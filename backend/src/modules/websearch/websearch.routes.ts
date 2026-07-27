import { Router } from 'express'
import { HttpError } from '../../http-error.js'
import {
  listSearchEngines,
  listSearchSourceGroups,
  setSearchSourceEnabled,
  type SearchRequest,
} from './websearch.service.js'
import {
  getResearchSessionStore,
  runResearchSearch,
  type ResearchResultDecision,
  type ResearchResultStatus,
} from './research-session.service.js'
import {
  addResearchEvidence,
  assessResearchRound,
  createResearchClaims,
  extractResearchResults,
  getResearchEvidenceCandidates,
  getResearchSessionState,
  writeResearchToWiki,
} from './research-workflow.service.js'

export const websearchRouter = Router()

function searchRequestFromBody(value: unknown): SearchRequest {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    query: String(body.query ?? ''),
    engines: Array.isArray(body.engines) ? body.engines.map(String) : undefined,
    region: body.region === 'cn' || body.region === 'global' || body.region === 'auto'
      ? body.region
      : undefined,
    site: typeof body.site === 'string' ? body.site : undefined,
    filetype: typeof body.filetype === 'string' ? body.filetype : undefined,
    time:
      body.time === 'hour'
      || body.time === 'day'
      || body.time === 'week'
      || body.time === 'month'
      || body.time === 'year'
        ? body.time
        : undefined,
    intent:
      body.intent === 'general'
      || body.intent === 'development'
      || body.intent === 'privacy'
      || body.intent === 'news'
      || body.intent === 'academic'
      || body.intent === 'wechat'
      || body.intent === 'knowledge'
        ? body.intent
        : undefined,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  }
}

websearchRouter.get('/engines', async (_req, res, next) => {
  try {
    res.json({
      engines: await listSearchEngines(),
      sourceGroups: await listSearchSourceGroups(),
    })
  } catch (e) {
    next(e)
  }
})

websearchRouter.get('/research/sessions', (req, res, next) => {
  try {
    const limit = Number(req.query.limit)
    const store = getResearchSessionStore()
    res.json({
      sessions: Number.isFinite(limit) ? store.listSessions(limit) : store.listSessions(),
    })
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions', (req, res, next) => {
  try {
    res.status(201).json(getResearchSessionStore().createSession({
      title: String(req.body?.title ?? ''),
      description: typeof req.body?.description === 'string' ? req.body.description : undefined,
      owner: typeof req.body?.owner === 'string' ? req.body.owner : 'web',
    }))
  } catch (error) {
    next(error)
  }
})

websearchRouter.get('/research/sessions/:sessionId', (req, res, next) => {
  try {
    res.json(getResearchSessionState(String(req.params.sessionId)))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/search', async (req, res, next) => {
  try {
    res.json(await runResearchSearch(
      String(req.params.sessionId),
      searchRequestFromBody(req.body),
    ))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/extract', async (req, res, next) => {
  try {
    res.json(await extractResearchResults({
      sessionId: String(req.params.sessionId),
      resultIds: Array.isArray(req.body?.resultIds) ? req.body.resultIds.map(String) : [],
      maxChars: typeof req.body?.maxChars === 'number' ? req.body.maxChars : undefined,
    }))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/assess', (req, res, next) => {
  try {
    res.json(assessResearchRound({
      sessionId: String(req.params.sessionId),
      queryId: typeof req.body?.queryId === 'string' ? req.body.queryId : undefined,
    }))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/results/review', (req, res, next) => {
  try {
    const decisions: ResearchResultDecision[] = []
    for (const value of Array.isArray(req.body?.decisions) ? req.body.decisions : []) {
      const decision = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {}
      const status = decision.status
      if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
        throw new HttpError(400, '研究审核状态不正确。')
      }
      decisions.push({
        resultId: String(decision.resultId ?? ''),
        status: status as ResearchResultStatus,
      })
    }
    res.json(getResearchSessionStore().reviewResults(
      String(req.params.sessionId),
      decisions,
    ))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/claims', (req, res, next) => {
  try {
    const claims = (Array.isArray(req.body?.claims) ? req.body.claims : []).map((value: unknown) => {
      const claim = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      if (typeof claim.text !== 'string' || !claim.text.trim()) {
        throw new HttpError(400, '研究主张文本不能为空。')
      }
      if (
        claim.riskLevel !== undefined
        && claim.riskLevel !== 'low'
        && claim.riskLevel !== 'medium'
        && claim.riskLevel !== 'high'
      ) {
        throw new HttpError(400, '研究主张风险等级不正确。')
      }
      return {
        text: claim.text,
        subject: typeof claim.subject === 'string' ? claim.subject : undefined,
        predicate: typeof claim.predicate === 'string' ? claim.predicate : undefined,
        object: typeof claim.object === 'string' ? claim.object : undefined,
        timeConstraint: typeof claim.timeConstraint === 'string' ? claim.timeConstraint : undefined,
        riskLevel: claim.riskLevel,
      }
    })
    res.status(201).json(createResearchClaims({
      sessionId: String(req.params.sessionId),
      claims,
    }))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post(
  '/research/sessions/:sessionId/claims/:claimId/evidence/candidates',
  (req, res, next) => {
    try {
      res.json(getResearchEvidenceCandidates({
        sessionId: String(req.params.sessionId),
        claimId: String(req.params.claimId),
        limit: typeof req.body?.limit === 'number' ? req.body.limit : undefined,
      }))
    } catch (error) {
      next(error)
    }
  },
)

websearchRouter.post(
  '/research/sessions/:sessionId/claims/:claimId/evidence',
  (req, res, next) => {
    try {
      const stance = req.body?.stance
      if (stance !== 'support' && stance !== 'refute' && stance !== 'insufficient') {
        throw new HttpError(400, '研究证据立场不正确。')
      }
      res.status(201).json(addResearchEvidence({
        sessionId: String(req.params.sessionId),
        claimId: String(req.params.claimId),
        resultId: String(req.body?.resultId ?? ''),
        snapshotId: typeof req.body?.snapshotId === 'string' ? req.body.snapshotId : undefined,
        quote: String(req.body?.quote ?? ''),
        charStart: Number(req.body?.charStart),
        charEnd: Number(req.body?.charEnd),
        stance,
        confidence: typeof req.body?.confidence === 'number' ? req.body.confidence : undefined,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      }))
    } catch (error) {
      next(error)
    }
  },
)

websearchRouter.post(
  '/research/sessions/:sessionId/claims/:claimId/review',
  (req, res, next) => {
    try {
      res.json(getResearchSessionStore().reviewClaim(
        String(req.params.sessionId),
        String(req.params.claimId),
        typeof req.body?.reviewer === 'string' ? req.body.reviewer : 'agent',
      ))
    } catch (error) {
      next(error)
    }
  },
)

websearchRouter.post('/research/sessions/:sessionId/writeback', async (req, res, next) => {
  try {
    res.json(await writeResearchToWiki({
      sessionId: String(req.params.sessionId),
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      summary: String(req.body?.summary ?? ''),
      content: typeof req.body?.content === 'string' ? req.body.content : undefined,
      claimIds: Array.isArray(req.body?.claimIds) ? req.body.claimIds.map(String) : undefined,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : undefined,
      completeSession: req.body?.completeSession === true,
    }))
  } catch (error) {
    next(error)
  }
})

websearchRouter.post('/research/sessions/:sessionId/complete', (req, res, next) => {
  try {
    res.json(getResearchSessionStore().completeSession(String(req.params.sessionId)))
  } catch (error) {
    next(error)
  }
})

websearchRouter.patch('/sources/:family/:id', async (req, res, next) => {
  try {
    await setSearchSourceEnabled({
      family: String(req.params.family) as 'web-search' | 'skill-marketplace' | 'uapis' | 'intel-source',
      id: String(req.params.id),
      enabled: req.body?.enabled as boolean,
    })
    res.json({
      engines: await listSearchEngines(),
      sourceGroups: await listSearchSourceGroups(),
    })
  } catch (e) {
    next(e)
  }
})
