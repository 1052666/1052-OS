import { createHash } from 'node:crypto'

export type ResearchQualityVerdict = 'good' | 'acceptable' | 'poor'
export type ResearchClaimRisk = 'low' | 'medium' | 'high'
export type ResearchEvidenceStance = 'support' | 'refute' | 'insufficient'
export type ResearchClaimReviewDecision = 'approved' | 'needs_review' | 'rejected'

export type ResearchAnalysisResult = {
  id: string
  title: string
  url: string
  normalizedUrl: string
  content: string
  status: 'pending' | 'approved' | 'rejected'
}

export type ResearchQualityIndicator = {
  value: number
  threshold: number
  pass: boolean
}

export type ResearchQualityAssessment = {
  verdict: ResearchQualityVerdict
  breakdown: {
    contentDepth: ResearchQualityIndicator
    sourceDiversity: ResearchQualityIndicator
    novelty: ResearchQualityIndicator
  }
  failedIndicators: Array<'contentDepth' | 'sourceDiversity' | 'novelty'>
}

export type ResearchQuerySuggestion = {
  query: string
  reason: string
  strategy: 'depth' | 'diversity' | 'novelty' | 'coverage'
}

export type ResearchEvidenceCandidate = {
  resultId: string
  resultUrl: string
  quote: string
  charStart: number
  charEnd: number
  contentHash: string
  sourceClusterId: string
  similarity: number
}

export type ResearchReviewEvidence = {
  id: string
  stance: ResearchEvidenceStance
  quote: string
  sourceClusterId: string
}

export type ResearchClaimReview = {
  decision: ResearchClaimReviewDecision
  autoPass: boolean
  checks: {
    sourceIndependent: boolean
    hasRefute: boolean
    allSupport: boolean
    evidenceCount: number
  }
  conflict?: {
    summary: string
    supporting: string[]
    refuting: string[]
  }
  matchedRule:
    | 'noEvidence'
    | 'singleRefute'
    | 'highRiskInsufficient'
    | 'dualSourceSupport'
    | 'dualSourceMixed'
    | 'singleSource'
    | 'allInsufficient'
    | 'fallback'
}

export const DEFAULT_RESEARCH_QUALITY_THRESHOLDS = {
  contentDepth: 800,
  sourceDiversity: 3,
  novelty: 0.3,
} as const

const NOVELTY_SIMILARITY_THRESHOLD = 0.75
const CJK_EVIDENCE_THRESHOLD = 0.2
const LATIN_EVIDENCE_THRESHOLD = 0.3
const SPECIALIZED_DOMAINS = [
  'arxiv.org',
  'semanticscholar.org',
  'github.com',
  'stackoverflow.com',
  'docs.rs',
  'npmjs.com',
  'pypi.org',
  'reddit.com',
  'news.ycombinator.com',
] as const

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'and', 'or', 'if', 'this', 'that', 'these', 'those',
  'it', 'its', 'which', 'who', 'what', 'how', 'why', 'when',
])

export function hashResearchText(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function researchSourceClusterId(url: string) {
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    // Unknown publishers intentionally share one cluster.
  }
  return hashResearchText(hostname).slice(0, 16)
}

export function tokenizeResearchText(value: string) {
  const normalized = value.toLowerCase()
  const tokens: string[] = []

  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/gu)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2))
    }
  }

  for (const match of normalized.matchAll(/[a-z]+(?:[._-][a-z0-9]+)*|\d+(?:[._-]\d+)+|[a-z0-9]+/g)) {
    const token = match[0]
    if (token.length > 1 && !STOPWORDS.has(token)) tokens.push(token)
  }

  return tokens
}

