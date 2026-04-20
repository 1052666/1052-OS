import { useEffect, useMemo, useState } from 'react'
import { WebsearchApi, type SearchSourceGroup, type SearchSourceInfo } from '../api/websearch'
import { IconRefresh } from '../components/Icons'

const FAMILY_LABELS: Record<SearchSourceInfo['family'], string> = {
  'web-search': '联网搜索',
  'skill-marketplace': 'Skill 生态',
}

const KIND_LABELS: Record<SearchSourceInfo['kind'], string> = {
  engine: '搜索引擎',
  marketplace: '市场目录',
  repository: '仓库归档',
}

const REGION_LABELS: Record<NonNullable<SearchSourceInfo['region']>, string> = {
  cn: '中文友好',
  global: '国际通用',
  shared: '通用来源',
}

const STATUS_LABELS: Record<SearchSourceInfo['status'], string> = {
  stable: '可用',
  needs_work: '待补强',
  pass: '已跳过',
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
  skills: 'Skill 检索',
  marketplace: '市场搜索',
  discovery: '发现能力包',
  preview: '文件预览',
  install: '安装来源',
}

function buildTags(source: SearchSourceInfo) {
  const tags = [
    FAMILY_LABELS[source.family],
    KIND_LABELS[source.kind],
    source.region ? REGION_LABELS[source.region] : null,
    source.supportsTime ? '支持时间筛选' : null,
    ...source.intents.map((intent) => INTENT_LABELS[intent] ?? intent),
    ...source.tags,
  ].filter((tag): tag is string => Boolean(tag))

  return Array.from(new Set(tags)).slice(0, 9)
}

export default function SearchSources() {
  const [sourceGroups, setSourceGroups] = useState<SearchSourceGroup[]>([])
  const [loading, setLoading] = useState(true)
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

  const allSources = useMemo(() => sourceGroups.flatMap((group) => group.items), [sourceGroups])
  const counts = useMemo(() => {
    const webSources = allSources.filter((source) => source.family === 'web-search')
    const skillSources = allSources.filter((source) => source.family === 'skill-marketplace')
    return {
      total: allSources.length,
      web: webSources.length,
      cn: webSources.filter((source) => source.region === 'cn').length,
      marketplace: skillSources.length,
    }
  }, [allSources])

  return (
    <div className="page search-sources-page">
      <header className="page-header">
        <div>
          <h1>搜索源状态</h1>
          <div className="muted">
            这里统一展示当前已接入的联网搜索来源与 Skill 市场来源。后续后端新增来源分组后，也会自动出现在这块面板里。
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
        <div className="search-status-card neutral">
          <span>联网搜索引擎</span>
          <strong>{counts.web}</strong>
        </div>
        <div className="search-status-card neutral">
          <span>中文友好搜索</span>
          <strong>{counts.cn}</strong>
        </div>
        <div className="search-status-card neutral">
          <span>Skill 市场来源</span>
          <strong>{counts.marketplace}</strong>
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
                  return (
                    <article className="search-source-card" key={`${group.id}:${source.id}`}>
                      <div className="search-source-meta">
                        <div>
                          <h3>{source.name}</h3>
                          <div className="search-source-id">{source.id}</div>
                        </div>
                        <span className={`search-status-pill ${STATUS_CLASSNAMES[source.status]}`}>
                          {STATUS_LABELS[source.status]}
                        </span>
                      </div>

                      <div className="search-source-tags">
                        {tags.map((tag) => (
                          <span key={`${source.id}:${tag}`}>{tag}</span>
                        ))}
                      </div>

                      <p className="search-source-reason">
                        {source.statusReason || '当前未记录额外限制，已作为稳定来源纳入系统。'}
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
