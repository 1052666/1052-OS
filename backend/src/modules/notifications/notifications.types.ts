export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export type AppNotification = {
  id: string
  title: string
  message: string
  level: NotificationLevel
  read: boolean
  createdAt: number
  source: 'scheduled-task'
  taskId?: string
  taskTitle?: string
  chatMessageId?: number
  chatMessageTs?: number
}

export type NotificationInput = {
  title?: unknown
  message?: unknown
  level?: unknown
  source?: unknown
  taskId?: unknown
  taskTitle?: unknown
  chatMessageId?: unknown
  chatMessageTs?: unknown
}

export type NotificationContext = {
  notificationId: string
  status: 'active' | 'compacted' | 'missing'
  taskId?: string
  taskTitle?: string
  messageId?: number
  compactMessageId?: number
  backupPath?: string
  backupMessageId?: number
  excerpt?: string
}
