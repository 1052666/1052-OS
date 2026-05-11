import { useCallback, useEffect, useState } from 'react'
import { AgentApi, type TokenUsageStats } from '../api/agent'

export interface UseTokenUsageReturn {
  stats: TokenUsageStats | null
  loading: boolean
  refreshing: boolean
  error: string
  refresh: () => Promise<void>
}

/**
 * Encapsulates `/agent/stats/usage` fetching + refresh, used by:
 *  - classic `TokenUsagePanel`
 *  - mirror right column (IU-11)
 *
 * Re-implements the same lifecycle as the original inline state in
 * TokenUsagePanel.tsx so both UIs can share the data source.
 */
export function useTokenUsage(): UseTokenUsageReturn {
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

  const refresh = useCallback(async () => {
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
  }, [])

  return { stats, loading, refreshing, error, refresh }
}
