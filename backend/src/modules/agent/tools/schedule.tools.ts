import { HttpError } from '../../../http-error.js'
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  setScheduledTaskEnabled,
  triggerScheduledTaskNow,
  updateScheduledTask,
} from '../../calendar/calendar.schedule.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function assertConfirmed(value: unknown) {
  if (value !== true) {
    throw new HttpError(
      400,
      'Creating or changing a scheduled task requires telling the user the task title, target, trigger rule, and main effect, then waiting for explicit confirmation.',
    )
  }
}

function runtimeWechatSource(input: Record<string, unknown>) {
  const context =
    input.__runtimeContext && typeof input.__runtimeContext === 'object'
      ? (input.__runtimeContext as Record<string, unknown>)
      : null
  const source =
    context?.source && typeof context.source === 'object'
      ? (context.source as Record<string, unknown>)
      : null
  if (
    source?.channel === 'wechat' &&
    typeof source.accountId === 'string' &&
    typeof source.peerId === 'string' &&
    source.accountId.trim() &&
    source.peerId.trim()
  ) {
    return {
      accountId: source.accountId.trim(),
      peerId: source.peerId.trim(),
    }
  }
  return null
}

function runtimeFeishuSource(input: Record<string, unknown>) {
  const context =
    input.__runtimeContext && typeof input.__runtimeContext === 'object'
      ? (input.__runtimeContext as Record<string, unknown>)
      : null
  const source =
    context?.source && typeof context.source === 'object'
      ? (context.source as Record<string, unknown>)
      : null
  if (
    source?.channel === 'feishu' &&
    typeof source.receiveIdType === 'string' &&
    typeof source.receiveId === 'string' &&
    source.receiveId.trim()
  ) {
    return {
      receiveIdType:
        source.receiveIdType === 'open_id' ||
        source.receiveIdType === 'user_id' ||
        source.receiveIdType === 'union_id' ||
        source.receiveIdType === 'email'
          ? source.receiveIdType
          : 'chat_id',
      receiveId: source.receiveId.trim(),
    }
  }
  return null
}

function withRuntimeDelivery(input: Record<string, unknown>) {
  if (input.delivery !== undefined) return input
  const source = runtimeWechatSource(input)
  const feishuSource = runtimeFeishuSource(input)
  if (!source && !feishuSource) return input
  return {
    ...input,
    delivery: {
      ...(source
        ? {
            wechat: {
              mode: 'fixed',
              accountId: source.accountId,
              peerId: source.peerId,
            },
          }
        : {}),
      ...(feishuSource
        ? {
            feishu: {
              mode: 'fixed',
              receiveIdType: feishuSource.receiveIdType,
              receiveId: feishuSource.receiveId,
            },
          }
        : {}),
    },
  }
}

export const scheduleTools: AgentTool[] = [
  {
    name: 'schedule_list_tasks',
    description:
      'List scheduled tasks. Read-only. Use this to inspect current recurring or one-time automated tasks managed by 1052 OS.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['agent', 'terminal'] },
        enabled: { type: 'boolean' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const tasks = await listScheduledTasks(input)
      return {
        count: tasks.length,
        tasks,
      }
    },
  },
  {
    name: 'schedule_list_runs',
    description:
      'List scheduled task execution history. Read-only. Optional taskId filters execution records for one task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const runs = await listScheduledTaskRuns(
        typeof input.taskId === 'string' ? input.taskId : undefined,
        typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 500) : 50,
      )
      return {
        count: runs.length,
        runs,
      }
    },
  },
  {
    name: 'schedule_create_task',
    description:
      'Create a scheduled task. Supports once, recurring, or ongoing tasks. Target can be agent or terminal. Before calling, tell the user the schedule rule and effect, then wait for explicit confirmation. If the request comes from WeChat or Feishu and delivery is omitted, the task will be pinned to that conversation automatically.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        target: { type: 'string', enum: ['agent', 'terminal'] },
        mode: { type: 'string', enum: ['once', 'recurring', 'ongoing'] },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM in 24-hour format' },
        repeatUnit: { type: 'string', enum: ['day', 'week', 'month'] },
        repeatInterval: { type: 'number' },
        repeatWeekdays: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional weekdays for weekly recurrence. 0=Sunday, 6=Saturday.',
        },
        endDate: { type: 'string', description: 'Optional YYYY-MM-DD for recurring tasks.' },
        prompt: { type: 'string', description: 'Required when target is agent.' },
        command: { type: 'string', description: 'Required when target is terminal.' },
        shell: { type: 'string', enum: ['powershell', 'cmd'] },
        delivery: {
          type: 'object',
          description:
            'Optional delivery config. WeChat and Feishu both support auto, fixed, or off modes.',
          properties: {
            wechat: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['auto', 'fixed', 'off'] },
                accountId: { type: 'string' },
                peerId: { type: 'string' },
              },
              additionalProperties: false,
            },
            feishu: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['auto', 'fixed', 'off'] },
                receiveIdType: {
                  type: 'string',
                  enum: ['chat_id', 'open_id', 'user_id', 'union_id', 'email'],
                },
                receiveId: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        enabled: { type: 'boolean' },
        confirmed: { type: 'boolean' },
      },
      required: ['title', 'target', 'mode', 'startDate', 'time', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return createScheduledTask(withRuntimeDelivery(input))
    },
  },
  {
    name: 'schedule_update_task',
    description:
      'Update a scheduled task. Before calling, tell the user the task id and the change summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        target: { type: 'string', enum: ['agent', 'terminal'] },
        mode: { type: 'string', enum: ['once', 'recurring', 'ongoing'] },
        startDate: { type: 'string' },
        time: { type: 'string' },
        repeatUnit: { type: 'string', enum: ['day', 'week', 'month'] },
        repeatInterval: { type: 'number' },
        repeatWeekdays: { type: 'array', items: { type: 'number' } },
        endDate: { type: 'string' },
        prompt: { type: 'string' },
        command: { type: 'string' },
        shell: { type: 'string', enum: ['powershell', 'cmd'] },
        delivery: {
          type: 'object',
          description:
            'Optional delivery config. WeChat and Feishu mode can be auto, fixed, or off.',
          properties: {
            wechat: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['auto', 'fixed', 'off'] },
                accountId: { type: 'string' },
                peerId: { type: 'string' },
              },
              additionalProperties: false,
            },
            feishu: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['auto', 'fixed', 'off'] },
                receiveIdType: {
                  type: 'string',
                  enum: ['chat_id', 'open_id', 'user_id', 'union_id', 'email'],
                },
                receiveId: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        enabled: { type: 'boolean' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return updateScheduledTask(String(input.id ?? ''), input)
    },
  },
  {
    name: 'schedule_delete_task',
    description:
      'Delete a scheduled task permanently. Before calling, tell the user the task id, title, and effect, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return deleteScheduledTask(String(input.id ?? ''))
    },
  },
  {
    name: 'schedule_pause_task',
    description:
      'Pause a scheduled task so it stops executing until resumed. Before calling, tell the user the task id and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return setScheduledTaskEnabled(String(input.id ?? ''), false)
    },
  },
  {
    name: 'schedule_resume_task',
    description:
      'Resume a paused scheduled task. Before calling, tell the user the task id and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return setScheduledTaskEnabled(String(input.id ?? ''), true)
    },
  },
  {
    name: 'schedule_run_task_now',
    description:
      'Trigger a scheduled task immediately. Before calling, tell the user the task id and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return triggerScheduledTaskNow(String(input.id ?? ''))
    },
  },
]
