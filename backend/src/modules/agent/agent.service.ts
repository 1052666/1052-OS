import os from 'node:os'
import path from 'node:path'
import { httpError, HttpError } from '../../http-error.js'
import {
  formatMorningBriefRuntimeContext,
  getSettings,
  resolveLlmConfigForTask,
} from '../settings/settings.service.js'
import { getChatHistory } from './agent.history.service.js'
import { formatMemoryRuntimeContext } from '../memory/memory.service.js'
import { formatOutputProfileRuntimeContext } from '../output-profiles/output-profile.service.js'
import { formatSkillsRuntimeContext } from '../skills/skills.service.js'
import {
  formatUapisDirectorySummary,
  formatUapisRuntimeContext,
} from '../uapis/uapis.service.js'
import { getAgentSystemPrompt } from './agent.prompt.service.js'
import { formatAgentWorkspaceContext } from './agent.workspace.service.js'
import {
  executeToolCall,
  getAgentToolDefinitions,
  getAgentToolDefinitionsForNames,
  buildArgsPreview,
  buildResultPreview,
  type AgentToolRuntimeContext,
} from './agent.tool.service.js'
import { isWriteOperation } from './agent.tool.safety.js'
import {
  chatCompletionStream,
  estimateTokenCount,
  type LLMAssistantMessage,
  type LLMConversationMessage,
} from './llm.client.js'
import type { ChatMessage, StoredChatMessage, TokenUsage } from './agent.types.js'
import type { AgentStreamEvent } from './agent.runtime.types.js'
import {
  appendCheckpointEntry,
  deriveSessionId,
  getCheckpoint,
  patchCheckpoint,
} from './agent.checkpoint.service.js'
import { ensureCheckpointSeedForSession } from './agent.seed.service.js'
import { buildP0Messages, getContextUpgradeToolDefinition } from './agent.p0.service.js'
import {
  expandMountedPacks,
  getToolNamesForMountedPacks,
} from './agent.pack.service.js'
import type { AgentPackName } from './agent.runtime.types.js'
import {
  isContextUpgradeToolCall,
  parseContextUpgradeArgs,
  validateContextUpgradeRequest,
  REQUEST_CONTEXT_UPGRADE_TOOL,
} from './agent.upgrade.service.js'
import { appendAgentRuntimeLog } from './agent.runtime-log.service.js'
import {
  formatSafeCallerSystemInstructions,
  safeSliceMessages,
  sanitizeCheckpointTextForModel,
  toModelChatMessages,
} from './agent.context-sanitizer.service.js'
import { maybeCreateInferredMemorySuggestion } from './agent.memory-autosuggest.service.js'

const MAX_TOOL_ROUNDS = 450

type AgentRunOptions = {
  runtimeContext?: AgentToolRuntimeContext
  abortSignal?: AbortSignal
}

function workspaceRoot() {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === 'backend' ? path.dirname(cwd) : cwd
}

function formatRuntimeContext(now: Date) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'long',
  }).format(now)

  return [
    'Runtime context:',
    '- timezone: Asia/Hong_Kong (UTC+08:00)',
    `- date: ${date}`,
    `- time: ${time}`,
    `- weekday: ${weekday}`,
  ].join('\n')
}

function formatSystemEnvironmentContext() {
  const platformName =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin'
        ? 'macOS'
        : process.platform === 'linux'
          ? 'Linux'
          : process.platform

  return [
    'System environment:',
    `- platform: ${platformName} (${process.platform}/${process.arch})`,
    `- os: ${os.type()} ${os.release()}`,
    `- node: ${process.version}`,
    `- workspace: ${workspaceRoot()}`,
    `- backend cwd: ${process.cwd()}`,
  ].join('\n')
}

function formatPermissionBlock(fullAccess: boolean) {
  return fullAccess
    ? 'Permission mode: full-access enabled. For local writes or risky operations, execute directly and report results.'
    : 'Permission mode: full-access disabled. For local writes or risky operations, explain impact first and wait for explicit confirmation.'
}

function truncateText(value: string, max = 200) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

