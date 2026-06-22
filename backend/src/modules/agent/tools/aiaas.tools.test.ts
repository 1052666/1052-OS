import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '../agent.tool.types.js'
import { aiaasTools } from './aiaas.tools.js'

function toolByName(tools: AgentTool[], name: string) {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`missing tool: ${name}`)
  return tool
}

afterEach(() => {
  delete process.env.AIAAS_API_URL
  delete process.env.INDUSTRIAL_GATEWAY_URL
  vi.unstubAllGlobals()
})

describe('aiaas agent tools', () => {
  it('reads realtime state from AIAAS API and marks result advisory-only', async () => {
    process.env.AIAAS_API_URL = 'http://aiaas.local:8000/'
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://aiaas.local:8000/api/state')
      return new Response(JSON.stringify({ do_mg_l: 2.1, nh4n_mg_l: 0.8 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await toolByName(aiaasTools, 'aiaas_get_state').execute({})

    expect(result).toMatchObject({
      source: 'aiaas',
      endpoint: '/api/state',
      safety: {
        direct_control_allowed: false,
        recommendation_level: 'advisory_only',
      },
      data: {
        do_mg_l: 2.1,
        nh4n_mg_l: 0.8,
      },
    })
  })

  it('passes prediction query parameters without allowing control writes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        'http://127.0.0.1:8000/api/prediction/analysis?window_minutes=120&horizon_minutes=90',
      )
      return new Response(JSON.stringify({ risk_score: { level: 'warning' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await toolByName(aiaasTools, 'aiaas_get_prediction_analysis').execute({
      windowMinutes: 120,
      horizonMinutes: 90,
    })

    expect(result).toMatchObject({
      endpoint: '/api/prediction/analysis',
      safety: {
        direct_control_allowed: false,
        recommendation_level: 'advisory_only',
      },
      data: {
        risk_score: { level: 'warning' },
      },
    })
  })

  it('explains alarms through AIAAS without exposing actuator write capability', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8000/api/agent/alarms/explain')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ alarm_code: 'HIGH_AMMONIA' })
      return new Response(JSON.stringify({ alarm_code: 'HIGH_AMMONIA', direct_control_allowed: false }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await toolByName(aiaasTools, 'aiaas_explain_alarm').execute({
      alarmCode: 'HIGH_AMMONIA',
    })

    expect(result).toMatchObject({
      endpoint: '/api/agent/alarms/explain',
      safety: {
        direct_control_allowed: false,
        recommendation_level: 'advisory_only',
      },
      data: {
        alarm_code: 'HIGH_AMMONIA',
      },
    })
  })

  it('builds a factory-level diagnosis by combining AIAAS opinion and 1052 evidence', async () => {
    process.env.AIAAS_API_URL = 'http://aiaas.local:8000'
    process.env.INDUSTRIAL_GATEWAY_URL = 'http://gateway.local:18765/'

    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url)
      const path = parsed.pathname
      if (parsed.origin === 'http://aiaas.local:8000') {
        if (path === '/api/state') {
          return new Response(
            JSON.stringify({
              do_mg_l: 0.92,
              nh4n_mg_l: 3.8,
              pressure_kpa: 38,
              blower_frequency_hz: 49,
              valve_opening_pct: 97,
              control_mode: 'ai_suggest',
            }),
            { status: 200 },
          )
        }
        if (path === '/api/alarms') {
          return new Response(JSON.stringify([{ code: 'HIGH_AMMONIA', level: 'warning' }]), {
            status: 200,
          })
        }
        if (path === '/api/prediction/analysis') {
          expect(parsed.searchParams.get('window_minutes')).toBe('30')
          expect(parsed.searchParams.get('horizon_minutes')).toBe('15')
          return new Response(
            JSON.stringify({
              risk_score: { level: 'warning', overall: 72 },
              recommendations: ['建议提升风量，并检查风压与阀门反馈。'],
            }),
            { status: 200 },
          )
        }
        if (path === '/api/control/logs') {
          expect(parsed.searchParams.get('limit')).toBe('10')
          return new Response(
            JSON.stringify([
              {
                dispatch_to_plc: false,
                safety_limited: true,
                rule_results: ['阀门步长限幅'],
              },
            ]),
            { status: 200 },
          )
        }
      }

      if (parsed.origin === 'http://gateway.local:18765') {
        if (path === '/api/tags') {
          return new Response(
            JSON.stringify({
              tags: [
                { metric: 'do_mg_l', table: 'raw_data_AIAAS_DO_MG_L', col: 'v' },
                { metric: 'nh4n_mg_l', table: 'raw_data_AIAAS_NH4N_MG_L', col: 'v' },
              ],
            }),
            { status: 200 },
          )
        }
        if (path === '/api/collector/status') {
          return new Response(JSON.stringify({ tasks: [{ id: 'AIAAS_DO_MG_L', running: true }] }), {
            status: 200,
          })
        }
        if (path === '/api/nodered/runtime') {
          return new Response(JSON.stringify({ running: true }), { status: 200 })
        }
        if (path === '/api/nodered/status') {
          return new Response(JSON.stringify({ ok: true, mqtt: 'connected' }), { status: 200 })
        }
        if (path === '/api/td/aggregate') {
          expect(parsed.searchParams.get('start')).toBeTruthy()
          expect(parsed.searchParams.get('end')).toBeTruthy()
          return new Response(
            JSON.stringify({
              data: [
                { ts: '2026-06-22T08:00:00Z', avg: 1.08 },
                { ts: '2026-06-22T08:05:00Z', avg: 0.92 },
              ],
            }),
            { status: 200 },
          )
        }
      }

      return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await toolByName(aiaasTools, 'aiaas_factory_diagnose').execute({
      windowMinutes: 30,
      horizonMinutes: 15,
      controlLogLimit: 10,
      trendInterval: '5m',
    })

    expect(result).toMatchObject({
      source: 'aiaas_factory_diagnosis',
      scope: {
        window_minutes: 30,
        horizon_minutes: 15,
      },
      aiaas_opinion: {
        risk_level: 'warning',
        alarms_count: 1,
      },
      safety: {
        direct_control_allowed: false,
        recommendation_level: 'factory_diagnosis_only',
      },
    })
    expect((result as { site_evidence: { tags: { matched_count: number } } }).site_evidence.tags.matched_count).toBe(2)
    expect((result as { site_evidence: { trends: Record<string, unknown> } }).site_evidence.trends).toHaveProperty('do_mg_l')
    expect((result as { excluded_causes: string[] }).excluded_causes.join('\n')).toContain('采集')
    expect((result as { possible_causes: string[] }).possible_causes.join('\n')).toContain('DO')
    expect((result as { recommended_actions: string[] }).recommended_actions.join('\n')).toContain('只读')
  })

  it('keeps factory diagnosis usable when optional AIAAS analysis endpoints are missing', async () => {
    process.env.AIAAS_API_URL = 'http://aiaas.local:8000'
    process.env.INDUSTRIAL_GATEWAY_URL = 'http://gateway.local:18765'

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.origin === 'http://aiaas.local:8000') {
        if (parsed.pathname === '/api/state') {
          return new Response(JSON.stringify({ do_mg_l: 0.9, nh4n_mg_l: 3.4 }), { status: 200 })
        }
        if (parsed.pathname === '/api/alarms') {
          return new Response(JSON.stringify([{ code: 'HIGH_AMMONIA' }]), { status: 200 })
        }
        return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
      }
      if (parsed.origin === 'http://gateway.local:18765') {
        if (parsed.pathname === '/api/tags') return new Response(JSON.stringify({ tags: [] }), { status: 200 })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 })
    }))

    const result = await toolByName(aiaasTools, 'aiaas_factory_diagnose').execute({
      windowMinutes: 30,
      horizonMinutes: 15,
    })

    expect(result).toMatchObject({
      source: 'aiaas_factory_diagnosis',
      aiaas_opinion: {
        risk_level: 'warning',
        alarms_count: 1,
      },
      safety: {
        direct_control_allowed: false,
        recommendation_level: 'factory_diagnosis_only',
      },
    })
    expect((result as { aiaas_opinion: { sources: { prediction: { ok: boolean } } } }).aiaas_opinion.sources.prediction.ok).toBe(false)
    expect((result as { uncertainties: string[] }).uncertainties.join('\n')).toContain('/api/prediction/analysis')
  })
})
