import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import {
  aggregateSearch,
  normalizeResultUrl,
  type SearchRequest,
  type SearchResponse,
} from './websearch.service.js'
import {
  evaluateResearchClaim,
  hashResearchText,
  researchSourceClusterId,
  type ResearchClaimReview,
  type ResearchClaimReviewDecision,
  type ResearchClaimRisk,
  type ResearchEvidenceStance,
  type ResearchQualityAssessment,
  type ResearchQuerySuggestion,
} from './research-analysis.service.js'

export type ResearchSessionStatus = 'active' | 'completed'
export type ResearchResultStatus = 'pending' | 'approved' | 'rejected'

export type ResearchSession = {
  id: string
  title: string
  description: string
  owner: string
  status: ResearchSessionStatus
  createdAt: number
  updatedAt: number
  rounds: number
  resultCounts: {
    total: number
    pending: number
    approved: number
    rejected: number
  }
}

export type ResearchResultOrigin = {
  queryId: string
  query: string
  round: number
  rank: number
  sourceScore: number
}

export type ResearchResult = {
  id: string
  sessionId: string
  title: string
  url: string
  normalizedUrl: string
  snippet: string
  content: string
  source: string
  engine: string
  engineId: string
  matchedBy: string[]
  status: ResearchResultStatus
  score: number
  rrfScore: number
  createdAt: number
  updatedAt: number
  origins: ResearchResultOrigin[]
}

export type ResearchSearchRound = {
  session: ResearchSession
  queryId: string
  round: number
  query: string
  added: number
  reused: number
  results: ResearchResult[]
  search: {
    selectedEngines: SearchResponse['selectedEngines']
    succeededEngines: string[]
    failedEngines: SearchResponse['failedEngines']
  }
}

export type ResearchRound = {
  id: string
  sessionId: string
  round: number
  query: string
  searchQuery: string
  intent: SearchResponse['intent']
  selectedEngines: SearchResponse['selectedEngines']
  succeededEngines: string[]
  failedEngines: SearchResponse['failedEngines']
  resultCount: number
  createdAt: number
}

export type ResearchResultDecision = {
  resultId: string
  status: ResearchResultStatus
}

export type ResearchSnapshotStatus = 'ready' | 'failed'

export type ResearchSnapshot = {
  id: string
  sessionId: string
  resultId: string
  status: ResearchSnapshotStatus
  requestedUrl: string
  finalUrl: string
  title: string
  content: string
  contentHash: string
  sourceDomain: string
  charCount: number
  extractedAt: number
  error: string
}

export type ResearchRoundAssessment = {
  queryId: string
  sessionId: string
  round: number
  quality: ResearchQualityAssessment
  suggestions: ResearchQuerySuggestion[]
  assessedAt: number
}

export type ResearchClaimStatus = 'pending' | 'verifying' | 'reviewed'

export type ResearchClaim = {
  id: string
  sessionId: string
  text: string
  subject: string
  predicate: string
  object: string
  timeConstraint: string
  riskLevel: ResearchClaimRisk
  status: ResearchClaimStatus
  createdAt: number
  updatedAt: number
}

export type ResearchEvidence = {
  id: string
  sessionId: string
  claimId: string
  resultId: string
  snapshotId: string
  resultUrl: string
  quote: string
  charStart: number
  charEnd: number
  contentHash: string
  snapshotHash: string
  extractedAt: number
  sourceClusterId: string
  stance: ResearchEvidenceStance
  confidence?: number
  reason: string
  createdAt: number
}

export type ResearchClaimReviewRecord = ResearchClaimReview & {
  claimId: string
  reviewer: string
  reviewedAt: number
}

export type ResearchWriteback = {
  id: string
  sessionId: string
  wikiPath: string
  title: string
  summary: string
  claimIds: string[]
  resultIds: string[]
  createdAt: number
}

type SessionRow = {
  id: string
  title: string
  description: string
  owner: string
  status: ResearchSessionStatus
  created_at: number
  updated_at: number
  rounds: number
  total_count: number
  pending_count: number
  approved_count: number
  rejected_count: number
}

type ResultRow = {
  id: string
  session_id: string
  title: string
  url: string
  normalized_url: string
  snippet: string
  content: string
  source: string
  engine: string
  engine_id: string
  matched_by_json: string
  status: ResearchResultStatus
  score: number
  created_at: number
  updated_at: number
}

type OriginRow = {
  result_id: string
  query_id: string
  query: string
  round: number
  rank: number
  source_score: number
}

type QueryRow = {
  id: string
  session_id: string
  round: number
  query: string
  search_query: string
  intent: SearchResponse['intent']
  selected_engines_json: string
  succeeded_engines_json: string
  failed_engines_json: string
  result_count: number
  created_at: number
}

type SnapshotRow = {
  id: string
  session_id: string
  result_id: string
  status: ResearchSnapshotStatus
  requested_url: string
  final_url: string
  title: string
  content: string
  content_hash: string
  source_domain: string
  char_count: number
  extracted_at: number
  error: string
}

type AssessmentRow = {
  query_id: string
  session_id: string
  round: number
  quality_json: string
  suggestions_json: string
  assessed_at: number
}

type ClaimRow = {
  id: string
  session_id: string
  text: string
  subject: string
  predicate: string
  object_value: string
  time_constraint: string
  risk_level: ResearchClaimRisk
  status: ResearchClaimStatus
  created_at: number
  updated_at: number
}

