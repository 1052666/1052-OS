import { runRuntime1052KernelStream } from './1052-kernel.js'
import type { Runtime1052RunOptions } from './1052-kernel.types.js'
import type { AgentStreamEvent } from './agent.runtime.types.js'
import type { ChatMessage, TokenUsage } from './agent.types.js'

export async function sendMessage(
  history: ChatMessage[],
  options: Runtime1052RunOptions = {},
): Promise<ChatMessage> {
  let content = ''
  let usage: TokenUsage | undefined

  for await (const event of sendMessageStream(history, {
    ...options,
    approvalMode: options.approvalMode ?? 'deny',
  })) {
    if (event.type === 'delta') content += event.content
    if (event.type === 'usage') usage = event.usage
  }

  return {
    role: 'assistant',
    content,
    usage,
  }
}

export async function* sendMessageStream(
  history: ChatMessage[],
  options: Runtime1052RunOptions = {},
): AsyncGenerator<AgentStreamEvent, void, void> {
  yield* runRuntime1052KernelStream(history, options)
}
