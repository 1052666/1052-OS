import { getSettings, resolveLlmConfigForTask } from '../../settings/settings.service.js'
import { discoverLocalModels } from '../../settings/local-llm-discovery.service.js'
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
]
