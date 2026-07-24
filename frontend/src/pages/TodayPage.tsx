import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Bell,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  MemoryStick,
  Play,
  Send,
  Sparkles,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { navSections } from '../app/navigation'
import { calendarApi, memoryApi, notificationsApi, settingsApi } from '../data/api'
import { useShellStore } from '../state/shell'
import { AsyncState, Badge, Button, IconButton, Surface, Textarea, Tooltip } from '../components/ui'
import { MobileTabs, PageBody, PageHeader } from './PageLayout'
import styles from './today.module.css'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

function isToday(date: string) {
  const now = new Date()
  const [year, month, day] = date.split('-').map(Number)
  return year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate()
}

function NotificationsView() {
  const client = useQueryClient()
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list })
  const mark = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <PageBody>
      <PageHeader
        eyebrow="Activity"
        title="通知中心"
        description="集中查看定时任务和 Runtime 产生的重要事件。"
        actions={<Button onClick={() => markAll.mutate()} disabled={markAll.isPending}>全部已读</Button>}
      />
      <MobileTabs items={navSections[0].items} />
      <Surface>
        <AsyncState loading={notifications.isLoading} error={notifications.error} empty={!notifications.data?.length}>
          <div className={styles.notificationList}>
            {notifications.data?.map((item) => (
              <button key={item.id} type="button" className={`${styles.notificationRow} ${item.read ? '' : styles.unread}`} onClick={() => !item.read && mark.mutate(item.id)}>
                <span className={`${styles.levelDot} ${styles[item.level]}`} />
                <span><strong>{item.title}</strong><small>{item.message}</small></span>
                <time>{timeFormatter.format(item.createdAt)}</time>
                {!item.read ? <Badge tone="warning">未读</Badge> : <Check size={15} />}
              </button>
            ))}
          </div>
        </AsyncState>
      </Surface>
    </PageBody>
  )
}

