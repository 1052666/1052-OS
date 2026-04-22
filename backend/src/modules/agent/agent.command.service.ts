import { HttpError } from '../../http-error.js'
import { compactChatHistory } from './agent.compaction.service.js'
import { saveChatHistory } from './agent.history.service.js'

type AgentChatCommandDefinition = {
  command: string
  title: string
  description: string
  kind: 'action' | 'prompt'
  aliases?: string[]
  buildPrompt?: (args: string) => string
}

export type AgentCommandActionResult = {
  handled: true
  mode: 'action'
  command: string
  responseText: string
}

export type AgentCommandPromptResult = {
  handled: true
  mode: 'prompt'
  command: string
  promptText: string
}

export type AgentCommandResolution =
  | AgentCommandActionResult
  | AgentCommandPromptResult

const AGENT_CHAT_COMMANDS: AgentChatCommandDefinition[] = [
  {
    command: '/1052',
    title: '1052 Help',
    description: 'Show the currently available chat commands on social channels.',
    kind: 'action',
    aliases: ['help', 'commands'],
  },
  {
    command: '/new',
    title: 'New Chat',
    description: 'Clear the current shared chat context.',
    kind: 'action',
  },
  {
    command: '/compact',
    title: 'Compact Context',
    description: 'Compress recent chat history and keep a backup file.',
    kind: 'action',
  },
  {
    command: '/notes',
    title: 'Notes Overview',
    description: 'Read the notes library overview and suggest the next step.',
    kind: 'prompt',
    buildPrompt: () =>
      '请读取我的笔记库概览，列出顶层文件夹、笔记数量，并告诉我可以继续怎么查。',
  },
  {
    command: '/search-notes',
    title: 'Search Notes',
    description: 'Search the whole notes library. You can append keywords after the command.',
    kind: 'prompt',
    buildPrompt: (args) =>
      args
        ? `请在我的整个笔记库里搜索“${args}”，返回最相关的笔记标题、路径、摘要，并告诉我下一步还能怎么继续查看。`
        : '请在我的整个笔记库里搜索：',
  },
  {
    command: '/repos',
    title: 'Repositories',
    description: 'List the accessible repositories and quick links.',
    kind: 'prompt',
    buildPrompt: () =>
      '请列出当前工作区里可以访问的项目仓库，并附上仓库快速链接。',
  },
  {
    command: '/calendar',
    title: 'Calendar',
    description: 'Check today and upcoming calendar items.',
    kind: 'prompt',
    buildPrompt: () => '请查看我今天和近期的日程安排。',
  },
  {
    command: '/tools',
    title: 'Available Tools',
    description: 'Explain the currently available tools and which actions still require confirmation.',
    kind: 'prompt',
    buildPrompt: () =>
      '请简要说明你当前可以使用哪些本地工具，以及哪些操作还需要我确认。',
  },
]

const COMMAND_PREFIX = /^[\/\\／＼]/u
const COMMAND_MAP = new Map<string, AgentChatCommandDefinition>()

for (const definition of AGENT_CHAT_COMMANDS) {
  const canonical = definition.command.slice(1).toLowerCase()
  COMMAND_MAP.set(canonical, definition)
  for (const alias of definition.aliases ?? []) {
    COMMAND_MAP.set(alias.toLowerCase(), definition)
  }
}

function normalizeInput(value: string) {
  const trimmed = value.trimStart()
  if (!COMMAND_PREFIX.test(trimmed)) return trimmed
  return `/${trimmed.slice(1)}`
}

function parseCommand(value: string) {
  const normalized = normalizeInput(value)
  if (!normalized.startsWith('/')) return null
  const body = normalized.slice(1).trim()
  if (!body) return null
  const whitespaceIndex = body.search(/\s/u)
  const commandName =
    whitespaceIndex === -1 ? body : body.slice(0, whitespaceIndex)
  const args =
    whitespaceIndex === -1 ? '' : body.slice(whitespaceIndex + 1).trim()
  const definition = COMMAND_MAP.get(commandName.toLowerCase())
  if (!definition) return null
  return {
    definition,
    args,
  }
}

export function formatAgentCommandHelp() {
  return [
    '1052 OS 可用指令：',
    ...AGENT_CHAT_COMMANDS.map(
      (definition) => `- ${definition.command}: ${definition.description}`,
    ),
    '',
    '说明：社交通道里同时支持 / 和 \\ 两种前缀。',
  ].join('\n')
}

export async function resolveAgentCommand(
  value: string,
): Promise<AgentCommandResolution | null> {
  const parsed = parseCommand(value)
  if (!parsed) return null

  const { definition, args } = parsed
  if (definition.kind === 'prompt') {
    const promptText = definition.buildPrompt?.(args).trim()
    if (!promptText) {
      throw new HttpError(400, `Command ${definition.command} does not have a valid prompt.`)
    }
    return {
      handled: true,
      mode: 'prompt',
      command: definition.command,
      promptText,
    }
  }

  if (definition.command === '/1052') {
    return {
      handled: true,
      mode: 'action',
      command: definition.command,
      responseText: formatAgentCommandHelp(),
    }
  }

  if (definition.command === '/new') {
    await saveChatHistory([], 'command-new')
    return {
      handled: true,
      mode: 'action',
      command: definition.command,
      responseText: '当前聊天上下文已清空。',
    }
  }

  if (definition.command === '/compact') {
    const result = await compactChatHistory()
    return {
      handled: true,
      mode: 'action',
      command: definition.command,
      responseText: [
        '上下文已压缩并完成备份。',
        `- 原始消息数：${result.originalCount}`,
        `- 备份文件：${result.backupPath}`,
      ].join('\n'),
    }
  }

  throw new HttpError(400, `Unsupported command: ${definition.command}`)
}
