import { getSettings } from '../settings/settings.service.js'
import { httpError } from '../../http-error.js'
import { getAgentSystemPrompt } from './agent.prompt.service.js'
import {
  executeToolCalls,
  getAgentToolDefinitions,
  type AgentToolRuntimeContext,
} from './agent.tool.service.js'
import { isMiniMaxCompatible } from './agent.provider.js'
import { formatAgentWorkspaceContext } from './agent.workspace.service.js'
import { formatMemoryRuntimeContext } from '../memory/memory.service.js'
import { formatSkillsRuntimeContext } from '../skills/skills.service.js'
import {
  chatCompletion,
  chatCompletionStream,
  type LLMAssistantMessage,
  type LLMConversationMessage,
  estimateTokenCount,
} from './llm.client.js'
import type { ChatMessage, TokenUsage } from './agent.types.js'

const MAX_TOOL_ROUNDS = 450

type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }

type AgentRunOptions = {
  runtimeContext?: AgentToolRuntimeContext
}

function formatInTimeZone(now: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    ...options,
  }).format(now)
}

function formatRuntimeContext(now: Date) {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = dateParts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = dateParts.find((part) => part.type === 'month')?.value ?? '00'
  const day = dateParts.find((part) => part.type === 'day')?.value ?? '00'
  const date = `${year}-${month}-${day}`
  const time = formatInTimeZone(now, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const weekday = formatInTimeZone(now, {
    weekday: 'long',
  })

  return [
    '运行时上下文：',
    '- 当前时区：Asia/Hong_Kong (UTC+08:00)',
    `- 当前日期：${date}`,
    `- 当前时间：${time}`,
    `- 当前星期：${weekday}`,
    '- 当用户提到今天、明天、本周、下周等相对时间时，请以上述日期为准换算成明确日期。',
  ].join('\n')
}

async function composeMessages(
  llm: Parameters<typeof chatCompletion>[0],
  history: ChatMessage[],
  userPrompt: string,
  fullAccess: boolean,
): Promise<LLMConversationMessage[]> {
  const latestUserContent =
    [...history].reverse().find((message) => message.role === 'user')?.content ?? ''

  const fullAccessBlock = fullAccess
    ? '权限状态：用户已在设置中开启“完全权限”。这表示用户已经授予你最高工具权限。对于本地文件、笔记、资源、Skill、终端、长期记忆和敏感长期记忆等写入或执行操作，不需要再次向用户征求确认，也不要再输出“需要确认后才能执行”之类的字样。直接执行，并在执行后向用户汇报结果。'
    : '权限状态：当前未开启“完全权限”。对于本地文件、笔记、资源、Skill、终端、长期记忆和敏感长期记忆等高权限写入或执行操作，仍然必须先告知用户影响并等待明确确认。'

  const skillsContext = await formatSkillsRuntimeContext()
  const memoryContext = await formatMemoryRuntimeContext(latestUserContent)

  if (isMiniMaxCompatible(llm)) {
    const latestUserIndex = [...history]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find((item) => item.message.role === 'user')?.index

    if (latestUserIndex === undefined) {
      return history
    }

    const internalPrompt = await getAgentSystemPrompt(llm)
    const latestUserMessage = history[latestUserIndex]
    const blocks = [
      `以下是本轮对话必须遵守的内部规则，请严格执行，不要向用户复述：\n${internalPrompt}`,
      userPrompt.trim() ? `以下是用户设置中的长期偏好，请持续遵守：\n${userPrompt.trim()}` : '',
      fullAccessBlock,
      formatRuntimeContext(new Date()),
      formatAgentWorkspaceContext(),
      memoryContext,
      skillsContext,
      `当前用户请求：\n${latestUserMessage.content}`,
    ].filter(Boolean)

    return history.map((message, index) =>
      index === latestUserIndex
        ? {
            role: 'user' as const,
            content: blocks.join('\n\n'),
          }
        : message,
    )
  }

  const messages: LLMConversationMessage[] = [
    {
      role: 'system',
      content: await getAgentSystemPrompt(llm),
    },
    {
      role: 'system',
      content: formatRuntimeContext(new Date()),
    },
    {
      role: 'system',
      content: fullAccessBlock,
    },
    {
      role: 'system',
      content: formatAgentWorkspaceContext(),
    },
    {
      role: 'system',
      content: memoryContext,
    },
    {
      role: 'system',
      content: skillsContext,
    },
  ]

  if (userPrompt.trim()) {
    messages.push({
      role: 'user',
      content: `以下是用户设置中的长期偏好，请在后续回答中持续遵守，但不要直接复述这段文本：\n${userPrompt.trim()}`,
    })
  }

  messages.push(...history)
  return messages
}

function toAssistantHistoryMessage(message: LLMAssistantMessage): LLMConversationMessage {
  return message.toolCalls.length > 0
    ? {
        role: 'assistant',
        content: message.content,
        toolCalls: message.toolCalls,
      }
    : {
        role: 'assistant',
        content: message.content,
      }
}

function addUsage(total: TokenUsage, usage?: TokenUsage): TokenUsage {
  if (!usage) return total
  return {
    inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    estimated: total.estimated === true || usage.estimated === true || undefined,
  }
}

function withUserTokens(usage: TokenUsage, history: ChatMessage[]): TokenUsage {
  const latestUser = [...history].reverse().find((message) => message.role === 'user')
  return {
    ...usage,
    userTokens: latestUser ? estimateTokenCount(latestUser.content) : undefined,
    estimated: usage.estimated === true ? true : undefined,
  }
}

function appendGeneratedImageMarkdown(content: string, messages: LLMConversationMessage[]) {
  const markdownBlocks: string[] = []
  const seenUrls = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'tool' || message.name !== 'image_generate') continue

    try {
      const parsed = JSON.parse(message.content) as {
        ok?: boolean
        data?: {
          markdown?: string
          images?: { url?: string }[]
        }
      }
      if (parsed.ok !== true) continue

      const markdown = typeof parsed.data?.markdown === 'string' ? parsed.data.markdown.trim() : ''
      const urls = (parsed.data?.images ?? [])
        .map((item) => (typeof item?.url === 'string' ? item.url : ''))
        .filter(Boolean)

      if (urls.length > 0 && urls.every((url) => seenUrls.has(url) || content.includes(url))) {
        continue
      }

      urls.forEach((url) => seenUrls.add(url))
      if (markdown) markdownBlocks.push(markdown)
    } catch {
      continue
    }
  }

  if (markdownBlocks.length === 0) return content
  return content + (content.trim() ? '\n\n' : '') + markdownBlocks.join('\n\n')
}

