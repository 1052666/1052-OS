import { api } from './client'

export type AppNotification = {
  id: string
  title: string
  message: string
  level: 'info' | 'success' | 'warning' | 'error'
  read: boolean
  createdAt: number
  source: 'scheduled-task'
  taskId?: string
  taskTitle?: string
  chatMessageId?: number
  chatMessageTs?: number
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

export const NotificationsApi = {
  list: () => api.get<AppNotification[]>('/notifications'),
  unreadCount: () => api.get<{ unread: number }>('/notifications/unread-count'),
  getContext: (id: string) => api.get<NotificationContext>('/notifications/' + id + '/context'),
  markRead: (id: string) => api.post<AppNotification>('/notifications/' + id + '/read', {}),
  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all', {}),
}
