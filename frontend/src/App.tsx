import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Chat from './pages/Chat'
import Calendar from './pages/Calendar'
import Repository from './pages/Repository'
import Notes from './pages/Notes'
import Resources from './pages/Resources'
import SearchSources from './pages/SearchSources'
import Skills from './pages/Skills'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import Memory from './pages/Memory'
import SocialChannels from './pages/SocialChannels'

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/repository" element={<Repository />} />
          <Route path="/repository/:id" element={<Repository />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/social-channels" element={<SocialChannels />} />
          <Route path="/social-channels/:channel" element={<SocialChannels />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/search-sources" element={<SearchSources />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
