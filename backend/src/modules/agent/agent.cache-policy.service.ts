import type { LLMConfig, LLMTokenUsage } from './llm.client.js'

export function shouldUseProviderCaching(config: LLMConfig, enabled: boolean) {
  if (!enabled) return false
  return Boolean(config.baseUrl && config.modelId)
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
