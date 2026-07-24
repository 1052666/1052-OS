import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CalendarEvent, ScheduledTask } from '../../contracts/schemas'
import { calendarApi, orchestrationApi } from '../../data/api'
import { DataTable } from '../../components/ui/DataTable'
import { AsyncState, Badge, Button, Dialog, Field, Input, Select, Surface, Switch, Textarea, uiStyles } from '../../components/ui'
import pageStyles from '../../pages/pages.module.css'
import styles from './automation.module.css'

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
  target: 'agent' | 'terminal'
  mode: 'once' | 'recurring' | 'ongoing'
  startDate: string
  time: string
  repeatUnit: '' | 'day' | 'week' | 'month'
  repeatInterval: string
  endDate: string
  prompt: string
  command: string
  shell: string
  enabled: boolean
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const todayIso = new Date().toISOString().slice(0, 10)

const emptyEvent = (date = todayIso): EventForm => ({
  title: '',
  date,
  startTime: '',
  endTime: '',
  location: '',
  notes: '',
})

const emptyTask = (): TaskForm => ({
  title: '',
  notes: '',
  target: 'agent',
  mode: 'once',
  startDate: todayIso,
  time: '09:00',
  repeatUnit: '',
  repeatInterval: '1',
  endDate: '',
  prompt: '',
  command: '',
  shell: 'powershell',
  enabled: true,
})

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function dateLabel(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toLocaleString('zh-CN', { hour12: false })
  if (typeof value === 'string' && value) return value
  return '-'
}

function taskStatusTone(task: ScheduledTask): 'default' | 'success' | 'warning' | 'danger' {
  if (!task.enabled) return 'default'
  if (task.lastRunStatus === 'failed') return 'danger'
  if (task.mode === 'ongoing') return 'warning'
  return 'success'
}

