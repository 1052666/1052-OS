import { useLocation } from 'react-router-dom'
import { navSections } from '../app/navigation'
import {
  DataSourcesView,
  RepositoriesView,
  ServersView,
  ShellFilesView,
  SqlFilesView,
  SqlWorkbenchView,
  VariablesView,
} from '../features/workspace/WorkspaceViews'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'

export default function WorkspacePage() {
  const location = useLocation()
  const mode = location.pathname.split('/').filter(Boolean)[1] ?? 'repositories'
  const labels: Record<string, [string, string]> = {
    repositories: ['本地仓库', '浏览项目状态、说明和文件内容。'],
    sql: ['SQL 工作台', '连接数据源并在专业编辑器中执行查询。'],
    datasources: ['数据源', '管理 MySQL、Oracle、SQLite 和 Hive 连接。'],
    'sql-files': ['SQL 文件', '维护可复用的本地查询脚本。'],
    variables: ['SQL 变量', '为查询和自动化流程提供动态参数。'],
    servers: ['远程服务器', '管理自动化使用的 SSH 服务器。'],
    'shell-files': ['Shell 文件', '维护并执行远程 Shell 脚本。'],
  }
  const [title, description] = labels[mode] ?? labels.repositories
  const view = mode === 'sql' ? <SqlWorkbenchView /> : mode === 'datasources' ? <DataSourcesView /> : mode === 'sql-files' ? <SqlFilesView /> : mode === 'variables' ? <VariablesView /> : mode === 'servers' ? <ServersView /> : mode === 'shell-files' ? <ShellFilesView /> : <RepositoriesView />
  return <PageBody><PageHeader eyebrow="Workspace" title={title} description={description} /><MobileTabs items={navSections.find((section) => section.id === 'workspace')!.items} />{view}</PageBody>
}
