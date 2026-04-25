import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import { getSettings } from '../settings/settings.service.js'
import { chatCompletion } from './llm.client.js'
import {
  getChatHistory,
  saveChatHistory,
  sanitizeStoredMessages,
} from './agent.history.service.js'
import type { ChatHistory, StoredChatMessage } from './agent.types.js'
import { sanitizeStoredMessageForCompaction } from './agent.context-sanitizer.service.js'

const BACKUP_DIR = 'chat-history-backups'
const CHUNK_CHAR_LIMIT = 32_000

function timestamp() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function backupDirPath() {
  return path.join(config.dataDir, BACKUP_DIR)
}

function backupFilePath() {
  return path.join(backupDirPath(), `chat-history-${timestamp()}.json`)
}

function compactDisplayText(
  backupPath: string,
  originalCount: number,
  chunkCount: number,
) {
  return [
    '上下文已压缩，可继续基于摘要对话。',
    '',
    `- 原消息数：${originalCount}`,
    `- 历史分段：${chunkCount}`,
    `- 备份文件：${backupPath}`,
  ].join('\n')
}

function renderMessage(message: StoredChatMessage, index: number) {
  const role =
    message.role === 'user'
      ? '用户'
      : message.role === 'assistant'
        ? 'Agent'
        : '系统'
  const body = message.compactSummary?.trim() || message.content
  return `## ${index + 1}. ${role}\n${body.trim()}`
}

function chunkMessages(messages: StoredChatMessage[]) {
  const chunks: string[] = []
  let current = ''

  for (let index = 0; index < messages.length; index += 1) {
    const block = renderMessage(messages[index], index)
    const next = current ? `${current}\n\n${block}` : block
    if (next.length <= CHUNK_CHAR_LIMIT) {
      current = next
      continue
    }

    if (current) {
      chunks.push(current)
      current = ''
    }

    if (block.length <= CHUNK_CHAR_LIMIT) {
      current = block
      continue
    }

    let start = 0
    while (start < block.length) {
      chunks.push(block.slice(start, start + CHUNK_CHAR_LIMIT))
      start += CHUNK_CHAR_LIMIT
    }
  }

  if (current) chunks.push(current)
  return chunks
}

async function backupHistory(history: ChatHistory) {
  await fs.mkdir(backupDirPath(), { recursive: true })
  const filePath = backupFilePath()
  await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8')
  return filePath
}

async function summarizeChunk(
  text: string,
  index: number,
  total: number,
) {
  const settings = await getSettings()
  const response = await chatCompletion(
    settings.llm,
    [
      {
        role: 'system',
        content:
          '你是聊天上下文压缩器。只输出摘要正文，不要寒暄，不要调用工具，不要回答新问题。',
      },
      {
        role: 'user',
        content: [
          `请压缩第 ${index}/${total} 段聊天历史。`,
          '',
          '要求：',
          '- 提取这一段里用户目标、明确决定、已完成改动、失败点、待办、风险、关键文件与路径。',
          '- 保留后续继续工作必需的信息，删掉寒暄和重复表述。',
          '- 如果这一段包含此前压缩摘要，要把其中仍然有效的信息继续保留。',
          '- 用中文输出，尽量结构化，控制在 600-1200 字。',
          '',
          '聊天历史：',
          text,
        ].join('\n'),
      },
    ],
    [],
    { providerCachingEnabled: settings.agent.providerCachingEnabled },
  )

  const summary = response.content.trim()
  if (!summary) {
    throw new HttpError(502, `上下文压缩失败：第 ${index} 段没有返回摘要`)
  }

  return {
    summary,
    usage: response.usage,
  }
}

