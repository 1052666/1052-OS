import { execFile } from 'node:child_process'
import path from 'node:path'
import { HttpError } from '../../../http-error.js'
import {
  appendChatMessage,
  getChatHistory,
  updateChatMessage,
} from '../../agent/agent.history.service.js'
import { resolveAgentCommand } from '../../agent/agent.command.service.js'
import { sendMessageStream } from '../../agent/agent.service.js'
import type { ChatMessage, StoredChatMessage, TokenUsage } from '../../agent/agent.types.js'
import { extractOutboundWechatMedia } from '../wechat/wechat.media.js'
import {
  createWechatDesktopGroupMemory,
  getWechatDesktopGroup,
  listWechatDesktopGroupMemories,
  listWechatDesktopGroups,
  listWechatDesktopSessions,
  loadWechatDesktopConfig,
  saveWechatDesktopConfig,
  upsertWechatDesktopGroup,
  upsertWechatDesktopSession,
} from './wechat-desktop.store.js'
import type {
  WechatDesktopBridgeGroup,
  WechatDesktopBridgeMention,
  WechatDesktopConfigRecord,
  WechatDesktopGroupMemoryItem,
  WechatDesktopGroupRecord,
  WechatDesktopRuntimeStatus,
  WechatDesktopSessionRecord,
  WechatDesktopStatus,
} from './wechat-desktop.types.js'

const BRIDGE_SCRIPT = path.resolve(process.cwd(), 'scripts', 'wechat-ui-bridge.py')
const DEFAULT_TIMEOUT_MS = 60_000
const SEND_TIMEOUT_MS = 120_000
const LISTEN_TIMEOUT_MS = 180_000
const MENTION_QUEUE_CONCURRENCY = 3
const OUTBOUND_ECHO_IGNORE_MS = 2 * 60_000
const MAX_RECENT_OUTBOUND_PER_CHAT = 40

type BridgeResult = {
  ok?: boolean
  error?: string
  detail?: string
  [key: string]: unknown
}

type BridgeQueuePriority = 'normal' | 'high'
type BridgeQueueTask = {
  command: string
  args: Record<string, unknown>
  timeoutMs: number
  resolve: (value: BridgeResult) => void
  reject: (reason: unknown) => void
}

type ListenerJob = {
  mention: WechatDesktopBridgeMention
}

const bridgeQueues: Record<BridgeQueuePriority, BridgeQueueTask[]> = {
  high: [],
  normal: [],
}
let bridgeQueueRunning = false
let listenerTimer: ReturnType<typeof setInterval> | null = null
let listenerTickRunning = false
const mentionQueue: ListenerJob[] = []
let mentionQueueRunning = 0
const processedMentionKeys = new Set<string>()
const recentOutboundByChat = new Map<string, Array<{ text: string; expiresAt: number }>>()
const runtimeState: WechatDesktopRuntimeStatus = {
  running: false,
  queuePending: 0,
  queueRunning: 0,
  sentCount: 0,
  sendFailedCount: 0,
  missingWindows: [],
  bridgeQueuePendingHigh: 0,
  bridgeQueuePendingNormal: 0,
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***')
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeEchoText(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/\s+/g, ' ')
        .replace(/[，。！？、；：,.!?;:]/g, '')
        .trim()
        .toLowerCase()
    : ''
}

function rememberWechatDesktopOutbound(chat: string, text: string) {
  const normalized = normalizeEchoText(text)
  if (!normalized) return
  const now = Date.now()
  const current = recentOutboundByChat.get(chat) ?? []
  const next = [
    { text: normalized, expiresAt: now + OUTBOUND_ECHO_IGNORE_MS },
    ...current.filter((item) => item.expiresAt > now && item.text !== normalized),
  ].slice(0, MAX_RECENT_OUTBOUND_PER_CHAT)
  recentOutboundByChat.set(chat, next)
}

