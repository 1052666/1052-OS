#!/usr/bin/env node

export const REQUIRED_AIAAS_METRICS = [
  'do_mg_l',
  'nh4n_mg_l',
  'pressure_kpa',
  'blower_frequency_hz',
  'valve_opening_pct',
]

const DEFAULT_AIAAS_URL = 'http://127.0.0.1:8000'
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18765'
const DEFAULT_TOPIC = 'aiaas/plc/line-1/zone-1/telemetry'
const DEFAULT_SITE = 'demo'
const DEFAULT_DEVICE = 'aiaas_line_1_zone_1'
const DEFAULT_TABLE = 'raw_data'
const DEFAULT_TREND_INTERVAL = '5m'

function trimBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '')
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase())
}

function parseArgs(argv) {
  const options = {
    aiaasUrl: process.env.AIAAS_API_URL || DEFAULT_AIAAS_URL,
    gatewayUrl: process.env.INDUSTRIAL_GATEWAY_URL || process.env.GATEWAY_API_URL || DEFAULT_GATEWAY_URL,
    topic: process.env.AIAAS_MQTT_TOPIC || DEFAULT_TOPIC,
    site: process.env.AIAAS_SITE || DEFAULT_SITE,
    device: process.env.AIAAS_DEVICE || DEFAULT_DEVICE,
    table: process.env.AIAAS_TABLE || DEFAULT_TABLE,
    brokerHost: process.env.AIAAS_MQTT_HOST || '127.0.0.1',
    brokerPort: Number.parseInt(process.env.AIAAS_MQTT_PORT || '1883', 10),
    startCollector: boolFromEnv(process.env.AIAAS_BRIDGE_START, false),
    seedMqtt: boolFromEnv(process.env.AIAAS_SEED_MQTT, false),
    strictTrends: boolFromEnv(process.env.AIAAS_STRICT_TRENDS, false),
    json: false,
    trendInterval: process.env.AIAAS_TREND_INTERVAL || DEFAULT_TREND_INTERVAL,
    trendAttempts: Number.parseInt(process.env.AIAAS_TREND_ATTEMPTS || '1', 10),
    pollMs: Number.parseInt(process.env.AIAAS_POLL_MS || '1000', 10),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--aiaas-url' && next) {
      options.aiaasUrl = next
      index += 1
    } else if (arg === '--gateway-url' && next) {
      options.gatewayUrl = next
      index += 1
    } else if (arg === '--topic' && next) {
      options.topic = next
      index += 1
    } else if (arg === '--site' && next) {
      options.site = next
      index += 1
    } else if (arg === '--device' && next) {
      options.device = next
      index += 1
    } else if (arg === '--table' && next) {
      options.table = next
      index += 1
    } else if (arg === '--broker-host' && next) {
      options.brokerHost = next
      index += 1
    } else if (arg === '--broker-port' && next) {
      options.brokerPort = Number.parseInt(next, 10)
      index += 1
    } else if (arg === '--trend-interval' && next) {
      options.trendInterval = next
      index += 1
    } else if (arg === '--start') {
      options.startCollector = true
    } else if (arg === '--seed-mqtt') {
      options.seedMqtt = true
      options.startCollector = true
    } else if (arg === '--strict-trends') {
      options.strictTrends = true
    } else if (arg === '--trend-attempts' && next) {
      options.trendAttempts = Number.parseInt(next, 10)
      index += 1
    } else if (arg === '--poll-ms' && next) {
      options.pollMs = Number.parseInt(next, 10)
      index += 1
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }
  return options
}

async function readJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let body = text
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 1000)
    }
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : body
    throw new Error(`${response.status} ${response.statusText}: ${detail}`)
  }
  return body
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tagKey(tag) {
  if (!tag || typeof tag !== 'object') return ''
  return typeof tag.metric === 'string' ? tag.metric : ''
}

function findTag(tags, metric) {
  return tags.find((tag) => tagKey(tag) === metric)
}

