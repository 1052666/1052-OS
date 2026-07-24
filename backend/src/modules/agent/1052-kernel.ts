import type { AgentStreamEvent } from './agent.runtime.types.js'
import type { ChatMessage, TokenUsage } from './agent.types.js'
import {
  addRuntime1052Usage,
  appendRuntime1052GeneratedImageMarkdown,
  applyRuntime1052ContextUpgrade,
  buildRuntime1052StepContext,
  completeRuntime1052Session,
  createRuntime1052SessionState,
  isRuntime1052EmptyReply,
  recordRuntime1052ToolResults,
  RUNTIME_1052_EMPTY_REPLY_NUDGE,
  toRuntime1052AssistantMessage,
  withRuntime1052UserTokens,
  type Runtime1052SessionState,
  type Runtime1052StepContext,
  type Runtime1052UpgradeResult,
} from './1052-context-runtime.js'
import { compactRuntime1052Conversation } from './1052-compaction-runtime.js'
import type {
  Runtime1052Event,
  Runtime1052RunOptions,
  Runtime1052Source,
  Runtime1052TurnInput,
  Runtime1052TurnStatus,
} from './1052-kernel.types.js'
import { isRuntime1052IdleError, sampleRuntime1052Model } from './1052-model-runtime.js'
import { createRuntime1052RolloutWriter } from './1052-rollout.service.js'
import { routeRuntime1052ToolCalls } from './1052-tool-router.js'
import { resolve1052PermissionProfile } from './1052-permission-profile.js'
import { estimateTokenCount, type LLMAssistantMessage, type LLMConversationMessage, type LLMToolCall } from './llm.client.js'
import { isContextUpgradeToolCall, REQUEST_CONTEXT_UPGRADE_TOOL } from './agent.upgrade.service.js'

const DEFAULT_MAX_STEPS = 128
const STREAM_IDLE_TIMEOUT_MS = 5 * 60_000
const MAX_EMPTY_REPLY_RETRIES = 2

export type Runtime1052LoopResult = {
  status: Runtime1052TurnStatus
  steps: number
  usage: TokenUsage
}

export type Runtime1052LoopDriver = {
  prepareStep: (state: Runtime1052SessionState) => Promise<Runtime1052StepContext>
  sampleStep: (
    state: Runtime1052SessionState,
    step: Runtime1052StepContext,
  ) => AsyncGenerator<string, LLMAssistantMessage, void>
  routeToolCalls: (
    state: Runtime1052SessionState,
    toolCalls: readonly LLMToolCall[],
  ) => AsyncGenerator<Runtime1052Event, LLMConversationMessage[], void>
  applyContextUpgrade: (
    state: Runtime1052SessionState,
    toolCall: LLMToolCall,
  ) => Promise<Runtime1052UpgradeResult>
  recordToolResults: (
    state: Runtime1052SessionState,
    toolCalls: readonly LLMToolCall[],
    messages: readonly LLMConversationMessage[],
  ) => Promise<void>
  complete: (state: Runtime1052SessionState, finalContent: string) => Promise<void>
}

export const defaultRuntime1052LoopDriver: Runtime1052LoopDriver = {
  prepareStep: buildRuntime1052StepContext,
  sampleStep(state, step) {
    return sampleRuntime1052Model({
      llm: state.llm,
      messages: step.messages,
      tools: step.tools,
      options: {
        abortSignal: state.options.abortSignal,
        providerCachingEnabled: state.settings.agent.providerCachingEnabled,
        streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      },
    })
  },
  routeToolCalls(state, toolCalls) {
    return routeRuntime1052ToolCalls({
      turnId: state.turn.turnId,
      toolCalls,
      source: state.turn.source,
      approvalMode: state.options.approvalMode,
      permissionProfile: resolve1052PermissionProfile(state.settings.agent),
      runtimeContext: state.options.runtimeContext,
      abortSignal: state.options.abortSignal,
    })
  },
  applyContextUpgrade: applyRuntime1052ContextUpgrade,
  recordToolResults: recordRuntime1052ToolResults,
  complete: completeRuntime1052Session,
}

function createTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function resolveSource(options: Runtime1052RunOptions): Runtime1052Source {
  return options.runtimeContext?.source ?? { channel: 'web' }
}

export function createRuntime1052TurnInput(
  history: ChatMessage[],
  options: Runtime1052RunOptions = {},
): Runtime1052TurnInput {
  return {
    turnId: options.turnId?.trim() || createTurnId(),
    history,
    source: resolveSource(options),
  }
}

export function runtime1052EventFromAgentEvent(
  turnId: string,
  event: AgentStreamEvent,
): Runtime1052Event | null {
  switch (event.type) {
    case 'delta':
      return { type: 'assistant-delta', turnId, content: event.content }
    case 'usage':
      return { type: 'usage-recorded', turnId, usage: event.usage }
    case 'tool-started':
      return {
        type: 'tool-call-started',
        turnId,
        name: event.name,
        callId: event.callId,
        argsPreview: event.argsPreview,
        dangerous: event.dangerous,
      }
    case 'tool-finished':
      return {
        type: 'tool-call-finished',
        turnId,
        name: event.name,
        ok: event.ok,
        error: event.error,
        callId: event.callId,
        resultPreview: event.resultPreview,
        durationMs: event.durationMs,
      }
    case 'approval-requested':
      return {
        type: 'approval-requested',
        turnId,
        approvalId: event.approvalId,
        callId: event.callId,
        name: event.name,
        argsPreview: event.argsPreview,
        expiresAt: event.expiresAt,
      }
    case 'approval-resolved':
      return {
        type: 'approval-resolved',
        turnId,
        approvalId: event.approvalId,
        callId: event.callId,
        name: event.name,
        decision: event.decision,
      }
    case 'context-upgrade-requested':
      return {
        type: 'context-upgrade-requested',
        turnId,
        packs: event.packs,
        reason: event.reason,
      }
    case 'context-upgrade-applying':
      return { type: 'context-upgrade-applying', turnId, packs: event.packs }
    case 'context-upgrade-applied':
      return { type: 'context-upgrade-applied', turnId, packs: event.packs }
    case 'context-upgrade-aborted':
      return { type: 'context-upgrade-aborted', turnId, stage: event.stage }
    case 'conversation-compacted':
      return {
        type: 'conversation-compacted',
        turnId,
        beforeMessages: event.beforeMessages,
        afterMessages: event.afterMessages,
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
        summaryTokens: event.summaryTokens,
        fallback: event.fallback,
        trigger: event.trigger,
        reason: event.reason,
        phase: event.phase,
        strategy: event.strategy,
        tokenLimit: event.tokenLimit,
        windowNumber: event.windowNumber,
        firstWindowId: event.firstWindowId,
        previousWindowId: event.previousWindowId,
        windowId: event.windowId,
      }
    case 'conversation-compaction-failed':
      return {
        type: 'conversation-compaction-failed',
        turnId,
        message: event.message,
        beforeMessages: event.beforeMessages,
        afterMessages: event.afterMessages,
      }
    default:
      return null
  }
}

