import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'
import {
  createWechatDesktopGroupMemoryView,
  listWechatDesktopGroupMemoriesView,
  listWechatDesktopGroupsView,
  listWechatDesktopSessionsView,
  sendWechatDesktopDirectMessage,
} from '../../channels/wechat-desktop/wechat-desktop.service.js'

function currentGroupId(args: Record<string, unknown>) {
  const runtimeContext =
    args.__runtimeContext && typeof args.__runtimeContext === 'object'
      ? (args.__runtimeContext as Record<string, unknown>)
      : null
  const source =
    runtimeContext?.source && typeof runtimeContext.source === 'object'
      ? (runtimeContext.source as Record<string, unknown>)
      : null
  if (typeof args.groupId === 'string' && args.groupId.trim()) return args.groupId.trim()
  return typeof source?.groupId === 'string' ? source.groupId.trim() : ''
}

function currentSessionName(args: Record<string, unknown>) {
  const runtimeContext =
    args.__runtimeContext && typeof args.__runtimeContext === 'object'
      ? (args.__runtimeContext as Record<string, unknown>)
      : null
  const source =
    runtimeContext?.source && typeof runtimeContext.source === 'object'
      ? (runtimeContext.source as Record<string, unknown>)
      : null
  if (typeof args.sessionName === 'string' && args.sessionName.trim()) return args.sessionName.trim()
  return typeof source?.sessionName === 'string' ? source.sessionName.trim() : ''
}

function ensureGroupContext(args: Record<string, unknown>) {
  const groupId = currentGroupId(args)
  if (!groupId) {
    throw new HttpError(
      400,
      'This tool needs a WeChat group context. Pass groupId explicitly, or call it while handling a wechat_desktop group message.',
    )
  }
  return groupId
}

export const wechatDesktopTools: AgentTool[] = [
  {
    name: 'wechat_desktop_list_sessions',
    description:
      'List configured/discovered WeChat desktop sessions. Use when you need to know which desktop WeChat conversation names are available before sending a message.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => listWechatDesktopSessionsView(),
  },
  {
    name: 'wechat_desktop_send_message',
    description:
      'Send a proactive text message through the Windows desktop WeChat automation channel. Use this when the user asks you to send something to a WeChat chat from another channel, from the web UI, or as a separate cross-channel action. Do not use this tool merely to reply to the current inbound wechat_desktop group mention; that reply is delivered automatically from your final answer. Prefer an explicit sessionName. In a wechat_desktop runtime context, sessionName can default to the current conversation only for explicit proactive sends.',
    parameters: {
      type: 'object',
      properties: {
        sessionName: {
          type: 'string',
          description: 'Exact WeChat session/chat name. If omitted during a wechat_desktop conversation, defaults to the current session.',
        },
        text: {
          type: 'string',
          description: 'Message text to send.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const sessionName = currentSessionName(input)
      if (!sessionName) {
        throw new HttpError(400, 'sessionName is required when there is no current wechat_desktop session context.')
      }
      return sendWechatDesktopDirectMessage({
        sessionName,
        text: typeof input.text === 'string' ? input.text : '',
      })
    },
  },
  {
    name: 'wechat_group_memory_list',
    description:
      'List long-term memories that belong to a specific WeChat group. Use this when a task depends on past context from a particular group instead of the global memory system.',
    parameters: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'WeChat desktop group ID. If omitted in a current wechat_desktop group context, defaults to that current group.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return listWechatDesktopGroupMemoriesView(ensureGroupContext(input))
    },
  },
  {
    name: 'wechat_group_memory_write',
    description:
      'Write a long-term memory item into a specific WeChat group memory store. Use this when the current task is clearly group-specific, especially if a user in that group explicitly asks you to remember something for that group later.',
    parameters: {
      type: 'object',
      properties: {
        groupId: {
          type: 'string',
          description: 'WeChat desktop group ID. If omitted in a current wechat_desktop group context, defaults to that current group.',
        },
        title: {
          type: 'string',
          description: 'Short group-memory title.',
        },
        content: {
          type: 'string',
          description: 'The actual group-specific long-term memory content.',
        },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const groupId = ensureGroupContext(input)
      return createWechatDesktopGroupMemoryView({
        groupId,
        title: typeof input.title === 'string' ? input.title : '',
        content: typeof input.content === 'string' ? input.content : '',
        source: 'tool_write',
      })
    },
  },
  {
    name: 'wechat_group_list',
    description:
      'List configured WeChat desktop groups together with their mode, prompt appendix, and permission flags. Use this before reading or writing group-specific state when you are not already inside that group context.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => listWechatDesktopGroupsView(),
  },
]
