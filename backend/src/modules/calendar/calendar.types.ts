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
  title?: unknown
  date?: unknown
  startTime?: unknown
  endTime?: unknown
  location?: unknown
  notes?: unknown
}

export type CalendarEventPatch = Partial<CalendarEventInput>

export type CalendarEventQueryInput = {
  date?: unknown
  startDate?: unknown
  endDate?: unknown
  keyword?: unknown
  limit?: unknown
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
  delivery: ScheduledTaskDelivery
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  lastRunStatus: 'success' | 'failed' | null
  lastRunSummary: string
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

export type ScheduledTaskInput = {
  title?: unknown
  notes?: unknown
  target?: unknown
  mode?: unknown
  startDate?: unknown
  time?: unknown
  repeatUnit?: unknown
  repeatInterval?: unknown
  repeatWeekdays?: unknown
  endDate?: unknown
  prompt?: unknown
  command?: unknown
  shell?: unknown
  delivery?: unknown
  enabled?: unknown
}

export type ScheduledTaskPatch = Partial<ScheduledTaskInput>

export type ScheduledTaskQueryInput = {
  target?: unknown
  enabled?: unknown
  limit?: unknown
}