export function researchJaccardSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenizeResearchText(left))
  const rightTokens = new Set(tokenizeResearchText(right))
  if (leftTokens.size === 0 && rightTokens.size === 0) return 0

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  const union = leftTokens.size + rightTokens.size - intersection
  return union === 0 ? 0 : intersection / union
}

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function assessResearchQuality(input: {
  results: ResearchAnalysisResult[]
  priorApproved: ResearchAnalysisResult[]
  seenEarlierUrls?: ReadonlySet<string>
  thresholds?: Partial<typeof DEFAULT_RESEARCH_QUALITY_THRESHOLDS>
}): ResearchQualityAssessment {
  const thresholds = {
    ...DEFAULT_RESEARCH_QUALITY_THRESHOLDS,
    ...input.thresholds,
  }
  const extracted = input.results.filter((result) => result.content.trim())
  const contentDepth = extracted.length === 0
    ? 0
    : extracted.reduce((sum, result) => sum + result.content.length, 0) / extracted.length
  const sourceDiversity = new Set(
    input.results.map((result) => sourceDomain(result.url)).filter(Boolean),
  ).size

  let novelCount = 0
  for (const result of input.results) {
    const repeatedUrl = input.seenEarlierUrls?.has(result.normalizedUrl) ?? false
    const comparable = result.content || result.title
    const duplicatedContent = input.priorApproved.some((prior) =>
      prior.normalizedUrl !== result.normalizedUrl
      && researchJaccardSimilarity(comparable, prior.content || prior.title) >= NOVELTY_SIMILARITY_THRESHOLD,
    )
    if (!repeatedUrl && !duplicatedContent) novelCount += 1
  }
  const novelty = input.results.length === 0 ? 0 : novelCount / input.results.length

  const breakdown = {
    contentDepth: {
      value: contentDepth,
      threshold: thresholds.contentDepth,
      pass: contentDepth >= thresholds.contentDepth,
    },
    sourceDiversity: {
      value: sourceDiversity,
      threshold: thresholds.sourceDiversity,
      pass: sourceDiversity >= thresholds.sourceDiversity,
    },
    novelty: {
      value: novelty,
      threshold: thresholds.novelty,
      pass: novelty >= thresholds.novelty,
    },
  }
  const failedIndicators = (Object.entries(breakdown) as Array<
    [ResearchQualityAssessment['failedIndicators'][number], ResearchQualityIndicator]
  >)
    .filter(([, indicator]) => !indicator.pass)
    .map(([key]) => key)
  const verdict: ResearchQualityVerdict =
    failedIndicators.length === 0
      ? 'good'
      : failedIndicators.length === 1
        ? 'acceptable'
        : 'poor'

  return { verdict, breakdown, failedIndicators }
}

function compactQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function suggestResearchQueries(input: {
  topic: string
  latestQuery: string
  quality: ResearchQualityAssessment
  results: ResearchAnalysisResult[]
  previousQueries: string[]
}) {
  const base = compactQuery(input.latestQuery || input.topic)
  const exploredDomains = new Set(input.results.map((result) => sourceDomain(result.url)))
  const suggestions: ResearchQuerySuggestion[] = []
  const add = (query: string, reason: string, strategy: ResearchQuerySuggestion['strategy']) => {
    const normalized = compactQuery(query)
    if (
      !normalized
      || input.previousQueries.some((previous) => compactQuery(previous).toLowerCase() === normalized.toLowerCase())
      || suggestions.some((item) => item.query.toLowerCase() === normalized.toLowerCase())
    ) return
    suggestions.push({ query: normalized, reason, strategy })
  }

  if (!input.quality.breakdown.contentDepth.pass) {
    add(`${base} 官方报告 深度分析`, '当前来源正文深度不足，优先寻找官方或长篇材料。', 'depth')
  }
  if (!input.quality.breakdown.sourceDiversity.pass) {
    const domain = SPECIALIZED_DOMAINS.find((item) => !exploredDomains.has(item))
    if (domain) {
      add(`${base} site:${domain}`, `当前独立来源不足，补充尚未覆盖的 ${domain}。`, 'diversity')
    }
  }
  if (!input.quality.breakdown.novelty.pass) {
    add(`${base} 争议 反方 独立评测`, '当前结果与既有来源重复度较高，主动寻找反例和独立观点。', 'novelty')
  }

  const frequencies = new Map<string, number>()
  for (const result of input.results) {
    for (const token of new Set(tokenizeResearchText(`${result.title} ${result.content.slice(0, 1200)}`))) {
      if (token.length < 2 || /^\d+$/.test(token)) continue
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    }
  }
  const coverageTerm = [...frequencies.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([term]) => term)
    .find((term) => !base.toLowerCase().includes(term.toLowerCase()))
  if (coverageTerm) {
    add(`${base} ${coverageTerm}`, `高频概念“${coverageTerm}”尚未形成独立检索轮次。`, 'coverage')
  }

  if (suggestions.length === 0) {
    add(`${base} 最新证据 原始来源`, '质量指标已满足，继续补充时优先寻找更新且可核验的原始来源。', 'coverage')
  }
  return suggestions.slice(0, 5)
}

