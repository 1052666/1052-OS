import { HttpError } from '../../http-error.js'
import { reindexPkm } from '../pkm/pkm.service.js'
import { writeWikiQueryBack } from '../wiki/wiki.service.js'
import {
  assessResearchQuality,
  findResearchEvidenceCandidates,
  suggestResearchQueries,
  type ResearchAnalysisResult,
  type ResearchClaimRisk,
  type ResearchEvidenceStance,
} from './research-analysis.service.js'
import {
  getResearchSessionStore,
  type ResearchSessionStore,
  type ResearchResult,
} from './research-session.service.js'
import { readWebPage } from './websearch.service.js'

const MAX_EXTRACTION_BATCH = 12
const MAX_RESEARCH_RESULTS = 100

export type ResearchWorkflowDependencies = {
  store: ResearchSessionStore
  readPage: typeof readWebPage
  writeWiki: (input: Parameters<typeof writeWikiQueryBack>[0]) => Promise<{ path: string }>
  reindex: () => Promise<unknown>
}

function workflowDependencies(
  overrides: Partial<ResearchWorkflowDependencies> = {},
): ResearchWorkflowDependencies {
  return {
    store: overrides.store ?? getResearchSessionStore(),
    readPage: overrides.readPage ?? readWebPage,
    writeWiki: overrides.writeWiki ?? writeWikiQueryBack,
    reindex: overrides.reindex ?? reindexPkm,
  }
}

function toAnalysisResult(result: ResearchResult): ResearchAnalysisResult {
  return {
    id: result.id,
    title: result.title,
    url: result.url,
    normalizedUrl: result.normalizedUrl,
    content: result.content,
    status: result.status,
  }
}