function monthDays(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function eventBody(form: EventForm) {
  return {
    title: form.title.trim(),
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    location: form.location.trim(),
    notes: form.notes.trim(),
  }
}

function taskBody(form: TaskForm) {
  return {
    title: form.title.trim(),
    notes: form.notes.trim(),
    target: form.target,
    mode: form.mode,
    startDate: form.startDate,
    time: form.time,
    timezone: 'Asia/Hong_Kong',
    repeatUnit: form.mode === 'recurring' ? form.repeatUnit || 'day' : '',
    repeatInterval: Number.parseInt(form.repeatInterval, 10) || 1,
    repeatWeekdays: [],
    endDate: form.endDate,
    prompt: form.prompt,
    command: form.command,
    shell: form.shell || 'powershell',
    delivery: {},
    enabled: form.enabled,
  }
}

export function CalendarView() {
  const client = useQueryClient()
  const events = useQuery({ queryKey: ['calendar', 'events'], queryFn: calendarApi.events })
  const [anchor, setAnchor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [form, setForm] = useState<EventForm>(emptyEvent(todayIso))
  const [open, setOpen] = useState(false)
  const refresh = () => void client.invalidateQueries({ queryKey: ['calendar', 'events'] })
  const save = useMutation({
    mutationFn: () => editing ? calendarApi.updateEvent(editing.id, eventBody(form)) : calendarApi.createEvent(eventBody(form)),
    onSuccess: () => { setOpen(false); setEditing(null); refresh() },
  })
  const remove = useMutation({ mutationFn: (id: string) => calendarApi.deleteEvent(id), onSuccess: refresh })
  const days = monthDays(anchor)
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events.data ?? []) map.set(event.date, [...(map.get(event.date) ?? []), event])
    return map
  }, [events.data])
  const selectedEvents = eventMap.get(selectedDate) ?? []
  const editEvent = (event: CalendarEvent) => {
    setEditing(event)
    setForm({ title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime, location: event.location, notes: event.notes })
    setOpen(true)
  }
  const createForDate = (date: string) => {
    setEditing(null)
    setForm(emptyEvent(date))
    setOpen(true)
  }
  return (
    <>
      <div className={pageStyles.grid2}>
        <Surface
          title={`${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`}
          action={<div className={pageStyles.toolbarGroup}><Button size="small" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>上月</Button><Button size="small" onClick={() => setAnchor(new Date())}>今天</Button><Button size="small" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>下月</Button></div>}
        >
          <AsyncState loading={events.isLoading} error={events.error}>
            <div className={styles.calendarGrid}>
              {weekdays.map((day) => <div key={day} className={styles.weekday}>{day}</div>)}
              {days.map((date) => {
                const iso = isoDate(date)
                const dayEvents = eventMap.get(iso) ?? []
                return (
                  <button
                    key={iso}
                    type="button"
                    className={`${styles.dayCell} ${date.getMonth() !== anchor.getMonth() ? styles.mutedDay : ''} ${iso === selectedDate ? styles.selectedDay : ''} ${iso === todayIso ? styles.todayCell : ''}`}
                    onClick={() => setSelectedDate(iso)}
                    onDoubleClick={() => createForDate(iso)}
                  >
                    <span className={styles.dayTop}><strong>{date.getDate()}</strong>{dayEvents.length ? <Badge>{dayEvents.length}</Badge> : null}</span>
                    {dayEvents.slice(0, 3).map((event) => <span key={event.id} className={styles.eventPill}>{event.startTime || '全天'} {event.title}</span>)}
                  </button>
                )
              })}
            </div>
          </AsyncState>
        </Surface>
        <Surface title={selectedDate} action={<Button size="small" variant="primary" onClick={() => createForDate(selectedDate)}><Plus size={14} />新日程</Button>}>
          <AsyncState empty={!selectedEvents.length}>
            <div className={styles.agenda}>
              {selectedEvents.map((event) => (
                <article key={event.id} className={styles.agendaItem}>
                  <time>{event.startTime || '全天'}{event.endTime ? `-${event.endTime}` : ''}</time>
                  <div><strong>{event.title}</strong><small>{event.location || event.notes || '无备注'}</small></div>
                  <div className={styles.compactActions}>
                    <Button size="small" onClick={() => editEvent(event)}>编辑</Button>
                    <Button size="small" variant="danger" onClick={() => remove.mutate(event.id)}><Trash2 size={13} /></Button>
                  </div>
                </article>
              ))}
            </div>
          </AsyncState>
        </Surface>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑日程' : '新建日程'} footer={<Button variant="primary" onClick={() => save.mutate()} disabled={!form.title.trim() || save.isPending}><Save size={14} />保存</Button>}>
        <div className={pageStyles.formGrid}>
          <Field label="标题"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
          <Field label="日期"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
          <Field label="开始时间"><Input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></Field>
          <Field label="结束时间"><Input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></Field>
          <Field label="地点"><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
          <Field label="备注"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  )
}