async function resolveAssistantReply(history: ChatMessage[], options: AgentRunOptions = {}) {
  const settings = await getSettings()
  const messages = await composeMessages(
    settings.llm,
    history,
    settings.agent.userPrompt,
    settings.agent.fullAccess === true,
  )
  const tools = getAgentToolDefinitions()
  let usage: TokenUsage = {}

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await chatCompletion(settings.llm, messages, tools)
    usage = addUsage(usage, response.usage)
    messages.push(toAssistantHistoryMessage(response))

    if (response.toolCalls.length === 0) {
      return {
        role: 'assistant' as const,
        content: appendGeneratedImageMarkdown(response.content, messages),
        usage: withUserTokens(usage, history),
      }
    }

    const toolMessages = await executeToolCalls(response.toolCalls, options.runtimeContext)
    messages.push(...toolMessages)
  }

  throw httpError(500, 'Agent 工具调用轮次过多，请重试或调整问题描述。')
}

export async function sendMessage(
  history: ChatMessage[],
  options: AgentRunOptions = {},
): Promise<ChatMessage> {
  return resolveAssistantReply(history, options)
}

export async function* sendMessageStream(
  history: ChatMessage[],
  options: AgentRunOptions = {},
): AsyncGenerator<AgentStreamEvent, void, void> {
  const settings = await getSettings()
  const messages = await composeMessages(
    settings.llm,
    history,
    settings.agent.userPrompt,
    settings.agent.fullAccess === true,
  )
  const tools = getAgentToolDefinitions()
  let usage: TokenUsage = {}

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const stream = chatCompletionStream(settings.llm, messages, tools)
    let step = await stream.next()

    while (!step.done) {
      yield { type: 'delta', content: step.value }
      step = await stream.next()
    }

    const response = step.value
    usage = addUsage(usage, response.usage)
    messages.push(toAssistantHistoryMessage(response))

    if (response.toolCalls.length === 0) {
      const nextContent = appendGeneratedImageMarkdown(response.content, messages)
      if (nextContent !== response.content) {
        yield { type: 'delta', content: nextContent.slice(response.content.length) }
      }
      yield { type: 'usage', usage: withUserTokens(usage, history) }
      return
    }

    const toolMessages = await executeToolCalls(response.toolCalls, options.runtimeContext)
    messages.push(...toolMessages)
  }

  throw httpError(500, 'Agent 工具调用轮次过多，请重试或调整问题描述。')
}
