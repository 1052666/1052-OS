import { Bell, ChevronLeft, ChevronRight, Moon, PanelRight, Search, Sun } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { entryForPath, navSections, sectionForPath } from '../../app/navigation'
import { notificationsApi } from '../../data/api'
import { useShellStore } from '../../state/shell'
import { IconButton, Tooltip } from '../ui'
import { CommandPalette } from './CommandPalette'
import { RuntimeInspector } from './RuntimeInspector'
import { SystemField } from './SystemField'
import styles from './shell.module.css'

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = sectionForPath(location.pathname)
  const settingsSection = navSections.find((section) => section.id === 'settings')!
  const breadcrumb = entryForPath(location.pathname)
  const collapsed = useShellStore((state) => state.sectionCollapsed)
  const setCollapsed = useShellStore((state) => state.setSectionCollapsed)
  const inspectorOpen = useShellStore((state) => state.inspectorOpen)
  const setInspectorOpen = useShellStore((state) => state.setInspectorOpen)
  const setCommandOpen = useShellStore((state) => state.setCommandOpen)
  const theme = useShellStore((state) => state.theme)
  const toggleTheme = useShellStore((state) => state.toggleTheme)
  const profile = useShellStore((state) => state.profile)
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: notificationsApi.unread, refetchInterval: 20_000 })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07090b' : '#f3f7f7')
  }, [theme])

  return (
    <div className={`${styles.shell} ${collapsed ? styles.sectionCollapsed : ''} ${inspectorOpen ? styles.inspectorVisible : ''}`}>
      <SystemField />
      <aside className={styles.rail} aria-label="主导航">
        <NavLink to="/today" className={styles.brand} aria-label="1052 OS"><span>10</span><span>52</span></NavLink>
        <nav className={styles.railNav} aria-label="主导航快捷入口">
          {navSections.filter((section) => section.id !== 'settings').map((section) => (
            <Tooltip key={section.id} label={section.label}>
              <NavLink to={section.path} className={`${styles.railLink} ${current.id === section.id ? styles.railActive : ''}`} aria-label={section.label}>
                <section.icon size={19} strokeWidth={1.8} />
              </NavLink>
            </Tooltip>
          ))}
        </nav>
        <div className={styles.railBottom}>
          <Tooltip label="设置"><NavLink to="/settings/models" className={`${styles.railLink} ${current.id === 'settings' ? styles.railActive : ''}`} aria-label="设置"><settingsSection.icon size={19} /></NavLink></Tooltip>
          <button type="button" className={styles.avatar} title={profile.name} onClick={() => navigate('/settings/appearance')}>
            {profile.avatar ? <img src={profile.avatar} alt="" /> : profile.name.slice(0, 1)}
          </button>
        </div>
      </aside>

      <aside className={styles.sectionPanel} aria-label={`${current.label}导航`}>
        <header><div><span>1052 OS</span><strong>{current.label}</strong></div><IconButton aria-label="收起分区导航" onClick={() => setCollapsed(true)}><ChevronLeft size={16} /></IconButton></header>
        <nav aria-label={`${current.label}分区导航`}>
          {current.items.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/today' || item.path === '/chat'} className={({ isActive }) => `${styles.sectionLink} ${isActive ? styles.sectionActive : ''}`}>
              <item.icon size={16} /><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sectionStatus}><span className={styles.onlineDot} /><div><strong>本地 Runtime</strong><small>数据保留在此设备</small></div></div>
      </aside>

      <main className={styles.contentFrame}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            {collapsed ? <IconButton aria-label="展开分区导航" onClick={() => setCollapsed(false)}><ChevronRight size={16} /></IconButton> : null}
            <span>{breadcrumb.section.label}</span><strong>{breadcrumb.entry.label}</strong>
          </div>
          <div className={styles.topActions}>
            <button type="button" className={styles.searchButton} aria-label="打开搜索与命令面板" onClick={() => setCommandOpen(true)}><Search size={15} /><span>搜索与命令</span></button>
            <Tooltip label={theme === 'dark' ? '切换浅色' : '切换深色'}><IconButton aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconButton></Tooltip>
            <Tooltip label="通知"><IconButton aria-label="打开通知" onClick={() => navigate('/today/activity')} className={styles.notificationButton}><Bell size={17} />{(unread.data?.unread ?? 0) > 0 ? <i>{Math.min(unread.data?.unread ?? 0, 99)}</i> : null}</IconButton></Tooltip>
            <Tooltip label="运行检查器"><IconButton aria-label="打开运行检查器" onClick={() => setInspectorOpen(!inspectorOpen)}><PanelRight size={17} /></IconButton></Tooltip>
          </div>
        </header>
        <div className={styles.main}><Outlet /></div>
      </main>

      <RuntimeInspector />
      <CommandPalette />

      <nav className={styles.mobileNav} aria-label="移动端主导航">
        {navSections.slice(0, 5).map((section) => (
          <NavLink key={section.id} to={section.path} className={current.id === section.id ? styles.mobileActive : ''} aria-label={section.label}>
            <section.icon size={18} /><span>{section.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