function latestUserMessage(history: ChatMessage[]) {
  return [...history].reverse().find((message) => message.role === 'user')
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

function addUsage(
  total: TokenUsage,
  usage?: TokenUsage,
  options?: { upgradeOverhead?: boolean },
): TokenUsage {
  if (!usage) return total
  return {
    userTokens: (total.userTokens ?? 0) + (usage.userTokens ?? 0),
    inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    upgradeOverheadInputTokens:
      (total.upgradeOverheadInputTokens ?? 0) +
      (options?.upgradeOverhead ? (usage.inputTokens ?? 0) : 0),
    upgradeOverheadOutputTokens:
      (total.upgradeOverheadOutputTokens ?? 0) +
      (options?.upgradeOverhead ? (usage.outputTokens ?? 0) : 0),
    upgradeOverheadTotalTokens:
      (total.upgradeOverheadTotalTokens ?? 0) +
      (options?.upgradeOverhead ? (usage.totalTokens ?? 0) : 0),
    estimated: total.estimated === true || usage.estimated === true || undefined,
  }
}

function withUserTokens(usage: TokenUsage, history: ChatMessage[]): TokenUsage {
  const latestUser = latestUserMessage(history)
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

function normalizeHistoryForProgressive(history: ChatMessage[], limit: number): LLMConversationMessage[] {
  return toModelChatMessages(history, limit) as LLMConversationMessage[]
}

async function composeLegacyMessages(
  history: ChatMessage[],
  userPrompt: string,
  fullAccess: boolean,
  contextMessageLimit: number,
  morningBriefContext: string,
): Promise<LLMConversationMessage[]> {
  const limitedHistory = history.slice(-Math.max(1, contextMessageLimit))
  const latestUserContent = latestUserMessage(limitedHistory)?.content ?? ''
  const callerSystemInstructions = formatSafeCallerSystemInstructions(history)
  const modelHistory = toModelChatMessages(
    limitedHistory,
    Math.max(1, contextMessageLimit),
  ) as LLMConversationMessage[]
  const [systemPrompt, skillsContext, uapisContext, memoryContext, outputProfileContext] = await Promise.all([
    getAgentSystemPrompt(),
    formatSkillsRuntimeContext(),
    formatUapisRuntimeContext(),
    formatMemoryRuntimeContext(latestUserContent),
    formatOutputProfileRuntimeContext(latestUserContent),
  ])

  const messages: LLMConversationMessage[] = [
    {
      role: 'system',
      content: [
        systemPrompt,
        formatRuntimeContext(new Date()),
        formatSystemEnvironmentContext(),
        formatPermissionBlock(fullAccess),
        morningBriefContext,
        callerSystemInstructions,
        formatAgentWorkspaceContext(),
        memoryContext,
        outputProfileContext,
        skillsContext,
        uapisContext,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]

  if (userPrompt.trim()) {
    messages.push({
      role: 'user',
      content: `以下是用户设置中的长期偏好，请在后续回答中持续遵守，但不要直接复述这段文本：\n${userPrompt.trim()}`,
    })
  }

  messages.push(...modelHistory)
  return messages
}

function parseToolResult(content: string): { ok?: boolean; error?: string } | null {
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; error?: string }
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function extractToolFailure(toolMessages: LLMConversationMessage[]) {
  for (const message of toolMessages) {
    if (message.role !== 'tool') continue
    const parsed = parseToolResult(message.content)
    if (parsed?.ok === false && parsed.error) {
      return sanitizeCheckpointTextForModel(`${message.name}: ${truncateText(parsed.error, 240)}`)
    }
  }
  return ''
}

async function* executeToolCallsWithEvents(
  toolCalls: readonly import('./llm.client.js').LLMToolCall[],
  runtimeContext?: AgentToolRuntimeContext,
): AsyncGenerator<AgentStreamEvent, LLMConversationMessage[], void> {
  if (toolCalls.length === 0) return []

  // Emit every `tool-started` event upfront so the UI surfaces the full set
  // of pending calls immediately, before any of them actually start running.
  for (const toolCall of toolCalls) {
    yield {
      type: 'tool-started',
      name: toolCall.function.name,
      callId: toolCall.id,
      argsPreview: buildArgsPreview(toolCall.function.arguments),
      dangerous: isWriteOperation(toolCall.function.name),
    }
  }

  // Helper: build an enriched tool-finished event from a completed tool message.
  function buildFinishedEvent(
    tc: import('./llm.client.js').LLMToolCall,
    msg: LLMConversationMessage,
    elapsedMs: number,
  ): AgentStreamEvent {
    const parsed = parseToolResult(msg.content)
    return {
      type: 'tool-finished',
      name: tc.function.name,
      ok: parsed?.ok === true,
      error: parsed?.ok === false ? parsed.error : undefined,
      callId: tc.id,
      resultPreview: buildResultPreview(msg.content ?? ''),
      durationMs: elapsedMs,
    }
  }

  // Single-call fast path: skip the Promise.race scheduling overhead and
  // keep behaviour byte-identical to the legacy serial implementation.
  if (toolCalls.length === 1) {
    const only = toolCalls[0]
    const t0 = Date.now()
    const toolMessage = await executeToolCall(only, runtimeContext)
    yield buildFinishedEvent(only, toolMessage, Date.now() - t0)
    return [toolMessage]
  }

  // Parallel path: when the model emits multiple tool_calls in one assistant
  // turn it is explicitly signalling that they are independent and can run
  // concurrently. We dispatch them all together and yield each
  // `tool-finished` event in completion order (so users see fast tools come
  // back first), but the returned messages keep INPUT order — required by
  // OpenAI's tool_call_id ordering contract on the next request.
  type Settled = {
    index: number
    message: LLMConversationMessage
    elapsedMs: number
  }
  const toolMessages: LLMConversationMessage[] = new Array(toolCalls.length)
  const startTimes: number[] = toolCalls.map(() => Date.now())
  const tracked: Promise<Settled>[] = toolCalls.map((toolCall, index) =>
    executeToolCall(toolCall, runtimeContext).then(
      (message): Settled => ({
        index,
        message,
        elapsedMs: Date.now() - startTimes[index],
      }),
    ),
  )
  const remaining = new Set<Promise<Settled>>(tracked)

  while (remaining.size > 0) {
    const settled = await Promise.race(remaining)
    remaining.delete(tracked[settled.index])
    toolMessages[settled.index] = settled.message
    yield buildFinishedEvent(toolCalls[settled.index], settled.message, settled.elapsedMs)
  }

  return toolMessages
}

function stripThink(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

async function maybeBuildExtraSections(
  mountedPacks: readonly AgentPackName[],
  latestUserContent: string,
  fullAccess: boolean,
  morningBriefContext: string,
) {
  const sections = [
    formatRuntimeContext(new Date()),
    formatPermissionBlock(fullAccess),
    morningBriefContext,
  ]

  if (mountedPacks.includes('repo-pack') || mountedPacks.includes('base-read-pack')) {
    sections.push(`Workspace root: ${workspaceRoot()}`)
  }

  if (mountedPacks.includes('search-pack')) {
    sections.push(await formatUapisDirectorySummary())
  }

  if (mountedPacks.includes('memory-pack')) {
    sections.push(await formatMemoryRuntimeContext(latestUserContent))
  }

  sections.push(await formatOutputProfileRuntimeContext(latestUserContent))

  return sections
}

async function buildProgressiveMessages(input: {
  history: LLMConversationMessage[]
  mountedPacks: readonly AgentPackName[]
  userPrompt: string
  checkpointSessionId: string
  latestUserContent: string
  callerSystemInstructions: string
  contextMessageLimit: number
  fullAccess: boolean
  morningBriefContext: string
}) {
  const checkpoint = await getCheckpoint(input.checkpointSessionId)
  const progressiveHistory = safeSliceMessages(
    input.history,
    Math.max(1, input.contextMessageLimit * 2),
  )
  const extraSections = await maybeBuildExtraSections(
    input.mountedPacks,
    input.latestUserContent,
    input.fullAccess,
    input.morningBriefContext,
  )
  if (input.callerSystemInstructions) {
    extraSections.push(input.callerSystemInstructions)
  }

  const built = await buildP0Messages({
    history: progressiveHistory,
    checkpoint,
    userPrompt: input.userPrompt,
    mountedPacks: input.mountedPacks,
    extraSections,
  })

  return { ...built, checkpoint }
}

function createToolErrorMessage(toolCallId: string, message: string): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId,
    name: REQUEST_CONTEXT_UPGRADE_TOOL,
    content: JSON.stringify({ ok: false, error: message }, null, 2),
  }
}

function createToolSuccessMessage(
  toolCallId: string,
  packs: readonly string[],
  mountedPacks: readonly AgentPackName[],
): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId,
    name: REQUEST_CONTEXT_UPGRADE_TOOL,
    content: JSON.stringify(
      {
        ok: true,
        data: {
          packs,
          mountedPacks,
        },
      },
      null,
      2,
    ),
  }
}

async function* runLegacyStream(
  history: ChatMessage[],
  options: AgentRunOptions,
): AsyncGenerator<AgentStreamEvent, void, void> {
  const settings = await getSettings()
  const llm = resolveLlmConfigForTask(settings.llm, 'agent-chat')
  const latestUserContent = latestUserMessage(history)?.content ?? ''
  const messages = await composeLegacyMessages(
    history,
    settings.agent.userPrompt,
    settings.agent.fullAccess === true,
    settings.agent.contextMessageLimit,
    formatMorningBriefRuntimeContext(settings.agent),
  )
  const tools = getAgentToolDefinitions()
  let usage: TokenUsage = {}
  const usedToolNames = new Set<string>()

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const stream = chatCompletionStream(llm, messages, tools, {
      abortSignal: options.abortSignal,
      providerCachingEnabled: settings.agent.providerCachingEnabled,
    })
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
      await maybeCreateInferredMemorySuggestion({
        latestUserContent,
        usedToolNames,
      }).catch(() => null)
      yield { type: 'usage', usage: withUserTokens(usage, history) }
      return
    }

    response.toolCalls.forEach((toolCall) => usedToolNames.add(toolCall.function.name))
    const toolMessages = yield* executeToolCallsWithEvents(
      response.toolCalls,
      options.runtimeContext,
    )
    messages.push(...toolMessages)
  }

  throw httpError(500, 'Agent 工具调用轮次过多，请重试或调整问题描述。')
}

