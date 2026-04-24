import { HttpError } from '../../http-error.js'
import { buildFeishuSimpleCard } from '../channels/feishu/feishu.cards.js'

export type IntelBriefTargetFormat =
  | 'markdown'
  | 'plain_text'
  | 'feishu_card'
  | 'wechat_text'
  | 'wecom_markdown'

type IntelBriefSector = {
  name: string
  summary?: string
  items: string[]
}

type IntelBriefTransmissionChain = {
  title: string
  origin?: string
  mechanism?: string
  endpoint?: string
  confidence?: string
}

type IntelBriefSource = {
  title: string
  url?: string
}

type NormalizedIntelBrief = {
  title: string
  date?: string
  summary?: string
  sectors: IntelBriefSector[]
  marketAnomalies: string[]
  transmissionChains: IntelBriefTransmissionChain[]
  deltaAlerts: string[]
  sources: IntelBriefSource[]
}

export type IntelBriefFormatResult = {
  targetFormat: IntelBriefTargetFormat
  mediaType: 'text/markdown' | 'text/plain' | 'application/json'
  content?: string
  messages?: string[]
  card?: unknown
  warnings: string[]
  metadata: {
    title: string
    date?: string
    sectors: number
    marketAnomalies: number
    transmissionChains: number
    deltaAlerts: number
    sources: number
  }
}

const TARGET_FORMATS = new Set<IntelBriefTargetFormat>([
  'markdown',
  'plain_text',
  'feishu_card',
  'wechat_text',
  'wecom_markdown',
])

const MAX_SECTION_ITEMS = 12
const MAX_SOURCES = 12
const MAX_ITEM_CHARS = 500
const MAX_CONTENT_CHARS = 20000
const DEFAULT_MESSAGE_CHARS = 1800

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readText(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return truncate(value.trim(), MAX_ITEM_CHARS)
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return undefined
}

function readArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`
}

function stringifyBriefItem(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return truncate(value.trim(), MAX_ITEM_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  const record = asRecord(value)
  if (!record) return undefined

  const title = readText(record, ['title', 'name', 'headline', 'asset', 'event'])
  const summary = readText(record, ['summary', 'description', 'content', 'reason', 'change'])
  const score = readText(record, ['relevance_score', 'score', 'severity'])
  const pieces = [title, summary, score ? `(${score})` : undefined].filter(Boolean)
  if (pieces.length > 0) return truncate(pieces.join(' - '), MAX_ITEM_CHARS)

  try {
    return truncate(JSON.stringify(value), MAX_ITEM_CHARS)
  } catch {
    return undefined
  }
}

function normalizeSectors(record: Record<string, unknown>): IntelBriefSector[] {
  const raw = readArray(record, ['sectorSummaries', 'sector_summaries', 'sector_summary', 'sectors'])
  return raw
    .map((value, index): IntelBriefSector | undefined => {
      const sector = asRecord(value)
      if (!sector) return undefined

      const items = readArray(sector, ['items', 'events', 'topEvents', 'top_events'])
        .map(stringifyBriefItem)
        .filter((item): item is string => Boolean(item))
        .slice(0, MAX_SECTION_ITEMS)

      const summary = readText(sector, ['summary', 'overview', 'content'])
      const name =
        readText(sector, ['name', 'sector', 'title']) ?? `Sector ${String(index + 1).padStart(2, '0')}`

      if (!summary && items.length === 0) return undefined

      return {
        name,
        summary,
        items,
      }
    })
    .filter((item): item is IntelBriefSector => Boolean(item))
    .slice(0, MAX_SECTION_ITEMS)
}

function normalizeStringList(record: Record<string, unknown>, keys: string[]): string[] {
  return readArray(record, keys)
    .map(stringifyBriefItem)
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_SECTION_ITEMS)
}

function normalizeChains(record: Record<string, unknown>): IntelBriefTransmissionChain[] {
  return readArray(record, [
    'transmissionChains',
    'transmission_chains',
    'crossSectorChains',
    'cross_sector_chains',
    'chains',
  ])
    .map((value, index): IntelBriefTransmissionChain | undefined => {
      const chain = asRecord(value)
      if (!chain) {
        const text = stringifyBriefItem(value)
        return text ? { title: text } : undefined
      }

      const title =
        readText(chain, ['title', 'name', 'path']) ?? `Chain ${String(index + 1).padStart(2, '0')}`
      return {
        title,
        origin: readText(chain, ['origin', 'source', 'from']),
        mechanism: readText(chain, ['mechanism', 'driver', 'why']),
        endpoint: readText(chain, ['endpoint', 'target', 'to']),
        confidence: readText(chain, ['confidence', 'confidence_level']),
      }
    })
    .filter((item): item is IntelBriefTransmissionChain => Boolean(item))
    .slice(0, MAX_SECTION_ITEMS)
}

function normalizeSources(record: Record<string, unknown>): IntelBriefSource[] {
  return readArray(record, ['sources', 'references', 'links'])
    .map((value, index): IntelBriefSource | undefined => {
      if (typeof value === 'string' && value.trim()) {
        return { title: truncate(value.trim(), MAX_ITEM_CHARS) }
      }

      const source = asRecord(value)
      if (!source) return undefined

      const title =
        readText(source, ['title', 'name', 'source']) ?? `Source ${String(index + 1).padStart(2, '0')}`
      const url = readText(source, ['url', 'link', 'href'])
      return { title, url }
    })
    .filter((item): item is IntelBriefSource => Boolean(item))
    .slice(0, MAX_SOURCES)
}

function normalizeIntelBrief(value: unknown): NormalizedIntelBrief {
  const record = asRecord(value)
  if (!record) throw new HttpError(400, 'intel_brief_format requires a brief object.')

  const marketRecord = asRecord(record.market)
  const deltaRecord = asRecord(record.market_delta) ?? asRecord(record.marketDelta)
  const title = readText(record, ['title', 'name']) ?? 'Intel Brief'
  const date = readText(record, ['date', 'asOf', 'as_of'])
  const marketAnomalies = [
    ...normalizeStringList(record, ['marketAnomalies', 'market_anomalies']),
    ...(marketRecord ? normalizeStringList(marketRecord, ['anomalies']) : []),
  ].slice(0, MAX_SECTION_ITEMS)
  const deltaAlerts = [
    ...normalizeStringList(record, ['deltaAlerts', 'delta_alerts']),
    ...(deltaRecord ? normalizeStringList(deltaRecord, ['deltas', 'alerts']) : []),
  ].slice(0, MAX_SECTION_ITEMS)

  return {
    title,
    date,
    summary: readText(record, ['summary', 'overview', 'executiveSummary', 'executive_summary']),
    sectors: normalizeSectors(record),
    marketAnomalies,
    transmissionChains: normalizeChains(record),
    deltaAlerts,
    sources: normalizeSources(record),
  }
}

function pushListSection(lines: string[], title: string, items: readonly string[]) {
  if (!items.length) return
  lines.push('', `## ${title}`)
  for (const item of items) lines.push(`- ${item}`)
}

