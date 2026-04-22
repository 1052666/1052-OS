import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CalendarApi,
  type CalendarEvent,
  type ScheduledTaskFeishuDeliveryMode,
  type ScheduledTaskFeishuReceiveIdType,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskMode,
  type ScheduledTaskRepeatUnit,
  type ScheduledTaskRun,
  type ScheduledTaskTarget,
  type ScheduledTaskWechatDeliveryMode,
} from '../api/calendar'
import {
  SocialChannelsApi,
  type FeishuDeliveryTarget,
  type WechatDeliveryTarget,
} from '../api/social-channels'
import {
  IconChevron,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSparkle,
  IconTrash,
} from '../components/Icons'

const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const REPEAT_WEEKDAYS = [
  { label: '日', value: 0 },
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
]

type CalendarCell = {
  d: number
  muted: boolean
  date: Date
  key: string
}

type EventForm = {
  title: string
  date: string
  startTime: string
  endTime: string
  location: string
  notes: string
}

type TaskForm = {
  title: string
  notes: string
  target: ScheduledTaskTarget
  mode: ScheduledTaskMode
  startDate: string
  time: string
  repeatUnit: ScheduledTaskRepeatUnit
  repeatInterval: number
  repeatWeekdays: number[]
  endDate: string
  prompt: string
  command: string
  shell: 'powershell' | 'cmd'
  deliveryMode: ScheduledTaskWechatDeliveryMode
  deliveryAccountId: string
  deliveryPeerId: string
  feishuDeliveryMode: ScheduledTaskFeishuDeliveryMode
  feishuReceiveIdType: ScheduledTaskFeishuReceiveIdType
  feishuReceiveId: string
  enabled: boolean
}

type Notice = {
  type: 'error' | 'success'
  message: string
  leaving: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const formatDay = (key: string) =>
  dateFromKey(key).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

const sortEvents = (events: CalendarEvent[]) =>
  [...events].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return byDate
    const byStart = (a.startTime || '99:99').localeCompare(b.startTime || '99:99')
    if (byStart !== 0) return byStart
    return a.createdAt - b.createdAt
  })

const sortTasks = (tasks: ScheduledTask[]) =>
  [...tasks].sort((a, b) => {
    const nextA = a.nextRunAt ?? Number.MAX_SAFE_INTEGER
    const nextB = b.nextRunAt ?? Number.MAX_SAFE_INTEGER
    if (nextA !== nextB) return nextA - nextB
    return a.createdAt - b.createdAt
  })

const formatEventTime = (event: CalendarEvent) => {
  if (event.startTime && event.endTime) return `${event.startTime} - ${event.endTime}`
  if (event.startTime) return event.startTime
  return '全天'
}

