import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SkillsApi, type BundledSkillUpdateStatus, type SkillDetail } from '../api/skills'
import { UapisApi, type UapisApiItem, type UapisCatalog } from '../api/uapis'
import Markdown from '../components/Markdown'
import {
  IconChevron,
  IconRefresh,
  IconSearch,
  IconSearchGrid,
  IconSkills,
  IconSparkle,
} from '../components/Icons'

const methodClass = (method: string) => method.toLowerCase()
const INTEL_SKILL_ID = 'intel-center'

const intelSectors = [
  { label: 'Politics', text: '地缘政治、制裁、战争、外交和政策冲击。' },
  { label: 'Finance', text: '市场、利率、通胀、加密资产和跨市场风险信号。' },
  { label: 'Tech', text: 'AI、芯片、网络安全、能源技术和科技监管。' },
]

const intelSources = [
  'Google News RSS',
  'Yahoo Finance',
  'RSS feeds',
  'Hacker News',
  'Search engines',
  'A/H market optional',
  'Tencent News registered',
]

export default function Toolbox() {
  const navigate = useNavigate()
  const { provider } = useParams()
  const [catalog, setCatalog] = useState<UapisCatalog | null>(null)
  const [intelSkill, setIntelSkill] = useState<SkillDetail | null>(null)
  const [bundledSkillUpdates, setBundledSkillUpdates] = useState<BundledSkillUpdateStatus[]>([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedApi, setSelectedApi] = useState<UapisApiItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [intelLoading, setIntelLoading] = useState(true)
  const [intelApplyingUpdate, setIntelApplyingUpdate] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [intelError, setIntelError] = useState('')

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
    if (provider === 'uapis') void load()
  }, [provider])

  const loadIntelSkill = async () => {
    setIntelLoading(true)
    setIntelError('')
    try {
      const [skill, updates] = await Promise.all([
        SkillsApi.read(INTEL_SKILL_ID),
        SkillsApi.listBundledUpdates(),
      ])
      setIntelSkill(skill)
      setBundledSkillUpdates(updates)
    } catch (error) {
      const err = error as { message?: string }
      setIntelError(err.message ?? 'Intel Center 加载失败。')
    } finally {
      setIntelLoading(false)
    }
  }

  useEffect(() => {
    if (provider === 'intel') void loadIntelSkill()
  }, [provider])

  const intelUpdate = bundledSkillUpdates.find((item) => item.id === INTEL_SKILL_ID)

  const applyIntelBundledUpdate = async () => {
    if (!intelUpdate?.updateAvailable && !intelUpdate?.localModified) return
    const confirmed = window.confirm(
      intelUpdate.localModified
        ? '检测到本地 Intel Center Skill 有修改。应用内置更新会先备份当前版本再覆盖，是否继续？'
        : '应用最新内置 Intel Center Skill？',
    )
    if (!confirmed) return

    setIntelApplyingUpdate(true)
    setIntelError('')
    try {
      await SkillsApi.applyBundledUpdate(INTEL_SKILL_ID)
      await loadIntelSkill()
    } catch (error) {
      const err = error as { message?: string }
      setIntelError(err.message ?? 'Intel Center 更新失败。')
    } finally {
      setIntelApplyingUpdate(false)
    }
  }

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

  if (provider === 'intel') {
    return (
      <div className="page toolbox-page">
        <header className="page-header toolbox-page-header">
          <div>
            <h1>Intel Center</h1>
            <div className="muted">三部门情报采集、市场异常检测和跨部门传导链分析。</div>
          </div>
          <div className="toolbar">
            <button className="chip" onClick={() => void loadIntelSkill()} disabled={intelLoading} type="button">
              <IconRefresh size={14} />
              {intelLoading ? '刷新中...' : '刷新'}
            </button>
            <button className="chip ghost" onClick={() => navigate('/skills')} type="button">
              <IconSkills size={14} />
              Skill 中心
            </button>
          </div>
        </header>

        {intelError && <div className="banner error">{intelError}</div>}

        {intelLoading && !intelSkill ? (
          <div className="uapis-list-empty">
            <strong>正在读取 Intel Center</strong>
            <p>启动后内置 Skill 会自动安装到本地 Skill 目录。</p>
          </div>
        ) : intelSkill ? (
          <>
            <section className="toolbox-provider-panel intel-provider-panel">
              <div className="toolbox-provider-copy">
                <span>{intelSkill.enabled ? 'Enabled Skill' : 'Disabled Skill'}</span>
                <strong>{intelSkill.name}</strong>
                <p>{intelSkill.description}</p>
              </div>
              <div className="toolbox-quota-cards">
                <div>
                  <span>部门</span>
                  <strong>3</strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>{intelSources.length}</strong>
                </div>
                <div>
                  <span>脚本</span>
                  <strong>{intelSkill.scripts.length}</strong>
                </div>
              </div>
              <div className="toolbox-links">
                <button className="chip" type="button" onClick={() => navigate('/skills')}>
                  查看 Skill
                </button>
                <code>python3 scripts/intel.py 2&gt;&amp;1</code>
              </div>
            </section>

            {intelUpdate && (
              <section
                className={
                  'intel-update-panel' +
                  (intelUpdate.updateAvailable ? ' update-available' : '') +
                  (intelUpdate.localModified ? ' local-modified' : '')
                }
              >
                <div>
                  <span>内置 Skill 热更新</span>
                  <strong>
                    {intelUpdate.updateAvailable
                      ? '有新版本'
                      : intelUpdate.localModified
                        ? '本地已修改'
                        : '已同步'}
                  </strong>
                  <p>
                    {intelUpdate.updateAvailable
                      ? intelUpdate.localModified
                        ? '仓库内置版本已更新，但本地 Skill 有改动；应用时会先备份当前版本。'
                        : '仓库内置版本已更新，可以应用到本地 Skill。'
                      : intelUpdate.localModified
                        ? '本地版本和上次安装记录不同；如需回到内置版本，可以手动应用更新。'
                        : '本地 Intel Center Skill 已和当前内置版本一致。'}
                  </p>
                </div>
                <div className="intel-update-actions">
                  <code>{intelUpdate.sourceHash.slice(0, 12)}</code>
                  <button
                    className="chip primary"
                    type="button"
                    disabled={intelApplyingUpdate || (!intelUpdate.updateAvailable && !intelUpdate.localModified)}
                    onClick={() => void applyIntelBundledUpdate()}
                  >
                    {intelApplyingUpdate ? '应用中...' : '应用内置版本'}
                  </button>
                </div>
              </section>
            )}

            <section className="intel-workbench">
              <div className="intel-sector-grid">
                {intelSectors.map((sector) => (
                  <article className="intel-sector-card" key={sector.label}>
                    <div className="toolbox-home-icon">
                      <IconSearchGrid size={22} />
                    </div>
                    <div>
                      <span>{sector.label}</span>
                      <p>{sector.text}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="intel-detail-grid">
                <section className="intel-panel">
                  <div className="toolbox-panel-title">
                    <span>采集来源</span>
                    <strong>{intelSources.length}</strong>
                  </div>
                  <div className="intel-source-list">
                    {intelSources.map((source) => (
                      <span key={source}>{source}</span>
                    ))}
                  </div>
                </section>

                <section className="intel-panel">
                  <div className="toolbox-panel-title">
                    <span>运行资产</span>
                    <strong>{intelSkill.enabled ? '可用' : '停用'}</strong>
                  </div>
                  <div className="intel-asset-list">
                    <div>
                      <span>Skill ID</span>
                      <code>{intelSkill.id}</code>
                    </div>
                    <div>
                      <span>本地路径</span>
                      <code>{intelSkill.path}</code>
                    </div>
                    <div>
                      <span>更新时间</span>
                      <code>{new Date(intelSkill.updatedAt).toLocaleString('zh-CN', { hour12: false })}</code>
                    </div>
                  </div>
                </section>
              </div>

              <section className="intel-panel">
                <div className="toolbox-panel-title">
                  <span>Skill 说明</span>
                  <strong>SKILL.md</strong>
                </div>
                <div className="skill-markdown intel-skill-markdown">
                  <Markdown text={intelSkill.body} />
                </div>
              </section>
            </section>
          </>
        ) : null}
      </div>
    )
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

          <button className="toolbox-home-card" type="button" onClick={() => navigate('/toolbox/intel')}>
            <div className="toolbox-home-icon">
              <IconSearchGrid size={24} />
            </div>
            <div>
              <span>Built-in Skill</span>
              <strong>Intel Center</strong>
              <p>
                把内置情报采集 Skill 放进工具箱：按 Politics / Finance / Tech
                三部门收集信号，并用于跨部门传导链分析。
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
