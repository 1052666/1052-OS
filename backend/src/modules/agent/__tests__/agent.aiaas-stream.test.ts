import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

type SseEvent = Record<string, unknown>

let currentDataDir: string | undefined

async function loadApp() {
  currentDataDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-agent-aiaas-stream-'))
  process.env.DATA_DIR = currentDataDir
  await fs.writeFile(
    path.join(currentDataDir, 'settings.json'),
    JSON.stringify({
      llm: {
        baseUrl: 'http://llm.local/v1',
        modelId: 'mock-agent',
        apiKey: 'test-key',
        kind: 'cloud',
        provider: 'openai-compatible',
        apiFormat: 'openai-compatible',
      },
      agent: {
        progressiveDisclosureEnabled: true,
        checkpointEnabled: true,
        seedOnResumeEnabled: true,
        upgradeDebugEventsEnabled: true,
      },
    }),
    'utf-8',
  )
  vi.resetModules()
  const { createApp } = await import('../../../app.js')
  return {
    app: createApp(),
  }
}

function parseSseEvents(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as SseEvent)
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(chunks: unknown[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  )
}

function toolCallChunk(id: string, name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

function installAiaasAndGatewayFetchMock() {
  let streamCallCount = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    if (parsed.origin === 'http://llm.local') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        stream?: boolean
        tools?: Array<{ function?: { name?: string } }>
      }
      if (!body.stream) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ goal: '精准曝气综合诊断', nextStep: '挂载 data-pack', facts: [] }),
              },
            },
          ],
        })
      }

      streamCallCount += 1
      const toolNames = (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean)
      if (streamCallCount === 1) {
        expect(toolNames).toEqual(['request_context_upgrade'])
        return sseResponse([
          toolCallChunk('upgrade-1', 'request_context_upgrade', {
            packs: ['data-pack'],
            reason: '需要读取 AIAAS 与工业网关证据链',
          }),
        ])
      }
      if (streamCallCount === 2) {
        expect(toolNames).toContain('aiaas_factory_diagnose')
        return sseResponse([
          toolCallChunk('diag-1', 'aiaas_factory_diagnose', {
            windowMinutes: 30,
            horizonMinutes: 15,
            trendInterval: '5m',
          }),
        ])
      }
      return sseResponse([
        {
          choices: [
            {
              delta: {
                content:
                  '结论：高氨氮风险存在，1052 已按只读会诊合并 AIAAS 和 TDengine 证据。安全边界：direct_control_allowed=false。',
              },
              finish_reason: 'stop',
            },
          ],
        },
      ])
    }

    if (parsed.origin === 'http://127.0.0.1:8000') {
      if (parsed.pathname === '/api/state') {
        return jsonResponse({
          do_mg_l: 0.92,
          nh4n_mg_l: 3.8,
          pressure_kpa: 38,
          blower_frequency_hz: 49,
          valve_opening_pct: 97,
        })
      }
      if (parsed.pathname === '/api/alarms') {
        return jsonResponse([{ code: 'HIGH_AMMONIA', level: 'warning' }])
      }
      if (parsed.pathname === '/api/control/logs') {
        return jsonResponse([{ safety_limited: true, dispatch_to_plc: false }])
      }
      if (parsed.pathname === '/api/prediction/analysis') {
        return jsonResponse({ detail: 'Not Found' }, 404)
      }
    }

    if (parsed.origin === 'http://127.0.0.1:18765') {
      if (parsed.pathname === '/api/tags') {
        return jsonResponse({
          tags: [
            { metric: 'do_mg_l', table: 'aiaas_agent_diag_AIAAS_DO_MG_L', col: 'v' },
            { metric: 'nh4n_mg_l', table: 'aiaas_agent_diag_AIAAS_NH4N_MG_L', col: 'v' },
            { metric: 'pressure_kpa', table: 'aiaas_agent_diag_AIAAS_PRESSURE_KPA', col: 'v' },
            { metric: 'blower_frequency_hz', table: 'aiaas_agent_diag_AIAAS_BLOWER_FREQUENCY_HZ', col: 'v' },
            { metric: 'valve_opening_pct', table: 'aiaas_agent_diag_AIAAS_VALVE_OPENING_PCT', col: 'v' },
          ],
        })
      }
      if (parsed.pathname === '/api/collector/status') return jsonResponse({ tasks: [] })
      if (parsed.pathname === '/api/nodered/runtime') return jsonResponse({ running: false, reason: 'disabled' })
      if (parsed.pathname === '/api/nodered/status') return jsonResponse({ broker: 'connected' })
      if (parsed.pathname === '/api/td/aggregate') {
        return jsonResponse({ data: [{ ts: '2026-06-22T15:00:00.000Z', avg: 1.0 }] })
      }
    }

    return jsonResponse({ detail: `unexpected ${url}` }, 404)
  }))
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  delete process.env.DATA_DIR
  if (currentDataDir) {
    await fs.rm(currentDataDir, { recursive: true, force: true })
    currentDataDir = undefined
  }
})

describe('agent AIAAS stream route', () => {
  it('upgrades to data-pack, calls aiaas_factory_diagnose, and streams a read-only diagnosis', async () => {
    installAiaasAndGatewayFetchMock()
    const { app } = await loadApp()

    const response = await request(app)
      .post('/api/agent/chat/stream')
      .send({ messages: [{ role: 'user', content: '请做一次精准曝气综合诊断' }] })
      .expect(200)

    const events = parseSseEvents(response.text)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'context-upgrade-requested',
      packs: ['data-pack'],
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool-started',
      name: 'aiaas_factory_diagnose',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool-finished',
      name: 'aiaas_factory_diagnose',
      ok: true,
    }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'done' }))
    expect(response.text).toContain('direct_control_allowed=false')
  })
})
