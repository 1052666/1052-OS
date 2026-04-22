import {
  createCalendarEvent,
  queryCalendarEvents,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../../calendar/calendar.service.js'
import type { AgentTool } from '../agent.tool.types.js'

export const calendarTools: AgentTool[] = [
  {
    name: 'calendar_create_event',
    description:
      '创建新的日历行程。适用于添加会议、预约、提醒、拜访、待办时间块等安排。',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '行程标题，例如 与产品团队周会',
        },
        date: {
          type: 'string',
          description: '行程日期，格式必须是 YYYY-MM-DD',
        },
        startTime: {
          type: 'string',
          description: '开始时间，24 小时制 HH:MM，可选',
        },
        endTime: {
          type: 'string',
          description: '结束时间，24 小时制 HH:MM，可选',
        },
        location: {
          type: 'string',
          description: '地点，可选',
        },
        notes: {
          type: 'string',
          description: '备注，可选',
        },
      },
      required: ['title', 'date'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const event = await createCalendarEvent({
        title: input.title,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location,
        notes: input.notes,
      })

      return {
        event,
      }
    },
  },
  {
    name: 'calendar_list_events',
    description:
      '查询日历行程。适用于获取今天、明天、本周、某一天或某段时间内的安排，也可按关键词筛选。',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '查询某一天的行程，格式 YYYY-MM-DD，可选',
        },
        startDate: {
          type: 'string',
          description: '查询区间开始日期，格式 YYYY-MM-DD，可选',
        },
        endDate: {
          type: 'string',
          description: '查询区间结束日期，格式 YYYY-MM-DD，可选',
        },
        keyword: {
          type: 'string',
          description: '按标题、地点或备注过滤的关键词，可选',
        },
        limit: {
          type: 'number',
          description: '最多返回多少条结果，1 到 50，可选',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const events = await queryCalendarEvents({
        date: input.date,
        startDate: input.startDate,
        endDate: input.endDate,
        keyword: input.keyword,
        limit: typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 50) : undefined,
      })

      return {
        source: 'current-persisted-calendar-events',
        count: events.length,
        events,
        note:
          events.length === 0
            ? '当前持久化日历数据中没有匹配日程。不要使用聊天历史里的旧日程补全结果。'
            : '这些是当前持久化日历数据中的匹配日程。',
      }
    },
  },
  {
    name: 'calendar_update_event',
    description:
      '更新已有日历行程。适用于修改已存在行程的标题、日期、时间、地点或备注。通常先查询，再根据返回的 event id 更新。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '要更新的行程 id，必须来自之前查询结果',
        },
        title: {
          type: 'string',
          description: '新的行程标题，可选',
        },
        date: {
          type: 'string',
          description: '新的日期，格式 YYYY-MM-DD，可选',
        },
        startTime: {
          type: 'string',
          description: '新的开始时间，24 小时制 HH:MM，可选',
        },
        endTime: {
          type: 'string',
          description: '新的结束时间，24 小时制 HH:MM，可选',
        },
        location: {
          type: 'string',
          description: '新的地点，可选',
        },
        notes: {
          type: 'string',
          description: '新的备注，可选',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const event = await updateCalendarEvent(String(input.id ?? ''), {
        title: input.title,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location,
        notes: input.notes,
      })

      return {
        event,
      }
    },
  },
  {
    name: 'calendar_delete_event',
    description:
      '删除已有日历行程。适用于取消、移除某个已存在的安排。通常先查询，再根据返回的 event id 删除。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '要删除的行程 id，必须来自之前查询结果',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const id = String(input.id ?? '')
      await deleteCalendarEvent(id)

      return {
        deleted: true,
        id,
      }
    },
  },
]
