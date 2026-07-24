import { Navigate, useLocation } from 'react-router-dom'
import { navSections } from '../app/navigation'
import { lazy, Suspense } from 'react'
import { CalendarView, RunsView, TasksView } from '../features/automations/AutomationViews'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'
import pageStyles from './pages.module.css'

const OrchestrationsView = lazy(() => import('../features/automations/AutomationFlowView'))

const labels: Record<string, [string, string]> = {
  calendar: ['日历', '统一查看和维护本地日程。'],
  tasks: ['定时任务', '管理 Agent 与终端任务的运行节奏。'],
  orchestrations: ['流程编排', '用节点画布组织 SQL、Shell、等待和循环步骤。'],
  runs: ['执行记录', '追踪任务与流程的运行状态、输出和错误。'],
}

export default function AutomationsPage() {
  const location = useLocation()
  const mode = location.pathname.split('/').filter(Boolean)[1] ?? 'calendar'
  if (location.pathname === '/automations') return <Navigate to="/automations/calendar" replace />
  const [title, description] = labels[mode] ?? labels.calendar
  const view = mode === 'tasks' ? <TasksView /> : mode === 'orchestrations' ? <Suspense fallback={<div className={pageStyles.loadingPanel}>正在载入流程画布</div>}><OrchestrationsView /></Suspense> : mode === 'runs' ? <RunsView /> : <CalendarView />
  return (
    <PageBody className={pageStyles.stack}>
      <PageHeader eyebrow="Automation" title={title} description={description} />
      <MobileTabs items={navSections.find((section) => section.id === 'automations')!.items} />
      {view}
    </PageBody>
  )
}
