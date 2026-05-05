/**
 * Provider adapter registry.
 *
 * Resolves an LLMConfig + apiFormat into the correct adapter instance.
 */

export type { LLMApiFormat, LLMProviderAdapter, AdapterRequestContext, StreamParser, StreamChunkResult } from './types.js'
export { OpenAIAdapter } from './openai.adapter.js'
export { AnthropicAdapter } from './anthropic.adapter.js'
export { GeminiAdapter } from './gemini.adapter.js'

import type { LLMApiFormat, LLMProviderAdapter } from './types.js'
import type { LLMConfig } from '../llm.client.js'
import { OpenAIAdapter } from './openai.adapter.js'
import { AnthropicAdapter } from './anthropic.adapter.js'
import { GeminiAdapter } from './gemini.adapter.js'

const openai = new OpenAIAdapter()
const anthropic = new AnthropicAdapter()
const gemini = new GeminiAdapter()

/**
 * Auto-detect the API format from baseUrl / modelId if no explicit
 * apiFormat is provided.
 */
export function inferApiFormat(cfg: LLMConfig): LLMApiFormat {
  const sig = `${cfg.baseUrl} ${cfg.modelId}`.toLowerCase()

  // Anthropic
  if (sig.includes('anthropic') || sig.includes('claude')) return 'anthropic'

  // Gemini / Google
  if (
    sig.includes('generativelanguage.googleapis.com') ||
    sig.includes('aiplatform.googleapis.com') ||
    /\bgemini\b/.test(sig)
  ) return 'gemini'

  // Default: OpenAI-compatible (covers OpenAI, DeepSeek, MiniMax, Ollama, etc.)
  return 'openai-compatible'
}

/**
 * Get the adapter for a given apiFormat tag.
 */
export function getAdapter(format: LLMApiFormat): LLMProviderAdapter {
  switch (format) {
    case 'anthropic': return anthropic
    case 'gemini': return gemini
    case 'openai-compatible':
    default:
      return openai
  }
}

/**
 * Resolve the adapter for an LLMConfig.
 * If `cfg.apiFormat` is set, use it directly; otherwise auto-detect.
 */
export function resolveAdapter(cfg: LLMConfig & { apiFormat?: LLMApiFormat }): LLMProviderAdapter {
  const format = cfg.apiFormat ?? inferApiFormat(cfg)
  return getAdapter(format)
}
