import {
  IconBell,
  IconCalendar,
  IconChat,
  IconDatabase,
  IconMemory,
  IconNotes,
  IconRepo,
  IconResources,
  IconSearchGrid,
  IconServer,
  IconSettings,
  IconSkills,
  IconSocial,
  IconSparkle,
  IconToolbox,
  IconWiki,
} from '../components/Icons'

type IconComponent = (p: { size?: number; className?: string }) => JSX.Element

export interface NavItem {
  id: string
  label: string
  path: string
  Icon: IconComponent
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'chat', label: '聊天', path: '/chat', Icon: IconChat },
  { id: 'calendar', label: '日历', path: '/calendar', Icon: IconCalendar },
  { id: 'notifications', label: '通知中心', path: '/notifications', Icon: IconBell },
  { id: 'repository', label: '仓库', path: '/repository', Icon: IconRepo },
  { id: 'notes', label: '笔记', path: '/notes', Icon: IconNotes },
  { id: 'wiki', label: 'Wiki', path: '/wiki', Icon: IconWiki },
  { id: 'pkm', label: 'PKM', path: '/pkm', Icon: IconSearchGrid },
  { id: 'output-profiles', label: '输出配方', path: '/output-profiles', Icon: IconSparkle },
  { id: 'resources', label: '资源列表', path: '/resources', Icon: IconResources },
  { id: 'memory', label: '记忆中心', path: '/memory', Icon: IconMemory },
  { id: 'social-channels', label: '社交通道', path: '/social-channels', Icon: IconSocial },
  { id: 'toolbox', label: '工具箱', path: '/toolbox', Icon: IconToolbox },
  { id: 'industrial-gateway', label: '工业网关', path: '/industrial-gateway', Icon: IconServer },
  { id: 'sql', label: 'SQL 工作台', path: '/sql', Icon: IconDatabase },
  { id: 'search-sources', label: '搜索源', path: '/search-sources', Icon: IconSearchGrid },
  { id: 'skills', label: 'Skill 中心', path: '/skills', Icon: IconSkills },
  { id: 'settings', label: '设置', path: '/settings', Icon: IconSettings },
] as const