function renderMarkdown(brief: NormalizedIntelBrief, includeTitle = true) {
  const lines: string[] = []
  if (includeTitle) {
    lines.push(`# ${brief.title}`)
    if (brief.date) lines.push('', `Date: ${brief.date}`)
  }
  if (brief.summary) lines.push('', `> ${brief.summary}`)

  if (brief.sectors.length) {
    lines.push('', '## Sector Summaries')
    for (const sector of brief.sectors) {
      lines.push('', `### ${sector.name}`)
      if (sector.summary) lines.push(sector.summary)
      for (const item of sector.items) lines.push(`- ${item}`)
    }
  }

  pushListSection(lines, 'Market Anomalies', brief.marketAnomalies)

  if (brief.transmissionChains.length) {
    lines.push('', '## Transmission Chains')
    brief.transmissionChains.forEach((chain, index) => {
      lines.push(`${index + 1}. **${chain.title}**`)
      if (chain.origin) lines.push(`   - Origin: ${chain.origin}`)
      if (chain.mechanism) lines.push(`   - Mechanism: ${chain.mechanism}`)
      if (chain.endpoint) lines.push(`   - Endpoint: ${chain.endpoint}`)
      if (chain.confidence) lines.push(`   - Confidence: ${chain.confidence}`)
    })
  }

  pushListSection(lines, 'Delta Alerts', brief.deltaAlerts)

  if (brief.sources.length) {
    lines.push('', '## Sources')
    for (const source of brief.sources) {
      lines.push(source.url ? `- [${source.title}](${source.url})` : `- ${source.title}`)
    }
  }

  return truncate(lines.join('\n').trim(), MAX_CONTENT_CHARS)
}

