import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:18765'
const DEFAULT_RAW_LIMIT = 200
const MAX_RAW_LIMIT = 500
const DEFAULT_HISTORY_LIMIT = 100
const MAX_HISTORY_LIMIT = 500

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

function readLimit(value: unknown, fallback: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function addParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && !value.trim()) return
  params.set(key, String(value))
}

async function fetchGateway(path: string, params?: URLSearchParams) {
  const query = params && params.toString() ? `?${params.toString()}` : ''
  const url = `${gatewayBaseUrl()}${path}${query}`
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    throw new HttpError(502, `工业网关连接失败: ${error instanceof Error ? error.message : String(error)}`)
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
    throw new HttpError(response.status, `工业网关 API ${path} 失败: ${detail}`)
  }

  return body
}

function filterTags(tags: unknown[], input: Record<string, unknown>) {
  const keyword = readString(input.keyword).toLowerCase()
  const device = readString(input.device).toLowerCase()
  const site = readString(input.site).toLowerCase()
  const limit = readLimit(input.limit, 100, 500)

  return tags
    .filter((item) => item && typeof item === 'object')
    .filter((item) => {
      const text = JSON.stringify(item).toLowerCase()
      if (keyword && !text.includes(keyword)) return false
      if (device && !text.includes(device)) return false
      if (site && !text.includes(site)) return false
      return true
    })
    .slice(0, limit)
}

function tableFromInput(input: Record<string, unknown>) {
  const table = readString(input.table) || readString(input.tag)
  if (!table) throw new HttpError(400, '必须提供 table 或 tag。自然语言名称不确定时，请先调用 industrial_list_tags 搜索点位。')
  return table
}

export const industrialGatewayTools: AgentTool[] = [
  {
    name: 'industrial_list_tags',
    description:
      '列出或搜索工业网关采集点位/标签。用于自然语言查询现场数据前定位 tag/table，例如温度、压力、粉尘、设备名、产线名。只读。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '按自然语言关键词过滤，例如 温度、粉尘、1号风机。' },
        device: { type: 'string', description: '可选设备名过滤。' },
        site: { type: 'string', description: '可选站点/区域过滤。' },
        limit: { type: 'number', description: '最多返回数量，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const result = await fetchGateway('/api/tags')
      const tags = Array.isArray((result as { tags?: unknown }).tags)
        ? ((result as { tags: unknown[] }).tags)
        : []
      return {
        ...result as Record<string, unknown>,
        tags: filterTags(tags, input),
        _hint: '如果用户问趋势/统计，下一步用返回的 table/tag 调用 industrial_query_timeseries 或 industrial_aggregate_timeseries。',
      }
    },
  },
  {
    name: 'industrial_query_timeseries',
    description:
      '查询工业点位原始时序数据。适合精确时间线、最近 N 条、报警前后明细。大范围趋势/统计应优先使用 industrial_aggregate_timeseries。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'TDengine 表名或点位表名。' },
        tag: { type: 'string', description: '点位 tag/table。若不确定请先调用 industrial_list_tags。' },
        start: { type: 'string', description: '开始时间，可留空；如 2026-06-22 08:00:00。' },
        end: { type: 'string', description: '结束时间，可留空。' },
        limit: { type: 'number', description: '返回条数，默认 200，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'table', tableFromInput(input))
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_RAW_LIMIT, MAX_RAW_LIMIT))
      const result = await fetchGateway('/api/td/query', params)
      return {
        ...result as Record<string, unknown>,
        _hint: '请基于真实数据回答；如果 data 为空，明确说明当前时间窗没有数据。',
      }
    },
  },
  {
    name: 'industrial_aggregate_timeseries',
    description:
      '对工业点位做时序聚合/降采样统计。适合趋势、平均值、最大值、最小值、计数、分时段对比。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'TDengine 表名或点位表名。' },
        tag: { type: 'string', description: '点位 tag/table。若不确定请先调用 industrial_list_tags。' },
        col: { type: 'string', description: '数值列，raw_data 子表通常是 v，默认 v。' },
        start: { type: 'string', description: '开始时间。' },
        end: { type: 'string', description: '结束时间。' },
        interval: { type: 'string', description: '聚合窗口，如 1m、10m、1h；默认 10m。' },
        agg: { type: 'string', enum: ['avg', 'min', 'max', 'sum', 'count', 'last'], description: '聚合函数，默认 avg。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'table', tableFromInput(input))
      addParam(params, 'col', readString(input.col) || 'v')
      addParam(params, 'interval', readString(input.interval) || '10m')
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'agg', readString(input.agg) || 'avg')
      return fetchGateway('/api/td/aggregate', params)
    },
  },
  {
    name: 'industrial_get_anomaly_history',
    description:
      '查询工业异常/报警历史。适合“今天报警多少次、最近有哪些异常、哪个设备报警最多、报警时间线”等问题。只读。',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '开始时间，可选。' },
        end: { type: 'string', description: '结束时间，可选。' },
        channelId: { type: 'string', description: '异常通道/点位 ID，可选。' },
        level: { type: 'string', description: '报警等级关键词，可选。' },
        limit: { type: 'number', description: '返回条数，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'channel_id', readString(input.channelId))
      addParam(params, 'level', readString(input.level))
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT))
      return fetchGateway('/api/anomaly/history', params)
    },
  },
  {
    name: 'industrial_get_collector_status',
    description:
      '查询工业网关采集任务健康状态，包括任务是否运行、最近值、最近更新时间和错误。适合判断是否掉线、数据是否中断。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return fetchGateway('/api/collector/status')
    },
  },
  {
    name: 'industrial_get_nodered_status',
    description:
      '查询内嵌 Node-RED 运行状态和 MQTT/发布状态。适合判断协议积木、Node-RED runtime、发布错误是否正常。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const [runtime, bridge] = await Promise.all([
        fetchGateway('/api/nodered/runtime'),
        fetchGateway('/api/nodered/status'),
      ])
      return { runtime, bridge }
    },
  },
  {
    name: 'industrial_get_audit_writes',
    description:
      '查询工业写入/控制/设定值修改审计记录。适合“谁改过设定值、最近有哪些控制操作、某设备是否被写入”。只读，不会执行控制。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT))
      return fetchGateway('/api/audit/writes', params)
    },
  },
  {
    name: 'industrial_describe_data',
    description:
      '查询工业数据存储结构：TDengine 表、超级表、字段结构、数据量。适合“有哪些表、表结构是什么、数据量多少”。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '可选表名；提供后会返回 describe 和 count。' },
        includeCounts: { type: 'boolean', description: '是否返回指定表 count；仅 table 存在时有效。' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      const table = readString(input.table)
      const tables = await fetchGateway('/api/td/tables')
      if (!table) return tables

      const describeParams = new URLSearchParams()
      addParam(describeParams, 'table', table)
      const describe = await fetchGateway('/api/td/describe', describeParams)
      const output: Record<string, unknown> = { tables, describe }
      if (input.includeCounts !== false) {
        const countParams = new URLSearchParams()
        addParam(countParams, 'table', table)
        output.count = await fetchGateway('/api/td/count', countParams)
      }
      return output
    },
  },
]