const formatTaskTimestamp = (timestamp: number | null) => {
  if (!timestamp) return '暂无'
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const describeTaskRule = (task: ScheduledTask) => {
  if (task.mode === 'once') return `单次 · ${task.startDate} ${task.time}`

  const every =
    task.repeatInterval > 1 ? `每 ${task.repeatInterval} ${task.repeatUnit}` : `每${task.repeatUnit === 'day' ? '天' : task.repeatUnit === 'week' ? '周' : '月'}`

  if (task.repeatUnit === 'week') {
    const labels = (task.repeatWeekdays.length ? task.repeatWeekdays : []).map(
      (weekday) => `周${REPEAT_WEEKDAYS.find((item) => item.value === weekday)?.label ?? weekday}`,
    )
    return `${task.mode === 'ongoing' ? '长期' : '循环'} · ${labels.join(' / ') || '每周'} · ${task.time}`
  }

  return `${task.mode === 'ongoing' ? '长期' : '循环'} · ${every} · ${task.time}`
}

export const describeTaskDelivery = (task: ScheduledTask) => {
  const wechat = task.delivery?.wechat
  if (!wechat || wechat.mode === 'auto') return '微信：自动推送到最近会话'
  if (wechat.mode === 'off') return '微信：不推送'
  return `微信：固定 ${wechat.accountId || '未填账号'} / ${wechat.peerId || '未填会话'}`
}

const deliveryTargetValue = (target: WechatDeliveryTarget) =>
  `${encodeURIComponent(target.accountId)}|${encodeURIComponent(target.peerId)}`

const feishuDeliveryTargetValue = (target: FeishuDeliveryTarget) =>
  `${encodeURIComponent(target.receiveIdType)}|${encodeURIComponent(target.receiveId)}`

const describeTaskDeliverySummary = (task: ScheduledTask) => {
  const wechat = task.delivery?.wechat
  const feishu = task.delivery?.feishu
  const wechatLabel =
    !wechat || wechat.mode === 'auto'
      ? '微信：自动'
      : wechat.mode === 'off'
        ? '微信：关闭'
        : `微信：固定 ${wechat.accountId || '未填账号'} / ${wechat.peerId || '未填会话'}`
  const feishuLabel =
    !feishu || feishu.mode === 'auto'
      ? '飞书：自动'
      : feishu.mode === 'off'
        ? '飞书：关闭'
        : `飞书：固定 ${feishu.receiveIdType} / ${feishu.receiveId || '未填目标'}`
  return `${wechatLabel} · ${feishuLabel}`
}

const emptyEventForm = (date: string): EventForm => ({
  title: '',
  date,
  startTime: '',
  endTime: '',
  location: '',
  notes: '',
})

const emptyTaskForm = (date: string): TaskForm => ({
  title: '',
  notes: '',
  target: 'agent',
  mode: 'once',
  startDate: date,
  time: '09:00',
  repeatUnit: 'day',
  repeatInterval: 1,
  repeatWeekdays: [],
  endDate: '',
  prompt: '',
  command: '',
  shell: 'powershell',
  deliveryMode: 'auto',
  deliveryAccountId: '',
  deliveryPeerId: '',
  feishuDeliveryMode: 'auto',
  feishuReceiveIdType: 'chat_id',
  feishuReceiveId: '',
  enabled: true,
})

const taskToForm = (task: ScheduledTask): TaskForm => {
  const wechatDelivery = task.delivery?.wechat ?? {
    mode: 'auto' as ScheduledTaskWechatDeliveryMode,
    accountId: '',
    peerId: '',
  }
  const feishuDelivery = task.delivery?.feishu ?? {
    mode: 'auto' as ScheduledTaskFeishuDeliveryMode,
    receiveIdType: 'chat_id' as ScheduledTaskFeishuReceiveIdType,
    receiveId: '',
  }
  return {
    title: task.title,
    notes: task.notes,
    target: task.target,
    mode: task.mode,
    startDate: task.startDate,
    time: task.time,
    repeatUnit: (task.repeatUnit || 'day') as ScheduledTaskRepeatUnit,
    repeatInterval: task.repeatInterval || 1,
    repeatWeekdays: [...task.repeatWeekdays],
    endDate: task.endDate,
    prompt: task.prompt,
    command: task.command,
    shell: task.shell,
    deliveryMode: wechatDelivery.mode,
    deliveryAccountId: wechatDelivery.accountId,
    deliveryPeerId: wechatDelivery.peerId,
    feishuDeliveryMode: feishuDelivery.mode,
    feishuReceiveIdType: feishuDelivery.receiveIdType,
    feishuReceiveId: feishuDelivery.receiveId,
    enabled: task.enabled,
  }
}

export default function Calendar() {
  const today = new Date()
  const todayKey = dateKey(today)
  const [tab, setTab] = useState<'events' | 'tasks'>('events')
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [taskRuns, setTaskRuns] = useState<ScheduledTaskRun[]>([])
  const [deliveryTargets, setDeliveryTargets] = useState<WechatDeliveryTarget[]>([])
  const [feishuTargets, setFeishuTargets] = useState<FeishuDeliveryTarget[]>([])
  const [eventForm, setEventForm] = useState<EventForm>(() => emptyEventForm(todayKey))
  const [taskForm, setTaskForm] = useState<TaskForm>(() => emptyTaskForm(todayKey))
  const [showEventForm, setShowEventForm] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeFadeTimer = useRef<number | null>(null)
  const noticeRemoveTimer = useRef<number | null>(null)

  const clearNoticeTimers = () => {
    if (noticeFadeTimer.current !== null) window.clearTimeout(noticeFadeTimer.current)
    if (noticeRemoveTimer.current !== null) window.clearTimeout(noticeRemoveTimer.current)
    noticeFadeTimer.current = null
    noticeRemoveTimer.current = null
  }

  const showNotice = (message: string, type: Notice['type'] = 'error') => {
    clearNoticeTimers()
    setNotice({ type, message, leaving: false })
    noticeFadeTimer.current = window.setTimeout(() => {
      setNotice((current) => (current ? { ...current, leaving: true } : current))
    }, 5000)
    noticeRemoveTimer.current = window.setTimeout(() => {
      setNotice(null)
    }, 5600)
  }

  const loadEvents = async () => {
    setLoadingEvents(true)
    try {
      setEvents(sortEvents(await CalendarApi.listEvents()))
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '日历加载失败')
    } finally {
      setLoadingEvents(false)
    }
  }

  const loadTasks = async (taskId?: string | null) => {
    setLoadingTasks(true)
    try {
      const [taskList, runs] = await Promise.all([
        CalendarApi.listTasks(),
        CalendarApi.listTaskRuns(taskId ?? undefined),
      ])
      const sortedTasks = sortTasks(taskList)
      setTasks(sortedTasks)
      setTaskRuns(runs)
      setSelectedTaskId((current) => {
        const preferred = taskId ?? current
        if (preferred && sortedTasks.some((task) => task.id === preferred)) return preferred
        return sortedTasks[0]?.id ?? null
      })
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '定时任务加载失败')
    } finally {
      setLoadingTasks(false)
    }
  }

  const loadDeliveryTargets = async () => {
    try {
      const [wechatList, feishuList] = await Promise.all([
        SocialChannelsApi.wechatDeliveryTargets().catch(() => []),
        SocialChannelsApi.feishuDeliveryTargets().catch(() => []),
      ])
      setDeliveryTargets(wechatList)
      setFeishuTargets(feishuList)
    } catch {
      setDeliveryTargets([])
      setFeishuTargets([])
    }
  }

  useEffect(() => {
    void loadEvents()
    void loadTasks()
    void loadDeliveryTargets()
  }, [])

  useEffect(() => clearNoticeTimers, [])

  useEffect(() => {
    if (!selectedTaskId) return
    void CalendarApi.listTaskRuns(selectedTaskId)
      .then((runs) => setTaskRuns(runs))
      .catch(() => {})
  }, [selectedTaskId])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevMonthDays = new Date(year, month, 0).getDate()

  const cells: CalendarCell[] = []
  for (let i = firstDay - 1; i >= 0; i -= 1) {
    const date = new Date(year, month - 1, prevMonthDays - i)
    cells.push({ d: prevMonthDays - i, muted: true, date, key: dateKey(date) })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    cells.push({ d: day, muted: false, date, key: dateKey(date) })
  }
  while (cells.length < 42) {
    const day = cells.length - firstDay - daysInMonth + 1
    const date = new Date(year, month + 1, day)
    cells.push({ d: day, muted: true, date, key: dateKey(date) })
  }

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const group = map.get(event.date) ?? []
      group.push(event)
      map.set(event.date, group)
    }
    return map
  }, [events])

  const selectedEvents = eventsByDate.get(selectedDate) ?? []
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

  const shift = (step: number) => setCursor(new Date(year, month + step, 1))

  const focusDate = (key: string) => {
    const date = dateFromKey(key)
    setSelectedDate(key)
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  const selectDate = (date: Date) => {
    const key = dateKey(date)
    setSelectedDate(key)
    setEventForm((current) => ({ ...current, date: key }))
    if (date.getFullYear() !== year || date.getMonth() !== month) {
      setCursor(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  const openCreateEvent = () => {
    setEventForm(emptyEventForm(selectedDate))
    setEditingEventId(null)
    setShowEventForm(true)
  }

  const openEditEvent = (event: CalendarEvent) => {
    focusDate(event.date)
    setEventForm({
      title: event.title,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      notes: event.notes,
    })
    setEditingEventId(event.id)
    setShowEventForm(true)
  }

  const closeEventForm = () => {
    setShowEventForm(false)
    setEditingEventId(null)
    setEventForm(emptyEventForm(selectedDate))
  }

  const openCreateTask = () => {
    setTaskForm(emptyTaskForm(todayKey))
    setEditingTaskId(null)
    setShowTaskForm(true)
    void loadDeliveryTargets()
  }

  const openEditTask = (task: ScheduledTask) => {
    setSelectedTaskId(task.id)
    setTaskForm(taskToForm(task))
    setEditingTaskId(task.id)
    setShowTaskForm(true)
    void loadDeliveryTargets()
  }

  const closeTaskForm = () => {
    setShowTaskForm(false)
    setEditingTaskId(null)
    setTaskForm(emptyTaskForm(todayKey))
  }

  const submitEvent = async (event: FormEvent) => {
    event.preventDefault()
    const title = eventForm.title.trim()
    if (!title) {
      showNotice('日常安排标题不能为空')
      return
    }

    setSaving(true)
    try {
      const payload = {
        title,
        date: eventForm.date,
        startTime: eventForm.startTime,
        endTime: eventForm.endTime,
        location: eventForm.location.trim(),
        notes: eventForm.notes.trim(),
      }
      const saved = editingEventId
        ? await CalendarApi.updateEvent(editingEventId, payload)
        : await CalendarApi.createEvent(payload)

      setEvents((current) =>
        sortEvents(
          editingEventId
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [...current, saved],
        ),
      )
      focusDate(saved.date)
      closeEventForm()
      showNotice(editingEventId ? '日常安排已更新' : '日常安排已创建', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '日常安排保存失败')
    } finally {
      setSaving(false)
    }
  }

  const removeEvent = async (event: CalendarEvent) => {
    try {
      await CalendarApi.deleteEvent(event.id)
      setEvents((current) => current.filter((item) => item.id !== event.id))
      if (editingEventId === event.id) closeEventForm()
      showNotice('日常安排已删除', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '日常安排删除失败')
    }
  }

  const buildTaskPayload = (): ScheduledTaskInput | null => {
    const title = taskForm.title.trim()
    if (!title) {
      showNotice('定时任务标题不能为空')
      return null
    }
    if (!taskForm.startDate || !taskForm.time) {
      showNotice('定时任务必须填写开始日期和时间')
      return null
    }
    if (taskForm.target === 'agent' && !taskForm.prompt.trim()) {
      showNotice('Agent 定时任务必须填写执行提示词')
      return null
    }
    if (taskForm.target === 'terminal' && !taskForm.command.trim()) {
      showNotice('终端定时任务必须填写命令')
      return null
    }
    if (taskForm.mode !== 'once' && !taskForm.repeatUnit) {
      showNotice('循环或长期任务必须选择重复规则')
      return null
    }
    if (
      taskForm.deliveryMode === 'fixed' &&
      (!taskForm.deliveryAccountId.trim() || !taskForm.deliveryPeerId.trim())
    ) {
      showNotice('固定微信推送需要填写账号 ID 和会话 ID')
      return null
    }

    if (taskForm.feishuDeliveryMode === 'fixed' && !taskForm.feishuReceiveId.trim()) {
      showNotice('固定飞书推送需要填写 receiveId')
      return null
    }

    return {
      title,
      notes: taskForm.notes.trim(),
      target: taskForm.target,
      mode: taskForm.mode,
      startDate: taskForm.startDate,
      time: taskForm.time,
      repeatUnit: taskForm.mode === 'once' ? undefined : taskForm.repeatUnit,
      repeatInterval: taskForm.mode === 'once' ? undefined : taskForm.repeatInterval,
      repeatWeekdays:
        taskForm.mode !== 'once' && taskForm.repeatUnit === 'week'
          ? taskForm.repeatWeekdays
          : undefined,
      endDate: taskForm.mode === 'recurring' ? taskForm.endDate || undefined : undefined,
      prompt: taskForm.target === 'agent' ? taskForm.prompt.trim() : undefined,
      command: taskForm.target === 'terminal' ? taskForm.command.trim() : undefined,
      shell: taskForm.target === 'terminal' ? taskForm.shell : undefined,
      delivery: {
        wechat: {
          mode: taskForm.deliveryMode,
          accountId:
            taskForm.deliveryMode === 'fixed' ? taskForm.deliveryAccountId.trim() : '',
          peerId: taskForm.deliveryMode === 'fixed' ? taskForm.deliveryPeerId.trim() : '',
        },
        feishu: {
          mode: taskForm.feishuDeliveryMode,
          receiveIdType: taskForm.feishuReceiveIdType,
          receiveId:
            taskForm.feishuDeliveryMode === 'fixed'
              ? taskForm.feishuReceiveId.trim()
              : '',
        },
      },
      enabled: taskForm.enabled,
    }
  }

  const submitTask = async (event: FormEvent) => {
    event.preventDefault()
    const payload = buildTaskPayload()
    if (!payload) return

    setSaving(true)
    try {
      const saved = editingTaskId
        ? await CalendarApi.updateTask(editingTaskId, payload)
        : await CalendarApi.createTask(payload)
      await loadTasks(saved.id)
      closeTaskForm()
      showNotice(editingTaskId ? '定时任务已更新' : '定时任务已创建', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '定时任务保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleTaskEnabled = async (task: ScheduledTask) => {
    try {
      const next = task.enabled
        ? await CalendarApi.pauseTask(task.id)
        : await CalendarApi.resumeTask(task.id)
      setTasks((current) =>
        sortTasks(current.map((item) => (item.id === next.id ? next : item))),
      )
      if (selectedTaskId === next.id) setSelectedTaskId(next.id)
      showNotice(task.enabled ? '定时任务已暂停' : '定时任务已恢复', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '定时任务状态更新失败')
    }
  }

  const runTaskNow = async (task: ScheduledTask) => {
    try {
      await CalendarApi.runTaskNow(task.id)
      await loadTasks(task.id)
      showNotice('定时任务已触发，执行结果会写入运行记录', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '定时任务触发失败')
    }
  }

  const removeTask = async (task: ScheduledTask) => {
    try {
      await CalendarApi.deleteTask(task.id)
      await loadTasks(selectedTaskId === task.id ? null : selectedTaskId)
      if (editingTaskId === task.id) closeTaskForm()
      showNotice('定时任务已删除', 'success')
    } catch (error) {
      const apiError = error as { message?: string }
      showNotice(apiError.message ?? '定时任务删除失败')
    }
  }

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <div>
          <h1>日历与任务计划</h1>
          <div className="muted">
            普通日常安排和自动执行的定时任务分开管理
          </div>
        </div>
        <div className="toolbar">
          <button className="chip ghost" onClick={() => setTab('events')}>
            日常安排
          </button>
          <button className="chip ghost" onClick={() => setTab('tasks')}>
            定时任务
          </button>
          {tab === 'events' ? (
            <button className="chip primary" onClick={openCreateEvent}>
              <IconPlus size={14} /> 新建日常
            </button>
          ) : (
            <button className="chip primary" onClick={openCreateTask}>
              <IconSparkle size={14} /> 新建任务
            </button>
          )}
        </div>
      </header>

      <div className="calendar-tabbar">
        <button
          type="button"
          className={'calendar-tab' + (tab === 'events' ? ' active' : '')}
          onClick={() => setTab('events')}
        >
          普通日常
        </button>
        <button
          type="button"
          className={'calendar-tab' + (tab === 'tasks' ? ' active' : '')}
          onClick={() => setTab('tasks')}
        >
          定时任务
        </button>
      </div>

      {notice && (
        <div className={'toast ' + notice.type + (notice.leaving ? ' leaving' : '')}>
          {notice.message}
        </div>
      )}

      {tab === 'events' ? (
        <div className="calendar-layout">
          <section className="calendar-main">
            <div className="toolbar calendar-toolbar">
              <button className="chip ghost" onClick={() => shift(-1)} title="上个月">
                <IconChevron size={14} className="flip" />
              </button>
              <button
                className="chip ghost"
                onClick={() => {
                  setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
                  setSelectedDate(todayKey)
                  setEventForm((current) => ({ ...current, date: todayKey }))
                }}
              >
                今天
              </button>
              <button className="chip ghost" onClick={() => shift(1)} title="下个月">
                <IconChevron size={14} />
              </button>
              <div className="muted calendar-month-label">
                {year} 年 {MONTHS[month]}
              </div>
            </div>

            <div className="calendar-grid">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="calendar-weekday">
                  {weekday}
                </div>
              ))}
              {cells.map((cell) => {
                const isToday = cell.key === todayKey
                const isSelected = cell.key === selectedDate
                const dayEvents = eventsByDate.get(cell.key) ?? []
                const visibleEvents = dayEvents.slice(0, 3)
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={
                      'calendar-cell' +
                      (cell.muted ? ' muted' : '') +
                      (isToday ? ' today' : '') +
                      (isSelected ? ' selected' : '')
                    }
                    onClick={() => selectDate(cell.date)}
                  >
                    <span className="calendar-num">{cell.d}</span>
                    <span className="calendar-events">
                      {visibleEvents.map((event) => (
                        <span key={event.id} className="calendar-event-pill">
                          {event.startTime && (
                            <span className="calendar-event-time">{event.startTime}</span>
                          )}
                          {event.title}
                        </span>
                      ))}
                      {dayEvents.length > visibleEvents.length && (
                        <span className="calendar-more">+{dayEvents.length - visibleEvents.length}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="calendar-side">
            <section className="calendar-day-panel">
              <div className="calendar-panel-head">
                <div>
                  <div className="calendar-panel-title">{formatDay(selectedDate)}</div>
                  <div className="calendar-panel-sub">
                    {selectedEvents.length ? `${selectedEvents.length} 个安排` : '暂无安排'}
                  </div>
                </div>
                <button className="icon-btn primary" onClick={openCreateEvent} title="新建日常">
                  <IconPlus size={14} />
                </button>
              </div>

              <div className="calendar-agenda">
                {loadingEvents ? (
                  <div className="calendar-empty">加载中...</div>
                ) : selectedEvents.length === 0 ? (
                  <div className="calendar-empty">当前日期暂无安排</div>
                ) : (
                  selectedEvents.map((event) => (
                    <div className="agenda-item" key={event.id}>
                      <div className="agenda-main">
                        <div className="agenda-time">{formatEventTime(event)}</div>
                        <div className="agenda-title">{event.title}</div>
                        {event.location && <div className="agenda-meta">{event.location}</div>}
                        {event.notes && <div className="agenda-notes">{event.notes}</div>}
                      </div>
                      <button
                        className="icon-btn ghost agenda-action"
                        onClick={() => openEditEvent(event)}
                        title="编辑日常"
                      >
                        <IconEdit size={14} />
                      </button>
                      <button
                        className="icon-btn ghost agenda-action agenda-delete"
                        onClick={() => removeEvent(event)}
                        title="删除日常"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {showEventForm && (
              <form className="calendar-form" onSubmit={submitEvent}>
                <div className="calendar-form-title">{editingEventId ? '编辑日常安排' : '新建日常安排'}</div>
                <label className="calendar-field">
                  <span>标题</span>
                  <input
                    value={eventForm.title}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="会议、拜访或提醒"
                    autoFocus
                  />
                </label>
                <label className="calendar-field">
                  <span>日期</span>
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, date: event.target.value }))
                    }
                  />
                </label>
                <div className="calendar-time-row">
                  <label className="calendar-field">
                    <span>开始</span>
                    <input
                      type="time"
                      value={eventForm.startTime}
                      onChange={(event) =>
                        setEventForm((current) => ({ ...current, startTime: event.target.value }))
                      }
                    />
                  </label>
                  <label className="calendar-field">
                    <span>结束</span>
                    <input
                      type="time"
                      value={eventForm.endTime}
                      onChange={(event) =>
                        setEventForm((current) => ({ ...current, endTime: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <label className="calendar-field">
                  <span>地点</span>
                  <input
                    value={eventForm.location}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, location: event.target.value }))
                    }
                    placeholder="可选"
                  />
                </label>
                <label className="calendar-field">
                  <span>备注</span>
                  <textarea
                    rows={3}
                    value={eventForm.notes}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="可选"
                  />
                </label>
                <div className="calendar-form-actions">
                  <button type="button" className="chip ghost" onClick={closeEventForm} disabled={saving}>
                    取消
                  </button>
                  <button type="submit" className="chip primary" disabled={saving}>
                    {saving ? '保存中...' : editingEventId ? '更新' : '保存'}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      ) : (
        <div className="calendar-layout calendar-layout-tasks">
          <section className="calendar-main">
            <div className="calendar-task-toolbar">
              <div className="muted">到时间后会自动触发 Agent 或终端命令，并写入运行记录。</div>
              <button className="chip ghost" onClick={() => void loadTasks(selectedTaskId)}>
                <IconRefresh size={14} /> 刷新
              </button>
            </div>

            <div className="task-list">
              {loadingTasks ? (
                <div className="calendar-empty">加载中...</div>
              ) : tasks.length === 0 ? (
                <div className="calendar-empty">还没有定时任务</div>
              ) : (
                tasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className={'task-card' + (task.id === selectedTaskId ? ' active' : '')}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <div className="task-card-head">
                      <div>
                        <div className="task-card-title">{task.title}</div>
                        <div className="task-card-meta">{describeTaskRule(task)}</div>
                      </div>
                      <span className={'task-state ' + (task.enabled ? 'on' : 'off')}>
                        {task.enabled ? '运行中' : '已暂停'}
                      </span>
                    </div>
                    <div className="task-card-grid">
                      <span>目标：{task.target === 'agent' ? 'Agent 回调' : `终端 ${task.shell}`}</span>
                      <span>{describeTaskDeliverySummary(task)}</span>
                      <span>下次：{formatTaskTimestamp(task.nextRunAt)}</span>
                      <span>上次：{formatTaskTimestamp(task.lastRunAt)}</span>
                      <span>
                        最近结果：
                        {task.lastRunStatus === 'success'
                          ? '成功'
                          : task.lastRunStatus === 'failed'
                            ? '失败'
                            : '暂无'}
                      </span>
                    </div>
                    {task.notes && <div className="task-card-note">{task.notes}</div>}
                  </button>
                ))
              )}
            </div>
          </section>

          <aside className="calendar-side">
            <section className="calendar-day-panel">
              <div className="calendar-panel-head">
                <div>
                  <div className="calendar-panel-title">{selectedTask?.title ?? '定时任务详情'}</div>
                  <div className="calendar-panel-sub">
                    {selectedTask
                      ? `${selectedTask.target === 'agent' ? 'Agent' : '终端'} · ${selectedTask.mode === 'once' ? '单次' : selectedTask.mode === 'recurring' ? '循环' : '长期'}`
                      : '选择一个任务查看详情'}
                  </div>
                </div>
                <button className="icon-btn primary" onClick={openCreateTask} title="新建任务">
                  <IconPlus size={14} />
                </button>
              </div>

              {selectedTask ? (
                <div className="calendar-agenda task-detail">
                  <div className="task-detail-row">
                    <strong>触发规则</strong>
                    <span>{describeTaskRule(selectedTask)}</span>
                  </div>
                  <div className="task-detail-row">
                    <strong>下次执行</strong>
                    <span>{formatTaskTimestamp(selectedTask.nextRunAt)}</span>
                  </div>
                  <div className="task-detail-row">
                    <strong>推送目标</strong>
                    <span>{describeTaskDeliverySummary(selectedTask)}</span>
                  </div>
                  <div className="task-detail-row">
                    <strong>最近执行</strong>
                    <span>{formatTaskTimestamp(selectedTask.lastRunAt)}</span>
                  </div>
                  <div className="task-detail-actions">
                    <button className="chip ghost" onClick={() => openEditTask(selectedTask)}>
                      <IconEdit size={14} /> 编辑
                    </button>
                    <button className="chip ghost" onClick={() => void toggleTaskEnabled(selectedTask)}>
                      {selectedTask.enabled ? '暂停' : '恢复'}
                    </button>
                    <button className="chip ghost" onClick={() => void runTaskNow(selectedTask)}>
                      立即执行
                    </button>
                    <button className="chip ghost danger" onClick={() => void removeTask(selectedTask)}>
                      <IconTrash size={14} /> 删除
                    </button>
                  </div>

                  {selectedTask.target === 'agent' ? (
                    <div className="task-detail-block">
                      <strong>Agent 回调提示词</strong>
                      <p>{selectedTask.prompt || '暂无'}</p>
                    </div>
                  ) : (
                    <div className="task-detail-block">
                      <strong>终端命令</strong>
                      <p>{selectedTask.command || '暂无'}</p>
                    </div>
                  )}

                  {selectedTask.lastRunSummary && (
                    <div className="task-detail-block">
                      <strong>最近回调摘要</strong>
                      <p>{selectedTask.lastRunSummary}</p>
                    </div>
                  )}

                  <div className="task-runs">
                    <div className="task-runs-title">执行记录</div>
                    {taskRuns.length === 0 ? (
                      <div className="calendar-empty">还没有执行记录</div>
                    ) : (
                      taskRuns.map((run) => (
                        <div key={run.id} className={'task-run-item ' + run.status}>
                          <div className="task-run-head">
                            <strong>{run.status === 'success' ? '成功' : run.status === 'failed' ? '失败' : '运行中'}</strong>
                            <span>{formatTaskTimestamp(run.startedAt)}</span>
                          </div>
                          {run.summary && <div className="task-run-copy">{run.summary}</div>}
                          {run.error && <div className="task-run-copy">{run.error}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="calendar-empty">请选择左侧任务，或新建一个定时任务</div>
              )}
            </section>

            {showTaskForm && (
              <form className="calendar-form" onSubmit={submitTask}>
                <div className="calendar-form-title">{editingTaskId ? '编辑定时任务' : '新建定时任务'}</div>

                <label className="calendar-field">
                  <span>标题</span>
                  <input
                    value={taskForm.title}
                    onChange={(event) =>
                      setTaskForm((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="例如：每天整理今天笔记"
                    autoFocus
                  />
                </label>

                <div className="calendar-time-row">
                  <label className="calendar-field">
                    <span>目标</span>
                    <select
                      value={taskForm.target}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          target: event.target.value as ScheduledTaskTarget,
                        }))
                      }
                    >
                      <option value="agent">Agent 回调</option>
                      <option value="terminal">终端命令</option>
                    </select>
                  </label>
                  <label className="calendar-field">
                    <span>类型</span>
                    <select
                      value={taskForm.mode}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          mode: event.target.value as ScheduledTaskMode,
                          endDate:
                            event.target.value === 'ongoing' ? '' : current.endDate,
                        }))
                      }
                    >
                      <option value="once">单次</option>
                      <option value="recurring">循环</option>
                      <option value="ongoing">长期</option>
                    </select>
                  </label>
                </div>

                <div className="calendar-time-row">
                  <label className="calendar-field">
                    <span>开始日期</span>
                    <input
                      type="date"
                      value={taskForm.startDate}
                      onChange={(event) =>
                        setTaskForm((current) => ({ ...current, startDate: event.target.value }))
                      }
                    />
                  </label>
                  <label className="calendar-field">
                    <span>时间</span>
                    <input
                      type="time"
                      value={taskForm.time}
                      onChange={(event) =>
                        setTaskForm((current) => ({ ...current, time: event.target.value }))
                      }
                    />
                  </label>
                </div>

                {taskForm.mode !== 'once' && (
                  <>
                    <div className="calendar-time-row">
                      <label className="calendar-field">
                        <span>重复单位</span>
                        <select
                          value={taskForm.repeatUnit}
                          onChange={(event) =>
                            setTaskForm((current) => ({
                              ...current,
                              repeatUnit: event.target.value as ScheduledTaskRepeatUnit,
                              repeatWeekdays:
                                event.target.value === 'week' ? current.repeatWeekdays : [],
                            }))
                          }
                        >
                          <option value="day">每天</option>
                          <option value="week">每周</option>
                          <option value="month">每月</option>
                        </select>
                      </label>
                      <label className="calendar-field">
                        <span>间隔</span>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={taskForm.repeatInterval}
                          onChange={(event) =>
                            setTaskForm((current) => ({
                              ...current,
                              repeatInterval: Number(event.target.value) || 1,
                            }))
                          }
                        />
                      </label>
                    </div>

                    {taskForm.repeatUnit === 'week' && (
                      <div className="weekday-picker">
                        {REPEAT_WEEKDAYS.map((weekday) => {
                          const active = taskForm.repeatWeekdays.includes(weekday.value)
                          return (
                            <button
                              type="button"
                              key={weekday.value}
                              className={'weekday-chip' + (active ? ' active' : '')}
                              onClick={() =>
                                setTaskForm((current) => ({
                                  ...current,
                                  repeatWeekdays: active
                                    ? current.repeatWeekdays.filter((item) => item !== weekday.value)
                                    : [...current.repeatWeekdays, weekday.value].sort((a, b) => a - b),
                                }))
                              }
                            >
                              周{weekday.label}
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {taskForm.mode === 'recurring' && (
                      <label className="calendar-field">
                        <span>结束日期</span>
                        <input
                          type="date"
                          value={taskForm.endDate}
                          onChange={(event) =>
                            setTaskForm((current) => ({ ...current, endDate: event.target.value }))
                          }
                        />
                      </label>
                    )}
                  </>
                )}

                {taskForm.target === 'agent' ? (
                  <label className="calendar-field">
                    <span>Agent 回调提示词</span>
                    <textarea
                      rows={4}
                      value={taskForm.prompt}
                      onChange={(event) =>
                        setTaskForm((current) => ({ ...current, prompt: event.target.value }))
                      }
                      placeholder="例如：整理今天新增的笔记，并输出简短摘要"
                    />
                  </label>
                ) : (
                  <>
                    <label className="calendar-field">
                      <span>终端 Shell</span>
                      <select
                        value={taskForm.shell}
                        onChange={(event) =>
                          setTaskForm((current) => ({
                            ...current,
                            shell: event.target.value as 'powershell' | 'cmd',
                          }))
                        }
                      >
                        <option value="powershell">PowerShell</option>
                        <option value="cmd">CMD</option>
                      </select>
                    </label>
                    <label className="calendar-field">
                      <span>命令</span>
                      <textarea
                        rows={4}
                        value={taskForm.command}
                        onChange={(event) =>
                          setTaskForm((current) => ({ ...current, command: event.target.value }))
                        }
                        placeholder="例如：Get-ChildItem C:\\Users\\lixia\\Desktop"
                      />
                    </label>
                  </>
                )}

                <section className="task-delivery-panel">
                  <div className="task-delivery-head">
                    <strong>触发后推送</strong>
                    <span>默认把提醒结果发回最近的微信会话。</span>
                  </div>
                  <label className="calendar-field">
                    <span>微信推送策略</span>
                    <select
                      value={taskForm.deliveryMode}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          deliveryMode: event.target.value as ScheduledTaskWechatDeliveryMode,
                        }))
                      }
                    >
                      <option value="auto">自动：最近微信会话</option>
                      <option value="fixed">固定：指定账号和会话</option>
                      <option value="off">关闭：只写聊天流和通知</option>
                    </select>
                  </label>

                  {taskForm.deliveryMode === 'fixed' && (
                    <>
                      <label className="calendar-field">
                        <span>选择最近会话</span>
                        <select
                          value=""
                          onChange={(event) => {
                            const target = deliveryTargets.find(
                              (item) => deliveryTargetValue(item) === event.target.value,
                            )
                            if (!target) return
                            setTaskForm((current) => ({
                              ...current,
                              deliveryAccountId: target.accountId,
                              deliveryPeerId: target.peerId,
                            }))
                          }}
                        >
                          <option value="">从历史微信会话填充</option>
                          {deliveryTargets.map((target) => (
                            <option key={deliveryTargetValue(target)} value={deliveryTargetValue(target)}>
                              {target.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="calendar-time-row">
                        <label className="calendar-field">
                          <span>账号 ID</span>
                          <input
                            value={taskForm.deliveryAccountId}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                deliveryAccountId: event.target.value,
                              }))
                            }
                            placeholder="微信账号 ID"
                          />
                        </label>
                        <label className="calendar-field">
                          <span>会话 ID</span>
                          <input
                            value={taskForm.deliveryPeerId}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                deliveryPeerId: event.target.value,
                              }))
                            }
                            placeholder="from_user_id / peerId"
                          />
                        </label>
                      </div>
                    </>
                  )}

                  <label className="calendar-field">
                    <span>飞书推送策略</span>
                    <select
                      value={taskForm.feishuDeliveryMode}
                      onChange={(event) =>
                        setTaskForm((current) => ({
                          ...current,
                          feishuDeliveryMode: event.target.value as ScheduledTaskFeishuDeliveryMode,
                        }))
                      }
                    >
                      <option value="auto">自动：最近飞书会话</option>
                      <option value="fixed">固定：指定 receiveId</option>
                      <option value="off">关闭：不推送到飞书</option>
                    </select>
                  </label>

                  {taskForm.feishuDeliveryMode === 'fixed' && (
                    <>
                      <label className="calendar-field">
                        <span>选择最近飞书会话</span>
                        <select
                          value=""
                          onChange={(event) => {
                            const target = feishuTargets.find(
                              (item) => feishuDeliveryTargetValue(item) === event.target.value,
                            )
                            if (!target) return
                            setTaskForm((current) => ({
                              ...current,
                              feishuReceiveIdType: target.receiveIdType,
                              feishuReceiveId: target.receiveId,
                            }))
                          }}
                        >
                          <option value="">从最近飞书会话填充</option>
                          {feishuTargets.map((target) => (
                            <option
                              key={feishuDeliveryTargetValue(target)}
                              value={feishuDeliveryTargetValue(target)}
                            >
                              {target.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="calendar-time-row">
                        <label className="calendar-field">
                          <span>receiveIdType</span>
                          <select
                            value={taskForm.feishuReceiveIdType}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                feishuReceiveIdType:
                                  event.target.value as ScheduledTaskFeishuReceiveIdType,
                              }))
                            }
                          >
                            <option value="chat_id">chat_id</option>
                            <option value="open_id">open_id</option>
                            <option value="user_id">user_id</option>
                            <option value="union_id">union_id</option>
                            <option value="email">email</option>
                          </select>
                        </label>
                        <label className="calendar-field">
                          <span>receiveId</span>
                          <input
                            value={taskForm.feishuReceiveId}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                feishuReceiveId: event.target.value,
                              }))
                            }
                            placeholder="oc_xxx / ou_xxx / user_id"
                          />
                        </label>
                      </div>
                    </>
                  )}
                </section>

                <label className="calendar-field">
                  <span>备注</span>
                  <textarea
                    rows={3}
                    value={taskForm.notes}
                    onChange={(event) =>
                      setTaskForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="可选"
                  />
                </label>

                <label className="task-enabled-toggle">
                  <input
                    type="checkbox"
                    checked={taskForm.enabled}
                    onChange={(event) =>
                      setTaskForm((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span>保存后立即启用这个任务</span>
                </label>

                <div className="calendar-form-actions">
                  <button type="button" className="chip ghost" onClick={closeTaskForm} disabled={saving}>
                    取消
                  </button>
                  <button type="submit" className="chip primary" disabled={saving}>
                    {saving ? '保存中...' : editingTaskId ? '更新' : '保存'}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
