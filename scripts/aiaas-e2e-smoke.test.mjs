import assert from 'node:assert/strict'
import test from 'node:test'

import { REQUIRED_AIAAS_METRICS, runAiaasSmoke } from './aiaas-e2e-smoke.mjs'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('runAiaasSmoke validates AIAAS API, gateway bridge, tags, and trend probes', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    const parsed = new URL(String(url))
    if (parsed.origin === 'http://aiaas.test') {
      if (parsed.pathname === '/health') return jsonResponse({ status: 'ok' })
      if (parsed.pathname === '/api/state') return jsonResponse({ do_mg_l: 2.1, nh4n_mg_l: 0.8 })
    }
    if (parsed.origin === 'http://gateway.test') {
      if (parsed.pathname === '/api/aiaas/bridge/bootstrap') {
        return jsonResponse({
          tasks: REQUIRED_AIAAS_METRICS.map((metric) => ({ id: `AIAAS_${metric.toUpperCase()}` })),
          safety: { direct_control_allowed: false },
        })
      }
      if (parsed.pathname === '/api/tags') {
        return jsonResponse({
          tags: REQUIRED_AIAAS_METRICS.map((metric) => ({
            metric,
            table: `raw_data_${metric}`,
            col: `AIAAS_${metric.toUpperCase()}`,
          })),
        })
      }
      if (parsed.pathname === '/api/td/aggregate') return jsonResponse({ data: [{ avg: 1.2 }] })
    }
    return jsonResponse({ detail: `unexpected ${url}` }, 404)
  }

  const report = await runAiaasSmoke({
    aiaasUrl: 'http://aiaas.test',
    gatewayUrl: 'http://gateway.test',
    fetchImpl,
    startCollector: true,
    strictTrends: true,
    table: 'aiaas_smoke',
  })

  assert.equal(report.success, true)
  assert.equal(report.safety.direct_control_allowed, false)
  assert.equal(report.tags.missing.length, 0)
  assert.equal(Object.keys(report.trends).length, REQUIRED_AIAAS_METRICS.length)
  assert.equal(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/aiaas/bridge/bootstrap')), true)
  assert.equal(calls.find((call) => call.url.endsWith('/api/aiaas/bridge/bootstrap')).body.start, true)
  assert.equal(calls.find((call) => call.url.endsWith('/api/aiaas/bridge/bootstrap')).body.table, 'aiaas_smoke')
})

test('runAiaasSmoke fails when gateway tags do not expose required AIAAS metrics', async () => {
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url))
    if (parsed.origin === 'http://aiaas.test') {
      if (parsed.pathname === '/health') return jsonResponse({ status: 'ok' })
      if (parsed.pathname === '/api/state') return jsonResponse({ do_mg_l: 2.1 })
    }
    if (parsed.origin === 'http://gateway.test') {
      if (parsed.pathname === '/api/aiaas/bridge/bootstrap') {
        assert.equal(JSON.parse(init.body).start, false)
        return jsonResponse({ tasks: [], safety: { direct_control_allowed: false } })
      }
      if (parsed.pathname === '/api/tags') {
        return jsonResponse({ tags: [{ metric: 'do_mg_l', table: 'raw_data_AIAAS_DO_MG_L', col: 'AIAAS_DO_MG_L' }] })
      }
      if (parsed.pathname === '/api/td/aggregate') return jsonResponse({ data: [] })
    }
    return jsonResponse({ detail: `unexpected ${url}` }, 404)
  }

  const report = await runAiaasSmoke({
    aiaasUrl: 'http://aiaas.test',
    gatewayUrl: 'http://gateway.test',
    fetchImpl,
  })

  assert.equal(report.success, false)
  assert.deepEqual(report.tags.missing, REQUIRED_AIAAS_METRICS.filter((metric) => metric !== 'do_mg_l'))
  assert.match(report.failures.join('\n'), /缺少 AIAAS tag/)
})

test('runAiaasSmoke can seed one MQTT telemetry frame from the current AIAAS state', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    const parsed = new URL(String(url))
    if (parsed.origin === 'http://aiaas.test') {
      if (parsed.pathname === '/health') return jsonResponse({ status: 'ok' })
      if (parsed.pathname === '/api/state') {
        return jsonResponse({ do_mg_l: 1.9, nh4n_mg_l: 1.1, pressure_kpa: 52, blower_frequency_hz: 42, valve_opening_pct: 61 })
      }
    }
    if (parsed.origin === 'http://gateway.test') {
      if (parsed.pathname === '/api/aiaas/bridge/bootstrap') {
        return jsonResponse({ tasks: [], safety: { direct_control_allowed: false } })
      }
      if (parsed.pathname === '/api/nodered/publish') return jsonResponse({ ok: true, rc: 0 })
      if (parsed.pathname === '/api/tags') {
        return jsonResponse({
          tags: REQUIRED_AIAAS_METRICS.map((metric) => ({
            metric,
            table: `raw_data_${metric}`,
            col: `AIAAS_${metric.toUpperCase()}`,
          })),
        })
      }
      if (parsed.pathname === '/api/td/aggregate') return jsonResponse({ data: [{ avg: 1.9 }] })
    }
    return jsonResponse({ detail: `unexpected ${url}` }, 404)
  }

  const report = await runAiaasSmoke({
    aiaasUrl: 'http://aiaas.test',
    gatewayUrl: 'http://gateway.test',
    fetchImpl,
    startCollector: true,
    seedMqtt: true,
    strictTrends: true,
  })

  const publishCall = calls.find((call) => call.url.endsWith('/api/nodered/publish'))
  assert.equal(report.success, true)
  assert.equal(report.seed_mqtt.ok, true)
  assert.equal(publishCall.body.topic, 'aiaas/plc/line-1/zone-1/telemetry')
  assert.equal(publishCall.body.payload.do_mg_l, 1.9)
  assert.equal(publishCall.body.payload.nh4n_mg_l, 1.1)
  assert.equal(report.safety.direct_control_allowed, false)
})
