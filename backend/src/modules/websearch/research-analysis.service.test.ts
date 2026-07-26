import { describe, expect, it } from 'vitest'
import {
  assessResearchQuality,
  evaluateResearchClaim,
  findResearchEvidenceCandidates,
  hashResearchText,
  researchSourceClusterId,
  suggestResearchQueries,
  type ResearchAnalysisResult,
} from './research-analysis.service.js'

function result(
  id: string,
  url: string,
  content: string,
  status: ResearchAnalysisResult['status'] = 'approved',
): ResearchAnalysisResult {
  return {
    id,
    title: `${id} title`,
    url,
    normalizedUrl: url,
    content,
    status,
  }
}

describe('research analysis', () => {
  it('assesses independent quality indicators and suggests targeted follow-ups', () => {
    const latest = [
      result('one', 'https://one.example/report', 'same shallow text'),
      result('two', 'https://one.example/other', 'same shallow text'),
    ]
    const quality = assessResearchQuality({
      results: latest,
      priorApproved: [result('prior', 'https://prior.example/a', 'same shallow text')],
      seenEarlierUrls: new Set(['https://one.example/report']),
    })

    expect(quality.verdict).toBe('poor')
    expect(quality.failedIndicators).toEqual([
      'contentDepth',
      'sourceDiversity',
      'novelty',
    ])
    const suggestions = suggestResearchQueries({
      topic: 'runtime safety',
      latestQuery: 'runtime safety',
      quality,
      results: latest,
      previousQueries: ['runtime safety'],
    })
    expect(suggestions.map((item) => item.strategy)).toEqual(
      expect.arrayContaining(['depth', 'diversity', 'novelty']),
    )
    expect(suggestions.some((item) => item.query.includes('site:arxiv.org'))).toBe(true)
  })

  it('anchors multilingual evidence candidates to exact snapshot offsets', () => {
    const content = '系统采用事务存储，避免并发更新互相覆盖。第二条句子与主张无关。'
    const candidates = findResearchEvidenceCandidates(
      '事务存储可以避免并发覆盖',
      [result('result-1', 'https://docs.example/research', content)],
    )

    expect(candidates[0]).toMatchObject({
      resultId: 'result-1',
      quote: '系统采用事务存储，避免并发更新互相覆盖。',
      charStart: 0,
      contentHash: hashResearchText('系统采用事务存储，避免并发更新互相覆盖。'),
      sourceClusterId: researchSourceClusterId('https://docs.example/research'),
    })
    expect(content.slice(candidates[0]!.charStart, candidates[0]!.charEnd))
      .toBe(candidates[0]!.quote)
  })

  it('requires two independent supporting sources and surfaces conflicts', () => {
    const approved = evaluateResearchClaim('high', [
      {
        id: 'e1',
        stance: 'support',
        quote: 'Source one supports the claim.',
        sourceClusterId: researchSourceClusterId('https://one.example/a'),
      },
      {
        id: 'e2',
        stance: 'support',
        quote: 'Source two supports the claim.',
        sourceClusterId: researchSourceClusterId('https://two.example/b'),
      },
    ])
    expect(approved).toMatchObject({
      decision: 'approved',
      autoPass: true,
      matchedRule: 'dualSourceSupport',
    })

    const conflicted = evaluateResearchClaim('low', [
      {
        id: 'e1',
        stance: 'support',
        quote: 'Support quote.',
        sourceClusterId: researchSourceClusterId('https://one.example/a'),
      },
      {
        id: 'e2',
        stance: 'refute',
        quote: 'Refuting quote.',
        sourceClusterId: researchSourceClusterId('https://two.example/b'),
      },
    ])
    expect(conflicted).toMatchObject({
      decision: 'needs_review',
      matchedRule: 'singleRefute',
      checks: { hasRefute: true },
    })
    expect(conflicted.conflict?.refuting).toHaveLength(1)
  })
})
