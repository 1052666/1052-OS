import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'

const TodayPage = lazy(() => import('../pages/TodayPage'))
const ChatPage = lazy(() => import('../pages/ChatPage'))
const WorkspacePage = lazy(() => import('../pages/WorkspacePage'))
const KnowledgePage = lazy(() => import('../pages/KnowledgePage'))
const AutomationsPage = lazy(() => import('../pages/AutomationsPage'))
const CapabilitiesPage = lazy(() => import('../pages/CapabilitiesPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))

const legacyRoutes: Array<[string, string]> = [
  ['/calendar', '/automations/calendar'],
  ['/repository', '/workspace/repositories'],
  ['/repository/:id', '/workspace/repositories'],
  ['/notes', '/knowledge/notes'],
  ['/wiki', '/knowledge/wiki'],
  ['/pkm', '/knowledge/search'],
  ['/output-profiles', '/knowledge/output-profiles'],
  ['/resources', '/knowledge/resources'],
  ['/memory', '/knowledge/memory'],
  ['/social-channels', '/capabilities/channels'],
  ['/social-channels/:channel', '/capabilities/channels'],
  ['/toolbox', '/capabilities/tools'],
  ['/toolbox/:provider', '/capabilities/tools'],
  ['/sql', '/workspace/sql'],
  ['/sql/datasources', '/workspace/datasources'],
  ['/sql/files', '/workspace/sql-files'],
  ['/sql/variables', '/workspace/variables'],
  ['/sql/orchestration', '/automations/orchestrations'],
  ['/sql/loads', '/automations/runs'],
  ['/sql/servers', '/workspace/servers'],
  ['/sql/shell-files', '/workspace/shell-files'],
  ['/notifications', '/today/activity'],
  ['/search-sources', '/capabilities/search'],
  ['/skills', '/capabilities/skills'],
  ['/settings', '/settings/models'],
]

function LoadingScreen() {
  return <div style={{ display: 'grid', minHeight: '100%', placeItems: 'center', color: 'var(--text-muted)' }}>正在载入工作区</div>
}

export function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="/today/*" element={<TodayPage />} />
          <Route path="/chat/*" element={<ChatPage />} />
          <Route path="/workspace/*" element={<WorkspacePage />} />
          <Route path="/knowledge/*" element={<KnowledgePage />} />
          <Route path="/automations/*" element={<AutomationsPage />} />
          <Route path="/capabilities/*" element={<CapabilitiesPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          {legacyRoutes.map(([path, target]) => <Route key={path} path={path} element={<Navigate to={target} replace />} />)}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
