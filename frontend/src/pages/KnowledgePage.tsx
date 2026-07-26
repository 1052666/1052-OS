import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { navSections } from '../app/navigation'
import { MemoryView, NotesView, OutputProfilesView, PkmView, ResourcesView, WikiView } from '../features/knowledge/KnowledgeViews'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'

const ResearchView = lazy(() => import('../features/knowledge/ResearchView'))

export default function KnowledgePage() {
  const location = useLocation()
  const mode = location.pathname.split('/').filter(Boolean)[1] ?? 'notes'
  const labels: Record<string, [string, string]> = {
    notes: ['笔记', '编辑保存在本地目录中的 Markdown 笔记。'],
    wiki: ['Wiki', '维护结构化知识页面、来源和索引。'],
    memory: ['记忆中心', '查看并控制 Agent 可以长期使用的信息。'],
    resources: ['资源库', '集中管理链接、材料、参考信息和状态。'],
    search: ['知识检索', '跨 Wiki、记忆、Skill、资源和日程进行语义检索。'],
    research: ['深度研究', '按轮次积累来源，并通过快照、证据和审核形成可追溯结论。'],
    'output-profiles': ['输出配置', '定义不同场景中的认知模型、写作方式和约束。'],
  }
  const [title, description] = labels[mode] ?? labels.notes
  const content = mode === 'wiki'
    ? <WikiView />
    : mode === 'memory'
      ? <MemoryView />
      : mode === 'resources'
        ? <ResourcesView />
        : mode === 'search'
          ? <PkmView />
          : mode === 'research'
            ? <Suspense fallback={null}><ResearchView /></Suspense>
            : mode === 'output-profiles'
              ? <OutputProfilesView />
              : <NotesView />
  return <PageBody><PageHeader eyebrow="Knowledge" title={title} description={description} /><MobileTabs items={navSections.find((section) => section.id === 'knowledge')!.items} />{content}</PageBody>
}
