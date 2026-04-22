import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { UapisApi, type UapisApiItem, type UapisCatalog } from '../api/uapis'
import { IconChevron, IconRefresh, IconSearch, IconSparkle } from '../components/Icons'

const methodClass = (method: string) => method.toLowerCase()

export default function Toolbox() {
  const navigate = useNavigate()
  const { provider } = useParams()
  const [catalog, setCatalog] = useState<UapisCatalog | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedApi, setSelectedApi] = useState<UapisApiItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await UapisApi.catalog()
      setCatalog(next)
      setSelectedApi((current) => {
        if (current) return next.apis.find((item) => item.id === current.id) ?? next.apis[0] ?? null
        return next.apis[0] ?? null
      })
    } catch (error) {
      const err = error as { message?: string }
      setError(err.message ?? 'UAPIs 工具箱加载失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const categoryStats = useMemo(() => {
    if (!catalog) return []
    return catalog.categories.map((category) => {
      const apis = catalog.apis.filter((item) => item.categoryId === category.id)
      return {
        ...category,
        total: apis.length,
        enabled: apis.filter((item) => item.enabled).length,
      }
    })
  }, [catalog])

  const filteredApis = useMemo(() => {
    const source = catalog?.apis ?? []
    const keyword = query.trim().toLowerCase()
    return source.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false
      if (!keyword) return true
      return [item.id, item.name, item.description, item.path, item.categoryName]
        .join('\n')
        .toLowerCase()
        .includes(keyword)
    })
  }, [catalog, query, selectedCategory])

  const selectedCategoryName =
    selectedCategory === 'all'
      ? '全部接口'
      : categoryStats.find((category) => category.id === selectedCategory)?.name ?? '当前分类'

  const toggleApi = async (item: UapisApiItem) => {
    setSavingId(item.id)
    setError('')
    try {
      const updated = await UapisApi.setEnabled(item.id, !item.enabled)
      setCatalog((current) => {
        if (!current) return current
        const apis = current.apis.map((api) => (api.id === updated.id ? updated : api))
        const enabled = apis.filter((api) => api.enabled).length
        return {
          ...current,
          apis,
          counts: {
            ...current.counts,
            enabled,
            disabled: apis.length - enabled,
          },
        }
      })
      setSelectedApi((current) => (current?.id === updated.id ? updated : current))
    } catch (error) {
      const err = error as { message?: string }
      setError(err.message ?? '状态更新失败。')
    } finally {
      setSavingId('')
    }
  }

  const bulkToggle = async (enabled: boolean, categoryId?: string) => {
    setSavingId(enabled ? 'bulk-enable' : 'bulk-disable')
    setError('')
    try {
      const next = await UapisApi.bulkToggle(enabled, categoryId)
      setCatalog(next)
      setSelectedApi((current) => {
        if (!current) return next.apis[0] ?? null
        return next.apis.find((item) => item.id === current.id) ?? next.apis[0] ?? null
      })
    } catch (error) {
      const err = error as { message?: string }
      setError(err.message ?? '批量更新失败。')
    } finally {
      setSavingId('')
    }
  }

  if (provider !== 'uapis') {
    return (
      <div className="page toolbox-page">
        <header className="page-header">
          <div>
            <h1>工具箱</h1>
            <div className="muted">集中管理内置在线 API、能力扩展和后续可插拔工具。</div>
          </div>
        </header>

        <section className="toolbox-home-grid">
          <button className="toolbox-home-card" type="button" onClick={() => navigate('/toolbox/uapis')}>
            <div className="toolbox-home-icon">
              <IconSparkle size={24} />
            </div>
            <div>
              <span>Built-in API Suite</span>
              <strong>UAPIs 工具箱</strong>
              <p>
                将 UAPIs.cn 文档中的接口做成内置能力，支持前端启停、设置页可选 API Key，以及 Agent
                索引式调用。
              </p>
            </div>
            <IconChevron size={18} />
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="page toolbox-page">
      <header className="page-header toolbox-page-header">
        <div>
          <h1>UAPIs 工具箱</h1>
          <div className="muted">
            API Key 可选；不填写时使用免费 IP 额度，填写后后端才会自动携带 Bearer Key。
          </div>
        </div>
        <div className="toolbar">
          <button className="chip" onClick={() => void load()} disabled={loading} type="button">
            <IconRefresh size={14} />
            {loading ? '刷新中...' : '刷新'}
          </button>
          <button
            className="chip"
            type="button"
            disabled={!catalog || savingId !== ''}
            onClick={() => void bulkToggle(true, selectedCategory === 'all' ? undefined : selectedCategory)}
          >
            启用当前范围
          </button>
          <button
            className="chip ghost"
            type="button"
            disabled={!catalog || savingId !== ''}
            onClick={() => void bulkToggle(false, selectedCategory === 'all' ? undefined : selectedCategory)}
          >
            禁用当前范围
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {catalog && (
        <>
          <section className="toolbox-provider-panel">
            <div className="toolbox-provider-copy">
              <span>UapiPro / UAPIs.cn</span>
              <strong>
                {catalog.counts.enabled} 个已启用，{catalog.counts.disabled} 个已禁用
              </strong>
              <p>
                文档声明 {catalog.provider.declaredTotal} 个 API；当前文件中可解析到明确路径的接口为{' '}
                {catalog.provider.explicitTotal} 个。Agent 只会看到已启用接口的轻量索引。
              </p>
            </div>
            <div className="toolbox-quota-cards">
              <div>
                <span>模式</span>
                <strong>{catalog.provider.apiKeyMode === 'api-key' ? 'API Key' : '免费 IP'}</strong>
              </div>
              <div>
                <span>免费 IP / 月</span>
                <strong>{catalog.provider.freeQuota.anonymousMonthlyCredits}</strong>
              </div>
              <div>
                <span>Key / 月</span>
                <strong>{catalog.provider.freeQuota.apiKeyMonthlyCredits}</strong>
              </div>
            </div>
            <div className="toolbox-links">
              <a href={catalog.provider.home} target="_blank" rel="noreferrer">
                官网
              </a>
              <a href={catalog.provider.console} target="_blank" rel="noreferrer">
                控制台
              </a>
              <a href={catalog.provider.pricing} target="_blank" rel="noreferrer">
                价格
              </a>
              <a href={catalog.provider.status} target="_blank" rel="noreferrer">
                状态
              </a>
            </div>
          </section>

          <section className="toolbox-workbench">
            <div className="toolbox-category-panel">
              <div className="toolbox-panel-title">
                <span>分类</span>
                <strong>{catalog.categories.length}</strong>
              </div>
              <button
                className={'toolbox-category-chip' + (selectedCategory === 'all' ? ' active' : '')}
                type="button"
                onClick={() => setSelectedCategory('all')}
              >
                <span>全部接口</span>
                <em>
                  {catalog.counts.enabled}/{catalog.counts.total}
                </em>
              </button>
              <div className="toolbox-category-list">
                {categoryStats.map((category) => (
                  <button
                    className={'toolbox-category-chip' + (selectedCategory === category.id ? ' active' : '')}
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    <span>{category.name}</span>
                    <em>
                      {category.enabled}/{category.total}
                    </em>
                  </button>
                ))}
              </div>
            </div>

            <div className="uapis-browser">
              <section className="toolbox-filterbar">
                <label className="toolbox-search">
                  <IconSearch size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 API 名称、路径、描述或分类"
                  />
                </label>
                <div className="toolbox-result-meta">
                  <strong>{filteredApis.length}</strong>
                  <span>{selectedCategoryName}</span>
                </div>
              </section>

              <section className="uapis-layout">
                <div className="uapis-list" aria-label="UAPIs 接口列表">
                  {filteredApis.map((item) => (
                    <article
                      className={
                        'uapis-row' +
                        (item.enabled ? '' : ' disabled') +
                        (selectedApi?.id === item.id ? ' active' : '')
                      }
                      key={item.id}
                    >
                      <button className="uapis-row-main" type="button" onClick={() => setSelectedApi(item)}>
                        <span className={'uapis-method ' + methodClass(item.method)}>{item.method}</span>
                        <span className="uapis-row-text">
                          <strong>{item.name}</strong>
                          <p>{item.description || '暂无描述'}</p>
                          <code>{item.path}</code>
                        </span>
                        <span className="uapis-category">{item.categoryName}</span>
                      </button>
                      <div className="uapis-row-actions">
                        <span className={item.enabled ? 'uapis-state on' : 'uapis-state'}>
                          {item.enabled ? '已启用' : '已禁用'}
                        </span>
                        <button
                          className={'switch' + (item.enabled ? ' on' : '')}
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void toggleApi(item)}
                          aria-label={item.enabled ? '禁用 API' : '启用 API'}
                        >
                          <span className="switch-thumb" />
                        </button>
                      </div>
                    </article>
                  ))}
                  {filteredApis.length === 0 && (
                    <div className="uapis-list-empty">
                      <strong>没有匹配的接口</strong>
                      <p>尝试切换分类，或减少搜索关键词。</p>
                    </div>
                  )}
                </div>

                <aside className="uapis-detail">
                  {selectedApi ? (
                    <>
                      <div className="uapis-detail-head">
                        <div>
                          <span>{selectedApi.categoryName}</span>
                          <h2>{selectedApi.name}</h2>
                        </div>
                        <span className={'uapis-method ' + methodClass(selectedApi.method)}>
                          {selectedApi.method}
                        </span>
                      </div>
                      <p>{selectedApi.description || '暂无描述'}</p>
                      <code className="uapis-detail-path">{selectedApi.path}</code>
                      <div className="uapis-detail-actions">
                        <span>{selectedApi.enabled ? '已注入 Agent 索引' : '未注入 Agent 索引'}</span>
                        <button
                          className={'switch' + (selectedApi.enabled ? ' on' : '')}
                          type="button"
                          disabled={savingId === selectedApi.id}
                          onClick={() => void toggleApi(selectedApi)}
                        >
                          <span className="switch-thumb" />
                        </button>
                      </div>
                      {selectedApi.params.length > 0 && (
                        <div className="uapis-param-list">
                          <strong>参数</strong>
                          {selectedApi.params.map((param) => (
                            <div key={param.name}>
                              <code>{param.name}</code>
                              <span>{param.type}</span>
                              <span>{param.required ? '必填' : '可选'}</span>
                              <p>{param.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedApi.bodyExample && (
                        <pre className="uapis-doc-block">{selectedApi.bodyExample}</pre>
                      )}
                      <details className="uapis-doc-details">
                        <summary>查看原始文档片段</summary>
                        <pre>{selectedApi.documentation}</pre>
                      </details>
                    </>
                  ) : (
                    <div className="uapis-empty-detail">
                      <strong>选择一个 API</strong>
                      <p>点击左侧接口即可查看参数、原始文档片段，并单独启用或禁用。</p>
                    </div>
                  )}
                </aside>
              </section>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