export function agentEventFromRuntime1052Event(
  event: Runtime1052Event,
): AgentStreamEvent | null {
  switch (event.type) {
    case 'assistant-delta':
      return { type: 'delta', content: event.content }
    case 'usage-recorded':
      return { type: 'usage', usage: event.usage }
    case 'tool-call-started':
      return {
        type: 'tool-started',
        name: event.name,
        callId: event.callId,
        argsPreview: event.argsPreview,
        dangerous: event.dangerous,
      }
    case 'tool-call-finished':
      return {
        type: 'tool-finished',
        name: event.name,
        ok: event.ok,
        error: event.error,
        callId: event.callId,
        resultPreview: event.resultPreview,
        durationMs: event.durationMs,
      }
    case 'approval-requested':
      return {
        type: 'approval-requested',
        approvalId: event.approvalId,
        callId: event.callId,
        name: event.name,
        argsPreview: event.argsPreview,
        expiresAt: event.expiresAt,
      }
    case 'approval-resolved':
      return {
        type: 'approval-resolved',
        approvalId: event.approvalId,
        callId: event.callId,
        name: event.name,
        decision: event.decision,
      }
    case 'context-upgrade-requested':
      return {
        type: 'context-upgrade-requested',
        packs: event.packs,
        reason: event.reason,
      }
    case 'context-upgrade-applying':
      return { type: 'context-upgrade-applying', packs: event.packs }
    case 'context-upgrade-applied':
      return { type: 'context-upgrade-applied', packs: event.packs }
    case 'context-upgrade-aborted':
      return { type: 'context-upgrade-aborted', stage: event.stage }
    case 'conversation-compacted':
      return {
        type: 'conversation-compacted',
        beforeMessages: event.beforeMessages,
        afterMessages: event.afterMessages,
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
        summaryTokens: event.summaryTokens,
        fallback: event.fallback,
        trigger: event.trigger,
        reason: event.reason,
        phase: event.phase,
        strategy: event.strategy,
        tokenLimit: event.tokenLimit,
        windowNumber: event.windowNumber,
        firstWindowId: event.firstWindowId,
        previousWindowId: event.previousWindowId,
        windowId: event.windowId,
      }
    case 'conversation-compaction-failed':
      return {
        type: 'conversation-compaction-failed',
        message: event.message,
        beforeMessages: event.beforeMessages,
        afterMessages: event.afterMessages,
      }
    default:
      return null
  }
}

export function shouldExposeRuntime1052Event(
  event: Runtime1052Event,
  upgradeDebugEventsEnabled: boolean,
) {
  if (upgradeDebugEventsEnabled) return true
  return (
    event.type !== 'context-upgrade-requested' &&
    event.type !== 'context-upgrade-applying' &&
    event.type !== 'context-upgrade-applied' &&
    event.type !== 'context-upgrade-aborted'
  )
}

function modelResponseEvent(
  turnId: string,
  step: number,
  response: LLMAssistantMessage,
): Runtime1052Event {
  return {
    type: 'model-response',
    turnId,
    step,
    content: response.content,
    finishReason: response.finishReason,
    toolCalls: response.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })),
    usage: response.usage,
  }
}

function createToolErrorMessage(toolCall: LLMToolCall, error: string): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolCall.function.name,
    content: JSON.stringify({ ok: false, error }, null, 2),
  }
}

function finalUsage(state: Runtime1052SessionState) {
  return withRuntime1052UserTokens(state.usage, state.turn.history, estimateTokenCount)
}

function gracefulModelError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown model error'
  if (isRuntime1052IdleError(error)) {
    return `\n\n---\n模型在 ${Math.floor(STREAM_IDLE_TIMEOUT_MS / 60_000)} 分钟内没有继续输出。本轮已停止；发送“继续”可以重试。`
  }
  return `\n\n---\n模型调用失败：${message}。发送“继续”可以重试。`
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  return error instanceof Error && (error.name === 'AbortError' || /aborted|cancelled/i.test(error.message))
}

