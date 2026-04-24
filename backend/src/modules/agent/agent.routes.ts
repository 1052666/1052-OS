import { Router } from 'express'
import multer from 'multer'
import { HttpError, httpError } from '../../http-error.js'
import {
  type ChatHistorySaveReason,
  getChatHistory,
  saveChatHistory,
  subscribeChatHistory,
} from './agent.history.service.js'
import { compactChatHistory } from './agent.compaction.service.js'
import { previewAgentMigration, runAgentMigration } from './agent.migration.service.js'
import { getTokenUsageStats } from './agent.stats.service.js'
import { saveAgentUpload } from './agent.upload.service.js'
import { sendMessage, sendMessageStream } from './agent.service.js'
import type {
  ChatHistory,
  ChatMessage,
  ChatRequest,
  StoredChatMessage,
  TokenUsage,
} from './agent.types.js'

export const agentRouter: Router = Router()
const agentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 8,
  },
})

const VALID_ROLES: ChatMessage['role'][] = ['system', 'user', 'assistant']

function validateTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  const pick = (key: string) =>
    typeof usage[key] === 'number' && Number.isFinite(usage[key])
      ? (usage[key] as number)
      : undefined

  const normalized: TokenUsage = {
    userTokens: pick('userTokens'),
    inputTokens: pick('inputTokens'),
    outputTokens: pick('outputTokens'),
    totalTokens: pick('totalTokens'),
    cacheReadTokens: pick('cacheReadTokens'),
    cacheWriteTokens: pick('cacheWriteTokens'),
    upgradeOverheadInputTokens: pick('upgradeOverheadInputTokens'),
    upgradeOverheadOutputTokens: pick('upgradeOverheadOutputTokens'),
    upgradeOverheadTotalTokens: pick('upgradeOverheadTotalTokens'),
    estimated: usage.estimated === true ? true : undefined,
  }

  return Object.values(normalized).some((item) => item !== undefined)
    ? normalized
    : undefined
}

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw httpError(400, 'messages 必须是非空数组')
  }

  return value.map((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).role !== 'string' ||
      typeof (item as Record<string, unknown>).content !== 'string'
    ) {
      throw httpError(400, `messages[${index}] 格式错误`)
    }

    const role = (item as { role: ChatMessage['role'] }).role
    if (!VALID_ROLES.includes(role)) {
      throw httpError(400, `messages[${index}].role 非法: ${role}`)
    }

    return {
      role,
      content: (item as { content: string }).content,
    }
  })
}

function validateStoredMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) {
    throw httpError(400, 'messages 必须是数组')
  }

  return value.map((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as any).id !== 'number' ||
      !Number.isFinite((item as any).id) ||
      typeof (item as any).ts !== 'number' ||
      !Number.isFinite((item as any).ts) ||
      typeof (item as any).role !== 'string' ||
      typeof (item as any).content !== 'string'
    ) {
      throw httpError(400, `messages[${index}] 格式错误`)
    }

    const role = (item as any).role as ChatMessage['role']
    if (!VALID_ROLES.includes(role)) {
      throw httpError(400, `messages[${index}].role 非法: ${role}`)
    }

    return {
      id: (item as any).id,
      ts: (item as any).ts,
      role,
      content: (item as any).content,
      error: (item as any).error === true ? true : undefined,
      streaming: (item as any).streaming === true ? true : undefined,
      usage: validateTokenUsage((item as any).usage),
      compactSummary:
        typeof (item as any).compactSummary === 'string' && (item as any).compactSummary.trim()
          ? (item as any).compactSummary
          : undefined,
      compactBackupPath:
        typeof (item as any).compactBackupPath === 'string' &&
        (item as any).compactBackupPath.trim()
          ? (item as any).compactBackupPath
          : undefined,
      compactOriginalCount:
        typeof (item as any).compactOriginalCount === 'number' &&
        Number.isFinite((item as any).compactOriginalCount) &&
        (item as any).compactOriginalCount > 0
          ? (item as any).compactOriginalCount
          : undefined,
      meta:
        (item as any).meta && typeof (item as any).meta === 'object'
          ? {
              source:
                (item as any).meta.source === 'web' ||
                (item as any).meta.source === 'wechat' ||
                (item as any).meta.source === 'feishu' ||
                (item as any).meta.source === 'scheduled-task'
                  ? (item as any).meta.source
                  : undefined,
              channel:
                (item as any).meta.channel === 'web' ||
                (item as any).meta.channel === 'wechat' ||
                (item as any).meta.channel === 'feishu'
                  ? (item as any).meta.channel
                  : undefined,
              accountId:
                typeof (item as any).meta.accountId === 'string'
                  ? (item as any).meta.accountId
                  : undefined,
              peerId:
                typeof (item as any).meta.peerId === 'string'
                  ? (item as any).meta.peerId
                  : undefined,
              externalMessageId:
                typeof (item as any).meta.externalMessageId === 'string'
                  ? (item as any).meta.externalMessageId
                  : undefined,
              delivery:
                (item as any).meta.delivery && typeof (item as any).meta.delivery === 'object'
                  ? {
                      status:
                        (item as any).meta.delivery.status === 'pending' ||
                        (item as any).meta.delivery.status === 'sent' ||
                        (item as any).meta.delivery.status === 'failed'
                          ? (item as any).meta.delivery.status
                          : undefined,
                      targetChannel:
                        (item as any).meta.delivery.targetChannel === 'wechat' ||
                        (item as any).meta.delivery.targetChannel === 'feishu'
                          ? (item as any).meta.delivery.targetChannel
                          : undefined,
                      targetPeerId:
                        typeof (item as any).meta.delivery.targetPeerId === 'string'
                          ? (item as any).meta.delivery.targetPeerId
                          : undefined,
                      error:
                        typeof (item as any).meta.delivery.error === 'string'
                          ? (item as any).meta.delivery.error
                          : undefined,
                    }
                  : undefined,
              taskId:
                typeof (item as any).meta.taskId === 'string'
                  ? (item as any).meta.taskId
                  : undefined,
              taskTitle:
                typeof (item as any).meta.taskTitle === 'string'
                  ? (item as any).meta.taskTitle
                  : undefined,
            }
          : undefined,
    }
  })
}

