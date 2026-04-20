import { Router } from 'express'
import { HttpError, httpError } from '../../http-error.js'
import {
  getChatHistory,
  saveChatHistory,
  subscribeChatHistory,
} from './agent.history.service.js'
import { compactChatHistory } from './agent.compaction.service.js'
import { getTokenUsageStats } from './agent.stats.service.js'
import { sendMessage, sendMessageStream } from './agent.service.js'
import type {
  ChatHistory,
  ChatMessage,
  ChatRequest,
  StoredChatMessage,
  TokenUsage,
} from './agent.types.js'

export const agentRouter: Router = Router()

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
    estimated: usage.estimated === true ? true : undefined,
  }

  return Object.values(normalized).some((item) => item !== undefined)
    ? normalized
    : undefined
}

function validateMessages(x: unknown): ChatMessage[] {
  if (!Array.isArray(x) || x.length === 0) {
    throw httpError(400, 'messages 必须是非空数组')
  }
  return x.map((m, i) => {
    if (
      !m ||
      typeof m !== 'object' ||
      typeof (m as any).role !== 'string' ||
      typeof (m as any).content !== 'string'
    ) {
      throw httpError(400, `messages[${i}] 格式错误`)
    }
    const role = (m as any).role as ChatMessage['role']
    if (!VALID_ROLES.includes(role)) {
      throw httpError(400, `messages[${i}].role 非法: ${role}`)
    }
    return { role, content: (m as any).content }
  })
}

function validateStoredMessages(x: unknown): StoredChatMessage[] {
  if (!Array.isArray(x)) {
    throw httpError(400, 'messages 必须是数组')
  }

  return x.map((m, i) => {
    if (
      !m ||
      typeof m !== 'object' ||
      typeof (m as any).id !== 'number' ||
      !Number.isFinite((m as any).id) ||
      typeof (m as any).ts !== 'number' ||
      !Number.isFinite((m as any).ts) ||
      typeof (m as any).role !== 'string' ||
      typeof (m as any).content !== 'string'
    ) {
      throw httpError(400, `messages[${i}] 格式错误`)
    }

    const role = (m as any).role as ChatMessage['role']
    if (!VALID_ROLES.includes(role)) {
      throw httpError(400, `messages[${i}].role 非法: ${role}`)
    }

    return {
      id: (m as any).id,
      ts: (m as any).ts,
      role,
      content: (m as any).content,
      error: (m as any).error === true ? true : undefined,
      streaming: (m as any).streaming === true ? true : undefined,
      usage: validateTokenUsage((m as any).usage),
      compactSummary:
        typeof (m as any).compactSummary === 'string' &&
        (m as any).compactSummary.trim()
          ? (m as any).compactSummary
          : undefined,
      compactBackupPath:
        typeof (m as any).compactBackupPath === 'string' &&
        (m as any).compactBackupPath.trim()
          ? (m as any).compactBackupPath
          : undefined,
      compactOriginalCount:
        typeof (m as any).compactOriginalCount === 'number' &&
        Number.isFinite((m as any).compactOriginalCount) &&
        (m as any).compactOriginalCount > 0
          ? (m as any).compactOriginalCount
          : undefined,
      meta:
        (m as any).meta && typeof (m as any).meta === 'object'
          ? {
              source:
                (m as any).meta.source === 'web' ||
                (m as any).meta.source === 'wechat' ||
                (m as any).meta.source === 'scheduled-task'
                  ? (m as any).meta.source
                  : undefined,
              channel:
                (m as any).meta.channel === 'web' ||
                (m as any).meta.channel === 'wechat'
                  ? (m as any).meta.channel
                  : undefined,
              accountId:
                typeof (m as any).meta.accountId === 'string'
                  ? (m as any).meta.accountId
                  : undefined,
              peerId:
                typeof (m as any).meta.peerId === 'string'
                  ? (m as any).meta.peerId
                  : undefined,
              externalMessageId:
                typeof (m as any).meta.externalMessageId === 'string'
                  ? (m as any).meta.externalMessageId
                  : undefined,
              delivery:
                (m as any).meta.delivery && typeof (m as any).meta.delivery === 'object'
                  ? {
                      status:
                        (m as any).meta.delivery.status === 'pending' ||
                        (m as any).meta.delivery.status === 'sent' ||
                        (m as any).meta.delivery.status === 'failed'
                          ? (m as any).meta.delivery.status
                          : undefined,
                      targetChannel:
                        (m as any).meta.delivery.targetChannel === 'wechat'
                          ? (m as any).meta.delivery.targetChannel
                          : undefined,
                      targetPeerId:
                        typeof (m as any).meta.delivery.targetPeerId === 'string'
                          ? (m as any).meta.delivery.targetPeerId
                          : undefined,
                      error:
                        typeof (m as any).meta.delivery.error === 'string'
                          ? (m as any).meta.delivery.error
                          : undefined,
                    }
                  : undefined,
              taskId:
                typeof (m as any).meta.taskId === 'string'
                  ? (m as any).meta.taskId
                  : undefined,
              taskTitle:
                typeof (m as any).meta.taskTitle === 'string'
                  ? (m as any).meta.taskTitle
                  : undefined,
            }
          : undefined,
    }
  })
}

agentRouter.get('/history', async (_req, res, next) => {
  try {
    res.json(await getChatHistory())
  } catch (e) {
    next(e)
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
  } catch (e) {
    next(e)
  }
})

agentRouter.put('/history', async (req, res, next) => {
  try {
    const body = req.body as ChatHistory
    const messages = validateStoredMessages(body?.messages)
    res.json(await saveChatHistory(messages))
  } catch (e) {
    next(e)
  }
})

agentRouter.post('/history/compact', async (req, res, next) => {
  try {
    const body = req.body as { messages?: unknown }
    res.json(await compactChatHistory(body?.messages))
  } catch (e) {
    next(e)
  }
})

agentRouter.post('/chat', async (req, res, next) => {
  try {
    const body = req.body as ChatRequest
    const messages = validateMessages(body?.messages)
    const message = await sendMessage(messages)
    res.json({ message })
  } catch (e) {
    next(e)
  }
})

/** SSE 流式对话。data 行是 JSON: {type:'delta',content} / {type:'done'} / {type:'error',message} */
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

    // 心跳,避免某些代理在无数据时关闭连接
    const heartbeat = setInterval(() => {
      res.write(': hb\n\n')
    }, 15000)

    // 客户端断连就停
    let aborted = false
    req.on('aborted', () => {
      aborted = true
    })
    res.on('close', () => {
      if (!res.writableEnded) aborted = true
    })

    try {
      for await (const event of sendMessageStream(messages)) {
        if (aborted) break
        write(event)
      }
      if (!aborted) write({ type: 'done' })
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      const message = e instanceof Error ? e.message : '流式调用失败'
      write({ type: 'error', status, message })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }
  } catch (e) {
    if (!headersSent) next(e)
    else res.end()
  }
})
