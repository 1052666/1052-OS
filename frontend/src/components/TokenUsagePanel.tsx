import { useEffect, useState } from 'react'
import {
  AgentApi,
  type TokenUsageAggregate,
  type TokenUsageBucket,
  type TokenUsageStats,
} from '../api/agent'

type UsageSegment = {
  label: string
  value: number
  color: string
}

function formatCompact(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)} 万`
  }
  return new Intl.NumberFormat('zh-CN').format(Math.round(value))
}

function formatExact(value: number) {
  return `${new Intl.NumberFormat('zh-CN').format(Math.round(value))} tokens`
}

function formatTime(value?: number) {
  if (!value) return '暂无'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getComposition(total: TokenUsageAggregate): UsageSegment[] {
  return [
    { label: '用户输入', value: total.userTokens, color: '#6ea8fe' },
    { label: '上下文开销', value: total.contextTokens, color: '#f59e0b' },
    { label: 'AI 输出', value: total.outputTokens, color: '#34d399' },
  ]
}

function MetricCard(props: { label: string; value: number; note: string }) {
  return (
    <article className="usage-metric-card">
      <div className="usage-metric-label">{props.label}</div>
      <div className="usage-metric-value">{formatCompact(props.value)}</div>
      <div className="usage-metric-note">{props.note}</div>
    </article>
  )
}

function DonutChart(props: { total: number; segments: UsageSegment[] }) {
  const radius = 46
  const stroke = 12
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="usage-donut-wrap">
      <svg className="usage-donut" viewBox="0 0 120 120" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="rgba(148, 163, 184, 0.14)"
          strokeWidth={stroke}
        />
        {props.total > 0
          ? props.segments.map((segment) => {
              const dash = (segment.value / props.total) * circumference
              const node = (
                <circle
                  key={segment.label}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              )
              offset += dash
              return node
            })
          : null}
      </svg>
      <div className="usage-donut-center">
        <strong>{formatCompact(props.total)}</strong>
        <span>总 tokens</span>
      </div>
    </div>
  )
}

function TrendChart(props: { buckets: TokenUsageBucket[] }) {
  if (props.buckets.length === 0) {
    return (
      <div className="usage-chart-card">
        <div className="usage-card-head">
          <div>
            <h3>近 14 天趋势</h3>
            <p>暂时还没有可用于统计的历史数据。</p>
          </div>
        </div>
      </div>
    )
  }

  const width = 420
  const height = 220
  const chartTop = 16
  const chartBottom = 176
  const chartHeight = chartBottom - chartTop
  const maxValue = Math.max(...props.buckets.map((bucket) => bucket.totalTokens), 1)
  const step = width / Math.max(props.buckets.length, 1)
  const barWidth = Math.max(12, step - 10)
  const guideValues = [1, 0.66, 0.33].map((ratio) => Math.round(maxValue * ratio))

  const heightFor = (value: number) => (value / maxValue) * chartHeight

  return (
    <div className="usage-chart-card">
      <div className="usage-card-head">
        <div>
          <h3>近 14 天趋势</h3>
          <p>按“用户输入 / 上下文开销 / AI 输出”堆叠展示。</p>
        </div>
      </div>
      <svg className="usage-trend-chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {guideValues.map((value, index) => {
          const y = chartBottom - (value / maxValue) * chartHeight
          return (
            <g key={value}>
              <line x1="0" y1={y} x2={width} y2={y} className="usage-trend-grid" />
              <text x="0" y={y - 6} className="usage-trend-guide">
                {index === 0 ? `峰值 ${formatCompact(value)}` : formatCompact(value)}
              </text>
            </g>
          )
        })}

        {props.buckets.map((bucket, index) => {
          const x = index * step + (step - barWidth) / 2
          const userHeight = heightFor(bucket.userTokens)
          const contextHeight = heightFor(bucket.contextTokens)
          const outputHeight = heightFor(bucket.outputTokens)
          const baseY = chartBottom
          const showLabel = index === 0 || index === props.buckets.length - 1 || index % 3 === 0

          return (
            <g key={bucket.date}>
              <rect
                x={x}
                y={baseY - userHeight}
                width={barWidth}
                height={Math.max(userHeight, bucket.userTokens > 0 ? 3 : 0)}
                rx="4"
                className="usage-bar-user"
              />
              <rect
                x={x}
                y={baseY - userHeight - contextHeight}
                width={barWidth}
                height={Math.max(contextHeight, bucket.contextTokens > 0 ? 3 : 0)}
                rx="4"
                className="usage-bar-context"
              />
              <rect
                x={x}
                y={baseY - userHeight - contextHeight - outputHeight}
                width={barWidth}
                height={Math.max(outputHeight, bucket.outputTokens > 0 ? 3 : 0)}
                rx="4"
                className="usage-bar-output"
              />
              {showLabel ? (
                <text
                  x={x + barWidth / 2}
                  y="204"
                  textAnchor="middle"
                  className="usage-trend-label"
                >
                  {bucket.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function BreakdownRow(props: {
  label: string
  value: number
  total: number
  note: string
  tone: 'current' | 'archived' | 'week' | 'month'
}) {
  return (
    <div className="usage-breakdown-row">
      <div className="usage-breakdown-copy">
        <strong>{props.label}</strong>
        <span>{props.note}</span>
      </div>
      <div className="usage-breakdown-bar">
        <div
          className={`usage-breakdown-fill ${props.tone}`}
          style={{
            width: `${props.total > 0 ? Math.max((props.value / props.total) * 100, props.value > 0 ? 4 : 0) : 0}%`,
          }}
        />
      </div>
      <div className="usage-breakdown-value">{formatCompact(props.value)}</div>
    </div>
  )
}

export default function TokenUsagePanel() {
  const [stats, setStats] = useState<TokenUsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const next = await AgentApi.getUsageStats()
        if (!cancelled) {
          setStats(next)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string }).message ?? 'Token 统计加载失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const next = await AgentApi.getUsageStats()
      setStats(next)
      setError('')
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Token 统计刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading && !stats) {
    return (
      <aside className="token-usage-panel">
        <div className="token-usage-loading">正在汇总聊天记录与压缩备份里的 token 数据...</div>
      </aside>
    )
  }

  if (!stats) {
    return (
      <aside className="token-usage-panel">
        <div className="usage-card">
          <div className="usage-card-head">
            <div>
              <h2>Token 可视化面板</h2>
              <p>这里会统计你和 Agent 的累计输入输出与上下文开销。</p>
            </div>
            <button className="chip ghost" type="button" onClick={() => void refresh()}>
              重试
            </button>
          </div>
          <div className="banner error">{error || '暂时无法读取 token 统计。'}</div>
        </div>
      </aside>
    )
  }

  const composition = getComposition(stats.totals)
  const comparisonMax = Math.max(
    stats.current.totalTokens,
    stats.archived.totalTokens,
    stats.recent7Days.totalTokens,
    stats.recent30Days.totalTokens,
    1,
  )
  const coverage =
    stats.totals.assistantMessages > 0
      ? Math.round((stats.totals.messagesWithUsage / stats.totals.assistantMessages) * 100)
      : 0

  return (
    <aside className="token-usage-panel">
      <div className="usage-card-head usage-panel-head">
        <div>
          <h2>Token 可视化面板</h2>
          <p>统计当前聊天、历史备份和近阶段的累计 token 使用情况。</p>
        </div>
        <button className="chip ghost" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? '刷新中...' : '刷新统计'}
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="usage-metric-grid">
        <MetricCard label="累计总量" value={stats.totals.totalTokens} note={formatExact(stats.totals.totalTokens)} />
        <MetricCard
          label="用户输入"
          value={stats.totals.userTokens}
          note={`覆盖 ${stats.totals.messagesWithUsage} 次回复记录`}
        />
        <MetricCard
          label="AI 输出"
          value={stats.totals.outputTokens}
          note={`${stats.totals.assistantMessages} 条 assistant 消息`}
        />
        <MetricCard
          label="上下文开销"
          value={stats.totals.contextTokens}
          note={`已覆盖 ${coverage}% 的回复统计`}
        />
      </div>

      <div className="usage-card usage-composition-card">
        <div className="usage-card-head">
          <div>
            <h3>Token 构成</h3>
            <p>把一次完整调用拆成用户输入、上下文开销和 AI 输出。</p>
          </div>
        </div>
        <div className="usage-composition-body">
          <DonutChart total={stats.totals.totalTokens} segments={composition} />
          <div className="usage-legend">
            {composition.map((segment) => {
              const share =
                stats.totals.totalTokens > 0
                  ? Math.round((segment.value / stats.totals.totalTokens) * 100)
                  : 0
              return (
                <div className="usage-legend-row" key={segment.label}>
                  <span className="usage-legend-swatch" style={{ background: segment.color }} />
                  <div className="usage-legend-copy">
                    <strong>{segment.label}</strong>
                    <span>{formatExact(segment.value)}</span>
                  </div>
                  <span className="usage-legend-share">{share}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <TrendChart buckets={stats.byDay} />

      <div className="usage-card">
        <div className="usage-card-head">
          <div>
            <h3>时间窗与来源拆分</h3>
            <p>区分当前聊天、历史归档，以及最近 7 / 30 天的 token 规模。</p>
          </div>
        </div>
        <div className="usage-breakdown-list">
          <BreakdownRow
            label="当前聊天"
            value={stats.current.totalTokens}
            total={comparisonMax}
            note={`${stats.current.messagesWithUsage} 次已记录回复`}
            tone="current"
          />
          <BreakdownRow
            label="历史归档"
            value={stats.archived.totalTokens}
            total={comparisonMax}
            note={`${stats.backupFiles} 个压缩备份文件`}
            tone="archived"
          />
          <BreakdownRow
            label="最近 7 天"
            value={stats.recent7Days.totalTokens}
            total={comparisonMax}
            note={`${stats.recent7Days.messagesWithUsage} 次已记录回复`}
            tone="week"
          />
          <BreakdownRow
            label="最近 30 天"
            value={stats.recent30Days.totalTokens}
            total={comparisonMax}
            note={`${stats.recent30Days.messagesWithUsage} 次已记录回复`}
            tone="month"
          />
        </div>
      </div>

      <div className="usage-card usage-meta-card">
        <div className="usage-card-head">
          <div>
            <h3>统计详情</h3>
            <p>帮助你判断统计覆盖范围，以及高峰出现在哪一天。</p>
          </div>
        </div>
        <div className="usage-meta-grid">
          <div>
            <span>首次记录</span>
            <strong>{formatTime(stats.firstMessageAt)}</strong>
          </div>
          <div>
            <span>最后活动</span>
            <strong>{formatTime(stats.lastMessageAt)}</strong>
          </div>
          <div>
            <span>活跃天数</span>
            <strong>{stats.daysActive || 0} 天</strong>
          </div>
          <div>
            <span>估算回复</span>
            <strong>{stats.totals.estimatedMessages} 条</strong>
          </div>
          <div>
            <span>峰值日期</span>
            <strong>
              {stats.peakDay ? `${stats.peakDay.label} / ${formatCompact(stats.peakDay.totalTokens)}` : '暂无'}
            </strong>
          </div>
          <div>
            <span>统计生成</span>
            <strong>{formatTime(stats.generatedAt)}</strong>
          </div>
        </div>
      </div>
    </aside>
  )
}