type EvidenceRow = {
  id: string
  session_id: string
  claim_id: string
  result_id: string
  snapshot_id: string
  result_url: string
  quote: string
  char_start: number
  char_end: number
  content_hash: string
  snapshot_hash: string
  extracted_at: number
  source_cluster_id: string
  stance: ResearchEvidenceStance
  confidence: number | null
  reason: string
  created_at: number
}

type ReviewRow = {
  claim_id: string
  decision: ResearchClaimReviewDecision
  auto_pass: number
  checks_json: string
  conflict_json: string
  matched_rule: ResearchClaimReview['matchedRule']
  reviewer: string
  reviewed_at: number
}

type WritebackRow = {
  id: string
  session_id: string
  wiki_path: string
  title: string
  summary: string
  claim_ids_json: string
  result_ids_json: string
  created_at: number
}

const DEFAULT_RESULT_LIMIT = 20
const MAX_RESULT_LIMIT = 100
const RRF_K = 60

function createId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_RESULT_LIMIT
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(value ?? DEFAULT_RESULT_LIMIT)))
}

function normalizeOffset(value: number | undefined) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value ?? 0))
}

export function normalizeResearchUrl(value: string) {
  const normalized = normalizeResultUrl(value.trim())
  try {
    const url = new URL(normalized)
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return normalized
  }
}

export function reciprocalRankScore(ranks: readonly number[], k = RRF_K) {
  if (!Number.isFinite(k) || k <= 0) throw new Error('RRF k must be positive.')
  return ranks.reduce((total, rank) => {
    const normalizedRank = Math.max(1, Math.floor(rank))
    return total + 1 / (k + normalizedRank)
  }, 0)
}

function sessionFromRow(row: SessionRow): ResearchSession {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    owner: row.owner,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rounds: row.rounds,
    resultCounts: {
      total: row.total_count,
      pending: row.pending_count,
      approved: row.approved_count,
      rejected: row.rejected_count,
    },
  }
}

function snapshotFromRow(row: SnapshotRow): ResearchSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    resultId: row.result_id,
    status: row.status,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    sourceDomain: row.source_domain,
    charCount: row.char_count,
    extractedAt: row.extracted_at,
    error: row.error,
  }
}

function assessmentFromRow(row: AssessmentRow): ResearchRoundAssessment {
  return {
    queryId: row.query_id,
    sessionId: row.session_id,
    round: row.round,
    quality: parseJson<ResearchQualityAssessment>(row.quality_json, {
      verdict: 'poor',
      breakdown: {
        contentDepth: { value: 0, threshold: 0, pass: false },
        sourceDiversity: { value: 0, threshold: 0, pass: false },
        novelty: { value: 0, threshold: 0, pass: false },
      },
      failedIndicators: ['contentDepth', 'sourceDiversity', 'novelty'],
    }),
    suggestions: parseJson<ResearchQuerySuggestion[]>(row.suggestions_json, []),
    assessedAt: row.assessed_at,
  }
}

