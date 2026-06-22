import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

const DEFAULT_AIAAS_API_URL = 'http://127.0.0.1:8000'
const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:18765'
const DIAGNOSIS_METRICS = [
  'do_mg_l',
  'nh4n_mg_l',
  'pressure_kpa',
  'blower_frequency_hz',
  'valve_opening_pct',
] as const

function aiaasBaseUrl() {
  return (process.env.AIAAS_API_URL || DEFAULT_AIAAS_API_URL).replace(/\/+$/, '')
}

function gatewayBaseUrl() {
  return (
    process.env.INDUSTRIAL_GATEWAY_URL ||
    process.env.GATEWAY_API_URL ||
    DEFAULT_GATEWAY_BASE_URL
  ).replace(/\/+$/, '')
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function addParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && !value.trim()) return
  params.set(key, String(value))
}

function advisoryEnvelope(endpoint: string, data: unknown) {
  return {
    source: 'aiaas',
    endpoint,
    safety: {
      direct_control_allowed: false,
      recommendation_level: 'advisory_only',
      notice: 'AIAAS Agent bridge is read-only. AI diagnostics must not dispatch PLC commands.',
    },
    data,
  }
}

async function fetchAiaas(endpoint: string, options: RequestInit = {}) {
  let response: Response
  const url = `${aiaasBaseUrl()}${endpoint}`
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    })
  } catch (error) {
    throw new HttpError(502, `AIAAS API 连接失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let body: unknown = text
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text.slice(0, 1000)
    }
  }

  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail?: unknown }).detail)
        : typeof body === 'string'
          ? body
          : response.statusText
    throw new HttpError(response.status, `AIAAS API ${endpoint} 失败: ${detail}`)
  }

  return body
}

async function fetchAiaasSafe(endpoint: string, options: RequestInit = {}) {
  try {
    return { ok: true as const, endpoint, data: await fetchAiaas(endpoint, options) }
  } catch (error) {
    return {
      ok: false as const,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function fetchGatewaySafe(path: string, params?: URLSearchParams) {
  const query = params && params.toString() ? `?${params.toString()}` : ''
  const url = `${gatewayBaseUrl()}${path}${query}`
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    const text = await response.text()
    let body: unknown = text
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown
      } catch {
        body = text.slice(0, 1000)
      }
    }
    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? String((body as { detail?: unknown }).detail)
          : typeof body === 'string'
            ? body
            : response.statusText
      return { ok: false as const, error: `工业网关 API ${path} 失败: ${detail}` }
    }
    return { ok: true as const, data: body }
  } catch (error) {
    return {
      ok: false as const,
      error: `工业网关连接失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function withQuery(endpoint: string, params: URLSearchParams) {
  const query = params.toString()
  return query ? `${endpoint}?${query}` : endpoint
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function riskLevel(prediction: unknown, alarms: unknown[], state: Record<string, unknown>) {
  const predictionRecord = asRecord(prediction)
  const riskScore = asRecord(predictionRecord.risk_score)
  const level = readString(riskScore.level)
  if (level) return level
  if (alarms.length > 0) return 'warning'
  const nh4n = numberField(state, 'nh4n_mg_l')
  const doValue = numberField(state, 'do_mg_l')
  if ((nh4n !== null && nh4n >= 2) || (doValue !== null && doValue < 1.2)) return 'warning'
  return 'normal'
}

function findMetricTag(tags: unknown[], metric: string) {
  return tags.map(asRecord).find((tag) => readString(tag.metric) === metric)
}

function trendQueryParams(tag: Record<string, unknown>, interval: string, windowMinutes: number) {
  const params = new URLSearchParams()
  addParam(params, 'table', readString(tag.table))
  addParam(params, 'col', readString(tag.col) || 'v')
  addParam(params, 'interval', interval)
  addParam(params, 'agg', 'avg')
  const end = new Date()
  const start = new Date(end.getTime() - windowMinutes * 60_000)
  addParam(params, 'start', start.toISOString())
  addParam(params, 'end', end.toISOString())
  return params
}

function summarizeGatewayResult(result: Awaited<ReturnType<typeof fetchGatewaySafe>>) {
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, data: result.data }
}

function summarizeAiaasResult(result: Awaited<ReturnType<typeof fetchAiaasSafe>>) {
  if (!result.ok) return { ok: false, endpoint: result.endpoint, error: result.error }
  return { ok: true, endpoint: result.endpoint, data: result.data }
}

function controlLogSummary(logs: unknown[]) {
  const limited = logs.map(asRecord).filter((log) => log.safety_limited === true).length
  const dispatched = logs.map(asRecord).filter((log) => log.dispatch_to_plc === true).length
  return {
    total: logs.length,
    safety_limited_count: limited,
    dispatch_to_plc_count: dispatched,
    read_only_interpretation:
      dispatched === 0
        ? '最近 AIAAS 记录未显示由 Agent 触发的 PLC 下发。'
        : '存在 PLC 下发记录，需要结合 AIAAS 控制审计确认来源与授权。',
  }
}

function buildExcludedCauses(
  collector: Awaited<ReturnType<typeof fetchGatewaySafe>>,
  runtime: Awaited<ReturnType<typeof fetchGatewaySafe>>,
  bridge: Awaited<ReturnType<typeof fetchGatewaySafe>>,
) {
  const excluded: string[] = []
  if (collector.ok) excluded.push('1052 采集器状态接口可读，未首先指向采集服务整体不可用。')
  if (runtime.ok) excluded.push('Node-RED runtime 状态接口可读，未首先指向 Node-RED 整体离线。')
  if (bridge.ok) excluded.push('MQTT/Node-RED 桥接状态接口可读，未首先指向网关状态接口中断。')
  if (excluded.length === 0) excluded.push('1052 现场证据链当前不足，暂不能排除采集、Node-RED 或 MQTT 链路问题。')
  return excluded
}

function buildPossibleCauses(state: Record<string, unknown>, logs: unknown[], prediction: unknown) {
  const causes: string[] = []
  const doValue = numberField(state, 'do_mg_l')
  const nh4n = numberField(state, 'nh4n_mg_l')
  const pressure = numberField(state, 'pressure_kpa')
  const blower = numberField(state, 'blower_frequency_hz')
  const valve = numberField(state, 'valve_opening_pct')
  if (nh4n !== null && nh4n >= 2) causes.push('NH4-N 已处于偏高区间，硝化负荷或曝气供给可能不足。')
  if (doValue !== null && doValue < 1.2) causes.push('DO 偏低，AIAAS 高氨氮风险可能与实际溶解氧不足相互印证。')
  if (pressure !== null && pressure < 40) causes.push('风压偏低，需要排查供气管网、阀门反馈、曝气支管或风机效率。')
  if (blower !== null && blower >= 48 && valve !== null && valve >= 95) {
    causes.push('风机频率和阀门开度接近上限，单纯继续调频可能难以解决，需要现场检查曝气能力。')
  }
  if (logs.map(asRecord).some((log) => log.safety_limited === true)) {
    causes.push('最近控制建议触发过安全限幅，实际下发能力可能低于 AIAAS 原始建议。')
  }
  const recommendations = asArray(asRecord(prediction).recommendations)
    .map((item) => readString(item))
    .filter(Boolean)
  if (recommendations.length > 0) causes.push(`AIAAS 专科建议提示：${recommendations[0]}`)
  if (causes.length === 0) causes.push('当前状态未形成单一明确原因，需要扩大时间窗核对趋势、报警和采集质量。')
  return causes
}

function buildRecommendedActions(level: string) {
  const actions = [
    '保持 1052 Agent 只读会诊，不通过聊天直接写 PLC、风机、阀门或控制模式。',
    '用 TDengine 趋势复核 DO、NH4-N、风压、风机频率和阀门开度是否同向支持 AIAAS 结论。',
  ]
  if (level !== 'normal') {
    actions.push('通知现场检查曝气管路堵塞、阀门开度反馈、鼓风机效率和仪表漂移。')
    actions.push('如需调整曝气，应回到 AIAAS/PLC 安全控制链路，由人工确认后经限幅规则执行。')
  }
  return actions
}

function buildAiaasUncertainties(results: Awaited<ReturnType<typeof fetchAiaasSafe>>[]) {
  return results
    .filter((result) => !result.ok)
    .map((result) => `AIAAS ${result.endpoint} 当前不可读：${result.error}`)
}

export const aiaasTools: AgentTool[] = [
  {
    name: 'aiaas_get_state',
    description:
      '读取 AI 智能精准曝气系统当前实时状态，包括 DO、NH4-N、风机频率、阀门开度、能耗和控制模式。只读，不执行控制。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const endpoint = '/api/state'
      return advisoryEnvelope(endpoint, await fetchAiaas(endpoint))
    },
  },
  {
    name: 'aiaas_get_alarms',
    description:
      '读取 AI 智能精准曝气系统当前报警快照，适合诊断高氨氮、PLC 故障安全、传感器越界和低风压风险。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const endpoint = '/api/alarms'
      return advisoryEnvelope(endpoint, await fetchAiaas(endpoint))
    },
  },
  {
    name: 'aiaas_get_prediction_analysis',
    description:
      '读取精准曝气预测分析，包含 DO/NH4-N/能耗趋势、风险评分和操作建议。只读，仅用于诊断和人工确认建议。',
    parameters: {
      type: 'object',
      properties: {
        windowMinutes: { type: 'number', description: '历史分析窗口分钟数，默认 1440，范围 5-10080。' },
        horizonMinutes: { type: 'number', description: '预测未来分钟数，默认 60，范围 5-1440。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'window_minutes', readNumber(input.windowMinutes, 1440, 5, 10080))
      addParam(params, 'horizon_minutes', readNumber(input.horizonMinutes, 60, 5, 1440))
      const endpoint = withQuery('/api/prediction/analysis', params)
      return advisoryEnvelope('/api/prediction/analysis', await fetchAiaas(endpoint))
    },
  },
  {
    name: 'aiaas_explain_alarm',
    description:
      '调用 AIAAS 工艺知识库解释指定报警，返回原因排序、处置建议和人工确认标记。只读，不确认/搁置报警。',
    parameters: {
      type: 'object',
      properties: {
        alarmCode: { type: 'string', description: '报警编码，例如 HIGH_AMMONIA、PLC_FAULT_SAFE。' },
      },
      required: ['alarmCode'],
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const alarmCode = readString(input.alarmCode)
      if (!alarmCode) throw new HttpError(400, '必须提供 alarmCode')
      const endpoint = '/api/agent/alarms/explain'
      return advisoryEnvelope(
        endpoint,
        await fetchAiaas(endpoint, {
          method: 'POST',
          body: JSON.stringify({ alarm_code: alarmCode }),
        }),
      )
    },
  },
  {
    name: 'aiaas_generate_daily_report',
    description:
      '生成 AIAAS 曝气运行日报，返回结构化运行概览、关键指标、风险排序和建议动作。只读建议层，不广播、不控制。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const endpoint = '/api/agent/daily-report?broadcast=false'
      return advisoryEnvelope('/api/agent/daily-report', await fetchAiaas(endpoint, { method: 'POST' }))
    },
  },
  {
    name: 'aiaas_get_control_logs',
    description:
      '读取 AIAAS 最近控制决策日志，用于追溯 AI 建议、PLC 限幅、安全规则和是否被拦截。只读。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 20，范围 1-100。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'limit', readNumber(input.limit, 20, 1, 100))
      const endpoint = withQuery('/api/control/logs', params)
      return advisoryEnvelope('/api/control/logs', await fetchAiaas(endpoint))
    },
  },
  {
    name: 'aiaas_factory_diagnose',
    description:
      '执行精准曝气综合诊断：合并 AIAAS 专科结论、报警/预测/控制日志，以及 1052 工业网关采集、Node-RED、MQTT、TDengine 趋势证据链。只读会诊，不执行控制。',
    parameters: {
      type: 'object',
      properties: {
        windowMinutes: { type: 'number', description: '1052 现场证据和 AIAAS 历史分析窗口，默认 30，范围 5-1440。' },
        horizonMinutes: { type: 'number', description: 'AIAAS 预测未来分钟数，默认 15，范围 5-1440。' },
        controlLogLimit: { type: 'number', description: '读取 AIAAS 控制日志条数，默认 20，范围 1-100。' },
        trendInterval: { type: 'string', description: 'TDengine 聚合窗口，例如 1m、5m、10m，默认 5m。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const windowMinutes = readNumber(input.windowMinutes, 30, 5, 1440)
      const horizonMinutes = readNumber(input.horizonMinutes, 15, 5, 1440)
      const controlLogLimit = readNumber(input.controlLogLimit, 20, 1, 100)
      const trendInterval = readString(input.trendInterval) || '5m'

      const predictionParams = new URLSearchParams()
      addParam(predictionParams, 'window_minutes', windowMinutes)
      addParam(predictionParams, 'horizon_minutes', horizonMinutes)
      const logParams = new URLSearchParams()
      addParam(logParams, 'limit', controlLogLimit)

      const predictionEndpoint = withQuery('/api/prediction/analysis', predictionParams)
      const logsEndpoint = withQuery('/api/control/logs', logParams)
      const [stateResult, alarmsResult, predictionResult, logsResult] = await Promise.all([
        fetchAiaasSafe('/api/state'),
        fetchAiaasSafe('/api/alarms'),
        fetchAiaasSafe(predictionEndpoint),
        fetchAiaasSafe(logsEndpoint),
      ])

      const [tagsResult, collectorResult, runtimeResult, bridgeResult] = await Promise.all([
        fetchGatewaySafe('/api/tags'),
        fetchGatewaySafe('/api/collector/status'),
        fetchGatewaySafe('/api/nodered/runtime'),
        fetchGatewaySafe('/api/nodered/status'),
      ])

      const state = stateResult.ok ? asRecord(stateResult.data) : {}
      const alarms = alarmsResult.ok ? asArray(alarmsResult.data) : []
      const predictionRaw = predictionResult.ok ? predictionResult.data : {}
      const logs = logsResult.ok ? asArray(logsResult.data) : []
      const tags = tagsResult.ok ? asArray(asRecord(tagsResult.data).tags) : []
      const matchedTags = DIAGNOSIS_METRICS
        .map((metric) => ({ metric, tag: findMetricTag(tags, metric) }))
        .filter((item): item is { metric: typeof DIAGNOSIS_METRICS[number]; tag: Record<string, unknown> } =>
          item.tag !== undefined,
        )

      const trendEntries = await Promise.all(
        matchedTags.map(async ({ metric, tag }) => {
          const trend = await fetchGatewaySafe('/api/td/aggregate', trendQueryParams(tag, trendInterval, windowMinutes))
          return [metric, summarizeGatewayResult(trend)] as const
        }),
      )
      const trends = Object.fromEntries(trendEntries)
      const level = riskLevel(predictionRaw, alarms, state)

      return {
        source: 'aiaas_factory_diagnosis',
        generated_at: new Date().toISOString(),
        scope: {
          plant: 'demo',
          line: 'line-1',
          zone: 'zone-1',
          window_minutes: windowMinutes,
          horizon_minutes: horizonMinutes,
          trend_interval: trendInterval,
        },
        conclusion:
          level === 'normal'
            ? 'AIAAS 专科判断和 1052 现场证据当前未显示高风险，但仍需持续观察趋势。'
            : 'AIAAS 专科判断提示风险，1052 已合并采集链路与趋势证据，建议按只读会诊结论组织现场复核。',
        aiaas_opinion: {
          risk_level: level,
          alarms_count: alarms.length,
          realtime_state: state,
          prediction: predictionRaw,
          control_logs: controlLogSummary(logs),
          sources: {
            state: summarizeAiaasResult(stateResult),
            alarms: summarizeAiaasResult(alarmsResult),
            prediction: summarizeAiaasResult(predictionResult),
            control_logs: summarizeAiaasResult(logsResult),
          },
        },
        site_evidence: {
          tags: {
            requested_metrics: [...DIAGNOSIS_METRICS],
            matched_count: matchedTags.length,
            matched: matchedTags.map(({ metric, tag }) => ({
              metric,
              table: readString(tag.table),
              col: readString(tag.col) || 'v',
            })),
            source: summarizeGatewayResult(tagsResult),
          },
          collector: summarizeGatewayResult(collectorResult),
          nodered: {
            runtime: summarizeGatewayResult(runtimeResult),
            bridge: summarizeGatewayResult(bridgeResult),
          },
          trends,
        },
        excluded_causes: buildExcludedCauses(collectorResult, runtimeResult, bridgeResult),
        possible_causes: buildPossibleCauses(state, logs, predictionRaw),
        recommended_actions: buildRecommendedActions(level),
        uncertainties: [
          ...buildAiaasUncertainties([stateResult, alarmsResult, predictionResult, logsResult]),
          '1052 会诊依赖 AIAAS API 与工业网关当前可读数据；若 tag 未注册或 TDengine 时间窗为空，需要先补采集链路。',
          '本工具不确认报警、不写入 PLC、不切换控制模式；所有控制动作仍必须回到 AIAAS 安全规则层和 PLC 限幅。',
        ],
        safety: {
          direct_control_allowed: false,
          recommendation_level: 'factory_diagnosis_only',
          notice: '1052 Agent 仅做工厂级综合诊断和运维建议，不通过聊天直接下发控制。',
        },
      }
    },
  },
]
