import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchResponse } from './websearch.service.js'
import {
  normalizeResearchUrl,
  reciprocalRankScore,
  ResearchSessionStore,
} from './research-session.service.js'

let tempDir = ''
let store: ResearchSessionStore

function searchResponse(
  query: string,
  results: SearchResponse['results'],
  overrides: Partial<SearchResponse> = {},
): SearchResponse {
  return {
    query,
    searchQuery: query,
    intent: 'general',
    usedDefaultStableSet: true,
    selectedEngines: [{ id: 'bing-int', name: 'Bing INT', region: 'global' }],
    succeededEngines: ['Bing INT'],
    failedEngines: [],
    results,
    ...overrides,
  }
}

function result(
  title: string,
  url: string,
  score: number,
): SearchResponse['results'][number] {
  return {
    title,
    url,
    snippet: `${title} detailed search result`,
    engine: 'Bing INT',
    engineId: 'bing-int',
    matchedBy: ['Bing INT'],
    score,
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1052-research-session-'))
  store = new ResearchSessionStore(path.join(tempDir, 'research.sqlite'))
})

afterEach(() => {
  store.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('research session store', () => {
  it('normalizes tracking URLs and computes reciprocal-rank fusion scores', () => {
    expect(
      normalizeResearchUrl(
        'https://Example.com/docs/?utm_source=test&source=feed&ref=home&from=share&spm=123&fbclid=x&gclid=y&keep=yes&b=2&a=1#section',
      ),
    ).toBe('https://example.com/docs?a=1&b=2&keep=yes')
    expect(reciprocalRankScore([1, 2])).toBeCloseTo(1 / 61 + 1 / 62)
    expect(() => reciprocalRankScore([1], 0)).toThrow('RRF k must be positive')
  })

  it('accumulates rounds, deduplicates URLs, and preserves provenance', () => {
    const session = store.createSession({
      title: 'Runtime comparison',
      description: 'Compare architecture and safety.',
      owner: 'web',
    })

    const first = store.appendSearchRound(
      session.id,
      searchResponse('runtime architecture', [
        result('Runtime design', 'https://example.com/runtime?utm_source=search', 200),
        result('Safety model', 'https://docs.example.org/safety', 150),
        result('Runtime design duplicate', 'https://example.com/runtime#summary', 190),
      ]),
    )
    expect(first).toMatchObject({
      round: 1,
      added: 2,
      reused: 1,
    })

    const second = store.appendSearchRound(
      session.id,
      searchResponse('runtime safety', [
        result('Runtime design expanded', 'https://example.com/runtime#details', 220),
        result('Independent review', 'https://review.example.net/runtime', 120),
      ], {
        selectedEngines: [
          { id: 'bing-int', name: 'Bing INT', region: 'global' },
          { id: 'startpage', name: 'Startpage', region: 'global' },
        ],
        succeededEngines: ['Bing INT'],
        failedEngines: [{ engine: 'Startpage', error: '请求超时' }],
      }),
    )
    expect(second).toMatchObject({
      round: 2,
      added: 1,
      reused: 1,
    })

    const status = store.getSession(session.id)
    expect(status.rounds).toBe(2)
    expect(status.resultCounts).toEqual({
      total: 3,
      pending: 3,
      approved: 0,
      rejected: 0,
    })

    const accumulated = store.listResults(session.id, { limit: 10 })
    const repeated = accumulated.find((item) => item.normalizedUrl === 'https://example.com/runtime')
    expect(repeated).toBeDefined()
    expect(repeated?.origins.map((origin) => origin.round)).toEqual([1, 2])
    expect(repeated?.rrfScore).toBeCloseTo(2 / 61)
    expect(accumulated[0]?.id).toBe(repeated?.id)

    const rounds = store.listRounds(session.id)
    expect(rounds.map((item) => item.round)).toEqual([2, 1])
    expect(rounds[0]).toMatchObject({
      query: 'runtime safety',
      searchQuery: 'runtime safety',
      intent: 'general',
      succeededEngines: ['Bing INT'],
      failedEngines: [{ engine: 'Startpage', error: '请求超时' }],
      resultCount: 2,
    })
    expect(rounds[0]?.selectedEngines.map((engine) => engine.id)).toEqual([
      'bing-int',
      'startpage',
    ])
  })

  it('returns persisted empty and failed search rounds', () => {
    const session = store.createSession({ title: 'Failure visibility' })
    store.appendSearchRound(
      session.id,
      searchResponse('unavailable source', [], {
        selectedEngines: [{ id: 'startpage', name: 'Startpage', region: 'global' }],
        succeededEngines: [],
        failedEngines: [{ engine: 'Startpage', error: '搜索引擎返回了验证页面' }],
      }),
    )

    expect(store.listRounds(session.id)).toEqual([
      expect.objectContaining({
        round: 1,
        query: 'unavailable source',
        resultCount: 0,
        succeededEngines: [],
        failedEngines: [{ engine: 'Startpage', error: '搜索引擎返回了验证页面' }],
      }),
    ])
    expect(store.listResults(session.id)).toEqual([])
  })

  it('persists immutable snapshots and a source-backed claim review', () => {
    const session = store.createSession({ title: 'Evidence workflow' })
    const round = store.appendSearchRound(
      session.id,
      searchResponse('transaction safety', [
        result('Source one', 'https://one.example/report', 200),
        result('Source two', 'https://two.example/report', 180),
      ]),
    )
    const [firstResult, secondResult] = round.results
    expect(firstResult).toBeDefined()
    expect(secondResult).toBeDefined()
    store.reviewResults(session.id, [
      { resultId: firstResult!.id, status: 'approved' },
      { resultId: secondResult!.id, status: 'approved' },
    ])

    const firstContent = '事务存储能够避免并发更新互相覆盖。'
    const secondContent = '独立测试确认事务边界可以保护研究会话。'
    const firstSnapshot = store.recordSnapshot(session.id, firstResult!.id, {
      status: 'ready',
      requestedUrl: firstResult!.url,
      finalUrl: firstResult!.url,
      title: firstResult!.title,
      content: firstContent,
      extractedAt: 100,
    })
    const secondSnapshot = store.recordSnapshot(session.id, secondResult!.id, {
      status: 'ready',
      requestedUrl: secondResult!.url,
      finalUrl: secondResult!.url,
      title: secondResult!.title,
      content: secondContent,
      extractedAt: 200,
    })
    const replacement = store.recordSnapshot(session.id, firstResult!.id, {
      status: 'ready',
      requestedUrl: firstResult!.url,
      finalUrl: firstResult!.url,
      title: firstResult!.title,
      content: '网页后来发生了变化。',
      extractedAt: 300,
    })
    expect(replacement.id).not.toBe(firstSnapshot.id)
    expect(store.getSnapshot(session.id, firstSnapshot.id).content).toBe(firstContent)

    const claims = store.createClaims(session.id, [
      { text: '事务存储可以保护并发研究会话。', riskLevel: 'high' },
      { text: '批量创建的第二个主张。', riskLevel: 'low' },
    ])
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(2)
    const claim = claims[0]!
    const firstEvidence = store.addEvidence({
      sessionId: session.id,
      claimId: claim.id,
      resultId: firstResult!.id,
      snapshotId: firstSnapshot.id,
      quote: firstContent,
      charStart: 0,
      charEnd: firstContent.length,
      stance: 'support',
      confidence: 0.9,
    })
    store.addEvidence({
      sessionId: session.id,
      claimId: claim.id,
      resultId: secondResult!.id,
      snapshotId: secondSnapshot.id,
      quote: secondContent,
      charStart: 0,
      charEnd: secondContent.length,
      stance: 'support',
      confidence: 0.8,
    })

    expect(firstEvidence.snapshotId).toBe(firstSnapshot.id)
    expect(firstEvidence.snapshotHash).toBe(firstSnapshot.contentHash)
    expect(store.reviewClaim(session.id, claim.id)).toMatchObject({
      decision: 'approved',
      autoPass: true,
      matchedRule: 'dualSourceSupport',
    })
  })

  it('reviews results transactionally and can restore them to pending', () => {
    const session = store.createSession({ title: 'Evidence review' })
    store.appendSearchRound(
      session.id,
      searchResponse('evidence', [
        result('Primary source', 'https://example.com/primary', 100),
        result('Low quality source', 'https://example.net/noise', 80),
      ]),
    )
    const pending = store.listResults(session.id, { status: 'pending' })
    const primary = pending.find((item) => item.title === 'Primary source')
    const noise = pending.find((item) => item.title === 'Low quality source')
    expect(primary).toBeDefined()
    expect(noise).toBeDefined()

    store.reviewResults(session.id, [
      { resultId: primary!.id, status: 'approved' },
      { resultId: noise!.id, status: 'rejected' },
    ])
    expect(store.getSession(session.id).resultCounts).toEqual({
      total: 2,
      pending: 0,
      approved: 1,
      rejected: 1,
    })

    store.reviewResults(session.id, [
      { resultId: noise!.id, status: 'pending' },
    ])
    expect(store.getSession(session.id).resultCounts).toEqual({
      total: 2,
      pending: 1,
      approved: 1,
      rejected: 0,
    })
  })

  it('keeps workflow reads complete when a session has more than one API page', () => {
    const session = store.createSession({ title: 'Large research session' })
    store.appendSearchRound(
      session.id,
      searchResponse(
        'large result set',
        Array.from({ length: 101 }, (_, index) =>
          result(`Source ${index}`, `https://example${index}.com/source`, 200 - index)),
      ),
    )

    expect(store.listResults(session.id, { limit: 100 })).toHaveLength(100)
    expect(store.listAllResults(session.id)).toHaveLength(101)
  })

  it('persists sessions and rejects new rounds after completion', () => {
    const session = store.createSession({ title: 'Persistent research' })
    store.appendSearchRound(
      session.id,
      searchResponse('first round', [
        result('One source', 'https://example.com/one', 100),
      ]),
    )
    store.completeSession(session.id)
    expect(store.getSession(session.id).status).toBe('completed')
    expect(() => store.appendSearchRound(
      session.id,
      searchResponse('late round', []),
    )).toThrow('研究会话已经完成')
    const resultId = store.listResults(session.id)[0]!.id
    expect(() => store.reviewResults(session.id, [
      { resultId, status: 'approved' },
    ])).toThrow('不能继续修改')
    expect(() => store.createClaims(session.id, [
      { text: '完成后的会话不应继续新增主张。' },
    ])).toThrow('不能继续修改')

    store.close()
    store = new ResearchSessionStore(path.join(tempDir, 'research.sqlite'))
    expect(store.getSession(session.id)).toMatchObject({
      id: session.id,
      rounds: 1,
      status: 'completed',
    })
  })
})
