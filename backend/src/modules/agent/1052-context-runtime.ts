import os from 'node:os'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import {
  formatMorningBriefRuntimeContext,
  getSettings,
  resolveLlmConfigForTask,
} from '../settings/settings.service.js'
import { formatMemoryRuntimeContext } from '../memory/memory.service.js'
import { formatOutputProfileRuntimeContext } from '../output-profiles/output-profile.service.js'
import { formatSkillsRuntimeContext } from '../skills/skills.service.js'
import { formatUapisDirectorySummary } from '../uapis/uapis.service.js'
import {
  appendCheckpointEntry,
  deriveSessionId,
  getCheckpoint,
  patchCheckpoint,
} from './agent.checkpoint.service.js'
import {
  formatSafeCallerSystemInstructions,
  safeSliceMessages,
  sanitizeCheckpointTextForModel,
  stripThinkBlocks,
  toModelChatMessages,
} from './agent.context-sanitizer.service.js'
import { getChatHistory } from './agent.history.service.js'
import { maybeCreateInferredMemorySuggestion } from './agent.memory-autosuggest.service.js'
import {
  expandMountedPacks,
  getToolNamesForMountedPacks,
  REQUESTABLE_PACKS,
} from './agent.pack.service.js'
import { buildP0Messages, getContextUpgradeToolDefinition } from './agent.p0.service.js'
import { ensureCheckpointSeedForSession } from './agent.seed.service.js'
import {
  getAgentToolDefinitions,
  getAgentToolDefinitionsForNames,
} from './agent.tool.service.js'
import {
  parseContextUpgradeArgs,
  REQUEST_CONTEXT_UPGRADE_TOOL,
  validateContextUpgradeRequest,
} from './agent.upgrade.service.js'
import { formatAgentWorkspaceContext } from './agent.workspace.service.js'
import type { AgentCheckpoint, AgentPackName } from './agent.runtime.types.js'
import type { ChatMessage, StoredChatMessage, TokenUsage } from './agent.types.js'
import type {
  LLMAssistantMessage,
  LLMConfig,
  LLMConversationMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.client.js'
import type { Runtime1052RunOptions, Runtime1052TurnInput } from './1052-kernel.types.js'
import {
  describe1052PermissionProfile,
  resolve1052PermissionProfile,
} from './1052-permission-profile.js'
import { resolveRuntime1052ContextPolicy } from './1052-context-policy.js'

export const RUNTIME_1052_EMPTY_REPLY_NUDGE: LLMConversationMessage = {
  role: 'system',
  content: [
    'The previous model step produced no visible answer and no tool call.',
    'Continue the same 1052 turn now.',
    'Either call the tool required for the next concrete action or provide the user-facing answer.',
    'Do not return reasoning-only or an empty response.',
  ].join('\n'),
}

type Runtime1052Settings = Awaited<ReturnType<typeof getSettings>>

export type Runtime1052Mode = 'progressive' | 'full-toolbox'

export type Runtime1052SessionState = {
  turn: Runtime1052TurnInput
  options: Runtime1052RunOptions
  settings: Runtime1052Settings
  llm: LLMConfig
  mode: Runtime1052Mode
  sessionId: string
  latestUserContent: string
  callerSystemInstructions: string
  conversation: LLMConversationMessage[]
  mountedPacks: AgentPackName[]
  checkpoint: AgentCheckpoint
  compactionWindow?: {
    windowNumber: number
    firstWindowId: string
    previousWindowId?: string
    windowId: string
  }
  upgradeCount: number
  usedToolNames: Set<string>
  usage: TokenUsage
}

export type Runtime1052StepContext = {
  messages: LLMConversationMessage[]
  tools: LLMToolDefinition[]
  mountedPacks: AgentPackName[]
  budgetTokens: number
  budgetLimitTokens: number
}

export type Runtime1052UpgradeResult =
  | {
      ok: true
      requestedPacks: Exclude<AgentPackName, 'base-read-pack'>[]
      reason: string
      mountedPacks: AgentPackName[]
      toolMessage: LLMConversationMessage
    }
  | {
      ok: false
      requestedPacks: Exclude<AgentPackName, 'base-read-pack'>[]
      reason: string
      stage: 'parse' | 'validation'
      error: string
      toolMessage: LLMConversationMessage
    }

function workspaceRoot() {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === 'backend' ? path.dirname(cwd) : cwd
}

function latestUserMessage(history: readonly ChatMessage[]) {
  return [...history].reverse().find((message) => message.role === 'user')
}

function formatRuntimeContext(state: Runtime1052SessionState) {
  const now = new Date()
  return [
    '1052 runtime context:',
    `- turn_id: ${state.turn.turnId}`,
    `- session_id: ${state.sessionId}`,
    `- source: ${state.turn.source.channel}`,
    `- local_time: ${now.toISOString()}`,
    `- timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'}`,
  ].join('\n')
}

function formatSystemEnvironmentContext() {
  return [
    'System environment:',
    `- platform: ${os.platform()} ${os.release()}`,
    `- architecture: ${os.arch()}`,
    `- shell: ${process.platform === 'win32' ? 'PowerShell' : process.env.SHELL || 'unknown'}`,
    `- workspace_root: ${workspaceRoot()}`,
  ].join('\n')
}

async function buildExtraSections(state: Runtime1052SessionState) {
  const permissionProfile = resolve1052PermissionProfile(state.settings.agent)
  const sections = [
    formatRuntimeContext(state),
    formatSystemEnvironmentContext(),
    describe1052PermissionProfile(permissionProfile),
    formatMorningBriefRuntimeContext(state.settings.agent),
    state.callerSystemInstructions,
    formatAgentWorkspaceContext(),
  ]

  if (state.mountedPacks.includes('search-pack')) {
    sections.push(await formatUapisDirectorySummary())
  }
  if (state.mountedPacks.includes('memory-pack')) {
    sections.push(await formatMemoryRuntimeContext(state.latestUserContent))
  }

  sections.push(await formatOutputProfileRuntimeContext(state.latestUserContent))
  sections.push(await formatSkillsRuntimeContext())
  return sections.filter(Boolean)
}

export async function createRuntime1052SessionState(
  turn: Runtime1052TurnInput,
  options: Runtime1052RunOptions,
): Promise<Runtime1052SessionState> {
  const settings = await getSettings()
  const llm = resolveLlmConfigForTask(settings.llm, 'agent-chat')
  const sessionId = deriveSessionId(options.runtimeContext)
  const storedMessages: StoredChatMessage[] | undefined = options.runtimeContext?.source
    ? undefined
    : (await getChatHistory()).messages
  const latestUserContent = latestUserMessage(turn.history)?.content ?? ''
  let checkpoint = await ensureCheckpointSeedForSession(sessionId, turn.history, storedMessages)

  if (settings.agent.checkpointEnabled && latestUserContent && !checkpoint.goal) {
    checkpoint = await patchCheckpoint(sessionId, {
      goal: latestUserContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    })
  }

  const mode: Runtime1052Mode = settings.agent.progressiveDisclosureEnabled
    ? 'progressive'
    : 'full-toolbox'
  const mountedPacks =
    mode === 'progressive'
      ? checkpoint.mountedPacks
      : expandMountedPacks(REQUESTABLE_PACKS)
  const contextPolicy = resolveRuntime1052ContextPolicy(settings.agent)

  return {
    turn,
    options,
    settings,
    llm,
    mode,
    sessionId,
    latestUserContent,
    callerSystemInstructions: formatSafeCallerSystemInstructions(turn.history),
    conversation: toModelChatMessages(
      turn.history,
      Math.max(1, contextPolicy.contextMessageLimit),
    ) as LLMConversationMessage[],
    mountedPacks,
    checkpoint,
    upgradeCount: 0,
    usedToolNames: new Set<string>(),
    usage: {},
  }
}

export async function buildRuntime1052StepContext(
  state: Runtime1052SessionState,
): Promise<Runtime1052StepContext> {
  if (state.settings.agent.checkpointEnabled) {
    state.checkpoint = await getCheckpoint(state.sessionId)
  }

  const contextPolicy = resolveRuntime1052ContextPolicy(state.settings.agent)
  const history = safeSliceMessages(state.conversation, Math.max(1, contextPolicy.contextMessageLimit))
  const built = await buildP0Messages({
    history,
    checkpoint: state.checkpoint,
    userPrompt: state.settings.agent.userPrompt,
    mountedPacks: state.mountedPacks,
    extraSections: await buildExtraSections(state),
  })

  if (state.settings.agent.checkpointEnabled) {
    state.checkpoint = await patchCheckpoint(state.sessionId, {
      summaryInjectedTokens: built.injectedCheckpointTokens,
    })
  }

  const tools =
    state.mode === 'full-toolbox'
      ? getAgentToolDefinitions()
      : [
          getContextUpgradeToolDefinition(),
          ...getAgentToolDefinitionsForNames(getToolNamesForMountedPacks(state.mountedPacks)),
        ]

  return {
    messages: built.messages,
    tools,
    mountedPacks: [...state.mountedPacks],
    budgetTokens: built.budgetReport.tokens,
    budgetLimitTokens: built.budgetReport.limitTokens,
  }
}

export function toRuntime1052AssistantMessage(
  response: LLMAssistantMessage,
): LLMConversationMessage {
  return {
    role: 'assistant',
    content: response.content,
    ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
  }
}

function contextUpgradeToolMessage(
  toolCallId: string,
  content: Record<string, unknown>,
): LLMConversationMessage {
  return {
    role: 'tool',
    toolCallId,
    name: REQUEST_CONTEXT_UPGRADE_TOOL,
    content: JSON.stringify(content, null, 2),
  }
}

export async function applyRuntime1052ContextUpgrade(
  state: Runtime1052SessionState,
  toolCall: LLMToolCall,
): Promise<Runtime1052UpgradeResult> {
  let requestedPacks: Exclude<AgentPackName, 'base-read-pack'>[] = []
  let reason = ''

  try {
    const request = parseContextUpgradeArgs(toolCall.function.arguments)
    requestedPacks = request.packs
    reason = request.reason
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid context upgrade arguments'
    return {
      ok: false,
      requestedPacks,
      reason,
      stage: 'parse',
      error: message,
      toolMessage: contextUpgradeToolMessage(toolCall.id, { ok: false, error: message }),
    }
  }

  try {
    validateContextUpgradeRequest({ packs: requestedPacks, reason }, state.upgradeCount)
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Context upgrade validation failed'
    if (state.settings.agent.checkpointEnabled) {
      state.checkpoint = await appendCheckpointEntry(state.sessionId, {
        failedAttempt: message,
        mountedPacks: state.mountedPacks,
      })
    }
    return {
      ok: false,
      requestedPacks,
      reason,
      stage: 'validation',
      error: message,
      toolMessage: contextUpgradeToolMessage(toolCall.id, { ok: false, error: message }),
    }
  }

  state.mountedPacks = [
    ...new Set([...state.mountedPacks, ...expandMountedPacks(requestedPacks)]),
  ]
  state.upgradeCount += 1
  if (state.settings.agent.checkpointEnabled) {
    state.checkpoint = await patchCheckpoint(state.sessionId, {
      mountedPacks: state.mountedPacks,
      nextStep: reason,
    })
  }

  return {
    ok: true,
    requestedPacks,
    reason,
    mountedPacks: [...state.mountedPacks],
    toolMessage: contextUpgradeToolMessage(toolCall.id, {
      ok: true,
      data: { packs: requestedPacks, mountedPacks: state.mountedPacks },
    }),
  }
}

function extractToolFailure(messages: readonly LLMConversationMessage[]) {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    try {
      const parsed = JSON.parse(message.content) as { ok?: boolean; error?: string }
      if (parsed.ok === false && parsed.error) {
        return sanitizeCheckpointTextForModel(`${message.name}: ${parsed.error.slice(0, 240)}`)
      }
    } catch {
      continue
    }
  }
  return ''
}

