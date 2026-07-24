import {
  buildArgsPreview,
  buildResultPreview,
  executeToolCall,
  type AgentToolRuntimeContext,
  type Runtime1052ToolAuthorization,
} from './agent.tool.service.js'
import {
  requestRuntime1052Approval,
  type Runtime1052ApprovalDecision,
} from './1052-approval.service.js'
import type {
  Runtime1052ApprovalMode,
  Runtime1052Event,
  Runtime1052Source,
} from './1052-kernel.types.js'
import type { PermissionProfile1052 } from './1052-permission-profile.js'
import type { LLMConversationMessage, LLMToolCall } from './llm.client.js'
import { canRun1052ToolInParallel, is1052ToolSideEffecting } from './1052-tool-runtime.js'

export type Runtime1052ToolExecutor = (
  toolCall: LLMToolCall,
  runtimeContext?: AgentToolRuntimeContext,
  authorization?: Runtime1052ToolAuthorization,
) => Promise<LLMConversationMessage>

export type Runtime1052ToolRouteOptions = {
  turnId: string
  toolCalls: readonly LLMToolCall[]
  source: Runtime1052Source
  approvalMode?: Runtime1052ApprovalMode
  permissionProfile: PermissionProfile1052
  runtimeContext?: AgentToolRuntimeContext
  abortSignal?: AbortSignal
  approvalTimeoutMs?: number
  execute?: Runtime1052ToolExecutor
}

type CompletedToolCall = {
  index: number
  toolCall: LLMToolCall
  message: LLMConversationMessage
  durationMs: number
}

function toolFailureMessage(toolCall: LLMToolCall, error: string): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolCall.function.name,
    content: JSON.stringify({ ok: false, error }, null, 2),
  }
}

function parseToolOutcome(content: string) {
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; error?: string }
    return {
      ok: parsed?.ok !== false,
      error: parsed?.ok === false && typeof parsed.error === 'string' ? parsed.error : undefined,
    }
  } catch {
    return { ok: true, error: undefined }
  }
}

function finishedEvent(turnId: string, completed: CompletedToolCall): Runtime1052Event {
  const content = completed.message.role === 'tool' ? completed.message.content : ''
  const outcome = parseToolOutcome(content)

  return {
    type: 'tool-call-finished',
    turnId,
    name: completed.toolCall.function.name,
    callId: completed.toolCall.id,
    ok: outcome.ok,
    error: outcome.error,
    resultPreview: buildResultPreview(content),
    resultContent: content,
    durationMs: completed.durationMs,
  }
}

async function executeOne(
  index: number,
  toolCall: LLMToolCall,
  runtimeContext: AgentToolRuntimeContext | undefined,
  execute: Runtime1052ToolExecutor,
  authorization?: Runtime1052ToolAuthorization,
): Promise<CompletedToolCall> {
  const startedAt = Date.now()
  const message = await execute(toolCall, runtimeContext, authorization)
  return {
    index,
    toolCall,
    message,
    durationMs: Date.now() - startedAt,
  }
}

function approvalFailure(decision: Runtime1052ApprovalDecision) {
  switch (decision) {
    case 'denied':
      return 'The user denied this 1052 tool approval.'
    case 'cancelled':
      return 'The 1052 tool approval was cancelled because the turn stopped.'
    case 'expired':
      return 'The 1052 tool approval expired before a decision was received.'
    default:
      return 'The 1052 tool approval was not granted.'
  }
}

export async function* routeRuntime1052ToolCalls(
  options: Runtime1052ToolRouteOptions,
): AsyncGenerator<Runtime1052Event, LLMConversationMessage[], void> {
  const {
    turnId,
    toolCalls,
    runtimeContext,
    permissionProfile,
    source,
    approvalMode = source.channel === 'web' ? 'interactive' : 'deny',
    abortSignal,
    approvalTimeoutMs,
  } = options
  const execute = options.execute ?? executeToolCall
  if (toolCalls.length === 0) return []

  for (const toolCall of toolCalls) {
    yield {
      type: 'tool-call-started',
      turnId,
      name: toolCall.function.name,
      callId: toolCall.id,
      argsPreview: buildArgsPreview(toolCall.function.arguments),
      dangerous: is1052ToolSideEffecting(toolCall.function.name),
    }
  }

  const messages: LLMConversationMessage[] = new Array(toolCalls.length)
  const runSequentially =
    toolCalls.length === 1 ||
    toolCalls.some((toolCall) => !canRun1052ToolInParallel(toolCall.function.name))

  if (runSequentially) {
    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index]!
      const sideEffecting = is1052ToolSideEffecting(toolCall.function.name)
      let authorization: Runtime1052ToolAuthorization | undefined
      let completed: CompletedToolCall

      if (
        sideEffecting &&
        permissionProfile.approvalPolicy !== 'never' &&
        permissionProfile.sandboxPolicy.type !== 'read-only'
      ) {
        if (approvalMode !== 'interactive') {
          completed = {
            index,
            toolCall,
            message: toolFailureMessage(
              toolCall,
              'This side-effecting tool requires an interactive 1052 approval, but this request cannot display one.',
            ),
            durationMs: 0,
          }
          messages[index] = completed.message
          yield finishedEvent(turnId, completed)
          continue
        }

        const argsPreview = buildArgsPreview(toolCall.function.arguments)
        const pending = requestRuntime1052Approval({
          turnId,
          callId: toolCall.id,
          toolName: toolCall.function.name,
          argsPreview,
          signal: abortSignal,
          timeoutMs: approvalTimeoutMs,
        })
        yield {
          type: 'approval-requested',
          turnId,
          approvalId: pending.request.approvalId,
          callId: toolCall.id,
          name: toolCall.function.name,
          argsPreview,
          expiresAt: pending.request.expiresAt,
        }
        const decision = await pending.decision
        yield {
          type: 'approval-resolved',
          turnId,
          approvalId: pending.request.approvalId,
          callId: toolCall.id,
          name: toolCall.function.name,
          decision,
        }

        if (decision !== 'approved') {
          completed = {
            index,
            toolCall,
            message: toolFailureMessage(toolCall, approvalFailure(decision)),
            durationMs: 0,
          }
          messages[index] = completed.message
          yield finishedEvent(turnId, completed)
          continue
        }
        authorization = { approved: true, approvalId: pending.request.approvalId }
      }

      completed = await executeOne(index, toolCall, runtimeContext, execute, authorization)
      messages[index] = completed.message
      yield finishedEvent(turnId, completed)
    }
    return messages
  }

  const pending = new Map<number, Promise<CompletedToolCall>>()
  toolCalls.forEach((toolCall, index) => {
    pending.set(index, executeOne(index, toolCall, runtimeContext, execute))
  })

  while (pending.size > 0) {
    const completed = await Promise.race(pending.values())
    pending.delete(completed.index)
    messages[completed.index] = completed.message
    yield finishedEvent(turnId, completed)
  }

  return messages
}
