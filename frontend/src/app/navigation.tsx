import {
  Activity,
  Bell,
  Blocks,
  Bot,
  BrainCircuit,
  CalendarDays,
  Cable,
  CodeXml,
  Database,
  FileCode2,
  FileText,
  FolderGit2,
  Home,
  Library,
  MemoryStick,
  Network,
  NotebookText,
  PackageSearch,
  RadioTower,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export type NavEntry = {
  label: string
  path: string
  icon: LucideIcon
  description?: string
}

export type NavSection = NavEntry & {
  id: 'today' | 'chat' | 'workspace' | 'knowledge' | 'automations' | 'capabilities' | 'settings'
  items: NavEntry[]
}

export const navSections: NavSection[] = [
  {
    id: 'today',
    label: '今日',
    path: '/today',
    icon: Home,
    items: [
      { label: '今日概览', path: '/today', icon: Activity },
      { label: '通知中心', path: '/today/activity', icon: Bell },
    ],
  },
  {
    id: 'chat',
    label: '对话',
    path: '/chat',
    icon: Bot,
    items: [{ label: 'Agent 对话', path: '/chat', icon: Sparkles }],
  },
  {
    id: 'workspace',
    label: '工作区',
    path: '/workspace/repositories',
    icon: CodeXml,
    items: [
      { label: '本地仓库', path: '/workspace/repositories', icon: FolderGit2 },
      { label: 'SQL 工作台', path: '/workspace/sql', icon: Database },
      { label: '数据源', path: '/workspace/datasources', icon: Cable },
      { label: 'SQL 文件', path: '/workspace/sql-files', icon: FileCode2 },
      { label: '变量', path: '/workspace/variables', icon: SlidersHorizontal },
      { label: '远程服务器', path: '/workspace/servers', icon: Server },
      { label: 'Shell 文件', path: '/workspace/shell-files', icon: TerminalSquare },
    ],
  },
  {
    id: 'knowledge',
    label: '知识',
    path: '/knowledge/notes',
    icon: Library,
    items: [
      { label: '笔记', path: '/knowledge/notes', icon: NotebookText },
      { label: 'Wiki', path: '/knowledge/wiki', icon: FileText },
      { label: '记忆', path: '/knowledge/memory', icon: MemoryStick },
      { label: '资源', path: '/knowledge/resources', icon: PackageSearch },
      { label: '知识检索', path: '/knowledge/search', icon: Search },
      { label: '输出配置', path: '/knowledge/output-profiles', icon: BrainCircuit },
    ],
  },
  {
    id: 'automations',
    label: '自动化',
    path: '/automations/calendar',
    icon: Workflow,
    items: [
      { label: '日历', path: '/automations/calendar', icon: CalendarDays },
      { label: '定时任务', path: '/automations/tasks', icon: Activity },
      { label: '流程编排', path: '/automations/orchestrations', icon: Network },
      { label: '执行记录', path: '/automations/runs', icon: RadioTower },
    ],
  },
  {
    id: 'capabilities',
    label: '能力与连接',
    path: '/capabilities/skills',
    icon: Blocks,
    items: [
      { label: 'Skills', path: '/capabilities/skills', icon: Sparkles },
      { label: '工具箱', path: '/capabilities/tools', icon: Wrench },
      { label: '搜索源', path: '/capabilities/search', icon: Search },
      { label: '外部通道', path: '/capabilities/channels', icon: Cable },
    ],
  },
  {
    id: 'settings',
    label: '设置',
    path: '/settings/models',
    icon: Settings,
    items: [
      { label: '模型接入', path: '/settings/models', icon: Bot },
      { label: 'Agent 与权限', path: '/settings/agent', icon: SlidersHorizontal },
      { label: '外观与动态', path: '/settings/appearance', icon: Sparkles },
      { label: '系统维护', path: '/settings/system', icon: Server },
    ],
  },
]

export function sectionForPath(pathname: string) {
  return navSections.find((section) => pathname === section.path || pathname.startsWith(`/${section.id}`)) ?? navSections[0]
}

export function entryForPath(pathname: string) {
  for (const section of navSections) {
    const exact = section.items.find((item) => pathname === item.path)
    if (exact) return { section, entry: exact }
    const nested = section.items
      .filter((item) => pathname.startsWith(item.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (nested) return { section, entry: nested }
  }
  const section = sectionForPath(pathname)
  return { section, entry: section.items[0] }
}

export const commandEntries = navSections.flatMap((section) =>
  section.items.map((entry) => ({ ...entry, section: section.label })),
)