function isRecentWechatDesktopOutboundEcho(mention: WechatDesktopBridgeMention) {
  const candidates = [normalizeEchoText(mention.text), normalizeEchoText(mention.raw)].filter(Boolean)
  if (!candidates.length) return false
  const now = Date.now()
  const current = recentOutboundByChat.get(mention.chat) ?? []
  const active = current.filter((item) => item.expiresAt > now)
  if (active.length !== current.length) recentOutboundByChat.set(mention.chat, active)
  return active.some((sent) =>
    candidates.some((candidate) => candidate === sent.text || candidate.includes(sent.text) || sent.text.includes(candidate)),
  )
}

function normalizeText(value: unknown, field: string) {
  const text = optionalText(value)
  if (!text) throw new HttpError(400, `${field} is required`)
  return text
}

function toChatMessages(messages: StoredChatMessage[], assistantId?: number): ChatMessage[] {
  return messages
    .filter((message) => message.id !== assistantId)
    .filter((message) => !message.streaming)
    .map(({ role, content, compactSummary }) => ({
      role,
      content: compactSummary?.trim() ? `${content}\n\n${compactSummary}` : content,
    }))
}

function filterWechatMarkdown(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function splitWechatText(text: string) {
  const limit = 1800
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const slice = rest.slice(0, limit)
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'))
    const cut = breakAt > 1000 ? breakAt : limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

function inferSenderFromRaw(raw: string, text: string) {
  const candidate = raw.trim()
  if (!candidate) return undefined
  const lines = candidate
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 2 && lines[1] === text.trim()) {
    return lines[0]
  }
  const match = candidate.match(/^([^:\n]{1,40})[:：]\s*(.+)$/s)
  if (!match) return undefined
  if (match[2].trim() !== text.trim()) return undefined
  return match[1].trim()
}

function parseBridgeOutput(stdout: string): BridgeResult {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const last = lines.at(-1) || ''
  try {
    return JSON.parse(last) as BridgeResult
  } catch {
    throw new HttpError(502, `WeChat desktop bridge returned non-JSON output: ${stdout.slice(0, 1000)}`)
  }
}

async function resolveBridgeConfigArgs(input: Partial<WechatDesktopConfigRecord> = {}) {
  const config = await loadWechatDesktopConfig()
  return {
    pythonCommand: optionalText(input.pythonCommand) || config.pythonCommand || 'python',
    scriptPath: optionalText(input.scriptPath) || config.scriptPath || BRIDGE_SCRIPT,
    pywechatRoot: optionalText(input.pywechatRoot) || config.pywechatRoot,
  }
}

function bridgeEnv(pywechatRoot?: string) {
  return {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PYTHONIOENCODING: 'utf-8',
    PYWECHAT_ROOT: pywechatRoot,
  }
}

async function runBridge(
  command: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const resolved = await resolveBridgeConfigArgs(args)
  const payload = JSON.stringify({ ...args, pywechatRoot: resolved.pywechatRoot })
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      resolved.pythonCommand,
      [resolved.scriptPath, command, payload],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: bridgeEnv(resolved.pywechatRoot),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new HttpError(502, `WeChat desktop bridge failed: ${stderr || error.message}`))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
  const parsed = parseBridgeOutput(result.stdout)
  if (parsed.ok === false) {
    throw new HttpError(502, `WeChat desktop bridge error: ${parsed.error || 'unknown error'}`)
  }
  return parsed
}

function syncQueueStatus() {
  runtimeState.queuePending = mentionQueue.length
  runtimeState.queueRunning = mentionQueueRunning
  runtimeState.bridgeQueuePendingHigh = bridgeQueues.high.length
  runtimeState.bridgeQueuePendingNormal = bridgeQueues.normal.length
}