export async function recordRuntime1052ToolResults(
  state: Runtime1052SessionState,
  toolCalls: readonly LLMToolCall[],
  messages: readonly LLMConversationMessage[],
) {
  toolCalls.forEach((toolCall) => state.usedToolNames.add(toolCall.function.name))
  if (!state.settings.agent.checkpointEnabled) return

  const failure = extractToolFailure(messages)
  state.checkpoint = await appendCheckpointEntry(state.sessionId, {
    fact: failure
      ? undefined
      : `Used tools: ${toolCalls.map((toolCall) => toolCall.function.name).join(', ')}`,
    failedAttempt: failure || undefined,
    mountedPacks: state.mountedPacks,
  })
}

export function appendRuntime1052GeneratedImageMarkdown(
  content: string,
  messages: readonly LLMConversationMessage[],
) {
  const markdownBlocks: string[] = []
  const seenUrls = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'tool' || message.name !== 'image_generate') continue
    try {
      const parsed = JSON.parse(message.content) as {
        ok?: boolean
        data?: { markdown?: string; images?: { url?: string }[] }
      }
      if (parsed.ok !== true) continue
      const markdown = typeof parsed.data?.markdown === 'string' ? parsed.data.markdown.trim() : ''
      const urls = (parsed.data?.images ?? [])
        .map((image) => (typeof image.url === 'string' ? image.url : ''))
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
  return `${content}${content.trim() ? '\n\n' : ''}${markdownBlocks.join('\n\n')}`
}

