import { getSettings } from '../settings/settings.service.js'
import type { ChatMessage, StoredChatMessage } from './agent.types.js'
import { chatCompletion, type LLMConversationMessage } from './llm.client.js'
import { redactSensitiveText } from './agent.redaction.service.js'
import {
  emptyCheckpoint,
  fingerprintSeedInput,
  getCheckpoint,
  messagesToRecentPlainText,
  saveCheckpoint,
} from './agent.checkpoint.service.js'
import type { AgentCheckpoint } from './agent.runtime.types.js'

export const MAX_CHECKPOINT_SEED_ATTEMPTS = 3

function normalizeSeedAttempts(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function getSeedAttemptsForInput(checkpoint: AgentCheckpoint, fingerprint: string) {
  if (checkpoint.seedInputFingerprint !== fingerprint) return 0
  return normalizeSeedAttempts(checkpoint.seedAttempts)
}

export function isCheckpointSeedRetryExhausted(
  checkpoint: AgentCheckpoint,
  fingerprint: string,
) {
  return (
    checkpoint.seedStatus === 'failed' &&
    getSeedAttemptsForInput(checkpoint, fingerprint) >= MAX_CHECKPOINT_SEED_ATTEMPTS
  )
}

function compactSummaryFromStoredMessages(messages: StoredChatMessage[]) {
  const compact = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && typeof message.compactSummary === 'string')
  return compact?.compactSummary?.trim() || ''
}

function heuristicSeedFromText(text: string) {
  const chunks = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return {
    goal: chunks.find((line) => line.startsWith('user:'))?.slice(5).trim() || '',
    nextStep: chunks.at(-1) || '',
    facts: chunks.slice(0, 4),
  }
}

async function summarizeSeedWithModel(input: string) {
  const settings = await getSettings()
  const messages: LLMConversationMessage[] = [
    {
      role: 'system',
      content:
        'Summarize the conversation into a compact JSON object with keys goal,nextStep,facts,done,failedAttempts. Keep it short and do not include secrets.',
    },
    {
      role: 'user',
      content: input,
    },
  ]
  const response = await chatCompletion(settings.llm, messages, [], {
    providerCachingEnabled: settings.agent.providerCachingEnabled,
  })
  try {
    const parsed = JSON.parse(response.content) as Record<string, unknown>
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal.trim() : '',
      nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep.trim() : '',
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
        : [],
      done: Array.isArray(parsed.done)
        ? parsed.done.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
        : [],
      failedAttempts: Array.isArray(parsed.failedAttempts)
        ? parsed.failedAttempts.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
        : [],
    }
  } catch {
    const fallback = heuristicSeedFromText(response.content)
    return { ...fallback, done: [], failedAttempts: [] }
  }
}

export async function ensureCheckpointSeedForSession(
  sessionId: string,
  history: ChatMessage[],
  storedMessages?: StoredChatMessage[],
) {
  const settings = await getSettings()
  if (!settings.agent.checkpointEnabled || !settings.agent.seedOnResumeEnabled) {
    return getCheckpoint(sessionId)
  }

  const existing = await getCheckpoint(sessionId)
  if (
    existing.seedStatus === 'ready' ||
    existing.goal ||
    existing.nextStep ||
    existing.facts.length > 0 ||
    existing.done.length > 0
  ) {
    return existing
  }

  const compactSummary = storedMessages?.length ? compactSummaryFromStoredMessages(storedMessages) : ''
  const recentPlainText = redactSensitiveText(messagesToRecentPlainText(history, 20))
  const summaryInput = compactSummary
    ? `Compact summary:\n${redactSensitiveText(compactSummary)}\n\nRecent messages:\n${recentPlainText}`
    : recentPlainText

  const fingerprint = fingerprintSeedInput([compactSummary, recentPlainText])
  if (isCheckpointSeedRetryExhausted(existing, fingerprint)) {
    return existing
  }

  const previousSeedAttempts = getSeedAttemptsForInput(existing, fingerprint)
  const next = emptyCheckpoint(sessionId)
  next.seedStatus = 'pending'
  next.seedInputFingerprint = fingerprint
  next.seedAttempts = previousSeedAttempts + 1
  await saveCheckpoint(next)

  try {
    const seeded = compactSummary
      ? {
          ...heuristicSeedFromText(redactSensitiveText(compactSummary)),
          done: [],
          failedAttempts: [],
        }
      : await summarizeSeedWithModel(summaryInput)

    next.goal = seeded.goal || next.goal
    next.nextStep = seeded.nextStep || next.nextStep
    next.facts = seeded.facts
    next.done = seeded.done
    next.failedAttempts = seeded.failedAttempts
    next.seedStatus = 'ready'
    return saveCheckpoint(next)
  } catch {
    next.seedStatus = 'failed'
    return saveCheckpoint(next)
  }
}