function splitEvidenceSentences(content: string) {
  const sentences: Array<{ quote: string; charStart: number; charEnd: number }> = []
  const matcher = /[^!?。！？\n]+[!?。！？]?|[^\n]+$/gu
  for (const match of content.matchAll(matcher)) {
    const raw = match[0]
    const leading = raw.length - raw.trimStart().length
    const quote = raw.trim()
    if (quote.length < 10 || match.index === undefined) continue
    const charStart = match.index + leading
    sentences.push({ quote, charStart, charEnd: charStart + quote.length })
  }
  return sentences
}

export function findResearchEvidenceCandidates(
  claimText: string,
  approvedResults: ResearchAnalysisResult[],
  limit = 8,
): ResearchEvidenceCandidate[] {
  const threshold = /[\u3400-\u9fff]/u.test(claimText)
    ? CJK_EVIDENCE_THRESHOLD
    : LATIN_EVIDENCE_THRESHOLD
  const candidates: ResearchEvidenceCandidate[] = []

  for (const result of approvedResults) {
    if (!result.content.trim()) continue
    for (const sentence of splitEvidenceSentences(result.content)) {
      const similarity = researchJaccardSimilarity(claimText, sentence.quote)
      if (similarity < threshold) continue
      candidates.push({
        resultId: result.id,
        resultUrl: result.url,
        quote: sentence.quote,
        charStart: sentence.charStart,
        charEnd: sentence.charEnd,
        contentHash: hashResearchText(sentence.quote),
        sourceClusterId: researchSourceClusterId(result.url),
        similarity,
      })
    }
  }

  return candidates
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit))))
}

export function evaluateResearchClaim(
  riskLevel: ResearchClaimRisk,
  evidences: ResearchReviewEvidence[],
): ResearchClaimReview {
  const sourceCount = new Set(evidences.map((evidence) => evidence.sourceClusterId)).size
  const supporting = evidences.filter((evidence) => evidence.stance === 'support')
  const refuting = evidences.filter((evidence) => evidence.stance === 'refute')
  const checks = {
    sourceIndependent: sourceCount >= 2,
    hasRefute: refuting.length > 0,
    allSupport: supporting.length > 0 && supporting.length === evidences.length,
    evidenceCount: evidences.length,
  }
  const result = (
    decision: ResearchClaimReviewDecision,
    matchedRule: ResearchClaimReview['matchedRule'],
  ): ResearchClaimReview => ({
    decision,
    autoPass: decision === 'approved',
    checks,
    matchedRule,
    ...(refuting.length > 0
      ? {
          conflict: {
            summary: `主张有 ${supporting.length} 条支持证据和 ${refuting.length} 条反驳证据。`,
            supporting: supporting.slice(0, 5).map((item) => `${item.id}: ${item.quote.slice(0, 120)}`),
            refuting: refuting.slice(0, 5).map((item) => `${item.id}: ${item.quote.slice(0, 120)}`),
          },
        }
      : {}),
  })

  if (evidences.length === 0) return result('needs_review', 'noEvidence')
  if (refuting.length > 0) return result('needs_review', 'singleRefute')
  if (riskLevel === 'high' && sourceCount < 2) return result('needs_review', 'highRiskInsufficient')
  if (sourceCount >= 2 && checks.allSupport) return result('approved', 'dualSourceSupport')
  if (sourceCount >= 2 && evidences.some((item) => item.stance === 'insufficient')) {
    return result('needs_review', 'dualSourceMixed')
  }
  if (sourceCount === 1) return result('needs_review', 'singleSource')
  if (evidences.every((item) => item.stance === 'insufficient')) {
    return result('needs_review', 'allInsufficient')
  }
  return result('needs_review', 'fallback')
}
