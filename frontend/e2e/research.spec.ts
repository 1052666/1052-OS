import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.setTimeout(120_000)

test('completes the research evidence and writeback workflow', async ({ page }, testInfo) => {
  const now = Date.now()
  const session = {
    id: 'research-e2e',
    title: '研究闭环测试',
    description: '验证来源、主张、证据和知识写回。',
    owner: 'web',
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
    rounds: 0,
    resultCounts: { total: 0, pending: 0, approved: 0, rejected: 0 },
  }
  const state = {
    session,
    rounds: [] as Array<Record<string, unknown>>,
    assessments: [] as Array<Record<string, unknown>>,
    results: [] as Array<Record<string, unknown>>,
    snapshots: [] as Array<Record<string, unknown>>,
    claims: [] as Array<Record<string, unknown>>,
    evidence: [] as Array<Record<string, unknown>>,
    claimReviews: [] as Array<Record<string, unknown>>,
    writebacks: [] as Array<Record<string, unknown>>,
  }
  let sessions: Array<typeof session> = []

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const apiPath = url.pathname.replace(/^\/api/, '')
    const method = request.method()
    const body = request.postDataJSON?.() as Record<string, unknown> | null
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })

    if (apiPath === '/notifications/unread-count') return json({ unread: 0 })
    if (apiPath === '/websearch/research/sessions' && method === 'GET') {
      return json({ sessions })
    }
    if (apiPath === '/websearch/research/sessions' && method === 'POST') {
      session.title = String(body?.title ?? session.title)
      session.description = String(body?.description ?? '')
      sessions = [session]
      return json(session, 201)
    }
    if (apiPath === `/websearch/research/sessions/${session.id}` && method === 'GET') {
      return json(state)
    }
    if (apiPath.endsWith('/search') && method === 'POST') {
      session.rounds = 1
      session.resultCounts = { total: 2, pending: 2, approved: 0, rejected: 0 }
      state.rounds = [{
        id: 'query-1',
        sessionId: session.id,
        round: 1,
        query: String(body?.query ?? ''),
        searchQuery: String(body?.query ?? ''),
        intent: 'general',
        selectedEngines: [{ id: 'bing-int', name: 'Bing INT', region: 'global' }],
        succeededEngines: ['Bing INT'],
        failedEngines: [],
        resultCount: 2,
        createdAt: now,
      }]
      state.results = [
        ['result-1', '来源一', 'https://one.example/report'],
        ['result-2', '来源二', 'https://two.example/report'],
      ].map(([id, title, url], index) => ({
        id,
        sessionId: session.id,
        title,
        url,
        normalizedUrl: url,
        snippet: `${title} 提供独立证据。`,
        content: '',
        source: 'websearch',
        engine: 'Bing INT',
        engineId: 'bing-int',
        matchedBy: ['Bing INT'],
        status: 'pending',
        score: 200 - index,
        rrfScore: 1 / (61 + index),
        createdAt: now,
        updatedAt: now,
        origins: [{
          queryId: 'query-1',
          query: String(body?.query ?? ''),
          round: 1,
          rank: index + 1,
          sourceScore: 200 - index,
        }],
      }))
      return json({
        session,
        queryId: 'query-1',
        round: 1,
        results: state.results,
      })
    }
    if (apiPath.endsWith('/extract') && method === 'POST') {
      const resultIds = Array.isArray(body?.resultIds) ? body.resultIds.map(String) : []
      const snapshots = resultIds.map((resultId) => ({
        id: `snapshot-${resultId}`,
        sessionId: session.id,
        resultId,
        status: 'ready',
        requestedUrl: `https://${resultId}.example/report`,
        finalUrl: `https://${resultId}.example/report`,
        title: `快照 ${resultId}`,
        content: '事务存储能够避免并发研究状态互相覆盖。',
        contentHash: `hash-${resultId}`,
        sourceDomain: `${resultId}.example`,
        charCount: 21,
        extractedAt: now,
        error: '',
      }))
      state.snapshots = [
        ...state.snapshots.filter((item) => !resultIds.includes(String(item.resultId))),
        ...snapshots,
      ]
      return json({ extracted: snapshots.length, failed: 0, snapshots })
    }
    if (apiPath.endsWith('/assess') && method === 'POST') {
      const assessment = {
        queryId: 'query-1',
        sessionId: session.id,
        round: 1,
        quality: {
          verdict: 'acceptable',
          breakdown: {
            contentDepth: { value: 1200, threshold: 800, pass: true },
            sourceDiversity: { value: 2, threshold: 3, pass: false },
            novelty: { value: 1, threshold: 0.3, pass: true },
          },
          failedIndicators: ['sourceDiversity'],
        },
        suggestions: [{
          query: '研究闭环 site:arxiv.org',
          reason: '补充第三个独立来源。',
          strategy: 'diversity',
        }],
        assessedAt: now,
      }
      state.assessments = [assessment]
      return json(assessment)
    }
    if (apiPath.endsWith('/results/review') && method === 'POST') {
      const decisions = Array.isArray(body?.decisions)
        ? body.decisions as Array<{ resultId: string; status: string }>
        : []
      for (const decision of decisions) {
        const result = state.results.find((item) => item.id === decision.resultId)
        if (result) result.status = decision.status
      }
      session.resultCounts.approved = state.results.filter((item) => item.status === 'approved').length
      session.resultCounts.pending = state.results.filter((item) => item.status === 'pending').length
      return json({ session, updated: decisions.length, results: state.results })
    }
    if (apiPath.endsWith('/claims') && method === 'POST') {
      const input = Array.isArray(body?.claims) ? body.claims[0] as Record<string, unknown> : {}
      const claim = {
        id: 'claim-1',
        sessionId: session.id,
        text: String(input?.text ?? ''),
        subject: '',
        predicate: '',
        object: '',
        timeConstraint: '',
        riskLevel: input?.riskLevel ?? 'medium',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      }
      state.claims = [claim]
      return json([claim], 201)
    }
    if (apiPath.endsWith('/evidence/candidates') && method === 'POST') {
      const candidates = state.results.map((result, index) => ({
        resultId: result.id,
        resultUrl: result.url,
        quote: '事务存储能够避免并发研究状态互相覆盖。',
        charStart: 0,
        charEnd: 21,
        contentHash: `quote-${index}`,
        sourceClusterId: `cluster-${index}`,
        similarity: 0.92 - index * 0.04,
      }))
      return json({ claim: state.claims[0], candidates })
    }
    if (/\/evidence$/.test(apiPath) && method === 'POST') {
      const evidence = {
        id: `evidence-${state.evidence.length + 1}`,
        sessionId: session.id,
        claimId: 'claim-1',
        resultId: String(body?.resultId),
        snapshotId: `snapshot-${String(body?.resultId)}`,
        resultUrl: state.results.find((item) => item.id === body?.resultId)?.url,
        quote: String(body?.quote),
        charStart: Number(body?.charStart),
        charEnd: Number(body?.charEnd),
        contentHash: `evidence-hash-${state.evidence.length + 1}`,
        snapshotHash: `snapshot-hash-${state.evidence.length + 1}`,
        extractedAt: now,
        sourceClusterId: `cluster-${state.evidence.length + 1}`,
        stance: body?.stance,
        reason: '',
        createdAt: now,
      }
      state.evidence.push(evidence)
      state.claims[0]!.status = 'verifying'
      return json(evidence, 201)
    }
    if (apiPath.endsWith('/review') && method === 'POST') {
      const review = {
        claimId: 'claim-1',
        decision: 'approved',
        autoPass: true,
        checks: {
          sourceIndependent: true,
          hasRefute: false,
          allSupport: true,
          evidenceCount: 2,
        },
        matchedRule: 'dualSourceSupport',
        reviewer: 'agent',
        reviewedAt: now,
      }
      state.claimReviews = [review]
      state.claims[0]!.status = 'reviewed'
      return json(review)
    }
    if (apiPath.endsWith('/writeback') && method === 'POST') {
      session.status = 'completed'
      const writeback = {
        id: 'writeback-1',
        sessionId: session.id,
        wikiPath: '综合分析/研究闭环测试.md',
        title: session.title,
        summary: String(body?.summary ?? ''),
        claimIds: ['claim-1'],
        resultIds: ['result-1', 'result-2'],
        createdAt: now,
      }
      state.writebacks = [writeback]
      return json({ session, page: { path: writeback.wikiPath }, writeback, pkm: { totalEntries: 1 } })
    }
    return json({ ok: true })
  })

  await page.goto('/knowledge/research', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '深度研究' })).toBeVisible()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('textbox', { name: '主题', exact: true }).fill('研究闭环测试')
  await page.getByLabel('范围与证据要求').fill('验证来源、主张、证据和知识写回。')
  await page.getByRole('button', { name: '创建' }).click()

  await page.getByPlaceholder('输入本轮聚焦查询').fill('事务研究状态安全')
  await page.getByRole('button', { name: '搜索一轮' }).click()
  await expect(page.getByText('来源一', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '提取 来源一' }).click()
  await page.getByRole('button', { name: '提取 来源二' }).click()
  await page.getByRole('button', { name: '批准 来源一' }).click()
  await page.getByRole('button', { name: '批准 来源二' }).click()
  await page.getByRole('button', { name: '质量评估' }).click()
  await expect(page.getByText('研究闭环 site:arxiv.org')).toBeVisible()

  await page.getByPlaceholder('写成一个可以被证据支持或反驳的原子主张')
    .fill('事务存储能够避免并发研究状态互相覆盖。')
  await page.getByRole('button', { name: '添加主张' }).click()
  const claim = page.locator('article').filter({ hasText: '事务存储能够避免并发研究状态互相覆盖。' })
  await claim.getByRole('button', { name: '查找证据' }).click()
  await expect(claim.getByText('匹配度 92%')).toBeVisible()
  await claim.getByRole('button', { name: '支持' }).first().click()
  await claim.getByRole('button', { name: '支持' }).first().click()
  await claim.getByRole('button', { name: '执行审核' }).click()
  await expect(claim.getByText('已通过')).toBeVisible()

  await page.getByPlaceholder('填写本次研究结论摘要').fill('两个独立来源支持事务存储结论。')
  await page.getByRole('button', { name: '写入并完成研究' }).click()
  await expect(page.getByText('最近写入 综合分析/研究闭环测试.md')).toBeVisible()
  await expect(page.getByText('已完成', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '搜索一轮' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '写入并完成研究' })).toBeDisabled()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(2)
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('research-closure.png'), fullPage: true })
})