export default function TodayPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useShellStore((state) => state.profile)
  const runtime = useShellStore((state) => state.runtime)
  const setInspectorOpen = useShellStore((state) => state.setInspectorOpen)
  const [prompt, setPrompt] = useState('')
  const [events, tasks, notifications, memory, settings] = useQueries({
    queries: [
      { queryKey: ['calendar', 'events'], queryFn: calendarApi.events },
      { queryKey: ['calendar', 'tasks'], queryFn: () => calendarApi.tasks(true) },
      { queryKey: ['notifications'], queryFn: notificationsApi.list },
      { queryKey: ['memory', 'summary'], queryFn: memoryApi.summary },
      { queryKey: ['settings'], queryFn: settingsApi.get },
    ],
  })

  const todayEvents = useMemo(() => events.data?.filter((event) => isToday(event.date)).sort((a, b) => a.startTime.localeCompare(b.startTime)) ?? [], [events.data])
  const enabledTasks = useMemo(() => tasks.data?.filter((task) => task.enabled).slice(0, 5) ?? [], [tasks.data])
  const recentNotifications = notifications.data?.slice(0, 5) ?? []
  const pendingApprovals = runtime.traces.filter((trace) => trace.kind === 'approval' && trace.status === 'warning')
  const runtimeActive = runtime.status === 'running' || runtime.status === 'waiting-approval'

  if (location.pathname.endsWith('/activity')) return <NotificationsView />

  const submit = () => {
    const value = prompt.trim()
    if (!value) return
    navigate('/chat', { state: { prompt: value } })
  }

  return (
    <PageBody className={styles.today}>
      <PageHeader
        eyebrow="Today"
        title={`${profile.name}，${dateFormatter.format(new Date())}`}
        description="今天的重要事项、运行状态和知识动态都在这里。"
        actions={<Button onClick={() => navigate('/chat')}><Bot size={15} />进入对话</Button>}
      />
      <MobileTabs items={navSections[0].items} />

      <motion.section className={styles.commandDeck} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
        <div className={styles.deckSignal} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.deckCopy}>
          <span><Sparkles size={14} />1052 Agent</span>
          <h2>现在想完成什么？</h2>
          <p>描述目标即可，Runtime 会选择需要的工具并在敏感操作前征求确认。</p>
        </div>
        <div className={styles.quickComposer}>
          <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="例如：整理今天的安排，并检查 1052 OS 项目的待办" />
          <Tooltip label="发送给 Agent"><IconButton aria-label="发送给 Agent" onClick={submit} disabled={!prompt.trim()}><Send size={17} /></IconButton></Tooltip>
        </div>
      </motion.section>

      <section className={styles.statusBand}>
        <button type="button" onClick={() => setInspectorOpen(true)}>
          <span className={`${styles.statusIcon} ${runtimeActive ? styles.activeIcon : ''}`}><Bot size={17} /></span>
          <span><small>Runtime</small><strong>{runtimeActive ? '正在处理请求' : runtime.status === 'error' ? '上次运行失败' : '等待新任务'}</strong></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => navigate('/today/activity')}>
          <span className={styles.statusIcon}><Bell size={17} /></span>
          <span><small>未读通知</small><strong>{notifications.data?.filter((item) => !item.read).length ?? 0} 条</strong></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => navigate('/knowledge/memory')}>
          <span className={styles.statusIcon}><MemoryStick size={17} /></span>
          <span><small>记忆建议</small><strong>{memory.data?.counts.suggestions ?? 0} 条待确认</strong></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => navigate('/settings/models')}>
          <span className={styles.statusIcon}><Sparkles size={17} /></span>
          <span><small>当前模型</small><strong>{settings.data?.llm.modelId || '尚未配置'}</strong></span>
          <ArrowRight size={15} />
        </button>
      </section>

      {pendingApprovals.length ? (
        <section className={styles.approvalBand}>
          <ShieldNotice count={pendingApprovals.length} onOpen={() => setInspectorOpen(true)} />
        </section>
      ) : null}

      <div className={styles.dashboardGrid}>
        <Surface title="今天的日程" action={<Button size="small" variant="ghost" onClick={() => navigate('/automations/calendar')}>查看日历</Button>}>
          <AsyncState loading={events.isLoading} error={events.error} empty={!todayEvents.length}>
            <div className={styles.timeline}>
              {todayEvents.map((event) => (
                <div key={event.id} className={styles.timelineItem}>
                  <time>{event.startTime || '全天'}</time>
                  <span />
                  <div><strong>{event.title}</strong><small>{event.location || event.notes || '无补充信息'}</small></div>
                </div>
              ))}
            </div>
          </AsyncState>
        </Surface>

        <Surface title="自动任务" action={<Button size="small" variant="ghost" onClick={() => navigate('/automations/tasks')}>管理任务</Button>}>
          <AsyncState loading={tasks.isLoading} error={tasks.error} empty={!enabledTasks.length}>
            <div className={styles.taskList}>
              {enabledTasks.map((task) => (
                <button key={task.id} type="button" onClick={() => navigate('/automations/tasks')}>
                  <span className={styles.taskIcon}>{task.target === 'agent' ? <Bot size={15} /> : <Play size={15} />}</span>
                  <span><strong>{task.title}</strong><small>{task.mode === 'once' ? `${task.startDate} ${task.time}` : `${task.time} · ${task.mode === 'recurring' ? '周期运行' : '持续运行'}`}</small></span>
                  <Badge tone="success">启用</Badge>
                </button>
              ))}
            </div>
          </AsyncState>
        </Surface>

        <Surface title="近期活动" action={<Button size="small" variant="ghost" onClick={() => navigate('/today/activity')}>全部通知</Button>}>
          <AsyncState loading={notifications.isLoading} error={notifications.error} empty={!recentNotifications.length}>
            <div className={styles.activityList}>
              {recentNotifications.map((item) => (
                <div key={item.id}>
                  {item.level === 'error' ? <CircleAlert size={15} /> : <Bell size={15} />}
                  <span><strong>{item.title}</strong><small>{item.message}</small></span>
                  <time>{timeFormatter.format(item.createdAt)}</time>
                </div>
              ))}
            </div>
          </AsyncState>
        </Surface>

        <Surface title="近期记忆" action={<Button size="small" variant="ghost" onClick={() => navigate('/knowledge/memory')}>记忆中心</Button>}>
          <AsyncState loading={memory.isLoading} error={memory.error} empty={!memory.data?.recent.length}>
            <div className={styles.memoryList}>
              {memory.data?.recent.slice(0, 4).map((item) => (
                <button key={item.id} type="button" onClick={() => navigate('/knowledge/memory')}>
                  <MemoryStick size={15} />
                  <span><strong>{item.title}</strong><small>{item.content}</small></span>
                  <Badge>{item.category}</Badge>
                </button>
              ))}
            </div>
          </AsyncState>
        </Surface>
      </div>
    </PageBody>
  )
}

function ShieldNotice({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}>
      <span><Clock3 size={17} /></span>
      <div><strong>{count} 个操作等待确认</strong><small>Runtime 已暂停相关工具，确认后会继续运行。</small></div>
      <span className={styles.approvalAction}>立即处理</span>
    </button>
  )
}