export async function extractResearchResults(input: {
  sessionId: string
  resultIds: string[]
  maxChars?: number
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  const { store, readPage } = workflowDependencies(overrides)
  store.assertActiveSession(input.sessionId)
  const resultIds = [...new Set(input.resultIds.map((id) => id.trim()).filter(Boolean))]
  if (resultIds.length === 0) throw new HttpError(400, '至少需要一个待提取的研究结果。')
  if (resultIds.length > MAX_EXTRACTION_BATCH) {
    throw new HttpError(400, `单次最多提取 ${MAX_EXTRACTION_BATCH} 个网页。`)
  }

  const snapshots = []
  for (const resultId of resultIds) {
    const result = store.getResult(input.sessionId, resultId)
    try {
      const page = await readPage(result.url, input.maxChars)
      snapshots.push(store.recordSnapshot(input.sessionId, result.id, {
        status: 'ready',
        requestedUrl: result.url,
        finalUrl: page.finalUrl,
        title: page.title,
        content: page.text,
      }))
    } catch (error) {
      snapshots.push(store.recordSnapshot(input.sessionId, result.id, {
        status: 'failed',
        requestedUrl: result.url,
        error: error instanceof Error ? error.message : '网页正文提取失败。',
      }))
    }
  }

  return {
    session: store.getSession(input.sessionId),
    extracted: snapshots.filter((snapshot) => snapshot.status === 'ready').length,
    failed: snapshots.filter((snapshot) => snapshot.status === 'failed').length,
    snapshots,
  }
}

export function assessResearchRound(input: {
  sessionId: string
  queryId?: string
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  const { store } = workflowDependencies(overrides)
  const session = store.getSession(input.sessionId)
  const rounds = store.listRounds(input.sessionId, { limit: MAX_RESEARCH_RESULTS })
  const round = input.queryId
    ? rounds.find((item) => item.id === input.queryId)
    : rounds[0]
  if (!round) throw new HttpError(404, '研究会话还没有可评估的搜索轮次。')

  const allResults = store.listAllResults(input.sessionId)
  const latestResults = allResults.filter((result) =>
    result.origins.some((origin) => origin.queryId === round.id),
  )
  const priorApproved = allResults.filter((result) =>
    result.status === 'approved'
    && result.origins.some((origin) => origin.round < round.round),
  )
  const seenEarlierUrls = new Set(
    allResults
      .filter((result) => result.origins.some((origin) => origin.round < round.round))
      .map((result) => result.normalizedUrl),
  )
  const quality = assessResearchQuality({
    results: latestResults.map(toAnalysisResult),
    priorApproved: priorApproved.map(toAnalysisResult),
    seenEarlierUrls,
  })
  const suggestions = suggestResearchQueries({
    topic: session.title,
    latestQuery: round.query,
    quality,
    results: latestResults.map(toAnalysisResult),
    previousQueries: rounds.map((item) => item.query),
  })
  return store.saveRoundAssessment({
    sessionId: input.sessionId,
    queryId: round.id,
    quality,
    suggestions,
  })
}

export function getResearchEvidenceCandidates(input: {
  sessionId: string
  claimId: string
  limit?: number
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  const { store } = workflowDependencies(overrides)
  const claim = store.getClaim(input.sessionId, input.claimId)
  const approved = store.listAllResults(input.sessionId, 'approved')
  return {
    claim,
    candidates: findResearchEvidenceCandidates(
      claim.text,
      approved.map(toAnalysisResult),
      input.limit,
    ),
  }
}

export function addResearchEvidence(input: {
  sessionId: string
  claimId: string
  resultId: string
  snapshotId?: string
  quote: string
  charStart: number
  charEnd: number
  stance: ResearchEvidenceStance
  confidence?: number
  reason?: string
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  return workflowDependencies(overrides).store.addEvidence(input)
}

export function createResearchClaims(input: {
  sessionId: string
  claims: Array<{
    text: string
    subject?: string
    predicate?: string
    object?: string
    timeConstraint?: string
    riskLevel?: ResearchClaimRisk
  }>
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  return workflowDependencies(overrides).store.createClaims(input.sessionId, input.claims)
}

export function getResearchSessionState(
  sessionId: string,
  overrides: Partial<ResearchWorkflowDependencies> = {},
) {
  const { store } = workflowDependencies(overrides)
  return {
    session: store.getSession(sessionId),
    rounds: store.listRounds(sessionId, { limit: MAX_RESEARCH_RESULTS }),
    assessments: store.listRoundAssessments(sessionId, MAX_RESEARCH_RESULTS),
    results: store.listResults(sessionId, { limit: MAX_RESEARCH_RESULTS }),
    snapshots: store.listSnapshots(sessionId, {
      latestOnly: true,
      limit: MAX_RESEARCH_RESULTS,
    }),
    claims: store.listClaims(sessionId, MAX_RESEARCH_RESULTS),
    evidence: store.listEvidence(sessionId, { limit: MAX_RESEARCH_RESULTS }),
    claimReviews: store.listClaimReviews(sessionId),
    writebacks: store.listWritebacks(sessionId, MAX_RESEARCH_RESULTS),
  }
}

function researchWritebackContent(input: {
  title: string
  content?: string
  claims: ReturnType<ReturnType<typeof getResearchSessionStore>['listClaims']>
  evidence: ReturnType<ReturnType<typeof getResearchSessionStore>['listEvidence']>
}) {
  const sections = [`# ${input.title}`]
  if (input.content?.trim()) sections.push(input.content.trim())
  sections.push('## 已核验主张')
  for (const claim of input.claims) {
    sections.push(`### ${claim.text}`)
    const claimEvidence = input.evidence.filter((item) => item.claimId === claim.id)
    for (const evidence of claimEvidence) {
      const stance =
        evidence.stance === 'support'
          ? '支持'
          : evidence.stance === 'refute'
            ? '反驳'
            : '证据不足'
      sections.push(`- ${stance}：[${evidence.quote}](${evidence.resultUrl})`)
    }
  }
  const sources = [...new Set(input.evidence.map((item) => item.resultUrl))]
  sections.push('## 来源')
  sections.push(...sources.map((source) => `- ${source}`))
  return sections.join('\n\n')
}

export async function writeResearchToWiki(input: {
  sessionId: string
  title?: string
  summary: string
  content?: string
  claimIds?: string[]
  tags?: string[]
  completeSession?: boolean
}, overrides: Partial<ResearchWorkflowDependencies> = {}) {
  const { store, writeWiki, reindex } = workflowDependencies(overrides)
  const session = store.assertActiveSession(input.sessionId)
  const reviews = store.listClaimReviews(input.sessionId)
  const approvedIds = reviews
    .filter((review) => review.decision === 'approved')
    .map((review) => review.claimId)
  const requestedIds = input.claimIds?.length
    ? [...new Set(input.claimIds.map((id) => id.trim()).filter(Boolean))]
    : approvedIds
  if (requestedIds.length === 0) {
    throw new HttpError(409, '没有通过 Claim Review 的主张可写入 Wiki。')
  }
  const disallowed = requestedIds.filter((id) => !approvedIds.includes(id))
  if (disallowed.length > 0) {
    throw new HttpError(409, `以下主张尚未批准: ${disallowed.join(', ')}`)
  }

  const claims = requestedIds.map((claimId) => store.getClaim(input.sessionId, claimId))
  const evidence = store.listAllEvidence(input.sessionId)
    .filter((item) => requestedIds.includes(item.claimId))
  if (evidence.length === 0) {
    throw new HttpError(409, '已批准主张没有可写入的证据。')
  }
  const resultIds = [...new Set(evidence.map((item) => item.resultId))]
  for (const resultId of resultIds) {
    if (store.getResult(input.sessionId, resultId).status !== 'approved') {
      throw new HttpError(409, `证据来源尚未批准: ${resultId}`)
    }
  }

  const title = input.title?.trim() || session.title
  const summary = input.summary.trim()
  if (!summary) throw new HttpError(400, 'Wiki 写回摘要不能为空。')
  const sources = [...new Set(evidence.map((item) => item.resultUrl))]
  const page = await writeWiki({
    title,
    summary,
    tags: [...new Set(['深度研究', '证据审核', ...(input.tags ?? [])])],
    sources,
    content: researchWritebackContent({
      title,
      content: input.content,
      claims,
      evidence,
    }),
  })
  const pkm = await reindex()
  const writeback = store.recordWriteback({
    sessionId: input.sessionId,
    wikiPath: page.path,
    title,
    summary,
    claimIds: requestedIds,
    resultIds,
  })
  if (input.completeSession === true) store.completeSession(input.sessionId)
  return {
    session: store.getSession(input.sessionId),
    page,
    pkm,
    writeback,
  }
}
