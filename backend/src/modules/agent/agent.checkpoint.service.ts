import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ChatMessage } from './agent.types.js'
import type { AgentCheckpoint, AgentPackName } from './agent.runtime.types.js'
import { estimateTokenCount } from './llm.client.js'
import { readJson, writeJson } from '../../storage.js'
import {
  sanitizeCheckpointTextForModel,
  toModelChatMessages,
} from './agent.context-sanitizer.service.js'

const CHECKPOINT_DIR = '1052/checkpoints'
const MAX_INJECTED_TOKENS = 800
const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])
const DEFAULT_CHECKPOINT: Omit<AgentCheckpoint, 'sessionId' | 'updatedAt'> = {
  facts: [],
  done: [],
  failedAttempts: [],
  mountedPacks: [],
  relatedRules: [],
  relatedMemories: [],
  relatedSkills: [],
}

function checkpointFile(sessionId: string) {
  return path.join(CHECKPOINT_DIR, `${sessionId}.json`)
}

function legacySessionId(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'web:default'
}

export function normalizeSessionId(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[:/\\|*?"<>]+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s_-]+|[.\s_-]+$/g, '')
  const safe = normalized || 'web-default'
  return WINDOWS_RESERVED_BASENAMES.has(safe) ? `${safe}-session` : safe
}

async function readLegacyCheckpointIfNeeded(sessionIdInput: string, safeSessionId: string) {
  const legacyId = legacySessionId(sessionIdInput)
  if (legacyId === safeSessionId) return null

  const legacy = await readJson<unknown>(checkpointFile(legacyId), null)
  if (!legacy || typeof legacy !== 'object') return null

  const normalized = normalizeCheckpoint(legacy, safeSessionId)
  await writeJson(checkpointFile(safeSessionId), normalized)
  return normalized
}

function normalizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, limit)
}

export function emptyCheckpoint(sessionId: string): AgentCheckpoint {
  return {
    sessionId,
    ...DEFAULT_CHECKPOINT,
    updatedAt: Date.now(),
  }
}

function normalizeCheckpoint(value: unknown, sessionId: string): AgentCheckpoint {
  if (!value || typeof value !== 'object') return emptyCheckpoint(sessionId)
  const record = value as Partial<AgentCheckpoint>
  return {
    sessionId,
    goal: typeof record.goal === 'string' ? record.goal.trim() : undefined,
    phase: typeof record.phase === 'string' ? record.phase.trim() : undefined,
    facts: normalizeStringArray(record.facts, 50),
    done: normalizeStringArray(record.done, 50),
    failedAttempts: normalizeStringArray(record.failedAttempts, 30),
    nextStep: typeof record.nextStep === 'string' ? record.nextStep.trim() : undefined,
    mountedPacks: normalizeStringArray(record.mountedPacks, 20).filter(
      (item): item is AgentPackName =>
        item === 'base-read-pack' ||
        item === 'repo-pack' ||
        item === 'search-pack' ||
        item === 'memory-pack' ||
        item === 'skill-pack' ||
        item === 'plan-pack' ||
        item === 'data-pack' ||
        item === 'channel-pack',
    ),
    relatedRules: normalizeStringArray(record.relatedRules, 20),
    relatedMemories: normalizeStringArray(record.relatedMemories, 20),
    relatedSkills: normalizeStringArray(record.relatedSkills, 20),
    summaryInjectedTokens:
      typeof record.summaryInjectedTokens === 'number' && Number.isFinite(record.summaryInjectedTokens)
        ? record.summaryInjectedTokens
        : undefined,
    seedStatus:
      record.seedStatus === 'pending' || record.seedStatus === 'ready' || record.seedStatus === 'failed'
        ? record.seedStatus
        : undefined,
    seedAttempts:
      typeof record.seedAttempts === 'number' && Number.isFinite(record.seedAttempts)
        ? record.seedAttempts
        : undefined,
    seedInputFingerprint:
      typeof record.seedInputFingerprint === 'string' ? record.seedInputFingerprint : undefined,
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
  }
}

export async function getCheckpoint(sessionIdInput: string) {
  const sessionId = normalizeSessionId(sessionIdInput)
  const current = await readJson(checkpointFile(sessionId), null)
  if (current && typeof current === 'object') {
    return normalizeCheckpoint(current, sessionId)
  }

  const migrated = await readLegacyCheckpointIfNeeded(sessionIdInput, sessionId)
  if (migrated) return migrated

  return normalizeCheckpoint(null, sessionId)
}

export async function saveCheckpoint(checkpoint: AgentCheckpoint) {
  const sessionId = normalizeSessionId(checkpoint.sessionId)
  const normalized = normalizeCheckpoint(checkpoint, sessionId)
  normalized.updatedAt = Date.now()
  await writeJson(checkpointFile(sessionId), normalized)
  return normalized
}