function claimFromRow(row: ClaimRow): ResearchClaim {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object_value,
    timeConstraint: row.time_constraint,
    riskLevel: row.risk_level,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function evidenceFromRow(row: EvidenceRow): ResearchEvidence {
  return {
    id: row.id,
    sessionId: row.session_id,
    claimId: row.claim_id,
    resultId: row.result_id,
    snapshotId: row.snapshot_id,
    resultUrl: row.result_url,
    quote: row.quote,
    charStart: row.char_start,
    charEnd: row.char_end,
    contentHash: row.content_hash,
    snapshotHash: row.snapshot_hash,
    extractedAt: row.extracted_at,
    sourceClusterId: row.source_cluster_id,
    stance: row.stance,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    reason: row.reason,
    createdAt: row.created_at,
  }
}

function reviewFromRow(row: ReviewRow): ResearchClaimReviewRecord {
  return {
    claimId: row.claim_id,
    decision: row.decision,
    autoPass: row.auto_pass === 1,
    checks: parseJson<ResearchClaimReview['checks']>(row.checks_json, {
      sourceIndependent: false,
      hasRefute: false,
      allSupport: false,
      evidenceCount: 0,
    }),
    ...(row.conflict_json
      ? { conflict: parseJson<NonNullable<ResearchClaimReview['conflict']>>(row.conflict_json, {
          summary: '',
          supporting: [],
          refuting: [],
        }) }
      : {}),
    matchedRule: row.matched_rule,
    reviewer: row.reviewer,
    reviewedAt: row.reviewed_at,
  }
}

function writebackFromRow(row: WritebackRow): ResearchWriteback {
  return {
    id: row.id,
    sessionId: row.session_id,
    wikiPath: row.wiki_path,
    title: row.title,
    summary: row.summary,
    claimIds: parseStringArray(row.claim_ids_json),
    resultIds: parseStringArray(row.result_ids_json),
    createdAt: row.created_at,
  }
}

function sessionSelectSql(where = '') {
  return `
    SELECT
      s.id,
      s.title,
      s.description,
      s.owner,
      s.status,
      s.created_at,
      s.updated_at,
      COUNT(DISTINCT q.id) AS rounds,
      COUNT(DISTINCT r.id) AS total_count,
      COUNT(DISTINCT CASE WHEN r.status = 'pending' THEN r.id END) AS pending_count,
      COUNT(DISTINCT CASE WHEN r.status = 'approved' THEN r.id END) AS approved_count,
      COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) AS rejected_count
    FROM research_sessions s
    LEFT JOIN research_queries q ON q.session_id = s.id
    LEFT JOIN research_results r ON r.session_id = s.id
    ${where}
    GROUP BY s.id
  `
}

export class ResearchSessionStore {
  private readonly db: BetterSqlite3.Database

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new BetterSqlite3(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  close() {
    this.db.close()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'completed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_queries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        query TEXT NOT NULL,
        search_query TEXT NOT NULL,
        intent TEXT NOT NULL,
        selected_engines_json TEXT NOT NULL DEFAULT '[]',
        succeeded_engines_json TEXT NOT NULL DEFAULT '[]',
        failed_engines_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, round)
      );

      CREATE TABLE IF NOT EXISTS research_results (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        normalized_url TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'websearch',
        engine TEXT NOT NULL DEFAULT '',
        engine_id TEXT NOT NULL DEFAULT '',
        matched_by_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        score REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, normalized_url)
      );

      CREATE TABLE IF NOT EXISTS research_result_origins (
        result_id TEXT NOT NULL REFERENCES research_results(id) ON DELETE CASCADE,
        query_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL,
        source_score REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(result_id, query_id)
      );

      CREATE TABLE IF NOT EXISTS research_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        result_id TEXT NOT NULL REFERENCES research_results(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
        requested_url TEXT NOT NULL,
        final_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        source_domain TEXT NOT NULL DEFAULT '',
        char_count INTEGER NOT NULL DEFAULT 0,
        extracted_at INTEGER NOT NULL,
        error TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS research_round_assessments (
        query_id TEXT PRIMARY KEY REFERENCES research_queries(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        quality_json TEXT NOT NULL,
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        assessed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_claims (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        predicate TEXT NOT NULL DEFAULT '',
        object_value TEXT NOT NULL DEFAULT '',
        time_constraint TEXT NOT NULL DEFAULT '',
        risk_level TEXT NOT NULL DEFAULT 'medium'
          CHECK (risk_level IN ('low', 'medium', 'high')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'verifying', 'reviewed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        claim_id TEXT NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
        result_id TEXT NOT NULL REFERENCES research_results(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL REFERENCES research_snapshots(id) ON DELETE RESTRICT,
        result_url TEXT NOT NULL,
        quote TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        extracted_at INTEGER NOT NULL,
        source_cluster_id TEXT NOT NULL,
        stance TEXT NOT NULL CHECK (stance IN ('support', 'refute', 'insufficient')),
        confidence REAL,
        reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(claim_id, snapshot_id, char_start, char_end, stance)
      );

      CREATE TABLE IF NOT EXISTS research_claim_reviews (
        claim_id TEXT PRIMARY KEY REFERENCES research_claims(id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'needs_review', 'rejected')),
        auto_pass INTEGER NOT NULL DEFAULT 0,
        checks_json TEXT NOT NULL,
        conflict_json TEXT NOT NULL DEFAULT '',
        matched_rule TEXT NOT NULL,
        reviewer TEXT NOT NULL DEFAULT 'agent',
        reviewed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_writebacks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        wiki_path TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        claim_ids_json TEXT NOT NULL DEFAULT '[]',
        result_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS research_queries_session_idx
        ON research_queries(session_id, round);
      CREATE INDEX IF NOT EXISTS research_results_session_status_idx
        ON research_results(session_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS research_origins_query_idx
        ON research_result_origins(query_id, rank);
      CREATE INDEX IF NOT EXISTS research_snapshots_result_idx
        ON research_snapshots(result_id, extracted_at DESC);
      CREATE INDEX IF NOT EXISTS research_assessments_session_idx
        ON research_round_assessments(session_id, round DESC);
      CREATE INDEX IF NOT EXISTS research_claims_session_idx
        ON research_claims(session_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS research_evidence_claim_idx
        ON research_evidence(claim_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS research_writebacks_session_idx
        ON research_writebacks(session_id, created_at DESC);
    `)
  }

  createSession(input: { title: string; description?: string; owner?: string }) {
    const title = input.title.trim()
    if (!title) throw new HttpError(400, '研究会话标题不能为空。')

    const now = Date.now()
    const id = createId('research')
    this.db.prepare(`
      INSERT INTO research_sessions (
        id, title, description, owner, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, title, input.description?.trim() ?? '', input.owner?.trim() ?? '', now, now)
    return this.getSession(id)
  }

  getSession(sessionId: string) {
    const row = this.db.prepare(`${sessionSelectSql('WHERE s.id = ?')}`).get(sessionId) as
      | SessionRow
      | undefined
    if (!row) throw new HttpError(404, '研究会话不存在。')
    return sessionFromRow(row)
  }

  listSessions(limit = 20) {
    const rows = this.db.prepare(`
      ${sessionSelectSql()}
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(normalizeLimit(limit)) as SessionRow[]
    return rows.map(sessionFromRow)
  }

  listRounds(
    sessionId: string,
    input: { limit?: number; offset?: number } = {},
  ): ResearchRound[] {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT
        q.id,
        q.session_id,
        q.round,
        q.query,
        q.search_query,
        q.intent,
        q.selected_engines_json,
        q.succeeded_engines_json,
        q.failed_engines_json,
        COUNT(o.result_id) AS result_count,
        q.created_at
      FROM research_queries q
      LEFT JOIN research_result_origins o ON o.query_id = q.id
      WHERE q.session_id = ?
      GROUP BY q.id
      ORDER BY q.round DESC
      LIMIT ? OFFSET ?
    `).all(
      sessionId,
      normalizeLimit(input.limit),
      normalizeOffset(input.offset),
    ) as QueryRow[]

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      round: row.round,
      query: row.query,
      searchQuery: row.search_query,
      intent: row.intent,
      selectedEngines: parseJson<SearchResponse['selectedEngines']>(
        row.selected_engines_json,
        [],
      ),
      succeededEngines: parseStringArray(row.succeeded_engines_json),
      failedEngines: parseJson<SearchResponse['failedEngines']>(
        row.failed_engines_json,
        [],
      ),
      resultCount: row.result_count,
      createdAt: row.created_at,
    }))
  }

  appendSearchRound(sessionId: string, response: SearchResponse): ResearchSearchRound {
    const transaction = this.db.transaction(() => {
      const session = this.getSession(sessionId)
      if (session.status !== 'active') {
        throw new HttpError(409, '研究会话已经完成，不能继续追加搜索轮次。')
      }

      const now = Date.now()
      const round = session.rounds + 1
      const queryId = createId('query')
      this.db.prepare(`
        INSERT INTO research_queries (
          id, session_id, round, query, search_query, intent,
          selected_engines_json, succeeded_engines_json, failed_engines_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        queryId,
        sessionId,
        round,
        response.query,
        response.searchQuery,
        response.intent,
        JSON.stringify(response.selectedEngines),
        JSON.stringify(response.succeededEngines),
        JSON.stringify(response.failedEngines),
        now,
      )

      const existingRows = this.db.prepare(`
        SELECT id, normalized_url, title, snippet, matched_by_json, score
        FROM research_results
        WHERE session_id = ?
      `).all(sessionId) as Array<{
        id: string
        normalized_url: string
        title: string
        snippet: string
        matched_by_json: string
        score: number
      }>
      const existingByUrl = new Map(existingRows.map((row) => [row.normalized_url, row]))

      const insertedIds: string[] = []
      let added = 0
      let reused = 0

      for (let index = 0; index < response.results.length; index += 1) {
        const item = response.results[index]
        const normalizedUrl = normalizeResearchUrl(item.url)
        if (!normalizedUrl) continue

        const existing = existingByUrl.get(normalizedUrl)
        let resultId: string
        if (existing) {
          resultId = existing.id
          reused += 1
          const matchedBy = [...new Set([
            ...parseStringArray(existing.matched_by_json),
            ...item.matchedBy,
          ])]
          this.db.prepare(`
            UPDATE research_results
            SET
              title = ?,
              snippet = ?,
              engine = ?,
              engine_id = ?,
              matched_by_json = ?,
              score = ?,
              updated_at = ?
            WHERE id = ?
          `).run(
            item.title.length >= existing.title.length ? item.title : existing.title,
            item.snippet.length >= existing.snippet.length ? item.snippet : existing.snippet,
            item.engine,
            item.engineId,
            JSON.stringify(matchedBy),
            Math.max(existing.score, item.score),
            now,
            resultId,
          )
        } else {
          resultId = createId('result')
          added += 1
          this.db.prepare(`
            INSERT INTO research_results (
              id, session_id, normalized_url, url, title, snippet, content, source,
              engine, engine_id, matched_by_json, status, score, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, '', 'websearch', ?, ?, ?, 'pending', ?, ?, ?)
          `).run(
            resultId,
            sessionId,
            normalizedUrl,
            item.url,
            item.title,
            item.snippet,
            item.engine,
            item.engineId,
            JSON.stringify(item.matchedBy),
            item.score,
            now,
            now,
          )
          existingByUrl.set(normalizedUrl, {
            id: resultId,
            normalized_url: normalizedUrl,
            title: item.title,
            snippet: item.snippet,
            matched_by_json: JSON.stringify(item.matchedBy),
            score: item.score,
          })
        }

        this.db.prepare(`
          INSERT INTO research_result_origins (result_id, query_id, rank, source_score)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(result_id, query_id) DO UPDATE SET
            rank = MIN(research_result_origins.rank, excluded.rank),
            source_score = MAX(research_result_origins.source_score, excluded.source_score)
        `).run(resultId, queryId, index + 1, item.score)
        insertedIds.push(resultId)
      }

      this.db.prepare('UPDATE research_sessions SET updated_at = ? WHERE id = ?')
        .run(now, sessionId)

      return {
        queryId,
        round,
        added,
        reused,
        resultIds: [...new Set(insertedIds)],
      }
    })

    const outcome = transaction()
    return {
      session: this.getSession(sessionId),
      queryId: outcome.queryId,
      round: outcome.round,
      query: response.query,
      added: outcome.added,
      reused: outcome.reused,
      results: this.getResultsByIds(sessionId, outcome.resultIds),
      search: {
        selectedEngines: response.selectedEngines,
        succeededEngines: response.succeededEngines,
        failedEngines: response.failedEngines,
      },
    }
  }

  listResults(
    sessionId: string,
    input: { status?: ResearchResultStatus; limit?: number; offset?: number } = {},
  ) {
    this.getSession(sessionId)
    const params: Array<string | number> = [sessionId]
    let statusSql = ''
    if (input.status) {
      statusSql = 'AND r.status = ?'
      params.push(input.status)
    }
    params.push(normalizeLimit(input.limit), normalizeOffset(input.offset))

    const rows = this.db.prepare(`
      SELECT r.*
      FROM research_results r
      LEFT JOIN research_result_origins o ON o.result_id = r.id
      WHERE r.session_id = ?
      ${statusSql}
      GROUP BY r.id
      ORDER BY SUM(1.0 / (${RRF_K} + o.rank)) DESC, r.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params) as ResultRow[]
    return this.hydrateResults(rows)
  }

  listAllResults(sessionId: string, status?: ResearchResultStatus) {
    this.getSession(sessionId)
    const rows = status
      ? this.db.prepare(`
          SELECT r.*
          FROM research_results r
          LEFT JOIN research_result_origins o ON o.result_id = r.id
          WHERE r.session_id = ? AND r.status = ?
          GROUP BY r.id
          ORDER BY SUM(1.0 / (${RRF_K} + o.rank)) DESC, r.updated_at DESC
        `).all(sessionId, status) as ResultRow[]
      : this.db.prepare(`
          SELECT r.*
          FROM research_results r
          LEFT JOIN research_result_origins o ON o.result_id = r.id
          WHERE r.session_id = ?
          GROUP BY r.id
          ORDER BY SUM(1.0 / (${RRF_K} + o.rank)) DESC, r.updated_at DESC
        `).all(sessionId) as ResultRow[]
    return this.hydrateResults(rows)
  }

  reviewResults(sessionId: string, decisions: ResearchResultDecision[]) {
    if (decisions.length === 0) throw new HttpError(400, '至少需要一个审核决定。')
    if (decisions.length > MAX_RESULT_LIMIT) {
      throw new HttpError(400, `单次最多审核 ${MAX_RESULT_LIMIT} 条结果。`)
    }

    const normalized = new Map<string, ResearchResultStatus>()
    for (const decision of decisions) {
      if (!decision.resultId.trim()) throw new HttpError(400, 'resultId 不能为空。')
      normalized.set(decision.resultId.trim(), decision.status)
    }

    const transaction = this.db.transaction(() => {
      this.assertActiveSession(sessionId)
      const now = Date.now()
      const updatedIds: string[] = []
      for (const [resultId, status] of normalized) {
        const result = this.db.prepare(`
          UPDATE research_results
          SET status = ?, updated_at = ?
          WHERE id = ? AND session_id = ?
        `).run(status, now, resultId, sessionId)
        if (result.changes === 0) {
          throw new HttpError(404, `研究结果不存在: ${resultId}`)
        }
        updatedIds.push(resultId)
      }
      this.db.prepare('UPDATE research_sessions SET updated_at = ? WHERE id = ?')
        .run(now, sessionId)
      return updatedIds
    })

    const updatedIds = transaction()
    return {
      session: this.getSession(sessionId),
      updated: updatedIds.length,
      results: this.getResultsByIds(sessionId, updatedIds),
    }
  }

  getResult(sessionId: string, resultId: string) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT *
      FROM research_results
      WHERE session_id = ? AND id = ?
    `).all(sessionId, resultId) as ResultRow[]
    const result = this.hydrateResults(rows)[0]
    if (!result) throw new HttpError(404, '研究结果不存在。')
    return result
  }

  recordSnapshot(
    sessionId: string,
    resultId: string,
    input:
      | {
          status: 'ready'
          requestedUrl: string
          finalUrl: string
          title: string
          content: string
          extractedAt?: number
        }
      | {
          status: 'failed'
          requestedUrl: string
          finalUrl?: string
          error: string
          extractedAt?: number
        },
  ) {
    const transaction = this.db.transaction(() => {
      this.assertActiveSession(sessionId)
      const result = this.getResult(sessionId, resultId)
      const extractedAt = input.extractedAt ?? Date.now()
      const id = createId('snapshot')
      const content = input.status === 'ready' ? input.content.trim() : ''
      if (input.status === 'ready' && !content) {
        throw new HttpError(422, '网页正文为空，不能创建可用快照。')
      }
      const finalUrl = input.finalUrl?.trim() || result.url
      let sourceDomain = ''
      try {
        sourceDomain = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, '')
      } catch {
        // The URL was already validated by the web reader. Keep the domain empty on legacy data.
      }
      const title = input.status === 'ready' ? input.title.trim() || result.title : result.title
      const contentHash = content ? hashResearchText(content) : ''
      const error = input.status === 'failed' ? input.error.trim() || '网页正文提取失败。' : ''

      this.db.prepare(`
        INSERT INTO research_snapshots (
          id, session_id, result_id, status, requested_url, final_url, title,
          content, content_hash, source_domain, char_count, extracted_at, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        resultId,
        input.status,
        input.requestedUrl.trim() || result.url,
        finalUrl,
        title,
        content,
        contentHash,
        sourceDomain,
        content.length,
        extractedAt,
        error,
      )

      if (input.status === 'ready') {
        this.db.prepare(`
          UPDATE research_results
          SET title = ?, content = ?, updated_at = ?
          WHERE id = ? AND session_id = ?
        `).run(title, content, extractedAt, resultId, sessionId)
      }
      this.db.prepare('UPDATE research_sessions SET updated_at = ? WHERE id = ?')
        .run(extractedAt, sessionId)
      return id
    })

    const snapshotId = transaction()
    return this.getSnapshot(sessionId, snapshotId)
  }

  getSnapshot(sessionId: string, snapshotId: string) {
    const row = this.db.prepare(`
      SELECT *
      FROM research_snapshots
      WHERE session_id = ? AND id = ?
    `).get(sessionId, snapshotId) as SnapshotRow | undefined
    if (!row) throw new HttpError(404, '研究来源快照不存在。')
    return snapshotFromRow(row)
  }

  listSnapshots(
    sessionId: string,
    input: { resultId?: string; latestOnly?: boolean; limit?: number } = {},
  ) {
    this.getSession(sessionId)
    const params: Array<string | number> = [sessionId]
    const resultSql = input.resultId ? 'AND s.result_id = ?' : ''
    if (input.resultId) params.push(input.resultId)
    const latestSql = input.latestOnly
      ? `AND s.id = (
          SELECT latest.id
          FROM research_snapshots latest
          WHERE latest.result_id = s.result_id
          ORDER BY latest.extracted_at DESC, latest.rowid DESC
          LIMIT 1
        )`
      : ''
    params.push(normalizeLimit(input.limit))
    const rows = this.db.prepare(`
      SELECT s.*
      FROM research_snapshots s
      WHERE s.session_id = ?
        ${resultSql}
        ${latestSql}
      ORDER BY s.extracted_at DESC, s.rowid DESC
      LIMIT ?
    `).all(...params) as SnapshotRow[]
    return rows.map(snapshotFromRow)
  }

  saveRoundAssessment(input: {
    sessionId: string
    queryId: string
    quality: ResearchQualityAssessment
    suggestions: ResearchQuerySuggestion[]
  }) {
    this.assertActiveSession(input.sessionId)
    const query = this.db.prepare(`
      SELECT id, session_id, round
      FROM research_queries
      WHERE id = ? AND session_id = ?
    `).get(input.queryId, input.sessionId) as
      | { id: string; session_id: string; round: number }
      | undefined
    if (!query) throw new HttpError(404, '研究搜索轮次不存在。')
    const assessedAt = Date.now()
    this.db.prepare(`
      INSERT INTO research_round_assessments (
        query_id, session_id, round, quality_json, suggestions_json, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(query_id) DO UPDATE SET
        quality_json = excluded.quality_json,
        suggestions_json = excluded.suggestions_json,
        assessed_at = excluded.assessed_at
    `).run(
      input.queryId,
      input.sessionId,
      query.round,
      JSON.stringify(input.quality),
      JSON.stringify(input.suggestions),
      assessedAt,
    )
    return this.getRoundAssessment(input.sessionId, input.queryId)
  }

  getRoundAssessment(sessionId: string, queryId: string) {
    const row = this.db.prepare(`
      SELECT *
      FROM research_round_assessments
      WHERE session_id = ? AND query_id = ?
    `).get(sessionId, queryId) as AssessmentRow | undefined
    if (!row) throw new HttpError(404, '研究轮次尚未完成质量评估。')
    return assessmentFromRow(row)
  }

  listRoundAssessments(sessionId: string, limit = 20) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT *
      FROM research_round_assessments
      WHERE session_id = ?
      ORDER BY round DESC
      LIMIT ?
    `).all(sessionId, normalizeLimit(limit)) as AssessmentRow[]
    return rows.map(assessmentFromRow)
  }

  createClaims(
    sessionId: string,
    inputs: Array<{
      text: string
      subject?: string
      predicate?: string
      object?: string
      timeConstraint?: string
      riskLevel?: ResearchClaimRisk
    }>,
  ) {
    if (inputs.length === 0) throw new HttpError(400, '至少需要一个待核验主张。')
    if (inputs.length > MAX_RESULT_LIMIT) {
      throw new HttpError(400, `单次最多创建 ${MAX_RESULT_LIMIT} 个主张。`)
    }
    const transaction = this.db.transaction(() => {
      this.assertActiveSession(sessionId)
      const createdIds: string[] = []
      for (const input of inputs) {
        const claimText = input.text.trim()
        if (!claimText) throw new HttpError(400, '主张文本不能为空。')
        const now = Date.now()
        const id = createId('claim')
        const riskLevel =
          input.riskLevel === 'low' || input.riskLevel === 'high'
            ? input.riskLevel
            : 'medium'
        this.db.prepare(`
          INSERT INTO research_claims (
            id, session_id, text, subject, predicate, object_value,
            time_constraint, risk_level, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(
          id,
          sessionId,
          claimText,
          input.subject?.trim() ?? '',
          input.predicate?.trim() ?? '',
          input.object?.trim() ?? '',
          input.timeConstraint?.trim() ?? '',
          riskLevel,
          now,
          now,
        )
        createdIds.push(id)
      }
      return createdIds
    })
    const ids = transaction()
    return this.listClaims(sessionId).filter((claim) => ids.includes(claim.id))
  }

  getClaim(sessionId: string, claimId: string) {
    const row = this.db.prepare(`
      SELECT *
      FROM research_claims
      WHERE session_id = ? AND id = ?
    `).get(sessionId, claimId) as ClaimRow | undefined
    if (!row) throw new HttpError(404, '研究主张不存在。')
    return claimFromRow(row)
  }

  listClaims(sessionId: string, limit = 100) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT *
      FROM research_claims
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, normalizeLimit(limit)) as ClaimRow[]
    return rows.map(claimFromRow)
  }

  listAllClaims(sessionId: string) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT *
      FROM research_claims
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as ClaimRow[]
    return rows.map(claimFromRow)
  }

  addEvidence(input: {
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
  }) {
    const transaction = this.db.transaction(() => {
      this.assertActiveSession(input.sessionId)
      this.getClaim(input.sessionId, input.claimId)
      const result = this.getResult(input.sessionId, input.resultId)
      if (result.status !== 'approved') {
        throw new HttpError(409, '证据只能引用已批准的研究结果。')
      }
      const snapshotRow = input.snapshotId
        ? this.db.prepare(`
            SELECT *
            FROM research_snapshots
            WHERE session_id = ? AND result_id = ? AND id = ?
          `).get(input.sessionId, input.resultId, input.snapshotId)
        : this.db.prepare(`
            SELECT *
            FROM research_snapshots
            WHERE session_id = ? AND result_id = ? AND status = 'ready'
            ORDER BY extracted_at DESC, rowid DESC
            LIMIT 1
          `).get(input.sessionId, input.resultId)
      const snapshot = snapshotRow as SnapshotRow | undefined
      if (!snapshot || snapshot.status !== 'ready') {
        throw new HttpError(409, '研究结果尚无可用正文快照。')
      }

      const charStart = Math.floor(input.charStart)
      const charEnd = Math.floor(input.charEnd)
      const quote = input.quote.trim()
      if (
        !Number.isFinite(charStart)
        || !Number.isFinite(charEnd)
        || charStart < 0
        || charEnd <= charStart
        || charEnd > snapshot.content.length
      ) {
        throw new HttpError(400, '证据字符偏移超出正文快照范围。')
      }
      const anchoredQuote = snapshot.content.slice(charStart, charEnd)
      if (!quote || anchoredQuote !== quote) {
        throw new HttpError(409, '证据原文与正文快照偏移不匹配。')
      }
      const contentHash = hashResearchText(anchoredQuote)
      const existing = this.db.prepare(`
        SELECT *
        FROM research_evidence
        WHERE claim_id = ? AND snapshot_id = ? AND char_start = ? AND char_end = ? AND stance = ?
      `).get(input.claimId, snapshot.id, charStart, charEnd, input.stance) as
        | EvidenceRow
        | undefined
      if (existing) return existing.id

      const now = Date.now()
      const id = createId('evidence')
      const confidence =
        typeof input.confidence === 'number' && Number.isFinite(input.confidence)
          ? Math.max(0, Math.min(1, input.confidence))
          : null
      this.db.prepare(`
        INSERT INTO research_evidence (
          id, session_id, claim_id, result_id, snapshot_id, result_url, quote,
          char_start, char_end, content_hash, snapshot_hash, extracted_at,
          source_cluster_id, stance, confidence, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.sessionId,
        input.claimId,
        input.resultId,
        snapshot.id,
        result.url,
        anchoredQuote,
        charStart,
        charEnd,
        contentHash,
        snapshot.content_hash,
        snapshot.extracted_at,
        researchSourceClusterId(snapshot.final_url || result.url),
        input.stance,
        confidence,
        input.reason?.trim() ?? '',
        now,
      )
      this.db.prepare(`
        UPDATE research_claims
        SET status = 'verifying', updated_at = ?
        WHERE id = ? AND session_id = ?
      `).run(now, input.claimId, input.sessionId)
      this.db.prepare('DELETE FROM research_claim_reviews WHERE claim_id = ?')
        .run(input.claimId)
      return id
    })

    const evidenceId = transaction()
    return this.listEvidence(input.sessionId, { claimId: input.claimId })
      .find((evidence) => evidence.id === evidenceId)!
  }

  listEvidence(
    sessionId: string,
    input: { claimId?: string; limit?: number } = {},
  ) {
    this.getSession(sessionId)
    const params: Array<string | number> = [sessionId]
    const claimSql = input.claimId ? 'AND claim_id = ?' : ''
    if (input.claimId) params.push(input.claimId)
    params.push(normalizeLimit(input.limit))
    const rows = this.db.prepare(`
      SELECT *
      FROM research_evidence
      WHERE session_id = ?
        ${claimSql}
      ORDER BY created_at ASC
      LIMIT ?
    `).all(...params) as EvidenceRow[]
    return rows.map(evidenceFromRow)
  }

  listAllEvidence(sessionId: string, claimId?: string) {
    this.getSession(sessionId)
    const rows = claimId
      ? this.db.prepare(`
          SELECT *
          FROM research_evidence
          WHERE session_id = ? AND claim_id = ?
          ORDER BY created_at ASC
        `).all(sessionId, claimId) as EvidenceRow[]
      : this.db.prepare(`
          SELECT *
          FROM research_evidence
          WHERE session_id = ?
          ORDER BY created_at ASC
        `).all(sessionId) as EvidenceRow[]
    return rows.map(evidenceFromRow)
  }

  reviewClaim(sessionId: string, claimId: string, reviewer = 'agent') {
    const transaction = this.db.transaction(() => {
      this.assertActiveSession(sessionId)
      const claim = this.getClaim(sessionId, claimId)
      const evidences = this.listAllEvidence(sessionId, claimId)
      const review = evaluateResearchClaim(
        claim.riskLevel,
        evidences.map((evidence) => ({
          id: evidence.id,
          stance: evidence.stance,
          quote: evidence.quote,
          sourceClusterId: evidence.sourceClusterId,
        })),
      )
      const reviewedAt = Date.now()
      this.db.prepare(`
        INSERT INTO research_claim_reviews (
          claim_id, decision, auto_pass, checks_json, conflict_json,
          matched_rule, reviewer, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(claim_id) DO UPDATE SET
          decision = excluded.decision,
          auto_pass = excluded.auto_pass,
          checks_json = excluded.checks_json,
          conflict_json = excluded.conflict_json,
          matched_rule = excluded.matched_rule,
          reviewer = excluded.reviewer,
          reviewed_at = excluded.reviewed_at
      `).run(
        claimId,
        review.decision,
        review.autoPass ? 1 : 0,
        JSON.stringify(review.checks),
        review.conflict ? JSON.stringify(review.conflict) : '',
        review.matchedRule,
        reviewer.trim() || 'agent',
        reviewedAt,
      )
      this.db.prepare(`
        UPDATE research_claims
        SET status = 'reviewed', updated_at = ?
        WHERE id = ? AND session_id = ?
      `).run(reviewedAt, claimId, sessionId)
    })
    transaction()
    return this.getClaimReview(sessionId, claimId)
  }

  getClaimReview(sessionId: string, claimId: string) {
    this.getClaim(sessionId, claimId)
    const row = this.db.prepare(`
      SELECT rv.*
      FROM research_claim_reviews rv
      INNER JOIN research_claims c ON c.id = rv.claim_id
      WHERE c.session_id = ? AND rv.claim_id = ?
    `).get(sessionId, claimId) as ReviewRow | undefined
    if (!row) throw new HttpError(404, '研究主张尚未完成审核。')
    return reviewFromRow(row)
  }

  listClaimReviews(sessionId: string) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT rv.*
      FROM research_claim_reviews rv
      INNER JOIN research_claims c ON c.id = rv.claim_id
      WHERE c.session_id = ?
      ORDER BY rv.reviewed_at ASC
    `).all(sessionId) as ReviewRow[]
    return rows.map(reviewFromRow)
  }

  recordWriteback(input: {
    sessionId: string
    wikiPath: string
    title: string
    summary: string
    claimIds: string[]
    resultIds: string[]
  }) {
    this.getSession(input.sessionId)
    const id = createId('writeback')
    const createdAt = Date.now()
    this.db.prepare(`
      INSERT INTO research_writebacks (
        id, session_id, wiki_path, title, summary,
        claim_ids_json, result_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sessionId,
      input.wikiPath,
      input.title,
      input.summary,
      JSON.stringify([...new Set(input.claimIds)]),
      JSON.stringify([...new Set(input.resultIds)]),
      createdAt,
    )
    return this.listWritebacks(input.sessionId).find((writeback) => writeback.id === id)!
  }

  listWritebacks(sessionId: string, limit = 20) {
    this.getSession(sessionId)
    const rows = this.db.prepare(`
      SELECT *
      FROM research_writebacks
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, normalizeLimit(limit)) as WritebackRow[]
    return rows.map(writebackFromRow)
  }

  completeSession(sessionId: string) {
    const result = this.db.prepare(`
      UPDATE research_sessions
      SET status = 'completed', updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(Date.now(), sessionId)
    if (result.changes === 0) this.getSession(sessionId)
    return this.getSession(sessionId)
  }

  assertActiveSession(sessionId: string) {
    const session = this.getSession(sessionId)
    if (session.status !== 'active') {
      throw new HttpError(409, '研究会话已经完成，不能继续修改。')
    }
    return session
  }

  private getResultsByIds(sessionId: string, ids: string[]) {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT *
      FROM research_results
      WHERE session_id = ? AND id IN (${placeholders})
    `).all(sessionId, ...ids) as ResultRow[]
    const order = new Map(ids.map((id, index) => [id, index]))
    return this.hydrateResults(rows)
      .sort((left, right) => {
        const scoreDifference = right.rrfScore - left.rrfScore
        if (scoreDifference !== 0) return scoreDifference
        return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
      })
  }

  private hydrateResults(rows: ResultRow[]): ResearchResult[] {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    const origins = this.db.prepare(`
      SELECT
        o.result_id,
        o.query_id,
        q.query,
        q.round,
        o.rank,
        o.source_score
      FROM research_result_origins o
      INNER JOIN research_queries q ON q.id = o.query_id
      WHERE o.result_id IN (${placeholders})
      ORDER BY q.round ASC, o.rank ASC
    `).all(...ids) as OriginRow[]
    const originsByResult = new Map<string, ResearchResultOrigin[]>()
    for (const origin of origins) {
      const group = originsByResult.get(origin.result_id) ?? []
      group.push({
        queryId: origin.query_id,
        query: origin.query,
        round: origin.round,
        rank: origin.rank,
        sourceScore: origin.source_score,
      })
      originsByResult.set(origin.result_id, group)
    }

    return rows.map((row) => {
      const resultOrigins = originsByResult.get(row.id) ?? []
      return {
        id: row.id,
        sessionId: row.session_id,
        title: row.title,
        url: row.url,
        normalizedUrl: row.normalized_url,
        snippet: row.snippet,
        content: row.content,
        source: row.source,
        engine: row.engine,
        engineId: row.engine_id,
        matchedBy: parseStringArray(row.matched_by_json),
        status: row.status,
        score: row.score,
        rrfScore: reciprocalRankScore(resultOrigins.map((origin) => origin.rank)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        origins: resultOrigins,
      }
    }).sort((left, right) => right.rrfScore - left.rrfScore)
  }
}

let sharedStore: ResearchSessionStore | undefined

export function getResearchSessionStore() {
  if (!sharedStore) {
    sharedStore = new ResearchSessionStore(
      path.join(config.dataDir, 'research', 'research-sessions.sqlite'),
    )
  }
  return sharedStore
}

export function closeResearchSessionStore() {
  sharedStore?.close()
  sharedStore = undefined
}

export async function runResearchSearch(sessionId: string, input: SearchRequest) {
  const store = getResearchSessionStore()
  const session = store.getSession(sessionId)
  if (session.status !== 'active') {
    throw new HttpError(409, '研究会话已经完成，不能继续追加搜索轮次。')
  }
  const response = await aggregateSearch(input)
  return store.appendSearchRound(sessionId, response)
}
