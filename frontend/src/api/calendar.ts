import { api } from './client'

export type CalendarEvent = {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  location: string
  notes: string
  createdAt: number
  updatedAt: number
}

export type CalendarEventInput = {
  title: string
  date: string
  startTime?: string
  endTime?: string
  location?: string
  notes?: string
}

export type ScheduledTaskTarget = 'agent' | 'terminal'
export type ScheduledTaskMode = 'once' | 'recurring' | 'ongoing'
export type ScheduledTaskRepeatUnit = 'day' | 'week' | 'month'
export type ScheduledTaskWechatDeliveryMode = 'auto' | 'fixed' | 'off'
export type ScheduledTaskFeishuDeliveryMode = 'auto' | 'fixed' | 'off'
export type ScheduledTaskFeishuReceiveIdType =
  | 'chat_id'
  | 'open_id'
  | 'user_id'
  | 'union_id'
  | 'email'

export type ScheduledTaskDelivery = {
  wechat: {
    mode: ScheduledTaskWechatDeliveryMode
    accountId: string
    peerId: string
  }
  feishu: {
    mode: ScheduledTaskFeishuDeliveryMode
    receiveIdType: ScheduledTaskFeishuReceiveIdType
    receiveId: string
  }
}

export type ScheduledTask = {
  id: string
  title: string
  notes: string
  target: ScheduledTaskTarget
  mode: ScheduledTaskMode
  startDate: string
  time: string
  timezone: 'Asia/Hong_Kong'
  repeatUnit: ScheduledTaskRepeatUnit | ''
  repeatInterval: number
  repeatWeekdays: number[]
  endDate: string
  prompt: string
  command: string
  shell: 'powershell' | 'cmd'
  delivery?: ScheduledTaskDelivery
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  lastRunStatus: 'success' | 'failed' | null
  lastRunSummary: string
}

export type ScheduledTaskInput = {
  title: string
  notes?: string
  target: ScheduledTaskTarget
  mode: ScheduledTaskMode
  startDate: string
  time: string
  repeatUnit?: ScheduledTaskRepeatUnit
  repeatInterval?: number
  repeatWeekdays?: number[]
  endDate?: string
  prompt?: string
  command?: string
  shell?: 'powershell' | 'cmd'
  delivery?: ScheduledTaskDelivery
  enabled?: boolean
}

export type ScheduledTaskRun = {
  id: string
  taskId: string
  taskTitle: string
  target: ScheduledTaskTarget
  status: 'running' | 'success' | 'failed'
  triggerAt: number
  startedAt: number
  finishedAt: number | null
  summary: string
  error: string
}

export const CalendarApi = {
  listEvents: () => api.get<CalendarEvent[]>('/calendar/events'),
  createEvent: (event: CalendarEventInput) =>
    api.post<CalendarEvent>('/calendar/events', event),
  updateEvent: (id: string, event: Partial<CalendarEventInput>) =>
    api.put<CalendarEvent>('/calendar/events/' + id, event),
  deleteEvent: (id: string) => api.delete<void>('/calendar/events/' + id),

  listTasks: () => api.get<ScheduledTask[]>('/calendar/tasks'),
  createTask: (task: ScheduledTaskInput) =>
    api.post<ScheduledTask>('/calendar/tasks', task),
  updateTask: (id: string, task: Partial<ScheduledTaskInput>) =>
    api.put<ScheduledTask>('/calendar/tasks/' + id, task),
  deleteTask: (id: string) => api.delete<void>('/calendar/tasks/' + id),
  pauseTask: (id: string) => api.post<ScheduledTask>('/calendar/tasks/' + id + '/pause', {}),
  resumeTask: (id: string) => api.post<ScheduledTask>('/calendar/tasks/' + id + '/resume', {}),
  runTaskNow: (id: string) => api.post<ScheduledTask>('/calendar/tasks/' + id + '/run', {}),
  listTaskRuns: (taskId?: string) =>
    api.get<ScheduledTaskRun[]>('/calendar/task-runs' + (taskId ? '?taskId=' + encodeURIComponent(taskId) : '')),
}