function drainBridgeQueue() {
  if (bridgeQueueRunning) return
  const task = bridgeQueues.high.shift() ?? bridgeQueues.normal.shift()
  syncQueueStatus()
  if (!task) return
  bridgeQueueRunning = true
  void runBridge(task.command, task.args, task.timeoutMs)
    .then(task.resolve)
    .catch(task.reject)
    .finally(() => {
      bridgeQueueRunning = false
      syncQueueStatus()
      drainBridgeQueue()
    })
}

async function runBridgeQueued(
  command: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  priority: BridgeQueuePriority = 'normal',
) {
  return new Promise<BridgeResult>((resolve, reject) => {
    bridgeQueues[priority].push({ command, args, timeoutMs, resolve, reject })
    syncQueueStatus()
    drainBridgeQueue()
  })
}

function mentionKey(mention: WechatDesktopBridgeMention) {
  return `${mention.chat}:${mention.sender ?? ''}:${mention.raw || mention.text || ''}`
}

function maybeShouldWriteExplicitGroupMemory(message: string) {
  return /记住|记下|以后都按这个|以后就这样|请记得|帮我记一下/.test(message)
}

async function maybeWriteImplicitGroupMemory(group: WechatDesktopGroupRecord, message: string) {
  if (!group.allowMemoryWrite) return null
  if (!maybeShouldWriteExplicitGroupMemory(message)) return null
  return createWechatDesktopGroupMemory({
    groupId: group.groupId,
    groupName: group.groupName,
    title: `群聊记忆 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    content: message.trim(),
    source: 'user_explicit',
  })
}

function buildWechatDesktopSystemContext(params: {
  chat: string
  sender: string
  text: string
  raw: string
  mentioned: boolean
  group?: WechatDesktopGroupRecord | null
  groupMemories?: WechatDesktopGroupMemoryItem[]
}) {
  const parts = [
    'WeChat desktop group runtime context:',
    `- channel: wechat_desktop`,
    `- group: ${params.chat}`,
    `- sender: ${params.sender}`,
    `- mentioned bot: ${params.mentioned ? 'yes' : 'no'}`,
    `- raw message: ${params.raw}`,
    `- effective user text: ${params.text}`,
  ]

  if (params.group) {
    parts.push(`- group mode: ${params.group.mode}`)
    parts.push(`- mention only: ${params.group.mentionOnly ? 'yes' : 'no'}`)
    parts.push(`- auto reply allowed: ${params.group.allowAutoReply ? 'yes' : 'no'}`)
    parts.push(`- tools allowed: ${params.group.allowTools ? 'yes' : 'no'}`)
    parts.push(`- memory write allowed: ${params.group.allowMemoryWrite ? 'yes' : 'no'}`)
    if (params.group.promptAppend.trim()) {
      parts.push('')
      parts.push('Group-specific prompt appendix:')
      parts.push(params.group.promptAppend.trim())
    }
  }

  const memories = (params.groupMemories ?? []).filter((item) => item.active).slice(0, 8)
  if (memories.length > 0) {
    parts.push('')
    parts.push('Recent group memories:')
    for (const item of memories) {
      parts.push(`- ${item.title}: ${item.content}`)
    }
  }

  parts.push('')
  parts.push(
    params.group?.mode === 'chat'
      ? 'Current group is in chat-only mode. Prefer direct reply. Do not use complex tools unless truly necessary.'
      : 'Current group allows full agent capabilities when needed.',
  )

  return parts.join('\n')
}

async function sendWechatDesktopFiles(chat: string, files: string[], pywechatRoot?: string) {
  if (!files.length) return
  await runBridgeQueued(
    'send-files',
    {
      friend: chat,
      files,
      requireBoundWindow: true,
      pywechatRoot,
    },
    SEND_TIMEOUT_MS,
    'high',
  )
}

async function sendWechatDesktopRichMessage(params: {
  chat: string
  text: string
  pywechatRoot?: string
}) {
  const outbound = await extractOutboundWechatMedia(params.text)
  const warningText = outbound.warnings.length
    ? `\n\n媒体处理提示：${outbound.warnings.join('；')}`
    : ''
  const reply = filterWechatMarkdown(`${outbound.text || ''}${warningText}`)
  const chunks = splitWechatText(reply)
  if (chunks.length === 0 && outbound.files.length === 0) {
    throw new HttpError(502, 'Agent response did not contain any deliverable WeChat desktop content.')
  }
  for (const chunk of chunks) {
    await runBridgeQueued(
      'send-text',
      {
        friend: params.chat,
        text: chunk,
        requireBoundWindow: true,
        pywechatRoot: params.pywechatRoot,
      },
      SEND_TIMEOUT_MS,
      'high',
    )
    rememberWechatDesktopOutbound(params.chat, chunk)
    runtimeState.sentCount = (runtimeState.sentCount ?? 0) + 1
  }
  if (outbound.files.length > 0) {
    await sendWechatDesktopFiles(params.chat, outbound.files, params.pywechatRoot)
    runtimeState.sentCount = (runtimeState.sentCount ?? 0) + outbound.files.length
  }
}

async function processWechatDesktopMention(mention: WechatDesktopBridgeMention, pywechatRoot?: string) {
  const chat = normalizeText(mention.chat, 'chat')
  const raw = optionalText(mention.raw) || optionalText(mention.text) || ''
  const text = normalizeText(optionalText(mention.text) || raw, 'text')
  const sender =
    optionalText(mention.sender) ||
    inferSenderFromRaw(raw, text) ||
    optionalText(mention.debugTexts?.[0]) ||
    '群成员'

  const session = await upsertWechatDesktopSession({
    sessionName: chat,
    sessionType: 'group',
    enabled: true,
    listening: true,
    source: 'configured',
    lastMessageAt: Date.now(),
    lastSenderName: sender,
    lastMessagePreview: text,
  })
  const group = await upsertWechatDesktopGroup({
    groupId: session.sessionId,
    groupName: chat,
    lastMessageAt: Date.now(),
    lastSenderName: sender,
  })

  if (!group.enabled) return { ok: true, ignored: 'group-disabled' }
  if (group.mentionOnly && mention.mentioned === false) return { ok: true, ignored: 'mention-only' }
  if (group.allowAutoReply === false) return { ok: true, ignored: 'auto-reply-disabled' }

  const command = await resolveAgentCommand(text)
  const effectiveContent = command?.mode === 'prompt' ? command.promptText : text
  if (command?.mode === 'action') {
    await sendWechatDesktopRichMessage({
      chat,
      text: command.responseText,
      pywechatRoot,
    })
    return { ok: true, actionOnly: true }
  }

  const userMessage = await appendChatMessage({
    role: 'user',
    content: effectiveContent,
    ts: Date.now(),
    meta: {
      source: 'wechat_desktop',
      channel: 'wechat_desktop',
      peerId: session.sessionId,
      externalMessageId: raw || `${chat}:${sender}:${Date.now()}`,
    },
  })
  void userMessage

  const assistantMessage = await appendChatMessage({
    role: 'assistant',
    content: '',
    streaming: true,
    meta: {
      source: 'wechat_desktop',
      channel: 'wechat_desktop',
      peerId: session.sessionId,
      delivery: {
        status: 'pending',
        targetChannel: 'wechat_desktop',
        targetPeerId: session.sessionId,
      },
    },
  })

  let finalText = ''
  let usage: TokenUsage | undefined
  try {
    const history = await getChatHistory()
    const chatMessages = toChatMessages(history.messages, assistantMessage.id)
    const systemContext = buildWechatDesktopSystemContext({
      chat,
      sender,
      text: effectiveContent,
      raw,
      mentioned: mention.mentioned === true,
      group,
      groupMemories: await listWechatDesktopGroupMemories(group.groupId),
    })
    const streamInput: ChatMessage[] = [{ role: 'system', content: systemContext }, ...chatMessages]
    for await (const event of sendMessageStream(streamInput, {
      runtimeContext: {
        source: {
          channel: 'wechat_desktop',
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          sessionType: 'group',
          groupId: group.groupId,
          senderName: sender,
          mentionedBot: mention.mentioned === true,
          allowTools: group.allowTools,
        },
      },
    })) {
      if (event.type === 'delta') {
        finalText += event.content
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, content: current.content + event.content }),
          'wechat-desktop-agent-delta',
        )
      } else if (event.type === 'usage') {
        usage = event.usage
        await updateChatMessage(
          assistantMessage.id,
          (current) => ({ ...current, usage }),
          'wechat-desktop-agent-usage',
        )
      }
    }

    await sendWechatDesktopRichMessage({
      chat,
      text: finalText,
      pywechatRoot,
    })
    runtimeState.lastMessageAt = Date.now()
    runtimeState.lastEventAt = Date.now()

    await updateChatMessage(
      assistantMessage.id,
      (current) => ({
        ...current,
        streaming: false,
        usage,
        meta: {
          ...current.meta,
          delivery: {
            status: 'sent',
            targetChannel: 'wechat_desktop',
            targetPeerId: session.sessionId,
          },
        },
      }),
      'wechat-desktop-agent-done',
    )

    await maybeWriteImplicitGroupMemory(group, effectiveContent).catch(() => null)
    return { ok: true }
  } catch (error) {
    const message = sanitizeError(error)
    runtimeState.sendFailedCount = (runtimeState.sendFailedCount ?? 0) + 1
    runtimeState.lastError = message
    await updateChatMessage(
      assistantMessage.id,
      (current) => ({
        ...current,
        streaming: false,
        error: true,
        content: current.content
          ? `${current.content}\n\n微信桌面通道处理失败：${message}`
          : `微信桌面通道处理失败：${message}`,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'wechat_desktop',
            targetPeerId: session.sessionId,
            error: message,
          },
        },
      }),
      'wechat-desktop-agent-error',
    )
    throw error
  }
}

async function drainMentionQueue() {
  while (mentionQueueRunning < MENTION_QUEUE_CONCURRENCY && mentionQueue.length > 0) {
    const job = mentionQueue.shift()
    if (!job) return
    mentionQueueRunning += 1
    syncQueueStatus()
    const config = await loadWechatDesktopConfig()
    void processWechatDesktopMention(job.mention, config.pywechatRoot)
      .catch((error) => {
        runtimeState.lastError = sanitizeError(error)
      })
      .finally(() => {
        mentionQueueRunning -= 1
        syncQueueStatus()
        void drainMentionQueue()
      })
  }
}

function enqueueMention(mention: WechatDesktopBridgeMention) {
  mentionQueue.push({ mention })
  syncQueueStatus()
  void drainMentionQueue()
}

async function syncConfiguredChats(config?: WechatDesktopConfigRecord) {
  const effectiveConfig = config ?? (await loadWechatDesktopConfig())
  const sessions = await listWechatDesktopSessions()
  const enabledChats = sessions
    .filter((item) => item.enabled && item.sessionType === 'group')
    .map((item) => item.sessionName)
  const chatNames = [...new Set([...(effectiveConfig.chatNames ?? []), ...enabledChats])]
  await saveWechatDesktopConfig({ chatNames })
  return chatNames
}

export async function primeMentionKeys(config: WechatDesktopConfigRecord) {
  const chatNames = await syncConfiguredChats(config)
  if (!chatNames.length) return
  const result = (await runBridgeQueued(
    'check-mentions',
    {
      botNames: config.botNames,
      chatNames,
      searchPages: config.searchPages,
      pywechatRoot: config.pywechatRoot,
    },
    LISTEN_TIMEOUT_MS,
  )) as BridgeResult & { mentions?: WechatDesktopBridgeMention[]; missingWindows?: string[] }
  runtimeState.missingWindows = result.missingWindows ?? []
  for (const mention of result.mentions ?? []) {
    processedMentionKeys.add(mentionKey(mention))
  }
}

export async function listenerTick() {
  if (listenerTickRunning) return
  listenerTickRunning = true
  try {
    const config = await loadWechatDesktopConfig()
    const chatNames = await syncConfiguredChats(config)
    runtimeState.lastEventAt = Date.now()
    if (!chatNames.length) return
    const result = (await runBridgeQueued(
      'check-mentions',
      {
        botNames: config.botNames,
        chatNames,
        searchPages: config.searchPages,
        pywechatRoot: config.pywechatRoot,
      },
      LISTEN_TIMEOUT_MS,
    )) as BridgeResult & { mentions?: WechatDesktopBridgeMention[]; missingWindows?: string[] }
    runtimeState.missingWindows = result.missingWindows ?? []
    if ((result.missingWindows ?? []).length > 0) {
      runtimeState.lastError = `绑定群聊窗口缺失：${(result.missingWindows ?? []).join('、')}`
      return
    }
    for (const mention of result.mentions ?? []) {
      const key = mentionKey(mention)
      if (processedMentionKeys.has(key)) continue
      processedMentionKeys.add(key)
      if (isRecentWechatDesktopOutboundEcho(mention)) continue
      enqueueMention(mention)
    }
  } catch (error) {
    runtimeState.lastError = sanitizeError(error)
  } finally {
    listenerTickRunning = false
  }
}

export async function bindConfiguredChats(config: WechatDesktopConfigRecord) {
  const chatNames = await syncConfiguredChats(config)
  if (!chatNames.length) return { ok: true, windows: [] }
  return runBridgeQueued(
    'bind-chat-windows',
    {
      chatNames,
      minimize: false,
      pywechatRoot: config.pywechatRoot,
    },
    LISTEN_TIMEOUT_MS,
    'high',
  )
}

export async function getWechatDesktopStatus(): Promise<WechatDesktopStatus> {
  const config = await loadWechatDesktopConfig()
  return {
    available: true,
    config,
    runtime: { ...runtimeState },
    sessions: await listWechatDesktopSessions(),
    groups: await listWechatDesktopGroups(),
  }
}

export async function saveWechatDesktopChannelConfig(input: Partial<WechatDesktopConfigRecord>) {
  const config = await saveWechatDesktopConfig({
    enabled: input.enabled,
    autoStart: input.autoStart,
    pythonCommand: input.pythonCommand,
    scriptPath: input.scriptPath,
    pywechatRoot: input.pywechatRoot,
    botNames: input.botNames,
    chatNames: input.chatNames,
    searchPages: input.searchPages,
    listenerEnabled: input.listenerEnabled,
  })
  await syncConfiguredChats(config)
  return getWechatDesktopStatus()
}

export async function startWechatDesktopChannel() {
  if (listenerTimer) clearInterval(listenerTimer)
  listenerTimer = null
  mentionQueue.length = 0
  mentionQueueRunning = 0
  runtimeState.running = false
  runtimeState.stoppedAt = Date.now()
  runtimeState.lastError = 'Legacy wechat-desktop listener is disabled; use /channels/wechat/ui/listener/start.'
  await saveWechatDesktopConfig({ enabled: true, listenerEnabled: false })
  return getWechatDesktopStatus()
}

export async function stopWechatDesktopChannel() {
  if (listenerTimer) clearInterval(listenerTimer)
  listenerTimer = null
  runtimeState.running = false
  runtimeState.stoppedAt = Date.now()
  await saveWechatDesktopConfig({ listenerEnabled: false })
  return getWechatDesktopStatus()
}

export async function refreshWechatDesktopSessions() {
  const config = await loadWechatDesktopConfig()
  const result = (await runBridgeQueued(
    'list-groups',
    {
      recent: true,
      pywechatRoot: config.pywechatRoot,
    },
    LISTEN_TIMEOUT_MS,
  )) as BridgeResult & { groups?: WechatDesktopBridgeGroup[] }

  for (const group of result.groups ?? []) {
    await upsertWechatDesktopSession({
      sessionName: group.name,
      sessionType: 'group',
      listening: config.chatNames.includes(group.name),
      enabled: config.chatNames.includes(group.name),
      source: 'discovered',
    })
    await upsertWechatDesktopGroup({
      groupName: group.name,
    })
  }

  return listWechatDesktopSessions()
}

export async function updateWechatDesktopSession(
  sessionIdInput: unknown,
  patch: Partial<WechatDesktopSessionRecord>,
) {
  const sessions = await listWechatDesktopSessions()
  const target = sessions.find((item) => item.sessionId === String(sessionIdInput).trim())
  if (!target) throw new HttpError(404, 'WeChat desktop session not found.')
  const next = await upsertWechatDesktopSession({
    ...target,
    ...patch,
    sessionId: target.sessionId,
    sessionName: patch.sessionName ?? target.sessionName,
    sessionType: patch.sessionType ?? target.sessionType,
  })
  const config = await loadWechatDesktopConfig()
  const chatNames = new Set(config.chatNames)
  if (next.enabled) chatNames.add(next.sessionName)
  else chatNames.delete(next.sessionName)
  await saveWechatDesktopConfig({ chatNames: [...chatNames] })
  return next
}

export async function updateWechatDesktopGroup(
  groupIdInput: unknown,
  patch: Partial<WechatDesktopGroupRecord>,
) {
  const groups = await listWechatDesktopGroups()
  const target = groups.find((item) => item.groupId === String(groupIdInput).trim())
  if (!target) throw new HttpError(404, 'WeChat desktop group not found.')
  return upsertWechatDesktopGroup({
    ...target,
    ...patch,
    groupId: target.groupId,
    groupName: patch.groupName ?? target.groupName,
  })
}

export async function listWechatDesktopSessionsView() {
  return listWechatDesktopSessions()
}

export async function listWechatDesktopGroupsView() {
  return listWechatDesktopGroups()
}

export async function sendWechatDesktopDirectMessage(input: {
  sessionName: string
  text: string
}) {
  const config = await loadWechatDesktopConfig()
  const sessionName = normalizeText(input.sessionName, 'sessionName')
  const text = normalizeText(input.text, 'text')
  await sendWechatDesktopRichMessage({
    chat: sessionName,
    text,
    pywechatRoot: config.pywechatRoot,
  })
  const existing = (await listWechatDesktopSessions()).find((item) => item.sessionName === sessionName)
  await upsertWechatDesktopSession({
    sessionName,
    sessionType: existing?.sessionType ?? 'direct',
    enabled: true,
    listening: existing?.listening ?? false,
    lastMessageAt: Date.now(),
    lastMessagePreview: text,
  })
  return { ok: true, sessionName }
}

export async function listWechatDesktopGroupMemoriesView(groupIdInput?: unknown) {
  return listWechatDesktopGroupMemories(groupIdInput)
}

export async function createWechatDesktopGroupMemoryView(input: {
  groupId: string
  title: string
  content: string
  source?: WechatDesktopGroupMemoryItem['source']
}) {
  const group = await getWechatDesktopGroup(input.groupId)
  if (!group) throw new HttpError(404, 'WeChat desktop group not found.')
  return createWechatDesktopGroupMemory({
    groupId: group.groupId,
    groupName: group.groupName,
    title: input.title,
    content: input.content,
    source: input.source ?? 'tool_write',
  })
}

export async function startAllEnabledWechatDesktopChannels() {
  if (listenerTimer) clearInterval(listenerTimer)
  listenerTimer = null
  runtimeState.running = false
}