function renderPlainText(brief: NormalizedIntelBrief) {
  const lines: string[] = [brief.title]
  if (brief.date) lines.push(`Date: ${brief.date}`)
  if (brief.summary) lines.push('', brief.summary)

  if (brief.sectors.length) {
    lines.push('', 'Sector Summaries')
    for (const sector of brief.sectors) {
      lines.push('', sector.name)
      if (sector.summary) lines.push(sector.summary)
      for (const item of sector.items) lines.push(`- ${item}`)
    }
  }

  pushPlainListSection(lines, 'Market Anomalies', brief.marketAnomalies)

  if (brief.transmissionChains.length) {
    lines.push('', 'Transmission Chains')
    brief.transmissionChains.forEach((chain, index) => {
      lines.push(`${index + 1}. ${chain.title}`)
      if (chain.origin) lines.push(`   Origin: ${chain.origin}`)
      if (chain.mechanism) lines.push(`   Mechanism: ${chain.mechanism}`)
      if (chain.endpoint) lines.push(`   Endpoint: ${chain.endpoint}`)
      if (chain.confidence) lines.push(`   Confidence: ${chain.confidence}`)
    })
  }

  pushPlainListSection(lines, 'Delta Alerts', brief.deltaAlerts)

  if (brief.sources.length) {
    lines.push('', 'Sources')
    for (const source of brief.sources) {
      lines.push(source.url ? `- ${source.title}: ${source.url}` : `- ${source.title}`)
    }
  }

  return truncate(lines.join('\n').trim(), MAX_CONTENT_CHARS)
}

function renderFeishuCardContent(brief: NormalizedIntelBrief) {
  const content = renderMarkdown(brief, false)
  if (content) return content

  return [
    brief.date ? `Date: ${brief.date}` : undefined,
    'No recognized Intel Brief analysis sections were provided.',
  ]
    .filter(Boolean)
    .join('\n')
}

function pushPlainListSection(lines: string[], title: string, items: readonly string[]) {
  if (!items.length) return
  lines.push('', title)
  for (const item of items) lines.push(`- ${item}`)
}

function splitMessages(content: string, maxChars: number) {
  const chunks: string[] = []
  const limit = Math.min(Math.max(maxChars, 500), 4000)
  let remaining = content.trim()

  while (remaining.length > limit) {
    const pivot = remaining.lastIndexOf('\n', limit)
    const cut = pivot > Math.floor(limit * 0.6) ? pivot : limit
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

function buildWarnings(brief: NormalizedIntelBrief) {
  const warnings: string[] = []
  if (
    !brief.summary &&
    !brief.sectors.length &&
    !brief.marketAnomalies.length &&
    !brief.transmissionChains.length &&
    !brief.deltaAlerts.length
  ) {
    warnings.push('Brief has no recognized analysis sections; rendered title and sources only.')
  }
  return warnings
}

function buildMetadata(brief: NormalizedIntelBrief): IntelBriefFormatResult['metadata'] {
  return {
    title: brief.title,
    date: brief.date,
    sectors: brief.sectors.length,
    marketAnomalies: brief.marketAnomalies.length,
    transmissionChains: brief.transmissionChains.length,
    deltaAlerts: brief.deltaAlerts.length,
    sources: brief.sources.length,
  }
}

function normalizeTargetFormat(value: unknown): IntelBriefTargetFormat {
  if (value === undefined || value === null) return 'markdown'
  if (typeof value === 'string' && TARGET_FORMATS.has(value as IntelBriefTargetFormat)) {
    return value as IntelBriefTargetFormat
  }
  throw new HttpError(400, 'Unsupported Intel Brief target format.')
}

export function formatIntelBrief(input: {
  brief: unknown
  targetFormat?: unknown
  maxMessageChars?: unknown
}): IntelBriefFormatResult {
  const targetFormat = normalizeTargetFormat(input.targetFormat)
  const brief = normalizeIntelBrief(input.brief)
  const warnings = buildWarnings(brief)
  const metadata = buildMetadata(brief)
  const maxMessageChars =
    typeof input.maxMessageChars === 'number' && Number.isFinite(input.maxMessageChars)
      ? input.maxMessageChars
      : DEFAULT_MESSAGE_CHARS

  if (targetFormat === 'plain_text') {
    return {
      targetFormat,
      mediaType: 'text/plain',
      content: renderPlainText(brief),
      warnings,
      metadata,
    }
  }

  if (targetFormat === 'wechat_text') {
    const content = renderPlainText(brief)
    return {
      targetFormat,
      mediaType: 'text/plain',
      content,
      messages: splitMessages(content, maxMessageChars),
      warnings,
      metadata,
    }
  }

  if (targetFormat === 'feishu_card') {
    const content = renderFeishuCardContent(brief)
    return {
      targetFormat,
      mediaType: 'application/json',
      content,
      card: buildFeishuSimpleCard({
        title: brief.title,
        subtitle: brief.date,
        content,
        note: 'Rendered by intel_brief_format. This tool formats content only and does not send it.',
      }),
      warnings,
      metadata,
    }
  }

  const content = renderMarkdown(brief)
  if (targetFormat === 'wecom_markdown') {
    return {
      targetFormat,
      mediaType: 'text/markdown',
      content,
      messages: splitMessages(content, maxMessageChars),
      warnings,
      metadata,
    }
  }

  return {
    targetFormat,
    mediaType: 'text/markdown',
    content,
    warnings,
    metadata,
  }
}
