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

      CREATE INDEX IF NOT EXISTS research_queries_session_idx
        ON research_queries(session_id, round);
      CREATE INDEX IF NOT EXISTS research_results_session_status_idx
        ON research_results(session_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS research_origins_query_idx
        ON research_result_origins(query_id, rank);
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
      this.getSession(sessionId)
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

  completeSession(sessionId: string) {
    const result = this.db.prepare(`
      UPDATE research_sessions
      SET status = 'completed', updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(Date.now(), sessionId)
    if (result.changes === 0) this.getSession(sessionId)
    return this.getSession(sessionId)
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
