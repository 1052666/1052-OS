import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchSessionStore } from './research-session.service.js'
import {
  assessResearchRound,
  createResearchClaims,
  extractResearchResults,
  getResearchEvidenceCandidates,
  writeResearchToWiki,
} from './research-workflow.service.js'
import type { SearchResponse } from './websearch.service.js'

let tempDir = ''
let store: ResearchSessionStore

function response(): SearchResponse {
  return {
    query: 'transaction research safety',
    searchQuery: 'transaction research safety',
    intent: 'general',
    usedDefaultStableSet: true,
    selectedEngines: [{ id: 'bing-int', name: 'Bing INT', region: 'global' }],
    succeededEngines: ['Bing INT'],
    failedEngines: [],
    results: [
      ['Source one', 'https://one.example/report'],
      ['Source two', 'https://two.example/report'],
      ['Source three', 'https://three.example/report'],
    ].map(([title, url], index) => ({
      title: title!,
      url: url!,
      snippet: `${title} summary`,
      engine: 'Bing INT',
      engineId: 'bing-int',
      matchedBy: ['Bing INT'],
      score: 200 - index,
    })),
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1052-research-workflow-'))
  store = new ResearchSessionStore(path.join(tempDir, 'research.sqlite'))
})

afterEach(() => {
  store.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('research workflow', () => {
  it('runs extraction, quality, claim review, and Wiki/PKM writeback end to end', async () => {
    const session = store.createSession({ title: 'Research closure' })
    const round = store.appendSearchRound(session.id, response())
    const sentence = '事务存储能够避免并发研究状态互相覆盖。'
    const filler = '独立来源提供了详细的架构、边界、测试方法和长期运行证据。'.repeat(35)
    const readPage = vi.fn(async (url: string) => ({
      url,
      finalUrl: url,
      title: `Snapshot ${url}`,
      text: `${sentence}${filler}`,
      excerpt: sentence,
    }))

    const extraction = await extractResearchResults({
      sessionId: session.id,
      resultIds: round.results.map((result) => result.id),
    }, { store, readPage })
    expect(extraction).toMatchObject({ extracted: 3, failed: 0 })
    expect(new Set(extraction.snapshots.map((snapshot) => snapshot.contentHash)).size).toBe(1)

    const assessment = assessResearchRound(
      { sessionId: session.id, queryId: round.queryId },
      { store },
    )
    expect(assessment.quality.verdict).toBe('good')

    store.reviewResults(
      session.id,
      round.results.map((result) => ({ resultId: result.id, status: 'approved' })),
    )
    const [claim] = createResearchClaims({
      sessionId: session.id,
      claims: [{ text: '事务存储能够避免并发研究状态互相覆盖。', riskLevel: 'high' }],
    }, { store })
    expect(claim).toBeDefined()
    const candidates = getResearchEvidenceCandidates({
      sessionId: session.id,
      claimId: claim!.id,
    }, { store }).candidates
    expect(candidates).toHaveLength(3)

    for (const candidate of candidates.slice(0, 2)) {
      store.addEvidence({
        sessionId: session.id,
        claimId: claim!.id,
        resultId: candidate.resultId,
        quote: candidate.quote,
        charStart: candidate.charStart,
        charEnd: candidate.charEnd,
        stance: 'support',
      })
    }
    expect(store.reviewClaim(session.id, claim!.id).decision).toBe('approved')

    const writeWiki = vi.fn(async () => ({ path: '综合分析/Research closure.md' }))
    const reindex = vi.fn(async () => ({ totalEntries: 1 }))
    const writeback = await writeResearchToWiki({
      sessionId: session.id,
      summary: '两个独立来源支持事务存储结论。',
      completeSession: true,
    }, { store, writeWiki, reindex })

    expect(writeback.session.status).toBe('completed')
    expect(writeback.writeback.claimIds).toEqual([claim!.id])
    expect(writeWiki).toHaveBeenCalledWith(expect.objectContaining({
      summary: '两个独立来源支持事务存储结论。',
      sources: expect.arrayContaining([
        'https://one.example/report',
        'https://two.example/report',
      ]),
    }))
    expect(reindex).toHaveBeenCalledOnce()
  })

  it('refuses to write unreviewed claims as verified knowledge', async () => {
    const session = store.createSession({ title: 'Unsafe writeback' })
    store.createClaims(session.id, [{ text: '尚未验证的结论。', riskLevel: 'high' }])

    await expect(writeResearchToWiki({
      sessionId: session.id,
      summary: '不应该写入。',
    }, {
      store,
      writeWiki: vi.fn(async () => ({ path: 'never.md' })),
      reindex: vi.fn(async () => ({})),
    })).rejects.toThrow('没有通过 Claim Review')
  })
})