async function step(label, failures, fn) {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    const message = `${label}: ${error instanceof Error ? error.message : String(error)}`
    failures.push(message)
    return { ok: false, error: message }
  }
}

export async function runAiaasSmoke(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is not available; use Node.js 20+')

  const aiaasUrl = trimBaseUrl(options.aiaasUrl || DEFAULT_AIAAS_URL)
  const gatewayUrl = trimBaseUrl(options.gatewayUrl || DEFAULT_GATEWAY_URL)
  const failures = []
  const warnings = []

  const health = await step('AIAAS /health', failures, () =>
    readJson(fetchImpl, `${aiaasUrl}/health`),
  )
  const state = await step('AIAAS /api/state', failures, () =>
    readJson(fetchImpl, `${aiaasUrl}/api/state`),
  )

  const bootstrapBody = {
    broker_host: options.brokerHost || '127.0.0.1',
    broker_port: Number.isFinite(options.brokerPort) ? options.brokerPort : 1883,
    topic: options.topic || DEFAULT_TOPIC,
    site: options.site || DEFAULT_SITE,
    device: options.device || DEFAULT_DEVICE,
    table: options.table || DEFAULT_TABLE,
    start: Boolean(options.startCollector),
  }

  const bootstrap = await step('1052 /api/aiaas/bridge/bootstrap', failures, () =>
    readJson(fetchImpl, `${gatewayUrl}/api/aiaas/bridge/bootstrap`, {
      method: 'POST',
      body: JSON.stringify(bootstrapBody),
    }),
  )

  const seedMqtt = options.seedMqtt
    ? await step('1052 /api/nodered/publish AIAAS seed', failures, () =>
        readJson(fetchImpl, `${gatewayUrl}/api/nodered/publish`, {
          method: 'POST',
          body: JSON.stringify({
            topic: bootstrapBody.topic,
            payload: state.ok ? state.data : {},
            retain: false,
          }),
        }),
      )
    : { ok: false, skipped: true, reason: 'seed_mqtt disabled' }

  const tagsResult = await step('1052 /api/tags', failures, () =>
    readJson(fetchImpl, `${gatewayUrl}/api/tags`),
  )

  const tags = tagsResult.ok ? safeArray(tagsResult.data.tags) : []
  const matched = REQUIRED_AIAAS_METRICS
    .map((metric) => ({ metric, tag: findTag(tags, metric) }))
    .filter((entry) => entry.tag)
  const missing = REQUIRED_AIAAS_METRICS.filter((metric) => !findTag(tags, metric))
  if (missing.length > 0) failures.push(`缺少 AIAAS tag: ${missing.join(', ')}`)

  const trends = {}
  for (const { metric, tag } of matched) {
    const params = new URLSearchParams()
    params.set('table', tag.table || tag.tag || '')
    params.set('col', tag.col || 'v')
    params.set('interval', options.trendInterval || DEFAULT_TREND_INTERVAL)
    params.set('agg', 'avg')
    const attempts = Math.max(1, Number.isFinite(options.trendAttempts) ? options.trendAttempts : 1)
    let trend = { ok: false, error: 'not attempted' }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      trend = await step(`TDengine aggregate ${metric}`, options.strictTrends ? failures : warnings, () =>
        readJson(fetchImpl, `${gatewayUrl}/api/td/aggregate?${params.toString()}`),
      )
      if (!trend.ok) break
      if (safeArray(trend.data.data).length > 0 || attempt === attempts) break
      await sleep(Math.max(0, Number.isFinite(options.pollMs) ? options.pollMs : 1000))
    }
    trends[metric] = trend
    if (options.strictTrends && trend.ok && safeArray(trend.data.data).length === 0) {
      failures.push(`TDengine aggregate ${metric}: 没有返回数据`)
    }
  }

  return {
    success: failures.length === 0,
    generated_at: new Date().toISOString(),
    endpoints: {
      aiaas_url: aiaasUrl,
      gateway_url: gatewayUrl,
    },
    bridge: {
      request: bootstrapBody,
      response: bootstrap,
    },
    seed_mqtt: seedMqtt,
    aiaas: {
      health,
      state,
    },
    tags: {
      required: REQUIRED_AIAAS_METRICS,
      matched: matched.map(({ metric, tag }) => ({
        metric,
        table: tag.table || '',
        col: tag.col || 'v',
      })),
      missing,
      source: tagsResult,
    },
    trends,
    failures,
    warnings,
    safety: {
      direct_control_allowed: false,
      recommendation_level: 'e2e_smoke_read_only',
      notice: 'This smoke test registers/starts read-only MQTT collectors only; it never writes PLC values.',
    },
  }
}

