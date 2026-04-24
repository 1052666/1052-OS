import { getSettings } from '../../settings/settings.service.js'
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
      return {
        agent: {
          progressiveDisclosureEnabled: settings.agent.progressiveDisclosureEnabled,
          providerCachingEnabled: settings.agent.providerCachingEnabled,
          checkpointEnabled: settings.agent.checkpointEnabled,
          seedOnResumeEnabled: settings.agent.seedOnResumeEnabled,
          upgradeDebugEventsEnabled: settings.agent.upgradeDebugEventsEnabled,
        },
        llm: {
          providerHost: providerHost(settings.llm.baseUrl),
          modelId: settings.llm.modelId,
          hasApiKey: settings.llm.apiKey.length > 0,
        },
        providerCaching: {
          active: shouldUseProviderCaching(
            settings.llm,
            settings.agent.providerCachingEnabled,
          ),
          promptCacheKeySupported: supportsPromptCacheKey(settings.llm),
          passivePrefixCaching: usesPassivePrefixCaching(settings.llm),
        },
      }
    },
  },
]
