import { Navigate, useLocation } from 'react-router-dom'
import { navSections } from '../app/navigation'
import { ChannelsView, SearchSourcesView, SkillsView, ToolsView } from '../features/capabilities/CapabilityViews'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'
import pageStyles from './pages.module.css'

const labels: Record<string, [string, string]> = {
  skills: ['Skills', '管理 Agent 可调用的专业能力包与 Marketplace 安装源。'],
  tools: ['工具箱', '配置 UAPI 工具并直接验证调用参数。'],
  search: ['搜索源', '控制联网搜索、Skill 市场、UAPI 和情报源的可用范围。'],
  channels: ['外部通道', '连接微信、飞书和企业微信，把运行结果送到个人工作流。'],
}

export default function CapabilitiesPage() {
  const location = useLocation()
  const mode = location.pathname.split('/').filter(Boolean)[1] ?? 'skills'
  if (location.pathname === '/capabilities') return <Navigate to="/capabilities/skills" replace />
  const [title, description] = labels[mode] ?? labels.skills
  const view = mode === 'tools' ? <ToolsView /> : mode === 'search' ? <SearchSourcesView /> : mode === 'channels' ? <ChannelsView /> : <SkillsView />
  return (
    <PageBody className={pageStyles.stack}>
      <PageHeader eyebrow="Capabilities" title={title} description={description} />
      <MobileTabs items={navSections.find((section) => section.id === 'capabilities')!.items} />
      {view}
    </PageBody>
  )
}
