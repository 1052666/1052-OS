import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MemoryApi, type MemorySummary } from '../api/memory'
import { IconMemory, IconRefresh } from './Icons'

function formatTime(value: number | null) {
  if (!value) return '暂无'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MemorySummaryPanel() {
  const [summary, setSummary] = useState<MemorySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const next = await MemoryApi.summary()
        if (!cancelled) {
          setSummary(next)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string }).message ?? '长期记忆摘要加载失败')
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
      const next = await MemoryApi.summary()
      setSummary(next)
      setError('')
    } catch (err) {
      setError((err as { message?: string }).message ?? '长期记忆摘要刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className={'usage-card memory-summary-panel' + (expanded ? ' expanded' : ' collapsed')}>
      <div className="usage-card-head">
        <div>
          <h3>长期记忆摘要</h3>
          <p>{expanded ? '查看 Agent 当前持久化的长期记忆、待确认建议和敏感记忆目录。' : '已折叠，仅保留计数摘要，展开后再渲染详细列表。'}</p>
        </div>
        <div className="memory-summary-actions">
          <button className="chip ghost" type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? '收起' : '展开'}
          </button>
          <button className="chip ghost" type="button" onClick={() => void refresh()} disabled={refreshing}>
            <IconRefresh size={14} /> {refreshing ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {!expanded ? (
        <div className="memory-summary-compact">
          {summary ? (
            <>
              <span>确认 {summary.counts.confirmed}</span>
              <span>启用 {summary.counts.active}</span>
              <span>待确认 {summary.counts.suggestions}</span>
              <span>敏感 {summary.counts.secure}</span>
            </>
          ) : loading ? (
            <span>正在读取摘要...</span>
          ) : (
            <span>暂无摘要</span>
          )}
        </div>
      ) : (
        <>
          {error ? <div className="banner error">{error}</div> : null}

          {loading && !summary ? (
            <div className="token-usage-loading">正在读取长期记忆摘要...</div>
          ) : summary ? (
            <>
          <div className="memory-summary-grid">
            <article className="memory-summary-stat">
              <span>已确认</span>
              <strong>{summary.counts.confirmed}</strong>
            </article>
            <article className="memory-summary-stat">
              <span>启用中</span>
              <strong>{summary.counts.active}</strong>
            </article>
            <article className="memory-summary-stat">
              <span>待确认</span>
              <strong>{summary.counts.suggestions}</strong>
            </article>
            <article className="memory-summary-stat">
              <span>敏感目录</span>
              <strong>{summary.counts.secure}</strong>
            </article>
          </div>

          <div className="memory-summary-note">
            <div>
              <span>普通画像文档</span>
              <strong>{formatTime(summary.profileUpdatedAt)}</strong>
            </div>
            <div>
              <span>敏感总览文档</span>
              <strong>{formatTime(summary.secureProfileUpdatedAt)}</strong>
            </div>
          </div>

          <div className="memory-summary-lists">
            <div className="memory-summary-block">
              <div className="memory-summary-title">最近更新的长期记忆</div>
              {summary.recent.length === 0 ? (
                <div className="memory-summary-empty">还没有已确认的长期记忆。</div>
              ) : (
                <div className="memory-summary-list">
                  {summary.recent.map((item) => (
                    <div key={item.id} className="memory-summary-item">
                      <div className="memory-summary-copy">
                        <strong>{item.title}</strong>
                        <span>{item.content}</span>
                      </div>
                      <div className="memory-summary-meta">{item.priority}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="memory-summary-block">
              <div className="memory-summary-title">敏感记忆目录</div>
              {summary.secure.length === 0 ? (
                <div className="memory-summary-empty">还没有敏感长期记忆。</div>
              ) : (
                <div className="memory-summary-list">
                  {summary.secure.map((item) => (
                    <div key={item.id} className="memory-summary-item">
                      <div className="memory-summary-copy">
                        <strong>{item.title}</strong>
                        <span>{item.mask || '(empty)'}</span>
                      </div>
                      <div className="memory-summary-meta">{item.type}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="memory-summary-links">
            <Link className="chip primary" to="/memory">
              <IconMemory size={14} /> 打开记忆中心
            </Link>
          </div>
            </>
          ) : (
            <div className="memory-summary-empty">暂时没有可显示的长期记忆摘要。</div>
          )}
        </>
      )}
    </section>
  )
}