export async function* runRuntime1052Loop(
  state: Runtime1052SessionState,
  driver: Runtime1052LoopDriver = defaultRuntime1052LoopDriver,
): AsyncGenerator<Runtime1052Event, Runtime1052LoopResult, void> {
  const startedAt = Date.now()
  const maxSteps = Math.max(1, state.options.maxSteps ?? DEFAULT_MAX_STEPS)
  const maxDurationMs =
    typeof state.options.maxDurationMs === 'number' && Number.isFinite(state.options.maxDurationMs)
      ? Math.max(1_000, state.options.maxDurationMs)
      : null
  let emptyReplyRetries = 0

  for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
    if (state.options.abortSignal?.aborted) {
      throw state.options.abortSignal.reason ?? new Error('1052 turn aborted')
    }

    if (maxDurationMs !== null && Date.now() - startedAt > maxDurationMs) {
      const usage = finalUsage(state)
      yield {
        type: 'assistant-delta',
        turnId: state.turn.turnId,
        content: `\n\n---\n处理时间已达到 ${Math.ceil(maxDurationMs / 60_000)} 分钟上限，本轮已暂停。发送“继续”即可接着处理。`,
      }
      yield { type: 'usage-recorded', turnId: state.turn.turnId, usage }
      return { status: 'time-limit', steps: stepNumber - 1, usage }
    }

    const compacted = await compactRuntime1052Conversation(state)
    if (compacted.compacted) {
      if (compacted.usage) {
        state.usage = addRuntime1052Usage(state.usage, compacted.usage)
      }
      yield {
        type: 'conversation-compacted',
        turnId: state.turn.turnId,
        beforeMessages: compacted.beforeMessages,
        afterMessages: compacted.afterMessages,
        beforeTokens: compacted.beforeTokens,
        afterTokens: compacted.afterTokens,
        summaryTokens: compacted.summaryTokens,
        fallback: compacted.fallback,
        trigger: compacted.trigger,
        reason: compacted.reason,
        phase: compacted.phase,
        strategy: compacted.strategy,
        tokenLimit: compacted.tokenLimit,
        windowNumber: compacted.windowNumber,
        firstWindowId: compacted.firstWindowId,
        previousWindowId: compacted.previousWindowId,
        windowId: compacted.windowId,
      }
      if (compacted.error) {
        yield {
          type: 'conversation-compaction-failed',
          turnId: state.turn.turnId,
          message: compacted.error,
          beforeMessages: compacted.beforeMessages,
          afterMessages: compacted.afterMessages,
        }
      }
    }

    const step = await driver.prepareStep(state)
    yield {
      type: 'step-started',
      turnId: state.turn.turnId,
      step: stepNumber,
      mode: state.mode,
      mountedPacks: [...step.mountedPacks],
      toolCount: step.tools.length,
      promptTokens: step.budgetTokens,
      promptTokenLimit: step.budgetLimitTokens,
    }

    let response: LLMAssistantMessage
    try {
      const stream = driver.sampleStep(state, step)
      let item = await stream.next()
      while (!item.done) {
        yield { type: 'assistant-delta', turnId: state.turn.turnId, content: item.value }
        item = await stream.next()
      }
      response = item.value
    } catch (error) {
      if (isAbortError(error, state.options.abortSignal)) throw error
      const message = error instanceof Error ? error.message : 'Unknown model error'
      yield { type: 'model-error', turnId: state.turn.turnId, step: stepNumber, message }
      yield {
        type: 'assistant-delta',
        turnId: state.turn.turnId,
        content: gracefulModelError(error),
      }
      const usage = finalUsage(state)
      yield { type: 'usage-recorded', turnId: state.turn.turnId, usage }
      return { status: 'model-error', steps: stepNumber, usage }
    }

    const hasUpgradeTool = response.toolCalls.some((toolCall) =>
      isContextUpgradeToolCall(toolCall.function.name),
    )
    state.usage = addRuntime1052Usage(state.usage, response.usage, {
      upgradeOverhead: hasUpgradeTool,
    })
    yield modelResponseEvent(state.turn.turnId, stepNumber, response)

    if (isRuntime1052EmptyReply(response) && emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES) {
      emptyReplyRetries += 1
      state.conversation.push(toRuntime1052AssistantMessage(response))
      state.conversation.push(RUNTIME_1052_EMPTY_REPLY_NUDGE)
      continue
    }

    state.conversation.push(toRuntime1052AssistantMessage(response))

    if (response.toolCalls.length === 0) {
      let finalContent = appendRuntime1052GeneratedImageMarkdown(
        response.content,
        state.conversation,
      )
      if (isRuntime1052EmptyReply(response)) {
        finalContent += '\n\n---\n模型没有生成可见回答或工具调用，请重新描述任务或发送“继续”重试。'
      }
      if (finalContent !== response.content) {
        yield {
          type: 'assistant-delta',
          turnId: state.turn.turnId,
          content: finalContent.slice(response.content.length),
        }
      }
      await driver.complete(state, finalContent)
      const usage = finalUsage(state)
      yield { type: 'usage-recorded', turnId: state.turn.turnId, usage }
      return { status: 'completed', steps: stepNumber, usage }
    }

    const upgradeCalls = response.toolCalls.filter((toolCall) =>
      isContextUpgradeToolCall(toolCall.function.name),
    )
    const businessCalls = response.toolCalls.filter(
      (toolCall) => !isContextUpgradeToolCall(toolCall.function.name),
    )

    if (upgradeCalls.length > 0 && businessCalls.length > 0) {
      const error = `${REQUEST_CONTEXT_UPGRADE_TOOL} cannot be mixed with business tool calls in one model step`
      const toolMessages = response.toolCalls.map((toolCall) =>
        createToolErrorMessage(toolCall, error),
      )
      state.conversation.push(...toolMessages)
      yield {
        type: 'context-upgrade-aborted',
        turnId: state.turn.turnId,
        stage: 'mixed-tool-calls',
      }
      continue
    }

    if (upgradeCalls.length > 0) {
      for (const toolCall of upgradeCalls) {
        const result = await driver.applyContextUpgrade(state, toolCall)
        state.conversation.push(result.toolMessage)
        if (!result.ok) {
          yield {
            type: 'context-upgrade-aborted',
            turnId: state.turn.turnId,
            stage: result.stage,
          }
          continue
        }

        yield {
          type: 'context-upgrade-requested',
          turnId: state.turn.turnId,
          packs: result.requestedPacks,
          reason: result.reason,
        }
        yield {
          type: 'context-upgrade-applying',
          turnId: state.turn.turnId,
          packs: result.requestedPacks,
        }
        yield {
          type: 'context-upgrade-applied',
          turnId: state.turn.turnId,
          packs: result.requestedPacks,
        }
      }
      continue
    }

    const toolStream = driver.routeToolCalls(state, businessCalls)
    let toolItem = await toolStream.next()
    while (!toolItem.done) {
      yield toolItem.value
      toolItem = await toolStream.next()
    }
    state.conversation.push(...toolItem.value)
    await driver.recordToolResults(state, businessCalls, toolItem.value)
  }

  const usage = finalUsage(state)
  yield {
    type: 'assistant-delta',
    turnId: state.turn.turnId,
    content: `\n\n---\n本轮已达到 ${maxSteps} 个执行步骤上限，已暂停。发送“继续”即可接着处理。`,
  }
  yield { type: 'usage-recorded', turnId: state.turn.turnId, usage }
  return { status: 'step-limit', steps: maxSteps, usage }
}

