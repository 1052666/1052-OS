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
        'https://Example.com/docs/?utm_source=test&b=2&a=1#section',
      ),
    ).toBe('https://example.com/docs?a=1&b=2')
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
      ]),
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

    store.close()
    store = new ResearchSessionStore(path.join(tempDir, 'research.sqlite'))
    expect(store.getSession(session.id)).toMatchObject({
      id: session.id,
      rounds: 1,
      status: 'completed',
    })
  })
})