async function summarizeFinal(
  chunkSummaries: string[],
) {
  const settings = await getSettings()
  const response = await chatCompletion(
    settings.llm,
    [
      {
        role: 'system',
        content:
          '你是聊天上下文压缩器。只输出最终摘要正文，不要寒暄，不要调用工具，不要回答新问题。',
      },
      {
        role: 'user',
        content: [
          '请把下面这些分段摘要合并成一个可继续对话使用的最终上下文摘要。',
          '',
          '必须覆盖这些部分：',
          '- 用户长期目标、偏好、已确认决定',
          '- 当前进行中的任务和下一步',
          '- 已完成的重要改动、关键模块、文件路径、接口或命令',
          '- 已知问题、风险、待确认事项、测试或重启要求',
          '',
          '输出格式：',
          '## 长期目标与约束',
          '## 当前状态',
          '## 已完成改动',
          '## 待继续事项',
          '## 风险与提醒',
          '',
          '要求：',
          '- 用中文输出。',
          '- 不要遗漏仍然有效的旧信息。',
          '- 不要编造历史中没有的信息。',
          '- 尽量精炼，但覆盖要完整，控制在 1200-2800 字。',
          '',
          '分段摘要：',
          chunkSummaries
            .map((summary, index) => `### 分段 ${index + 1}\n${summary}`)
            .join('\n\n'),
        ].join('\n'),
      },
    ],
    [],
    { providerCachingEnabled: settings.agent.providerCachingEnabled },
  )

  const summary = response.content.trim()
  if (!summary) {
    throw new HttpError(502, '上下文压缩失败：模型没有返回最终摘要')
  }

  return {
    summary,
    usage: response.usage,
  }
}

export async function compactChatHistory(inputMessages?: unknown): Promise<
  ChatHistory & {
    backupPath: string
    originalCount: number
  }
> {
  const currentHistory = inputMessages
    ? { messages: sanitizeStoredMessages(inputMessages) }
    : await getChatHistory()
  const messages = currentHistory.messages
    .map((message) => sanitizeStoredMessageForCompaction(message))
    .filter((message): message is StoredChatMessage => message !== null)

  if (messages.length === 0) {
    throw new HttpError(400, '当前没有可压缩的聊天上下文')
  }

  const backupPath = await backupHistory(currentHistory)
  const chunks = chunkMessages(messages)
  const chunkSummaries: string[] = []
  let finalUsage: StoredChatMessage['usage']

  for (let index = 0; index < chunks.length; index += 1) {
    const result = await summarizeChunk(chunks[index], index + 1, chunks.length)
    chunkSummaries.push(result.summary)
    finalUsage = result.usage
      ? {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          estimated: result.usage.estimated,
        }
      : finalUsage
  }

  const merged =
    chunkSummaries.length === 1
      ? { summary: chunkSummaries[0], usage: finalUsage }
      : await summarizeFinal(chunkSummaries)

  const summary = merged.summary.trim()
  if (!summary) {
    throw new HttpError(502, '上下文压缩失败：模型没有返回最终摘要')
  }

  const lastUserCompact = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim() === '/compact')
  const maxId = messages.reduce((max, message) => Math.max(max, message.id), 0)
  const compactRequest =
    lastUserCompact ??
    ({
      id: maxId + 1,
      role: 'user',
      content: '/compact',
      ts: Date.now(),
    } satisfies StoredChatMessage)

  const compacted: StoredChatMessage[] = [
    compactRequest,
    {
      id: compactRequest.id + 1,
      role: 'assistant',
      ts: Date.now(),
      content: compactDisplayText(backupPath, currentHistory.messages.length, chunks.length),
      compactSummary: summary,
      compactBackupPath: backupPath,
      compactOriginalCount: currentHistory.messages.length,
      usage: merged.usage
        ? {
            inputTokens: merged.usage.inputTokens,
            outputTokens: merged.usage.outputTokens,
            totalTokens: merged.usage.totalTokens,
            estimated: merged.usage.estimated,
          }
        : undefined,
    },
  ]

  const saved = await saveChatHistory(compacted)
  return {
    ...saved,
    backupPath,
    originalCount: currentHistory.messages.length,
  }
}