export function isRuntime1052EmptyReply(response: LLMAssistantMessage) {
  return response.toolCalls.length === 0 && stripThinkBlocks(response.content).length === 0
}

export async function completeRuntime1052Session(
  state: Runtime1052SessionState,
  finalContent: string,
) {
  if (state.settings.agent.checkpointEnabled) {
    state.checkpoint = await appendCheckpointEntry(state.sessionId, {
      done: stripThinkBlocks(finalContent).slice(0, 180),
      mountedPacks: state.mountedPacks,
    })
  }

  await maybeCreateInferredMemorySuggestion({
    latestUserContent: state.latestUserContent,
    usedToolNames: state.usedToolNames,
  }).catch(() => null)
}

export function addRuntime1052Usage(
  total: TokenUsage,
  usage: LLMAssistantMessage['usage'],
  options?: { upgradeOverhead?: boolean },
): TokenUsage {
  if (!usage) return total
  return {
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

export function withRuntime1052UserTokens(
  usage: TokenUsage,
  history: readonly ChatMessage[],
  estimateTokenCount: (text: string) => number,
): TokenUsage {
  const latestUser = latestUserMessage(history)
  return {
    ...usage,
    userTokens: latestUser ? estimateTokenCount(latestUser.content) : undefined,
    estimated: usage.estimated === true ? true : undefined,
  }
}
