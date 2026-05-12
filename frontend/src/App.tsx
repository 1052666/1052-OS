import { Routes, Route, Navigate } from 'react-router-dom'
import OnboardingModal from './components/OnboardingModal'
import Sidebar from './components/Sidebar'
import ThemeEffectLayer from './components/ThemeEffectLayer'
import { MirrorChrome } from './mirror/MirrorChrome'
import { useTheme } from './theme-context'
import Chat from './pages/Chat'
import Calendar from './pages/Calendar'
import Repository from './pages/Repository'
import Notes from './pages/Notes'
import Wiki from './pages/Wiki'
import Pkm from './pages/Pkm'
import OutputProfiles from './pages/OutputProfiles'
import Resources from './pages/Resources'
import SearchSources from './pages/SearchSources'
import Skills from './pages/Skills'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import Memory from './pages/Memory'
import SocialChannels from './pages/SocialChannels'
import SqlWorkbench from './pages/SqlWorkbench'
import Toolbox from './pages/Toolbox'
import SqlDataSources from './pages/SqlDataSources'
import SqlFiles from './pages/SqlFiles'
import SqlVariables from './pages/SqlVariables'
import SqlOrchestration from './pages/SqlOrchestration'
import SqlLoads from './pages/SqlLoads'
import SqlServers from './pages/SqlServers'
import SqlShellFiles from './pages/SqlShellFiles'
import { useOnboarding } from './use-onboarding'

export default function App() {
  const onboarding = useOnboarding()
  const { baseProfile } = useTheme()

  // Codex review #3 — abstract the shell decision so the App.tsx route branch
  // is open to future shells without poking at every `baseProfile === 'mirror'`
  // call site. Only 'mirror' uses MirrorChrome (with cursor tracking, cross-
  // card coupling, liquid pour). 'silky' shares the mirror material skin via
  // mirror-theme.css but renders through the classic shell, so it falls
  // through to the classic branch below alongside 'classic' and 'gpt'.
  const usesMirrorShell = baseProfile === 'mirror'

  if (usesMirrorShell) {
    return (
      <>
        <ThemeEffectLayer />
        <MirrorChrome />
        <OnboardingModal open={onboarding.shouldShow} onClose={onboarding.markCompleted} />
      </>
    )
  }

  return (
    <div className="app">
      <ThemeEffectLayer />
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/repository" element={<Repository />} />
          <Route path="/repository/:id" element={<Repository />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/wiki" element={<Wiki />} />
          <Route path="/pkm" element={<Pkm />} />
          <Route path="/output-profiles" element={<OutputProfiles />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/social-channels" element={<SocialChannels />} />
          <Route path="/social-channels/:channel" element={<SocialChannels />} />
          <Route path="/toolbox" element={<Toolbox />} />
          <Route path="/toolbox/:provider" element={<Toolbox />} />
          <Route path="/sql" element={<SqlWorkbench />} />
          <Route path="/sql/datasources" element={<SqlDataSources />} />
          <Route path="/sql/files" element={<SqlFiles />} />
          <Route path="/sql/variables" element={<SqlVariables />} />
          <Route path="/sql/orchestration" element={<SqlOrchestration />} />
          <Route path="/sql/loads" element={<SqlLoads />} />
          <Route path="/sql/servers" element={<SqlServers />} />
          <Route path="/sql/shell-files" element={<SqlShellFiles />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/search-sources" element={<SearchSources />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings onRestartOnboarding={onboarding.restart} />} />
        </Routes>
      </main>
      <OnboardingModal open={onboarding.shouldShow} onClose={onboarding.markCompleted} />
    </div>
  )
}
