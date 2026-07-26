import { describe, expect, it } from 'vitest'
import {
  calendarEventSchema,
  healthStatusSchema,
  orchestrationSchema,
  publicAppearanceThemesSchema,
  researchStateSchema,
  runtimeEventSchema,
  scheduledTaskSchema,
  searchSourcesSchema,
  uapiCatalogSchema,
} from './schemas'

describe('frontend API contracts', () => {
  it('keeps calendar event defaults compatible with backend omissions', () => {
    const event = calendarEventSchema.parse({
      id: 'event-1',
      title: '复盘',
      date: '2026-07-22',
      createdAt: 1,
      updatedAt: 2,
      extra: 'kept',
    })

    expect(event).toMatchObject({
      startTime: '',
      endTime: '',
      location: '',
      notes: '',
      extra: 'kept',
    })
  })

  it('parses the direct backend health endpoint', () => {
    expect(healthStatusSchema.parse({ ok: true, ts: 1784720000000, pid: 1052 })).toMatchObject({
      ok: true,
      ts: 1784720000000,
      pid: 1052,
    })
  })

  it('accepts the full scheduled task shape used by the scheduler', () => {
    const task = scheduledTaskSchema.parse({
      id: 'task-1',
      title: '每日早报',
      target: 'agent',
      mode: 'recurring',
      startDate: '2026-07-22',
      time: '08:30',
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    })

    expect(task).toMatchObject({
      notes: '',
      timezone: 'Asia/Hong_Kong',
      repeatUnit: '',
      repeatInterval: 1,
      repeatWeekdays: [],
      endDate: '',
      prompt: '',
      command: '',
      shell: 'powershell',
      delivery: {},
      lastRunStatus: null,
      lastRunSummary: '',
    })
  })

  it('preserves orchestration node and workflow passthrough fields', () => {
    const workflow = orchestrationSchema.parse({
      id: 'flow-1',
      name: '数据同步',
      nodes: [
        {
          id: 'n1',
          name: '查询',
          type: 'sql',
          enabled: true,
          datasourceId: 'main',
          sql: 'select 1',
          position: { x: 20, y: 40 },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 2,
      executionPolicy: 'manual',
    })

    expect(workflow.description).toBe('')
    expect(workflow.executionPolicy).toBe('manual')
    expect(workflow.nodes[0]).toMatchObject({ datasourceId: 'main', sql: 'select 1' })
  })

  it('parses runtime loop events as an extensible stream payload', () => {
    const event = runtimeEventSchema.parse({
      type: 'tool-call-finished',
      callId: 'call-1',
      name: 'sql_query',
      ok: true,
      resultPreview: '3 rows',
      mountedPacks: ['workspace-pack'],
      tokenBudgetRemaining: 1200,
    })

    expect(event).toMatchObject({
      type: 'tool-call-finished',
      callId: 'call-1',
      mountedPacks: ['workspace-pack'],
      tokenBudgetRemaining: 1200,
    })
  })

  it('accepts UAPI catalog and search source groups used by capabilities pages', () => {
    const catalog = uapiCatalogSchema.parse({
      provider: { name: 'UAPIs', apiKeyMode: 'free-ip-quota' },
      categories: [{ id: 'search', name: '搜索', declaredCount: 1 }],
      apis: [
        {
          id: 'web-search',
          categoryId: 'search',
          categoryName: '搜索',
          name: '网页搜索',
          method: 'GET',
          path: '/api/v1/search',
          description: '搜索网页',
          enabled: true,
        },
      ],
      counts: { total: 1, enabled: 1, disabled: 0, searchApis: 1 },
    })
    const sources = searchSourcesSchema.parse({
      engines: [{ id: 'bing', enabled: true }],
      sourceGroups: [{ id: 'web-search', title: '联网搜索源', items: [{ id: 'bing', enabled: true }] }],
    })

    expect(catalog.apis[0].enabled).toBe(true)
    expect(sources.sourceGroups).toHaveLength(1)
  })

  it('parses the complete research trajectory contract', () => {
    const state = researchStateSchema.parse({
      session: {
        id: 'research-1',
        title: '运行时安全',
        description: '',
        owner: 'web',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
        rounds: 1,
        resultCounts: { total: 1, pending: 0, approved: 1, rejected: 0 },
      },
      rounds: [{
        id: 'query-1',
        sessionId: 'research-1',
        round: 1,
        query: 'runtime safety',
        searchQuery: 'runtime safety',
        intent: 'general',
        selectedEngines: [],
        succeededEngines: ['Bing INT'],
        failedEngines: [],
        resultCount: 1,
        createdAt: 1,
      }],
      assessments: [{
        queryId: 'query-1',
        sessionId: 'research-1',
        round: 1,
        quality: {
          verdict: 'good',
          breakdown: {
            contentDepth: { value: 1200, threshold: 800, pass: true },
            sourceDiversity: { value: 3, threshold: 3, pass: true },
            novelty: { value: 1, threshold: 0.3, pass: true },
          },
          failedIndicators: [],
        },
        suggestions: [],
        assessedAt: 2,
      }],
      results: [],
      snapshots: [],
      claims: [],
      evidence: [],
      claimReviews: [],
      writebacks: [],
    })

    expect(state.assessments[0].quality.verdict).toBe('good')
    expect(state.rounds[0].succeededEngines).toEqual(['Bing INT'])
  })

  it('parses appearance theme profiles without binding the new UI to old theme code', () => {
    const themes = publicAppearanceThemesSchema.parse({
      schemaVersion: 1,
      activeProfileId: 'builtin-dark',
      activeProfile: {
        id: 'builtin-dark',
        theme: {
          schemaVersion: 1,
          name: '曜石深色',
          mode: 'dark',
          scope: 'all',
          safetyLevel: 'safe',
          coreTokens: {
            bg: '#080b0e',
            surface: '#10171b',
            fg: '#eef5f7',
            accent: '#26d9d0',
            success: '#4ade80',
            danger: '#ff6b6b',
          },
          tokens: { accentRing: '#26d9d0' },
        },
        review: { passed: true, safetyLevel: 'safe', blockingIssues: [], warnings: [] },
        createdAt: 1,
        updatedAt: 2,
        source: 'builtin',
      },
      applyHistory: [{ profileId: 'builtin-dark', appliedAt: 2 }],
      profiles: [],
    })

    expect(themes.activeProfile?.theme.name).toBe('曜石深色')
    expect(themes.activeProfile?.theme.tokens).toMatchObject({ accentRing: '#26d9d0' })
    expect(themes.applyHistory[0].profileId).toBe('builtin-dark')
  })
})