function validateHistorySaveReason(value: unknown): ChatHistorySaveReason {
  return value === 'sync' ||
    value === 'clear' ||
    value === 'compact' ||
    value === 'repair' ||
    value === 'replace'
    ? value
    : 'replace'
}

agentRouter.get('/history', async (_req, res, next) => {
  try {
    res.json(await getChatHistory())
  } catch (error) {
    next(error)
  }
})

agentRouter.get('/history/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const write = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  write({ type: 'connected', ts: Date.now() })
  const unsubscribe = subscribeChatHistory(write)
  const heartbeat = setInterval(() => {
    res.write(': hb\n\n')
  }, 15000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
    res.end()
  })
})

agentRouter.get('/stats/usage', async (_req, res, next) => {
  try {
    res.json(await getTokenUsageStats())
  } catch (error) {
    next(error)
  }
})

agentRouter.put('/history', async (req, res, next) => {
  try {
    const body = req.body as ChatHistory & { reason?: unknown }
    const messages = validateStoredMessages(body?.messages)
    res.json(await saveChatHistory(messages, validateHistorySaveReason(body?.reason)))
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/history/compact', async (req, res, next) => {
  try {
    const body = req.body as { messages?: unknown }
    res.json(await compactChatHistory(body?.messages))
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/migrations/preview', async (req, res, next) => {
  try {
    const body = req.body as { sourcePath?: unknown }
    res.json(await previewAgentMigration(body?.sourcePath))
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/migrations/run', async (req, res, next) => {
  try {
    const body = req.body as { sourcePath?: unknown; dryRun?: unknown }
    res.json(await runAgentMigration(body))
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/uploads', agentUpload.array('files', 8), async (req, res, next) => {
  try {
    const files = (req as typeof req & { files?: Express.Multer.File[] }).files ?? []
    if (files.length === 0) {
      throw httpError(400, '至少需要上传一个文件')
    }

    res.json({
      items: await Promise.all(
        files.map((file) =>
          saveAgentUpload({
            buffer: file.buffer,
            fileName: file.originalname,
            mimeType: file.mimetype,
          }),
        ),
      ),
    })
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/chat', async (req, res, next) => {
  try {
    const body = req.body as ChatRequest
    const messages = validateMessages(body?.messages)
    const message = await sendMessage(messages)
    res.json({ message })
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/chat/stream', async (req, res, next) => {
  let headersSent = false

  try {
    const body = req.body as ChatRequest
    const messages = validateMessages(body?.messages)

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    headersSent = true

    const write = (payload: object) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    const heartbeat = setInterval(() => {
      res.write(': hb\n\n')
    }, 15000)
    const abortController = new AbortController()
    let aborted = false

    req.on('aborted', () => {
      aborted = true
      abortController.abort()
    })
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true
        abortController.abort()
      }
    })

    try {
      for await (const event of sendMessageStream(messages, {
        abortSignal: abortController.signal,
      })) {
        if (aborted) break
        write(event)
      }
      if (!aborted) {
        write({ type: 'done' })
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : '流式调用失败'
      if (!aborted) {
        write({ type: 'error', status, message })
      }
    } finally {
      clearInterval(heartbeat)
      res.end()
    }
  } catch (error) {
    if (!headersSent) next(error)
    else res.end()
  }
})
