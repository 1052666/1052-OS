import type { LLMConfig } from './llm.client.js'

export function isMiniMaxCompatible(cfg: LLMConfig): boolean {
  return /minimax|minimaxi/i.test(cfg.baseUrl) || /^MiniMax-/i.test(cfg.modelId)
}