export function TasksView() {
  const client = useQueryClient()
  const tasks = useQuery({ queryKey: ['calendar', 'tasks'], queryFn: () => calendarApi.tasks() })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [form, setForm] = useState<TaskForm>(emptyTask())
  const refresh = () => void client.invalidateQueries({ queryKey: ['calendar', 'tasks'] })
  const save = useMutation({
    mutationFn: () => editing ? calendarApi.updateTask(editing.id, taskBody(form)) : calendarApi.createTask(taskBody(form)),
    onSuccess: () => { setOpen(false); setEditing(null); refresh() },
  })
  const remove = useMutation({ mutationFn: (id: string) => calendarApi.deleteTask(id), onSuccess: refresh })
  const run = useMutation({ mutationFn: (id: string) => calendarApi.runTask(id), onSuccess: refresh })
  const pause = useMutation({ mutationFn: (id: string) => calendarApi.pauseTask(id), onSuccess: refresh })
  const resume = useMutation({ mutationFn: (id: string) => calendarApi.resumeTask(id), onSuccess: refresh })
  const editTask = (task: ScheduledTask) => {
    setEditing(task)
    setForm({
      title: task.title,
      notes: task.notes,
      target: task.target,
      mode: task.mode,
      startDate: task.startDate,
      time: task.time,
      repeatUnit: task.repeatUnit,
      repeatInterval: String(task.repeatInterval || 1),
      endDate: task.endDate,
      prompt: task.prompt,
      command: task.command,
      shell: task.shell,
      enabled: task.enabled,
    })
    setOpen(true)
  }
  const columns = useMemo<ColumnDef<ScheduledTask>[]>(() => [
    {
      accessorKey: 'title',
      header: '任务',
      cell: ({ row }) => (
        <div className={styles.taskPrimary}>
          <span><span className={`${styles.statusDot} ${row.original.enabled ? styles.statusOn : ''}`} /><strong>{row.original.title}</strong></span>
          <small>{row.original.notes || row.original.prompt || row.original.command || '没有附加说明'}</small>
        </div>
      ),
    },
    { accessorKey: 'mode', header: '模式', cell: ({ row }) => <Badge tone={row.original.mode === 'ongoing' ? 'warning' : 'default'}>{row.original.mode}</Badge> },
    { accessorKey: 'target', header: '目标', cell: ({ getValue }) => <Badge>{getValue() === 'terminal' ? '终端' : 'Agent'}</Badge> },
    { accessorKey: 'nextRunAt', header: '下次运行', cell: ({ getValue }) => dateLabel(getValue()) },
    { accessorKey: 'lastRunStatus', header: '状态', cell: ({ row }) => <Badge tone={taskStatusTone(row.original)}>{row.original.enabled ? row.original.lastRunStatus || '待运行' : '已暂停'}</Badge> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className={uiStyles.rowActions}>
          <Button size="small" aria-label={`运行 ${row.original.title}`} onClick={() => run.mutate(row.original.id)} disabled={run.isPending}><Play size={13} /></Button>
          {row.original.enabled ? <Button size="small" aria-label={`暂停 ${row.original.title}`} onClick={() => pause.mutate(row.original.id)}><Pause size={13} /></Button> : <Button size="small" aria-label={`恢复 ${row.original.title}`} onClick={() => resume.mutate(row.original.id)}><Zap size={13} /></Button>}
          <Button size="small" onClick={() => editTask(row.original)}>编辑</Button>
          <Button size="small" aria-label={`删除 ${row.original.title}`} variant="danger" onClick={() => remove.mutate(row.original.id)}><Trash2 size={13} /></Button>
        </div>
      ),
    },
  ], [pause, remove, resume, run])
  return (
    <>
      <div className={pageStyles.statStrip}>
        <div><strong>{tasks.data?.length ?? 0}</strong><span>任务总数</span></div>
        <div><strong>{tasks.data?.filter((task) => task.enabled).length ?? 0}</strong><span>启用中</span></div>
        <div><strong>{tasks.data?.filter((task) => task.mode === 'recurring').length ?? 0}</strong><span>周期任务</span></div>
        <div><strong>{tasks.data?.filter((task) => task.lastRunStatus === 'failed').length ?? 0}</strong><span>最近失败</span></div>
      </div>
      <Surface title="定时任务" action={<Button size="small" variant="primary" onClick={() => { setEditing(null); setForm(emptyTask()); setOpen(true) }}><Plus size={14} />新任务</Button>}>
        <AsyncState loading={tasks.isLoading} error={tasks.error}>
          <DataTable data={tasks.data ?? []} columns={columns} />
        </AsyncState>
      </Surface>
      <Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑定时任务' : '新建定时任务'} footer={<Button variant="primary" onClick={() => save.mutate()} disabled={!form.title.trim() || save.isPending}><Save size={14} />保存</Button>}>
        <div className={pageStyles.formGrid}>
          <Field label="标题"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
          <Field label="目标"><Select value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value as TaskForm['target'] })}><option value="agent">Agent</option><option value="terminal">终端</option></Select></Field>
          <Field label="模式"><Select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as TaskForm['mode'] })}><option value="once">一次</option><option value="recurring">周期</option><option value="ongoing">持续</option></Select></Field>
          <Field label="开始日期"><Input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></Field>
          <Field label="时间"><Input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></Field>
          <Field label="重复单位"><Select value={form.repeatUnit} onChange={(event) => setForm({ ...form, repeatUnit: event.target.value as TaskForm['repeatUnit'] })}><option value="">不重复</option><option value="day">天</option><option value="week">周</option><option value="month">月</option></Select></Field>
          <Field label="重复间隔"><Input inputMode="numeric" value={form.repeatInterval} onChange={(event) => setForm({ ...form, repeatInterval: event.target.value })} /></Field>
          <Field label="结束日期"><Input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></Field>
          <Field label="Shell"><Input value={form.shell} onChange={(event) => setForm({ ...form, shell: event.target.value })} /></Field>
          <Field label="启用"><Switch label="启用任务" checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></Field>
          <Field label="Agent 提示词"><Textarea value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} /></Field>
          <Field label="终端命令"><Textarea value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} /></Field>
          <Field label="备注"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  )
}

