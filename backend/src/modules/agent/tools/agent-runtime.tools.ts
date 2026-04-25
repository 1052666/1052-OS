import { HttpError } from '../../../http-error.js'
import {
  activateLlmProfile,
  getSettings,
  resolveLlmConfigForTask,
  updateLlmTaskRoutes,
} from '../../settings/settings.service.js'
import { discoverLocalModels } from '../../settings/local-llm-discovery.service.js'
import type { LLMTaskKind } from '../../settings/settings.types.js'
import {
  shouldUseProviderCaching,
  supportsPromptCacheKey,
  usesPassivePrefixCaching,
} from '../agent.cache-policy.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const LLM_TASKS: LLMTaskKind[] = [
  'agent-chat',
  'pdf-to-markdown',
  'coding',
  'summarization',
  'vision',
]

function assertConfirmed(value: unknown, message: string) {
  if (value !== true) throw new HttpError(400, message)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export const agentRuntimeTools: AgentTool[] = [
  {
    name: 'agent_runtime_status',
    description:
      'Inspect read-only Agent runtime feature flags and provider cache policy. Does not expose API keys.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const settings = await getSettings()
      const chatLlm = resolveLlmConfigForTask(settings.llm, 'agent-chat')
      return {
        agent: {
          progressiveDisclosureEnabled: settings.agent.progressiveDisclosureEnabled,
          providerCachingEnabled: settings.agent.providerCachingEnabled,
          checkpointEnabled: settings.agent.checkpointEnabled,
          seedOnResumeEnabled: settings.agent.seedOnResumeEnabled,
          upgradeDebugEventsEnabled: settings.agent.upgradeDebugEventsEnabled,
        },
        llm: {
          activeProfileId: settings.llm.activeProfileId,
          routedProfileId: chatLlm.activeProfileId,
          kind: chatLlm.kind,
          provider: chatLlm.provider,
          providerHost: providerHost(chatLlm.baseUrl),
          modelId: chatLlm.modelId,
          hasApiKey: chatLlm.apiKey.length > 0,
          profiles: settings.llm.profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            kind: profile.kind,
            provider: profile.provider,
            modelId: profile.modelId,
            providerHost: providerHost(profile.baseUrl),
            enabled: profile.enabled,
            detected: profile.detected === true,
          })),
          taskRoutes: settings.llm.taskRoutes,
        },
        providerCaching: {
          active: shouldUseProviderCaching(
            chatLlm,
            settings.agent.providerCachingEnabled,
          ),
          promptCacheKeySupported: supportsPromptCacheKey(chatLlm),
          passivePrefixCaching: usesPassivePrefixCaching(chatLlm),
        },
      }
    },
  },
  {
    name: 'agent_llm_local_model_scan',
    description:
      'Scan localhost for installed local LLM servers and return OpenAI-compatible model candidates. Read-only and does not expose API keys.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return discoverLocalModels()
    },
  },
  {
    name: 'agent_llm_activate_profile',
    description:
      'Switch the active LLM profile. Before calling, tell the user which profile will become active and wait for explicit confirmation unless full-access mode is enabled.',
    parameters: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'LLM profile id from agent_runtime_status.' },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['profileId', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '切换 LLM Profile 前，必须先告知用户目标 Profile 和影响，并等待用户明确确认。',
      )
      const profileId = readString(input.profileId)
      if (!profileId) throw new HttpError(400, 'profileId 必填')
      return activateLlmProfile(profileId)
    },
  },
  {
    name: 'agent_llm_set_task_route',
    description:
      'Set or clear a task-level LLM route. Before calling, tell the user which task will use which profile and wait for explicit confirmation unless full-access mode is enabled.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: LLM_TASKS,
          description: 'Task route to update.',
        },
        profileId: {
          type: 'string',
          description: 'Profile id from agent_runtime_status. Leave empty only when clear is true.',
        },
        clear: {
          type: 'boolean',
          description: 'Clear this task route so it follows the active profile.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['task', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '修改任务级模型路由前，必须先告知用户目标任务、目标 Profile 和影响，并等待用户明确确认。',
      )
      const task = readString(input.task) as LLMTaskKind
      if (!LLM_TASKS.includes(task)) throw new HttpError(400, '无效的 LLM task')

      const settings = await getSettings()
      const currentRoutes = settings.llm.taskRoutes.filter((route) => route.task !== task)
      if (input.clear === true) return updateLlmTaskRoutes(currentRoutes)

      const profileId = readString(input.profileId)
      if (!profileId) throw new HttpError(400, 'profileId 必填')
      const profile = settings.llm.profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new HttpError(404, '未找到 LLM profile')
      }
      if (!profile.enabled) throw new HttpError(400, 'LLM profile 已停用，不能用于任务路由')

      return updateLlmTaskRoutes([...currentRoutes, { task, profileId }])
    },
  },
]
