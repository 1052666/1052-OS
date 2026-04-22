import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OrchestrationApi } from '../api/orchestration'
import { SqlApi } from '../api/sql'
import {
  IconChevron,
  IconDatabase,
  IconLoad,
  IconOrchestration,
  IconServer,
  IconShell,
  IconSqlFile,
  IconVariable,
} from '../components/Icons'

type WorkbenchStats = {
  datasources: number
  files: number
  variables: number
  orchestrations: number
  loads: number
  servers: number
  shellFiles: number
}

const MODULES = [
  {
    to: '/sql/datasources',
    title: 'SQL 数据源',
    kicker: 'Connections',
    description:
      '管理 MySQL、Oracle、SQLite、Hive 等连接配置，测试连通性并提供给 Agent 使用。',
    Icon: IconDatabase,
    statKey: 'datasources' as const,
    statLabel: '个数据源',
  },
  {
    to: '/sql/files',
    title: 'SQL 文件',
    kicker: 'Query Files',
    description: '保存常用查询脚本，绑定数据源后可直接编辑、运行和查看结果。',
    Icon: IconSqlFile,
    statKey: 'files' as const,
    statLabel: '个文件',
  },
  {
    to: '/sql/variables',
    title: 'SQL 变量',
    kicker: 'Variables',
    description:
      '维护静态变量和 SQL 动态变量，用于复用日期、分区、业务参数等内容。',
    Icon: IconVariable,
    statKey: 'variables' as const,
    statLabel: '个变量',
  },
  {
    to: '/sql/orchestration',
    title: 'SQL 编排',
    kicker: 'Flow Engine',
    description:
      '通过可视化流程把 SQL、Debug、Load、Wait 节点串起来，形成可执行任务链。',
    Icon: IconOrchestration,
    statKey: 'orchestrations' as const,
    statLabel: '个流程',
  },
  {
    to: '/sql/loads',
    title: '加载任务',
    kicker: 'Load Jobs',
    description: '查看编排中的跨数据源加载节点，适合沉淀数据同步和批处理任务。',
    Icon: IconLoad,
    statKey: 'loads' as const,
    statLabel: '个加载任务',
  },
  {
    to: '/sql/servers',
    title: '服务器',
    kicker: 'Servers',
    description: '管理 SSH 远程服务器连接配置，支持密码和密钥认证。',
    Icon: IconServer,
    statKey: 'servers' as const,
    statLabel: '台服务器',
  },
  {
    to: '/sql/shell-files',
    title: 'Shell 脚本',
    kicker: 'Scripts',
    description: '编写和管理 Shell 脚本，指定目标服务器执行命令。',
    Icon: IconShell,
    statKey: 'shellFiles' as const,
    statLabel: '个脚本',
  },
]

export default function SqlWorkbench() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<WorkbenchStats>({
    datasources: 0,
    files: 0,
    variables: 0,
    orchestrations: 0,
    loads: 0,
    servers: 0,
    shellFiles: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      SqlApi.listDataSources(),
      SqlApi.listSqlFiles(),
      SqlApi.listVariables(),
      OrchestrationApi.list(),
      SqlApi.listServers(),
      SqlApi.listShellFiles(),
    ])
      .then(([datasources, files, variables, orchestrations, serversResp, shellFilesResp]) => {
        if (cancelled) return
        const orchestrationItems =
          orchestrations.status === 'fulfilled' ? orchestrations.value : []
        setStats({
          datasources: datasources.status === 'fulfilled' ? datasources.value.length : 0,
          files: files.status === 'fulfilled' ? files.value.length : 0,
          variables: variables.status === 'fulfilled' ? variables.value.length : 0,
          orchestrations: orchestrationItems.length,
          loads: orchestrationItems.filter((item) =>
            item.nodes.some((node) => node.type === 'load'),
          ).length,
          servers: serversResp.status === 'fulfilled' ? serversResp.value.length : 0,
          shellFiles: shellFilesResp.status === 'fulfilled' ? shellFilesResp.value.length : 0,
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const total = useMemo(
    () =>
      stats.datasources +
      stats.files +
      stats.variables +
      stats.orchestrations +
      stats.loads +
      stats.servers +
      stats.shellFiles,
    [stats],
  )

  return (
    <div className="page sql-workbench-page">
      <div className="sql-workbench-hero">
        <div>
          <div className="eyebrow">SQL Workbench</div>
          <h1>SQL 工作台</h1>
          <p>
            把数据源、查询文件、变量、流程编排和加载任务收拢到一个入口，避免侧边栏被 SQL
            子功能挤满。
          </p>
        </div>
        <div className="sql-workbench-orb" aria-hidden="true">
          <span>SQL</span>
        </div>
      </div>

      <section className="sql-workbench-metrics">
        <div>
          <span>模块</span>
          <strong>{MODULES.length}</strong>
        </div>
        <div>
          <span>当前资产</span>
          <strong>{loading ? '...' : total}</strong>
        </div>
        <div>
          <span>执行方式</span>
          <strong>本地</strong>
        </div>
      </section>

      <section className="sql-workbench-grid" aria-label="SQL 工作台模块">
        {MODULES.map(({ to, title, kicker, description, Icon, statKey, statLabel }) => (
          <button
            className="sql-workbench-card"
            key={to}
            type="button"
            onClick={() => navigate(to)}
          >
            <div className="sql-workbench-card-main">
              <div className="sql-workbench-card-icon">
                <Icon size={22} />
              </div>
              <div>
                <span>{kicker}</span>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </div>
            <div className="sql-workbench-card-foot">
              <span>{loading ? '加载中' : `${stats[statKey]} ${statLabel}`}</span>
              <IconChevron size={16} />
            </div>
          </button>
        ))}
      </section>
    </div>
  )
}
