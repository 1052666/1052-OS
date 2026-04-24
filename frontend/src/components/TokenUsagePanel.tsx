import { useEffect, useState } from 'react'
import {
  AgentApi,
  type TokenUsageAggregate,
  type TokenUsageStats,
} from '../api/agent'

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)} 万`
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

function MetricCard(props: { label: string; value: number; note: string }) {
  return (
    <article className="usage-metric-card">
      <div className="usage-metric-label">{props.label}</div>
      <div className="usage-metric-value">{formatCompact(props.value)}</div>
      <div className="usage-metric-note">{props.note}</div>
    </article>
  )
}

function AggregateRow(props: {
  label: string
  value: TokenUsageAggregate
}) {
  return (
    <div className="usage-breakdown-row">
      <div className="usage-breakdown-copy">
        <strong>{props.label}</strong>
        <span>
          输入 {formatCompact(props.value.inputTokens)} / 输出 {formatCompact(props.value.outputTokens)} /
          总计 {formatCompact(props.value.totalTokens)}
        </span>
      </div>
      <div className="usage-breakdown-bar">
        <div
          className="usage-breakdown-fill current"
          style={{
            width: `${Math.min(
              100,
              Math.max(
                props.value.totalTokens > 0 ? (props.value.outputTokens / props.value.totalTokens) * 100 : 0,
                props.value.outputTokens > 0 ? 4 : 0,
              ),
            )}%`,
          }}
        />
      </div>
      <div className="usage-breakdown-value">{formatCompact(props.value.totalTokens)}</div>
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
        if (!cancelled) setLoading(false)
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
        <div className="token-usage-loading">正在汇总聊天、备份和压缩历史中的 token 数据...</div>
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
              <p>用于观察当前聊天、历史归档和内部升级动作的 token 规模。</p>
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

  const coverage =
    stats.totals.assistantMessages > 0
      ? Math.round((stats.totals.messagesWithUsage / stats.totals.assistantMessages) * 100)
      : 0

  return (
    <aside className="token-usage-panel">
      <div className="usage-card-head usage-panel-head">
        <div>
          <h2>Token 可视化面板</h2>
          <p>重点观察总量、上下文开销、cache 命中和升级动作额外成本。</p>
        </div>
        <button className="chip ghost" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? '刷新中...' : '刷新统计'}
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="usage-metric-grid">
        <MetricCard label="累计总量" value={stats.totals.totalTokens} note={formatExact(stats.totals.totalTokens)} />
        <MetricCard label="用户输入" value={stats.totals.userTokens} note={`覆盖率 ${coverage}%`} />
        <MetricCard label="AI 输出" value={stats.totals.outputTokens} note={formatExact(stats.totals.outputTokens)} />
        <MetricCard label="上下文开销" value={stats.totals.contextTokens} note={formatExact(stats.totals.contextTokens)} />
      </div>

      <div className="usage-card">
        <div className="usage-card-head">
          <div>
            <h3>Cache 与升级开销</h3>
            <p>这里单独拆出 provider cache 与 `request_context_upgrade` 造成的额外 token。</p>
          </div>
        </div>
        <div className="usage-metric-grid">
          <MetricCard label="Cache Read" value={stats.totals.cacheReadTokens} note={formatExact(stats.totals.cacheReadTokens)} />
          <MetricCard label="Cache Write" value={stats.totals.cacheWriteTokens} note={formatExact(stats.totals.cacheWriteTokens)} />
          <MetricCard
            label="Upgrade Overhead"
            value={stats.totals.upgradeOverheadTotalTokens}
            note={formatExact(stats.totals.upgradeOverheadTotalTokens)}
          />
          <MetricCard
            label="有 Usage 的回复"
            value={stats.totals.messagesWithUsage}
            note={`${stats.totals.assistantMessages} 条 assistant 消息`}
          />
        </div>
      </div>

      <div className="usage-card">
        <div className="usage-card-head">
          <div>
            <h3>来源与时间窗口</h3>
            <p>区分当前聊天、历史归档和最近时间窗口的 token 规模。</p>
          </div>
        </div>
        <div className="usage-breakdown-list">
          <AggregateRow label="当前聊天" value={stats.current} />
          <AggregateRow label="历史归档" value={stats.archived} />
          <AggregateRow label="最近 7 天" value={stats.recent7Days} />
          <AggregateRow label="最近 30 天" value={stats.recent30Days} />
        </div>
      </div>

      <div className="usage-card">
        <div className="usage-card-head">
          <div>
            <h3>统计摘要</h3>
            <p>快速查看历史覆盖范围和最近活跃情况。</p>
          </div>
        </div>
        <div className="usage-breakdown-list">
          <div className="usage-breakdown-row">
            <div className="usage-breakdown-copy">
              <strong>首条消息</strong>
              <span>{formatTime(stats.firstMessageAt)}</span>
            </div>
            <div className="usage-breakdown-value">{stats.daysActive} 天</div>
          </div>
          <div className="usage-breakdown-row">
            <div className="usage-breakdown-copy">
              <strong>最后活跃</strong>
              <span>{formatTime(stats.lastMessageAt)}</span>
            </div>
            <div className="usage-breakdown-value">{stats.backupFiles} 个备份</div>
          </div>
          <div className="usage-breakdown-row">
            <div className="usage-breakdown-copy">
              <strong>Peak Day</strong>
              <span>{stats.peakDay ? `${stats.peakDay.label} · ${formatExact(stats.peakDay.totalTokens)}` : '暂无'}</span>
            </div>
            <div className="usage-breakdown-value">{formatTime(stats.generatedAt)}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