export async function patchCheckpoint(
  sessionIdInput: string,
  patch: Partial<AgentCheckpoint>,
) {
  const current = await getCheckpoint(sessionIdInput)
  const next: AgentCheckpoint = {
    ...current,
    ...patch,
    sessionId: current.sessionId,
    facts: patch.facts ? normalizeStringArray(patch.facts, 50) : current.facts,
    done: patch.done ? normalizeStringArray(patch.done, 50) : current.done,
    failedAttempts: patch.failedAttempts
      ? normalizeStringArray(patch.failedAttempts, 30)
      : current.failedAttempts,
    relatedRules: patch.relatedRules
      ? normalizeStringArray(patch.relatedRules, 20)
      : current.relatedRules,
    relatedMemories: patch.relatedMemories
      ? normalizeStringArray(patch.relatedMemories, 20)
      : current.relatedMemories,
    relatedSkills: patch.relatedSkills
      ? normalizeStringArray(patch.relatedSkills, 20)
      : current.relatedSkills,
    mountedPacks: patch.mountedPacks
      ? normalizeStringArray(patch.mountedPacks, 20).filter(
          (item): item is AgentPackName =>
            item === 'base-read-pack' ||
            item === 'repo-pack' ||
            item === 'search-pack' ||
            item === 'memory-pack' ||
            item === 'skill-pack' ||
            item === 'plan-pack' ||
            item === 'data-pack' ||
            item === 'channel-pack',
        )
      : current.mountedPacks,
    updatedAt: Date.now(),
  }
  await writeJson(checkpointFile(current.sessionId), next)
  return next
}

export async function appendCheckpointEntry(
  sessionIdInput: string,
  input: {
    fact?: string
    done?: string
    failedAttempt?: string
    nextStep?: string
    mountedPacks?: AgentPackName[]
  },
) {
  const current = await getCheckpoint(sessionIdInput)
  const next = { ...current }
  const fact = input.fact ? sanitizeCheckpointTextForModel(input.fact) : ''
  const done = input.done ? sanitizeCheckpointTextForModel(input.done) : ''
  const failedAttempt = input.failedAttempt
    ? sanitizeCheckpointTextForModel(input.failedAttempt)
    : ''
  const nextStep = input.nextStep ? sanitizeCheckpointTextForModel(input.nextStep) : ''
  if (fact) next.facts = [...next.facts, fact].slice(-50)
  if (done) next.done = [...next.done, done].slice(-50)
  if (failedAttempt) {
    next.failedAttempts = [...next.failedAttempts, failedAttempt].slice(-30)
  }
  if (nextStep) next.nextStep = nextStep
  if (input.mountedPacks?.length) {
    next.mountedPacks = [...new Set([...next.mountedPacks, ...input.mountedPacks])]
  }
  return saveCheckpoint(next)
}

export function deriveSessionId(
  runtimeContext?: {
    source?:
      | {
          channel: 'wechat'
          accountId: string
          peerId: string
        }
      | {
          channel: 'feishu'
          receiveIdType: 'chat_id'
          receiveId: string
          chatType: 'p2p' | 'group'
          senderOpenId?: string
        }
  },
) {
  const source = runtimeContext?.source
  if (!source) return normalizeSessionId('web:default')
  if (source.channel === 'wechat') {
    return normalizeSessionId(`wechat:${source.accountId}:${source.peerId}`)
  }
  return normalizeSessionId(`feishu:${source.receiveId}`)
}

function checkpointLine(label: string, value: string | undefined) {
  if (!value) return ''
  const sanitized = sanitizeCheckpointTextForModel(value)
  return sanitized ? `- ${label}: ${sanitized}` : ''
}

function renderCheckpointLines(checkpoint: AgentCheckpoint) {
  return [
    checkpointLine('goal', checkpoint.goal),
    checkpointLine('phase', checkpoint.phase),
    checkpointLine('next', checkpoint.nextStep),
    checkpoint.mountedPacks.length > 0 ? `- mounted packs: ${checkpoint.mountedPacks.join(', ')}` : '',
    ...checkpoint.facts.slice(-4).map((item) => checkpointLine('fact', item)),
    ...checkpoint.done.slice(-4).map((item) => checkpointLine('done', item)),
    ...checkpoint.failedAttempts.slice(-3).map((item) => checkpointLine('failed', item)),
  ].filter(Boolean)
}

export function summarizeCheckpointForInjection(checkpoint: AgentCheckpoint) {
  const lines = renderCheckpointLines(checkpoint)
  if (lines.length === 0) {
    return {
      text: 'Checkpoint:\n- no checkpoint yet',
      injectedTokens: estimateTokenCount('Checkpoint:\n- no checkpoint yet'),
    }
  }

  const kept: string[] = []
  for (const line of lines) {
    const candidate = ['Checkpoint:', ...kept, line].join('\n')
    if (estimateTokenCount(candidate) > MAX_INJECTED_TOKENS) continue
    kept.push(line)
  }

  const text = ['Checkpoint:', ...kept].join('\n')
  return {
    text,
    injectedTokens: estimateTokenCount(text),
  }
}

export function fingerprintSeedInput(parts: string[]) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\n---\n')
  return hash.digest('hex')
}

export function messagesToRecentPlainText(history: ChatMessage[], maxMessages = 20) {
  return toModelChatMessages(history, maxMessages)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n')
}
