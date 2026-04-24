import { createHash } from 'node:crypto'
import type { LLMConfig, LLMTokenUsage } from './llm.client.js'
import type { LLMConversationMessage, LLMToolDefinition } from './llm.client.js'

export function shouldUseProviderCaching(config: LLMConfig, enabled: boolean) {
  if (!enabled) return false
  return Boolean(config.baseUrl && config.modelId)
}

function getProviderHost(config: LLMConfig) {
  try {
    return new URL(config.baseUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function supportsPromptCacheKey(config: LLMConfig) {
  return getProviderHost(config) === 'api.openai.com'
}

export function usesPassivePrefixCaching(config: LLMConfig) {
  const signature = `${config.baseUrl} ${config.modelId}`.toLowerCase()
  return /deepseek|minimax|minimaxi/.test(signature)
}

function messageText(message: LLMConversationMessage) {
  return typeof message.content === 'string' ? message.content : ''
}

function stableSystemPrefix(messages: readonly LLMConversationMessage[]) {
  const system = messages.find((message) => message.role === 'system')
  const text = system ? messageText(system) : ''
  return text.split(/\n\nCheckpoint:/, 1)[0]?.trim() || text.slice(0, 4000)
}

function hashCacheKey(parts: string[]) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\n---\n')
  return `1052-${hash.digest('hex').slice(0, 32)}`
}

export function buildProviderPromptCacheKey(input: {
  config: LLMConfig
  messages: readonly LLMConversationMessage[]
  tools: readonly LLMToolDefinition[]
}) {
  return hashCacheKey([
    input.config.modelId,
    stableSystemPrefix(input.messages),
    input.tools.map((tool) => tool.function.name).join(','),
  ])
}

export function buildProviderCachingPayloadFields(input: {
  config: LLMConfig
  enabled: boolean
  messages: readonly LLMConversationMessage[]
  tools: readonly LLMToolDefinition[]
}): Record<string, unknown> {
  if (!shouldUseProviderCaching(input.config, input.enabled)) return {}

  if (supportsPromptCacheKey(input.config)) {
    return {
      prompt_cache_key: buildProviderPromptCacheKey(input),
    }
  }

  if (usesPassivePrefixCaching(input.config)) {
    return {}
  }

  return {}
}

export function normalizeCacheUsage(usage: LLMTokenUsage | undefined): LLMTokenUsage | undefined {
  if (!usage) return undefined
  return {
    ...usage,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }
}

export function cachePrefixKey(parts: string[]) {
  return parts.map((item) => item.trim()).filter(Boolean).join('\n\n')
}