export async function* runRuntime1052KernelEvents(
  history: ChatMessage[],
  options: Runtime1052RunOptions = {},
): AsyncGenerator<Runtime1052Event, void, void> {
  const turn = createRuntime1052TurnInput(history, options)
  const rollout = createRuntime1052RolloutWriter()
  const startedEvent: Runtime1052Event = {
    type: 'turn-started',
    turnId: turn.turnId,
    source: turn.source,
    messageCount: turn.history.length,
  }
  rollout.enqueue(startedEvent)
  yield startedEvent

  try {
    const state = await createRuntime1052SessionState(turn, options)
    const loop = runRuntime1052Loop(state)
    let item = await loop.next()
    while (!item.done) {
      rollout.enqueue(item.value)
      if (
        shouldExposeRuntime1052Event(
          item.value,
          state.settings.agent.upgradeDebugEventsEnabled,
        )
      ) {
        yield item.value
      }
      item = await loop.next()
    }

    const completed: Runtime1052Event = {
      type: 'turn-completed',
      turnId: turn.turnId,
      status: item.value.status,
      steps: item.value.steps,
      usage: item.value.usage,
    }
    rollout.enqueue(completed)
    await rollout.flush()
    yield completed
  } catch (error) {
    const aborted: Runtime1052Event = {
      type: 'turn-aborted',
      turnId: turn.turnId,
      reason: error instanceof Error ? error.message : '1052 runtime aborted',
    }
    rollout.enqueue(aborted)
    await rollout.flush().catch(() => undefined)
    yield aborted
    throw error
  }
}

export async function* runRuntime1052KernelStream(
  history: ChatMessage[],
  options: Runtime1052RunOptions = {},
): AsyncGenerator<AgentStreamEvent, void, void> {
  for await (const runtimeEvent of runRuntime1052KernelEvents(history, options)) {
    const event = agentEventFromRuntime1052Event(runtimeEvent)
    if (event) yield event
  }
}
