import { describe, expect, it } from 'vitest'
import { formatIntelBrief } from '../intel-brief.service.js'

const sampleBrief = {
  title: 'Morning Intel',
  date: '2026-04-25',
  summary: 'Markets are reacting to a policy signal and a chip supply constraint.',
  sector_summaries: [
    {
      sector: 'Politics',
      summary: 'New export review signal.',
      items: ['Export review expands to AI accelerators.'],
    },
    {
      sector: 'Tech',
      items: [{ title: 'Chip lead times extend', relevance_score: 8 }],
    },
  ],
  market: {
    anomalies: ['VIX +2.5 points', { asset: 'Gold', change: '+1.1%' }],
  },
  transmission_chains: [
    {
      title: 'Politics -> Tech -> Finance',
      origin: 'Export review expands',
      mechanism: 'Supply risk reprices AI infrastructure names.',
      endpoint: 'Semiconductor volatility rises.',
      confidence: 'High',
    },
  ],
  market_delta: {
    deltas: ['Nasdaq -0.9% since last scan'],
  },
  sources: [{ title: 'Example Wire', url: 'https://example.com/wire' }],
}

describe('formatIntelBrief', () => {
  it('renders a structured Intel Brief as markdown', () => {
    const result = formatIntelBrief({ brief: sampleBrief, targetFormat: 'markdown' })

    expect(result.mediaType).toBe('text/markdown')
    expect(result.content).toContain('# Morning Intel')
    expect(result.content).toContain('## Sector Summaries')
    expect(result.content).toContain('VIX +2.5 points')
    expect(result.content).toContain('Politics -> Tech -> Finance')
    expect(result.content).toContain('[Example Wire](https://example.com/wire)')
    expect(result.metadata).toMatchObject({
      sectors: 2,
      marketAnomalies: 2,
      transmissionChains: 1,
      deltaAlerts: 1,
      sources: 1,
    })
  })

  it('renders Feishu card JSON without sending it', () => {
    const result = formatIntelBrief({ brief: sampleBrief, targetFormat: 'feishu_card' })

    expect(result.mediaType).toBe('application/json')
    expect(result.card).toMatchObject({
      schema: '2.0',
      header: {
        title: {
          content: 'Morning Intel',
        },
      },
    })
    expect(result.content).toContain('Market Anomalies')
  })

  it('keeps Feishu card content non-empty for minimal briefs', () => {
    const result = formatIntelBrief({
      brief: { title: 'Minimal Intel', date: '2026-04-25' },
      targetFormat: 'feishu_card',
    })

    expect(result.content).toContain('No recognized Intel Brief analysis sections')
    expect(result.warnings).toContain(
      'Brief has no recognized analysis sections; rendered title and sources only.',
    )
  })

  it('renders plain text without markdown link syntax', () => {
    const result = formatIntelBrief({ brief: sampleBrief, targetFormat: 'plain_text' })

    expect(result.mediaType).toBe('text/plain')
    expect(result.content).toContain('Morning Intel')
    expect(result.content).toContain('Example Wire: https://example.com/wire')
    expect(result.content).not.toContain('[Example Wire]')
  })

  it('renders WeCom markdown as chunkable markdown', () => {
    const result = formatIntelBrief({
      brief: sampleBrief,
      targetFormat: 'wecom_markdown',
      maxMessageChars: 600,
    })

    expect(result.mediaType).toBe('text/markdown')
    expect(result.content).toContain('# Morning Intel')
    expect(result.messages?.length).toBeGreaterThan(0)
  })

  it('does not duplicate sector summaries as fallback items', () => {
    const result = formatIntelBrief({
      brief: {
        title: 'Summary Only',
        sectors: [{ sector: 'Finance', summary: 'Sector-only summary.' }],
      },
      targetFormat: 'markdown',
    })

    expect(result.content?.match(/Sector-only summary/g)).toHaveLength(1)
  })

  it('chunks text-channel output', () => {
    const result = formatIntelBrief({
      brief: {
        title: 'Long Intel',
        market_anomalies: Array.from(
          { length: 12 },
          (_, index) => `Signal ${index} ${'x'.repeat(140)}`,
        ),
      },
      targetFormat: 'wechat_text',
      maxMessageChars: 520,
    })

    expect(result.mediaType).toBe('text/plain')
    expect(result.messages?.length).toBeGreaterThan(1)
    expect(result.messages?.every((message) => message.length <= 520)).toBe(true)
  })

  it('rejects unsupported target formats instead of silently changing output shape', () => {
    expect(() =>
      formatIntelBrief({
        brief: sampleBrief,
        targetFormat: 'email_html',
      }),
    ).toThrow('Unsupported Intel Brief target format')
  })
})
