import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { NotificationsApi } from '../api/notifications'
import {
  IconBell,
  IconCalendar,
  IconChat,
  IconChevron,
  IconDatabase,
  IconEdit,
  IconMemory,
  IconNotes,
  IconRepo,
  IconResources,
  IconSearchGrid,
  IconSettings,
  IconSkills,
  IconSocial,
  IconToolbox,
} from './Icons'
import ProfileModal, { type Profile } from './ProfileModal'

const items = [
  { to: '/chat', label: '聊天', Icon: IconChat },
  { to: '/calendar', label: '日历', Icon: IconCalendar },
  { to: '/notifications', label: '通知中心', Icon: IconBell },
  { to: '/repository', label: '仓库', Icon: IconRepo },
  { to: '/notes', label: '笔记', Icon: IconNotes },
  { to: '/resources', label: '资源列表', Icon: IconResources },
  { to: '/memory', label: '记忆中心', Icon: IconMemory },
  { to: '/social-channels', label: '社交通道', Icon: IconSocial },
  { to: '/toolbox', label: '工具箱', Icon: IconToolbox },
  { to: '/sql', label: 'SQL 工作台', Icon: IconDatabase },
  { to: '/search-sources', label: '搜索源', Icon: IconSearchGrid },
  { to: '/skills', label: 'Skill 中心', Icon: IconSkills },
  { to: '/settings', label: '设置', Icon: IconSettings },
]

const KEY = 'agent.profile'
const COLLAPSED_KEY = 'agent.sidebar.collapsed'

export default function Sidebar() {
  const [profile, setProfile] = useState<Profile>(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) return JSON.parse(saved) as Profile
    } catch {
      // Ignore invalid profile payload.
    }
    return { name: '本地用户', avatar: '', bio: '' }
  })

  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(profile))
  }, [profile])

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      NotificationsApi.unreadCount()
        .then((result) => {
          if (!cancelled) setUnread(result.unread)
        })
        .catch(() => {
          // Ignore unread-count polling errors in the sidebar.
        })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') load()
    }

    load()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const timer = window.setInterval(load, 15000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(timer)
    }
  }, [])

  const initial = profile.name.trim().charAt(0).toUpperCase() || '?'

  return (
    <>
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
        <div className="brand">
          <div className="brand-text">
            <div className="brand-name">1052 OS</div>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <IconChevron size={15} className={collapsed ? '' : 'flip'} />
          </button>
        </div>

        <nav className="nav">
          <div className="nav-section-title">导航</div>
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <Icon size={17} />
              <span className="nav-label">{label}</span>
              {to === '/notifications' && unread > 0 ? (
                <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-ribbon" aria-hidden="true">
          <span>1052</span>
          <i>01</i>
          <i>02</i>
          <i>03</i>
          <i>04</i>
          <i>05</i>
          <i>06</i>
        </div>

        <div className="user">
          <button
            className="user-avatar"
            onClick={() => setOpen(true)}
            title="打开个人中心"
            type="button"
          >
            {profile.avatar ? <img src={profile.avatar} alt="" /> : initial}
          </button>
          <div className="user-meta">
            <div className="user-name">{profile.name || '未命名'}</div>
            <div className="user-status">
              <span className="dot" />
              在线
            </div>
          </div>
          <button
            className="icon-btn ghost user-edit"
            onClick={() => setOpen(true)}
            title="编辑个人资料"
            type="button"
          >
            <IconEdit size={14} />
          </button>
        </div>
      </aside>

      <ProfileModal
        open={open}
        profile={profile}
        onClose={() => setOpen(false)}
        onSave={setProfile}
      />
    </>
  )
}