function printHelp() {
  console.log(`AIAAS <-> 1052 E2E smoke test

Usage:
  node scripts/aiaas-e2e-smoke.mjs [options]

Options:
  --aiaas-url URL        AIAAS FastAPI base URL. Default: ${DEFAULT_AIAAS_URL}
  --gateway-url URL      1052 Industrial Gateway base URL. Default: ${DEFAULT_GATEWAY_URL}
  --topic TOPIC          AIAAS MQTT telemetry topic. Default: ${DEFAULT_TOPIC}
  --site SITE            Site label. Default: ${DEFAULT_SITE}
  --device DEVICE        Device label. Default: ${DEFAULT_DEVICE}
  --table TABLE          TDengine stable for registered tasks. Default: ${DEFAULT_TABLE}
  --broker-host HOST     MQTT broker host. Default: 127.0.0.1
  --broker-port PORT     MQTT broker port. Default: 1883
  --trend-interval WIN   TDengine aggregate interval. Default: ${DEFAULT_TREND_INTERVAL}
  --start                Start registered MQTT collectors after bootstrap.
  --seed-mqtt            Publish one AIAAS state JSON frame to the bridge topic through gateway MQTT.
  --strict-trends        Treat TDengine aggregate errors or empty series as failures.
  --trend-attempts N     Poll aggregate endpoint N times. Default: 1
  --poll-ms MS           Delay between aggregate attempts. Default: 1000
  --json                 Print only JSON report.
  -h, --help             Show this help.
`)
}

function printHumanReport(report) {
  const mark = (ok) => (ok ? '[PASS]' : '[FAIL]')
  console.log('')
  console.log('AIAAS <-> 1052 E2E smoke')
  console.log('========================================')
  console.log(`${mark(report.aiaas.health.ok)} AIAAS health: ${report.endpoints.aiaas_url}/health`)
  console.log(`${mark(report.aiaas.state.ok)} AIAAS state: ${report.endpoints.aiaas_url}/api/state`)
  console.log(`${mark(report.bridge.response.ok)} Bridge bootstrap: ${report.endpoints.gateway_url}/api/aiaas/bridge/bootstrap`)
  if (!report.seed_mqtt.skipped) {
    console.log(`${mark(report.seed_mqtt.ok)} Seed MQTT frame: ${report.endpoints.gateway_url}/api/nodered/publish`)
  }
  console.log(`${mark(report.tags.missing.length === 0)} Required tags: ${report.tags.matched.length}/${report.tags.required.length}`)
  for (const tag of report.tags.matched) {
    const trend = report.trends[tag.metric]
    console.log(`  - ${tag.metric}: table=${tag.table} col=${tag.col} trend=${trend?.ok ? 'ok' : 'warn/fail'}`)
  }
  if (report.warnings.length > 0) {
    console.log('')
    console.log('Warnings:')
    for (const warning of report.warnings) console.log(`  - ${warning}`)
  }
  if (report.failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of report.failures) console.log(`  - ${failure}`)
  }
  console.log('')
  console.log(`Safety: direct_control_allowed=${report.safety.direct_control_allowed}, level=${report.safety.recommendation_level}`)
  console.log('')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return 0
  }
  const report = await runAiaasSmoke(options)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReport(report)
  }
  return report.success ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
