import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { redactSensitiveText } from './agent.redaction.service.js'
import type { Runtime1052Event } from './1052-kernel.types.js'

const ROLLOUT_DIR = '1052-rollouts'
const appendQueues = new Map<string, Promise<void>>()

export type Runtime1052RolloutRecord = {
  ts: number
  event: Runtime1052Event
}

const REDACTED_1052_VALUE = '[REDACTED]'

function isSensitive1052Tool(name: string) {
  return /(?:^|_)(?:secure|secret|credential)(?:_|$)/i.test(name)
}

function redactRuntime1052Json(text: string) {
  return redactSensitiveText(text).replace(
    /("(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)"\s*:\s*")[^"]*(")/gi,
    `$1${REDACTED_1052_VALUE}$2`,
  )
}

export function sanitizeRuntime1052RolloutEvent(event: Runtime1052Event): Runtime1052Event {
  let sanitized: Runtime1052Event = event

  if (event.type === 'model-response') {
    sanitized = {
      ...event,
      toolCalls: event.toolCalls.map((toolCall) => ({
        ...toolCall,
        arguments: isSensitive1052Tool(toolCall.name)
          ? REDACTED_1052_VALUE
          : toolCall.arguments,
      })),
    }
  } else if (event.type === 'tool-call-started' && isSensitive1052Tool(event.name)) {
    sanitized = { ...event, argsPreview: REDACTED_1052_VALUE }
  } else if (event.type === 'approval-requested' && isSensitive1052Tool(event.name)) {
    sanitized = { ...event, argsPreview: REDACTED_1052_VALUE }
  } else if (event.type === 'tool-call-finished' && isSensitive1052Tool(event.name)) {
    sanitized = {
      ...event,
      resultPreview: REDACTED_1052_VALUE,
      resultContent: REDACTED_1052_VALUE,
    }
  }

  return JSON.parse(redactRuntime1052Json(JSON.stringify(sanitized))) as Runtime1052Event
}

function safeTurnFileName(turnId: string) {
  return `${turnId.replace(/[^a-zA-Z0-9._-]/g, '_')}.jsonl`
}

export function runtime1052RolloutPath(turnId: string) {
  return path.join(config.dataDir, ROLLOUT_DIR, safeTurnFileName(turnId))
}

export async function appendRuntime1052RolloutEvent(event: Runtime1052Event): Promise<void> {
  const file = runtime1052RolloutPath(event.turnId)
  const queue = appendQueues.get(file) ?? Promise.resolve()
  const record: Runtime1052RolloutRecord = {
    ts: Date.now(),
    event: sanitizeRuntime1052RolloutEvent(event),
  }
  const task = queue.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf-8')
  })

  appendQueues.set(file, task)
  try {
    await task
  } finally {
    if (appendQueues.get(file) === task) appendQueues.delete(file)
  }
}

export class Runtime1052RolloutWriter {
  private pending: Promise<void> = Promise.resolve()
  private failure: unknown

  enqueue(event: Runtime1052Event) {
    this.pending = this.pending
      .then(() => appendRuntime1052RolloutEvent(event))
      .catch((error: unknown) => {
        this.failure ??= error
      })
  }

  async flush() {
    await this.pending
    if (this.failure) throw this.failure
  }
}

export function createRuntime1052RolloutWriter() {
  return new Runtime1052RolloutWriter()
}

export async function readRuntime1052Rollout(turnId: string): Promise<Runtime1052RolloutRecord[]> {
  const file = runtime1052RolloutPath(turnId)
  const text = await fs.readFile(file, 'utf-8').catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return ''
    throw error
  })

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Runtime1052RolloutRecord)
}
