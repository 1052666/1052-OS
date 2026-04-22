import type { FeishuCardActionValue } from './feishu.types.js'

type CardActionDefinition = {
  text: string
  style?: 'primary' | 'default' | 'danger'
  value?: FeishuCardActionValue
  url?: string
  disabled?: boolean
}

function toCardButton(action: CardActionDefinition) {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: action.text,
    },
    type: action.style ?? 'default',
    disabled: action.disabled === true,
    value: action.url ? undefined : action.value,
    multi_url: action.url
      ? {
          url: action.url,
          pc_url: action.url,
          ios_url: action.url,
          android_url: action.url,
        }
      : undefined,
  }
}

export function buildFeishuSimpleCard(params: {
  title: string
  subtitle?: string
  content: string
  status?: string
  actions?: CardActionDefinition[]
  note?: string
}) {
  const actions = params.actions ?? []

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: params.title,
      },
      subtitle: params.subtitle
        ? {
            tag: 'plain_text',
            content: params.subtitle,
          }
        : undefined,
      template: actions.some((item) => item.style === 'danger') ? 'red' : 'blue',
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 12px 12px',
      elements: [
        {
          tag: 'markdown',
          content: params.content,
        },
        ...(params.status
          ? [
              {
                tag: 'markdown',
                content: `**Status:** ${params.status}`,
              },
            ]
          : []),
        ...(params.note
          ? [
              {
                tag: 'note',
                elements: [
                  {
                    tag: 'plain_text',
                    content: params.note,
                  },
                ],
              },
            ]
          : []),
        ...(actions.length
          ? [
              {
                tag: 'action',
                actions: actions.map((action) => toCardButton(action)),
              },
            ]
          : []),
      ],
    },
  }
}

export function buildCardToast(
  content: string,
  type: 'info' | 'success' | 'error' | 'warning' = 'info',
) {
  return {
    toast: {
      type,
      content,
    },
  }
}

export function buildCardActionResult(params: {
  title: string
  content: string
  status: string
  actions?: CardActionDefinition[]
  note?: string
}) {
  return {
    toast: {
      type: 'success',
      content: params.status,
    },
    card: {
      type: 'raw',
      data: buildFeishuSimpleCard({
        title: params.title,
        content: params.content,
        status: params.status,
        actions: params.actions,
        note: params.note ?? 'This card has been processed by 1052 OS.',
      }),
    },
  }
}

export function buildFeishuNotificationCard(params: {
  title: string
  message: string
  level: 'info' | 'success' | 'warning' | 'error'
  notificationId: string
  url?: string
}) {
  const status =
    params.level === 'success'
      ? 'Success'
      : params.level === 'warning'
        ? 'Warning'
        : params.level === 'error'
          ? 'Error'
          : 'Info'

  return buildFeishuSimpleCard({
    title: params.title,
    subtitle: '1052 OS Notification',
    content: params.message,
    status,
    actions: [
      {
        text: 'Mark Read',
        style: 'primary',
        value: {
          actionType: 'notification_mark_read',
          notificationId: params.notificationId,
          version: 1,
        },
      },
      ...(params.url
        ? [
            {
              text: 'Open',
              url: params.url,
            } satisfies CardActionDefinition,
          ]
        : []),
    ],
    note: 'Notifications can be cleared directly in Feishu.',
  })
}

export function buildFeishuScheduledTaskCard(params: {
  taskId: string
  taskTitle: string
  summary: string
  status: 'success' | 'failed'
  enabled: boolean
  notificationId?: string
  url?: string
}) {
  return buildFeishuSimpleCard({
    title: params.taskTitle,
    subtitle: '1052 OS Scheduled Task',
    content: params.summary,
    status: params.status === 'success' ? 'Completed' : 'Failed',
    actions: [
      {
        text: 'Run Again',
        style: 'primary',
        value: {
          actionType: 'task_run_now',
          taskId: params.taskId,
          version: 1,
        },
      },
      {
        text: params.enabled ? 'Pause Task' : 'Resume Task',
        value: {
          actionType: 'task_toggle_enabled',
          taskId: params.taskId,
          enabled: !params.enabled,
          version: 1,
        },
      },
      ...(params.notificationId
        ? [
            {
              text: 'Mark Read',
              value: {
                actionType: 'notification_mark_read',
                notificationId: params.notificationId,
                version: 1,
              },
            } satisfies CardActionDefinition,
          ]
        : []),
      ...(params.url
        ? [
            {
              text: 'Open Schedule',
              url: params.url,
            } satisfies CardActionDefinition,
          ]
        : []),
    ],
    note: 'You can re-run or change the task state directly from this card.',
  })
}

export function buildFeishuMemorySuggestionCard(params: {
  suggestionId: string
  title: string
  content: string
  tags?: string[]
  url?: string
}) {
  const tagLine = params.tags?.length ? `\n\nTags: ${params.tags.join(', ')}` : ''

  return buildFeishuSimpleCard({
    title: params.title,
    subtitle: '1052 OS Memory Suggestion',
    content: `${params.content}${tagLine}`,
    status: 'Pending Review',
    actions: [
      {
        text: 'Confirm',
        style: 'primary',
        value: {
          actionType: 'memory_confirm_suggestion',
          entityType: 'memory-suggestion',
          entityId: params.suggestionId,
          version: 1,
        },
      },
      {
        text: 'Reject',
        style: 'danger',
        value: {
          actionType: 'memory_reject_suggestion',
          entityType: 'memory-suggestion',
          entityId: params.suggestionId,
          version: 1,
        },
      },
      ...(params.url
        ? [
            {
              text: 'Open Memory',
              url: params.url,
            } satisfies CardActionDefinition,
          ]
        : []),
    ],
    note: 'Memory suggestions require explicit confirmation before they become active.',
  })
}

export function normalizeCardActionValue(value: unknown): FeishuCardActionValue {
  if (!value || typeof value !== 'object') {
    return {
      actionType: 'unknown',
    }
  }

  const raw = value as Record<string, unknown>
  return {
    actionType:
      typeof raw.actionType === 'string' && raw.actionType.trim()
        ? raw.actionType.trim()
        : 'unknown',
    entityType: typeof raw.entityType === 'string' ? raw.entityType.trim() : undefined,
    entityId: typeof raw.entityId === 'string' ? raw.entityId.trim() : undefined,
    notificationId:
      typeof raw.notificationId === 'string' ? raw.notificationId.trim() : undefined,
    taskId: typeof raw.taskId === 'string' ? raw.taskId.trim() : undefined,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
    receiveId: typeof raw.receiveId === 'string' ? raw.receiveId.trim() : undefined,
    url: typeof raw.url === 'string' ? raw.url.trim() : undefined,
    source: typeof raw.source === 'string' ? raw.source.trim() : undefined,
    version:
      typeof raw.version === 'number' && Number.isFinite(raw.version)
        ? raw.version
        : undefined,
  }
}
