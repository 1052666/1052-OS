import { HttpError } from '../../http-error.js'
import {
  chatCompletionStream,
  type LLMAssistantMessage,
  type LLMConfig,
  type LLMConversationMessage,
  type LLMRequestOptions,
  type LLMToolDefinition,
} from './llm.client.js'

const DEFAULT_MAX_RETRIES = 2

export type Runtime1052ModelRequest = {
  llm: LLMConfig
  messages: LLMConversationMessage[]
  tools: LLMToolDefinition[]
  options?: LLMRequestOptions
  maxRetries?: number
}

export type Runtime1052ModelStreamFactory = typeof chatCompletionStream

export type Runtime1052ModelDependencies = {
  stream?: Runtime1052ModelStreamFactory
  sleep?: (ms: number) => Promise<void>
}

export function isRuntime1052IdleError(error: unknown) {
  return (
    error instanceof HttpError &&
    error.status === 504 &&
    /idle\s*timeout|空闲超时/i.test(error.message)
  )
}

export function isRuntime1052TransientModelError(error: unknown) {
  if (!(error instanceof HttpError)) return false
  if (isRuntime1052IdleError(error)) return false
  return error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504
}

export async function* sampleRuntime1052Model(
  request: Runtime1052ModelRequest,
  dependencies: Runtime1052ModelDependencies = {},
): AsyncGenerator<string, LLMAssistantMessage, void> {
  const streamFactory = dependencies.stream ?? chatCompletionStream
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const maxRetries = Math.max(0, request.maxRetries ?? DEFAULT_MAX_RETRIES)
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let emittedVisibleOutput = false

    try {
      const stream = streamFactory(request.llm, request.messages, request.tools, request.options)
      let step = await stream.next()

      while (!step.done) {
        if (step.value) {
          emittedVisibleOutput = true
          yield step.value
        }
        step = await stream.next()
      }

      return step.value
    } catch (error) {
      lastError = error
      const canRetry =
        !emittedVisibleOutput &&
        attempt < maxRetries &&
        isRuntime1052TransientModelError(error)

      if (!canRetry) throw error
      await sleep(1_000 * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('1052 model request failed')
}
