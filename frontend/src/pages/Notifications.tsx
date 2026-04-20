import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NotificationsApi, type AppNotification } from '../api/notifications'

export default function Notifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setItems(await NotificationsApi.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const markRead = async (id: string) => {
    const next = await NotificationsApi.markRead(id)
    setItems((current) => current.map((item) => (item.id === id ? next : item)))
  }

  const markAll = async () => {
    await NotificationsApi.markAllRead()
    setItems((current) => current.map((item) => ({ ...item, read: true })))
  }

  const jumpToChat = async (item: AppNotification) => {
    if (!item.read) {
      const next = await NotificationsApi.markRead(item.id)
      setItems((current) => current.map((entry) => (entry.id === item.id ? next : entry)))
    }
    navigate('/chat?notification=' + encodeURIComponent(item.id))
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>通知中心</h1>
          <div className="muted">定时任务触发后的提醒和执行结果会保存在这里。</div>
        </div>
        <div className="toolbar">
          <button className="chip ghost" onClick={() => void markAll()}>
            全部已读
          </button>
          <button className="chip ghost" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </header>

      <div className="task-list">
        {loading ? (
          <div className="calendar-empty">加载中...</div>
        ) : items.length === 0 ? (
          <div className="calendar-empty">还没有通知</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={'task-card notification-card' + (item.read ? '' : ' unread')}
            >
              <div className="task-card-head">
                <div>
                  <div className="task-card-title">{item.title}</div>
                  <div className="task-card-meta">
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </div>
                </div>
                <span className={'task-state ' + (item.read ? 'off' : 'on')}>
                  {item.read ? '已读' : '未读'}
                </span>
              </div>
              <div className="task-run-copy">{item.message}</div>
              <div className="task-detail-actions">
                <button className="chip ghost" onClick={() => void jumpToChat(item)}>
                  跳回聊天
                </button>
                {!item.read && (
                  <button className="chip ghost" onClick={() => void markRead(item.id)}>
                    标记已读
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
