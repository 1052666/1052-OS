import { useEffect, useMemo, useState } from 'react'
import { WebsearchApi, type SearchSourceGroup, type SearchSourceInfo } from '../api/websearch'
import { IconRefresh } from '../components/Icons'

const FAMILY_LABELS: Record<SearchSourceInfo['family'], string> = {
  'web-search': '联网搜索',
  'skill-marketplace': 'Skill 市场',
  uapis: 'UAPIs',
}

const KIND_LABELS: Record<SearchSourceInfo['kind'], string> = {
  engine: '搜索引擎',
  marketplace: '市场目录',
  repository: '仓库来源',
  api: '在线 API',
}

const REGION_LABELS: Record<NonNullable<SearchSourceInfo['region']>, string> = {
  cn: '中文友好',
  global: '国际通用',
  shared: '通用来源',
}

const STATUS_LABELS: Record<SearchSourceInfo['status'], string> = {
  stable: '可用',
  needs_work: '待补强',
  pass: '已停用',
}

const STATUS_CLASSNAMES: Record<SearchSourceInfo['status'], string> = {
  stable: 'stable',
  needs_work: 'needs-work',
  pass: 'pass',
}

const INTENT_LABELS: Record<string, string> = {
  general: '通用检索',
  development: '开发内容',
  news: '新闻资讯',
  wechat: '微信内容',
  privacy: '隐私导向',
  knowledge: '知识检索',
  academic: '学术内容',
  skills: 'Skill 搜索',
  marketplace: '市场搜索',
  discovery: '能力发现',
  preview: '预览来源',
  install: '安装来源',
  uapis: 'UAPIs',
  search: '搜索接口',
  aggregate: '聚合搜索',
}

function buildTags(source: SearchSourceInfo) {
  const tags = [
    FAMILY_LABELS[source.family],
    KIND_LABELS[source.kind],
    source.region ? REGION_LABELS[source.region] : null,
    source.supportsTime ? '支持时间过滤' : null,
    ...source.intents.map((intent) => INTENT_LABELS[intent] ?? intent),
    ...source.tags,
  ].filter((tag): tag is string => Boolean(tag))

  return Array.from(new Set(tags)).slice(0, 9)
}

export default function SearchSources() {
  const [sourceGroups, setSourceGroups] = useState<SearchSourceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await WebsearchApi.listSources()
      setSourceGroups(data.sourceGroups ?? [])
    } catch (error) {
      const err = error as { message?: string }
      setError(err.message ?? '加载搜索源状态失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleSource = async (source: SearchSourceInfo) => {
    const key = `${source.family}:${source.id}`
    setSavingKey(key)
    setError('')
    try {
      const data = await WebsearchApi.setSourceEnabled(source.family, source.id, !source.enabled)
      setSourceGroups(data.sourceGroups ?? [])
    } catch (error) {
      const err = error as { message?: string }
      setError(err.message ?? '搜索源状态更新失败。')
    } finally {
      setSavingKey('')
    }
  }

  const allSources = useMemo(() => sourceGroups.flatMap((group) => group.items), [sourceGroups])
  const counts = useMemo(() => {
    const webSources = allSources.filter((source) => source.family === 'web-search')
    const skillSources = allSources.filter((source) => source.family === 'skill-marketplace')
    const uapisSources = allSources.filter((source) => source.family === 'uapis')
    return {
      total: allSources.length,
      enabled: allSources.filter((source) => source.enabled).length,
      web: webSources.length,
      cn: webSources.filter((source) => source.region === 'cn').length,
      marketplace: skillSources.length,
      uapis: uapisSources.length,
    }
  }, [allSources])

  return (
    <div className="page search-sources-page">
      <header className="page-header">
        <div>
          <h1>搜索源状态</h1>
          <div className="muted">
            这里统一管理联网搜索源、Skill 市场来源和 UAPIs 搜索接口。禁用后，Agent 后续不会再调用对应来源。
          </div>
        </div>
        <div className="toolbar">
          <button className="chip" onClick={() => void load()} disabled={loading} type="button">
            <IconRefresh size={14} />
            {loading ? '刷新中...' : '刷新状态'}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="search-sources-summary">
        <div className="search-status-card stable">
          <span>已接入来源</span>
          <strong>{counts.total}</strong>
        </div>
        <div className="search-status-card stable">
          <span>当前启用</span>
          <strong>{counts.enabled}</strong>
        </div>
        <div className="search-status-card neutral">
          <span>联网搜索引擎</span>
          <strong>{counts.web}</strong>
        </div>
        <div className="search-status-card neutral">
          <span>Skill / UAPIs</span>
          <strong>{counts.marketplace + counts.uapis}</strong>
        </div>
      </section>

      <section className="search-source-groups">
        {sourceGroups.map((group) => (
          <section className="search-group" key={group.id}>
            <div className="search-group-head">
              <div>
                <h2>{group.title}</h2>
                <p>{group.description}</p>
              </div>
              <span className="search-status-pill stable">{group.items.length} 项</span>
            </div>

            {group.items.length === 0 ? (
              <div className="search-empty">当前分组下还没有可展示的来源。</div>
            ) : (
              <div className="search-source-grid">
                {group.items.map((source) => {
                  const tags = buildTags(source)
                  const saveKey = `${source.family}:${source.id}`
                  const busy = savingKey === saveKey
                  return (
                    <article
                      className={'search-source-card' + (source.enabled ? '' : ' disabled')}
                      key={saveKey}
                    >
                      <div className="search-source-meta">
                        <div>
                          <h3>{source.name}</h3>
                          <div className="search-source-id">{source.id}</div>
                        </div>
                        <span className={`search-status-pill ${STATUS_CLASSNAMES[source.status]}`}>
                          {STATUS_LABELS[source.status]}
                        </span>
                      </div>

                      <div className="search-source-controls">
                        <div className={'search-source-enabled' + (source.enabled ? ' on' : '')}>
                          {source.enabled ? '已启用' : '已禁用'}
                        </div>
                        <button
                          className={'switch' + (source.enabled ? ' on' : '')}
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleSource(source)}
                          aria-label={source.enabled ? '禁用搜索源' : '启用搜索源'}
                        >
                          <span className="switch-thumb" />
                        </button>
                      </div>

                      <div className="search-source-tags">
                        {tags.map((tag) => (
                          <span key={`${source.id}:${tag}`}>{tag}</span>
                        ))}
                      </div>

                      <p className="search-source-reason">
                        {source.statusReason || '当前未记录额外限制，已作为可用来源纳入系统。'}
                      </p>

                      <div className="search-source-link-row">
                        <a
                          className="skill-btn subtle search-source-link"
                          href={source.homepage}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开来源主页
                        </a>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </section>
    </div>
  )
}