async function* runProgressiveStream(
  history: ChatMessage[],
  options: AgentRunOptions,
): AsyncGenerator<AgentStreamEvent, void, void> {
  const settings = await getSettings()
  const llm = resolveLlmConfigForTask(settings.llm, 'agent-chat')
  const sessionId = deriveSessionId(options.runtimeContext)
  const storedMessages: StoredChatMessage[] | undefined =
    options.runtimeContext?.source ? undefined : (await getChatHistory()).messages
  const latestUserContent = latestUserMessage(history)?.content ?? ''
  const callerSystemInstructions = formatSafeCallerSystemInstructions(history)
  const usedToolNames = new Set<string>()
  let checkpoint = await ensureCheckpointSeedForSession(sessionId, history, storedMessages)
  let conversation = normalizeHistoryForProgressive(
    history,
    Math.max(1, settings.agent.contextMessageLimit),
  )

  if (settings.agent.checkpointEnabled && latestUserContent && !checkpoint.goal) {
    checkpoint = await patchCheckpoint(sessionId, {
      goal: truncateText(latestUserContent, 200),
    })
  }

  let mountedPacks = checkpoint.mountedPacks
  let usage: TokenUsage = {}
  let upgradeCount = 0

  appendAgentRuntimeLog({
    stage: 'progressive-start',
    mode: 'progressive',
    sessionId,
    mountedPacks,
    upgradeCount,
    checkpoint,
    checkpointEnabled: settings.agent.checkpointEnabled,
    providerCachingEnabled: settings.agent.providerCachingEnabled,
  })

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const built = await buildProgressiveMessages({
      history: conversation,
      mountedPacks,
      userPrompt: settings.agent.userPrompt,
      checkpointSessionId: sessionId,
      latestUserContent,
      callerSystemInstructions,
      contextMessageLimit: settings.agent.contextMessageLimit,
      fullAccess: settings.agent.fullAccess === true,
      morningBriefContext: formatMorningBriefRuntimeContext(settings.agent),
    })

    if (settings.agent.checkpointEnabled) {
      checkpoint = await patchCheckpoint(sessionId, {
        summaryInjectedTokens: built.injectedCheckpointTokens,
      })
    } else {
      checkpoint = built.checkpoint
    }

    appendAgentRuntimeLog({
      stage: 'p0-budget',
      mode: 'progressive',
      sessionId,
      round,
      mountedPacks,
      upgradeCount,
      checkpoint,
      checkpointEnabled: settings.agent.checkpointEnabled,
      providerCachingEnabled: settings.agent.providerCachingEnabled,
      budgetReport: built.budgetReport,
    })

    const mountedToolDefinitions = getAgentToolDefinitionsForNames(
      getToolNamesForMountedPacks(mountedPacks),
    )
    const tools =
      mountedPacks.length > 0
        ? [getContextUpgradeToolDefinition(), ...mountedToolDefinitions]
        : [getContextUpgradeToolDefinition()]

    const stream = chatCompletionStream(llm, built.messages, tools, {
      abortSignal: options.abortSignal,
      providerCachingEnabled: settings.agent.providerCachingEnabled,
    })
    let step = await stream.next()

    while (!step.done) {
      yield { type: 'delta', content: step.value }
      step = await stream.next()
    }

    const response = step.value
    const hasUpgradeToolCall = response.toolCalls.some((toolCall) =>
      isContextUpgradeToolCall(toolCall.function.name),
    )
    usage = addUsage(usage, response.usage, {
      upgradeOverhead: hasUpgradeToolCall,
    })

    if (response.toolCalls.length === 0) {
      const nextContent = appendGeneratedImageMarkdown(response.content, built.messages)
      if (settings.agent.checkpointEnabled) {
        await appendCheckpointEntry(sessionId, {
          done: truncateText(stripThink(nextContent), 180),
          mountedPacks,
        })
      }
      if (nextContent !== response.content) {
        yield { type: 'delta', content: nextContent.slice(response.content.length) }
      }
      const finalUsage = withUserTokens(usage, history)
      appendAgentRuntimeLog({
        stage: 'progressive-complete',
        mode: 'progressive',
        sessionId,
        round,
        mountedPacks,
        upgradeCount,
        checkpoint,
        checkpointEnabled: settings.agent.checkpointEnabled,
        providerCachingEnabled: settings.agent.providerCachingEnabled,
        usage: finalUsage,
      })
      await maybeCreateInferredMemorySuggestion({
        latestUserContent,
        usedToolNames,
      }).catch(() => null)
      yield { type: 'usage', usage: finalUsage }
      return
    }

    const upgradeToolCalls = response.toolCalls.filter((toolCall) =>
      isContextUpgradeToolCall(toolCall.function.name),
    )
    const businessToolCalls = response.toolCalls.filter(
      (toolCall) => !isContextUpgradeToolCall(toolCall.function.name),
    )

    if (upgradeToolCalls.length > 0 && businessToolCalls.length > 0) {
      conversation.push(toAssistantHistoryMessage(response))
      appendAgentRuntimeLog({
        stage: 'context-upgrade-aborted',
        mode: 'progressive',
        sessionId,
        round,
        mountedPacks,
        upgradeCount,
        checkpoint,
        checkpointEnabled: settings.agent.checkpointEnabled,
        providerCachingEnabled: settings.agent.providerCachingEnabled,
        toolNames: response.toolCalls.map((toolCall) => toolCall.function.name),
        error: 'request_context_upgrade cannot be mixed with business tool calls',
      })
      if (settings.agent.upgradeDebugEventsEnabled) {
        yield { type: 'context-upgrade-aborted', stage: 'mixed-tool-calls' }
      }
      conversation.push(
        createToolErrorMessage(
          upgradeToolCalls[0]!.id,
          'request_context_upgrade cannot be mixed with business tool calls',
        ),
      )
      if (settings.agent.checkpointEnabled) {
        await appendCheckpointEntry(sessionId, {
          failedAttempt: 'Mixed request_context_upgrade with business tools in one assistant turn',
          mountedPacks,
        })
      }
      continue
    }

    if (upgradeToolCalls.length > 0) {
      const toolCall = upgradeToolCalls[0]!
      const upgradeRequest = parseContextUpgradeArgs(toolCall.function.arguments)

      try {
        validateContextUpgradeRequest(upgradeRequest, upgradeCount)
      } catch (error) {
        const message =
          error instanceof HttpError ? error.message : 'Failed to validate context upgrade request'
        conversation.push(toAssistantHistoryMessage(response))
        conversation.push(createToolErrorMessage(toolCall.id, message))
        appendAgentRuntimeLog({
          stage: 'context-upgrade-aborted',
          mode: 'progressive',
          sessionId,
          round,
          mountedPacks,
          upgradeCount,
          checkpoint,
          checkpointEnabled: settings.agent.checkpointEnabled,
          providerCachingEnabled: settings.agent.providerCachingEnabled,
          requestedPacks: upgradeRequest.packs,
          reason: upgradeRequest.reason,
          error: message,
        })
        if (settings.agent.upgradeDebugEventsEnabled) {
          yield { type: 'context-upgrade-aborted', stage: 'validation' }
        }
        if (settings.agent.checkpointEnabled) {
          await appendCheckpointEntry(sessionId, {
            failedAttempt: truncateText(message, 160),
            mountedPacks,
          })
        }
        continue
      }

      appendAgentRuntimeLog({
        stage: 'context-upgrade-requested',
        mode: 'progressive',
        sessionId,
        round,
        mountedPacks,
        upgradeCount,
        checkpoint,
        checkpointEnabled: settings.agent.checkpointEnabled,
        providerCachingEnabled: settings.agent.providerCachingEnabled,
        requestedPacks: upgradeRequest.packs,
        reason: upgradeRequest.reason,
      })

      if (settings.agent.upgradeDebugEventsEnabled) {
        yield {
          type: 'context-upgrade-requested',
          packs: upgradeRequest.packs,
          reason: upgradeRequest.reason,
        }
        yield { type: 'context-upgrade-applying', packs: upgradeRequest.packs }
      }

      mountedPacks = [...new Set([...mountedPacks, ...expandMountedPacks(upgradeRequest.packs)])]
      upgradeCount += 1
      conversation.push(toAssistantHistoryMessage(response))
      conversation.push(createToolSuccessMessage(toolCall.id, upgradeRequest.packs, mountedPacks))

      if (settings.agent.checkpointEnabled) {
        checkpoint = await patchCheckpoint(sessionId, {
          mountedPacks,
          nextStep: upgradeRequest.reason,
        })
      }

      appendAgentRuntimeLog({
        stage: 'context-upgrade-applied',
        mode: 'progressive',
        sessionId,
        round,
        mountedPacks,
        upgradeCount,
        checkpoint,
        checkpointEnabled: settings.agent.checkpointEnabled,
        providerCachingEnabled: settings.agent.providerCachingEnabled,
        requestedPacks: upgradeRequest.packs,
        reason: upgradeRequest.reason,
      })

      if (settings.agent.upgradeDebugEventsEnabled) {
        yield { type: 'context-upgrade-applied', packs: upgradeRequest.packs }
      }
      continue
    }

    conversation.push(toAssistantHistoryMessage(response))
    response.toolCalls.forEach((toolCall) => usedToolNames.add(toolCall.function.name))
    const toolMessages = yield* executeToolCallsWithEvents(
      response.toolCalls,
      options.runtimeContext,
    )
    conversation.push(...toolMessages)

    const toolFailure = extractToolFailure(toolMessages)
    appendAgentRuntimeLog({
      stage: 'business-tools',
      mode: 'progressive',
      sessionId,
      round,
      mountedPacks,
      upgradeCount,
      checkpoint,
      checkpointEnabled: settings.agent.checkpointEnabled,
      providerCachingEnabled: settings.agent.providerCachingEnabled,
      toolNames: response.toolCalls.map((tool) => tool.function.name),
      toolFailure: toolFailure || undefined,
    })
    if (settings.agent.checkpointEnabled) {
      await appendCheckpointEntry(sessionId, {
        fact: toolFailure ? undefined : `Used tools: ${response.toolCalls.map((tool) => tool.function.name).join(', ')}`,
        failedAttempt: toolFailure || undefined,
        mountedPacks,
      })
    }

  }

  appendAgentRuntimeLog({
    stage: 'progressive-round-limit',
    mode: 'progressive',
    sessionId,
    mountedPacks,
    upgradeCount,
    checkpoint,
    checkpointEnabled: settings.agent.checkpointEnabled,
    providerCachingEnabled: settings.agent.providerCachingEnabled,
    error: 'Agent tool round limit exceeded',
  })
  throw httpError(500, 'Agent 工具调用轮次过多，请重试或调整问题描述。')
}

export async function sendMessage(
  history: ChatMessage[],
  options: AgentRunOptions = {},
): Promise<ChatMessage> {
  let content = ''
  let usage: TokenUsage | undefined

  for await (const event of sendMessageStream(history, options)) {
    if (event.type === 'delta') {
      content += event.content
    } else if (event.type === 'usage') {
      usage = event.usage
    }
  }

  return {
    role: 'assistant',
    content,
    usage,
  }
}

export async function* sendMessageStream(
  history: ChatMessage[],
  options: AgentRunOptions = {},
): AsyncGenerator<AgentStreamEvent, void, void> {
  const settings = await getSettings()
  if (settings.agent.progressiveDisclosureEnabled) {
    yield* runProgressiveStream(history, options)
    return
  }

  yield* runLegacyStream(history, options)
}
