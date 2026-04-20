import type { LLMConfig } from './llm.client.js'

export function isMiniMaxCompatible(cfg: LLMConfig): boolean {
  return /minimaxi\.com/i.test(cfg.baseUrl) || /^MiniMax-/i.test(cfg.modelId)
}
