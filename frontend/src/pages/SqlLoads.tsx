import { useEffect, useState } from 'react'
import { SqlApi, type DataSource } from '../api/sql'
import { OrchestrationApi, type Orchestration } from '../api/orchestration'

export default function SqlLoads() {
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  const [datasources, setDatasources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [orchs, ds] = await Promise.all([
        OrchestrationApi.list(),
        SqlApi.listDataSources(),
      ])
      setOrchestrations(orchs)
      setDatasources(ds)
    } catch {
      setError('加载数据失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const loadOrchestrations = orchestrations.filter(o =>
    o.nodes.some(n => n.type === 'load')
  )

  const getDsName = (id: string) => datasources.find(d => d.id === id)?.name ?? '未知'

  if (loading) return <div className="page"><p>加载中...</p></div>

  return (
    <div className="page">
      <div className="orch-page-header">
        <h1>加载任务</h1>
      </div>

      {error && <div className="orch-error">{error}</div>}

      {loadOrchestrations.length === 0 ? (
        <div className="sql-var-empty card">
          <p>暂无加载任务</p>
          <p style={{ fontSize: 13, opacity: 0.6, marginTop: 8 }}>
            在「编排」页面中添加「加载」节点来创建跨数据源数据传输任务
          </p>
        </div>
      ) : (
        <div className="orch-list">
          {loadOrchestrations.map(orch => {
            const loadNodes = orch.nodes.filter(n => n.type === 'load')
            return (
              <div key={orch.id} className="orch-card card">
                <div className="orch-card-header">
                  <h3>{orch.name}</h3>
                  <span className="orch-node-count">{loadNodes.length} 加载节点</span>
                </div>
                {orch.description && <p className="orch-card-desc">{orch.description}</p>}
                <div className="orch-card-nodes">
                  {loadNodes.map(node => (
                    <span key={node.id} className="orch-mini-node load">
                      {node.name}: {getDsName(node.datasourceId)} → {getDsName(node.targetDatasourceId ?? '')}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
