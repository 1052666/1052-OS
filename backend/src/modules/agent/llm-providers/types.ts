/**
 * LLM Provider Adapter abstraction.
 *
 * Each adapter translates between 1052 OS's internal message format and a
 * specific LLM provider's HTTP API (OpenAI, Anthropic, Gemini, …).
 */

import type {
  LLMConfig,
  LLMConversationMessage,
  LLMToolDefinition,
  LLMTokenUsage,
  LLMRequestOptions,
  LLMAssistantMessage,
} from '../llm.client.js'

// ─── API format tag ────────────────────────────────────────────────

export type LLMApiFormat =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

// ─── Adapter interface ─────────────────────────────────────────────

/**
 * Every adapter must implement these four methods.
 *
 * - `buildRequest`  → produce a fetch-ready Request (or the three pieces:
 *   url, headers, body).
 * - `parseResponse` → non-streaming: parse the JSON body into an
 *   LLMAssistantMessage.
 * - `parseStreamChunk` → streaming: parse a single SSE / NDJSON chunk and
 *   return incremental content + tool-call deltas. The caller manages
 *   buffering, idle timeout, abort, and reassembly.
 * - `extractStreamError` → optionally provide a nicer error message from a
 *   non-2xx streaming response body.
 */

export interface LLMProviderAdapter {
  readonly format: LLMApiFormat

  /** Build the fetch URL, headers, and JSON body for a request. */
  buildRequest(ctx: AdapterRequestContext): AdapterRequest

  /** Parse a non-streaming JSON response into the internal message type. */
  parseResponse(
    json: unknown,
    ctx: AdapterRequestContext,
  ): LLMAssistantMessage

  /** Create a fresh stream parser (stateful — accumulates tool call deltas). */
  createStreamParser(ctx: AdapterRequestContext): StreamParser
}

// ─── Supporting types ──────────────────────────────────────────────

export interface AdapterRequestContext {
  cfg: LLMConfig
  messages: LLMConversationMessage[]
  tools: LLMToolDefinition[]
  stream: boolean
  options: LLMRequestOptions
}

export interface AdapterRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** Incremental output from a single SSE / NDJSON event. */
export interface StreamChunkResult {
  /** New content text (may be empty). */
  content: string
  /** New reasoning / thinking text (may be empty). */
  reasoning: string
  /** Raw tool_calls delta array for ToolCallBuffer ingestion. */
  toolCallDeltas: unknown[] | null
  /** Usage snapshot if provider included it. */
  usage: LLMTokenUsage | undefined
  /** Finish reason if present (e.g. 'stop', 'tool_use'). */
  finishReason: string | undefined
  /** True when the stream signals completion (e.g. `[DONE]`). */
  done: boolean
}

/**
 * Stateful stream parser. Fed raw SSE / NDJSON lines one at a time.
 * Returns zero or more chunk results per line.
 */
export interface StreamParser {
  /** Feed one raw line from the stream (including the `data:` prefix for SSE). */
  feedLine(line: string): StreamChunkResult[]
  /** Called when the stream ends to flush any buffered state. */
  flush(): StreamChunkResult[]
}