export function RunsView() {
  const [taskId, setTaskId] = useState('')
  const tasks = useQuery({ queryKey: ['calendar', 'tasks'], queryFn: () => calendarApi.tasks() })
  const runs = useQuery({ queryKey: ['calendar', 'runs', taskId], queryFn: () => calendarApi.runs(taskId || undefined), refetchInterval: 8000 })
  const workflows = useQuery({ queryKey: ['orchestration'], queryFn: orchestrationApi.list })
  const [workflowId, setWorkflowId] = useState('')
  const selectedWorkflow = workflowId || workflows.data?.[0]?.id || ''
  const logs = useQuery({ queryKey: ['orchestration', selectedWorkflow, 'logs'], queryFn: () => orchestrationApi.logs(selectedWorkflow), enabled: Boolean(selectedWorkflow), refetchInterval: 8000 })
  const runRows = (runs.data ?? []) as Array<Record<string, unknown>>
  const workflowLogs = (logs.data ?? []) as Array<Record<string, unknown>>
  return (
    <div className={pageStyles.grid2}>
      <Surface
        title="任务执行记录"
        action={<Select value={taskId} onChange={(event) => setTaskId(event.target.value)} aria-label="任务筛选"><option value="">全部任务</option>{tasks.data?.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</Select>}
      >
        <AsyncState loading={runs.isLoading || tasks.isLoading} error={runs.error || tasks.error} empty={!runRows.length}>
          <div className={styles.runPanel}>
            {runRows.slice(0, 30).map((run, index) => (
              <article key={String(run.id ?? index)} className={styles.runLine}>
                <time>{dateLabel(run.startedAt ?? run.createdAt)}</time>
                <div><strong>{text(run.title ?? run.taskTitle, '任务运行')}</strong><p>{text(run.summary ?? run.error ?? run.message, '没有输出摘要')}</p></div>
                <Badge tone={text(run.status) === 'failed' ? 'danger' : text(run.status) === 'success' ? 'success' : 'default'}>{text(run.status, 'unknown')}</Badge>
              </article>
            ))}
          </div>
        </AsyncState>
      </Surface>
      <Surface
        title="流程执行日志"
        action={<Select value={selectedWorkflow} onChange={(event) => setWorkflowId(event.target.value)} aria-label="流程筛选">{workflows.data?.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</Select>}
      >
        <AsyncState loading={logs.isLoading || workflows.isLoading} error={logs.error || workflows.error} empty={!workflowLogs.length}>
          <div className={styles.runPanel}>
            {workflowLogs.slice(0, 30).map((log, index) => (
              <article key={String(log.id ?? index)} className={styles.runLine}>
                <time>{dateLabel(log.timestamp ?? log.createdAt)}</time>
                <div><strong>{text(log.nodeName ?? log.step ?? log.type, '流程步骤')}</strong><p>{text(log.message ?? log.summary ?? log.error, JSON.stringify(log))}</p></div>
                <Badge tone={text(log.status) === 'failed' || text(log.level) === 'error' ? 'danger' : text(log.status) === 'success' ? 'success' : 'default'}>{text(log.status ?? log.level, 'log')}</Badge>
              </article>
            ))}
          </div>
        </AsyncState>
      </Surface>
    </div>
  )
}
