import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import type {
  OutputProfile,
  OutputProfileInput,
  OutputProfilePriority,
  OutputProfileQuery,
  OutputProfileRef,
  OutputProfileRefType,
  OutputProfileSummary,
} from './output-profile.types.js'

const OUTPUT_PROFILE_DIR = 'output-profiles'
const PROFILES_FILE = 'profiles.json'
const MAX_TITLE_CHARS = 160
const MAX_TEXT_CHARS = 12000
const MAX_LIST_ITEMS = 80
const MAX_REF_ITEMS = 80
const MAX_LIST_LIMIT = 200

const REF_TYPES: OutputProfileRefType[] = [
  'memory',
  'wiki',
  'raw',
  'resource',
  'note',
  'tag',
  'freeform',
]
const PRIORITIES: OutputProfilePriority[] = ['high', 'normal', 'low']
const PRIORITY_ORDER: Record<OutputProfilePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
}

function profileRoot() {
  return path.join(config.dataDir, OUTPUT_PROFILE_DIR)
}

function profilesPath() {
  return path.join(profileRoot(), PROFILES_FILE)
}

async function ensureProfileDir() {
  await fs.mkdir(profileRoot(), { recursive: true })
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeText(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
    : ''
}

function normalizeList(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : []

  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))].slice(
    0,
    MAX_LIST_ITEMS,
  )
}

function normalizeId(value: unknown) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized || normalized.includes('..') || normalized === '.' || normalized === '..') {
    throw new HttpError(400, 'Output profile id is invalid')
  }

  return normalized
}

function createId() {
  return `out_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function normalizePriority(value: unknown, fallback: OutputProfilePriority = 'normal') {
  return PRIORITIES.includes(value as OutputProfilePriority)
    ? (value as OutputProfilePriority)
    : fallback
}

function normalizeRefType(value: unknown, fallback: OutputProfileRefType = 'freeform') {
  return REF_TYPES.includes(value as OutputProfileRefType)
    ? (value as OutputProfileRefType)
    : fallback
}

function normalizeLimit(value: unknown, fallback = 80) {
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)))
}

function normalizeRefs(value: unknown): OutputProfileRef[] {
  const rows = Array.isArray(value) ? value : []
  return rows
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const type = normalizeRefType(record.type)
      const ref = normalizeString(record.ref)
      const label = normalizeString(record.label)
      const note = normalizeText(record.note)
      if (!ref && !label && !note) return null
      return {
        type,
        ref: ref.slice(0, 300),
        label: label.slice(0, 160),
        note: note.slice(0, 1000),
      }
    })
    .filter((item): item is OutputProfileRef => item !== null)
    .slice(0, MAX_REF_ITEMS)
}

function normalizeProfileRecord(value: unknown): OutputProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = normalizeString(record.id)
  const title = normalizeString(record.title)
  if (!id || !title) return null

  const now = Date.now()
  return {
    id,
    title,
    description: normalizeText(record.description).slice(0, MAX_TEXT_CHARS),
    active: record.active !== false,
    isDefault: record.isDefault === true,
    priority: normalizePriority(record.priority),
    modes: normalizeList(record.modes),
    tags: normalizeList(record.tags),
    cognitiveModels: normalizeRefs(record.cognitiveModels),
    writingStyles: normalizeRefs(record.writingStyles),
    materials: normalizeRefs(record.materials),
    instructions: normalizeText(record.instructions).slice(0, MAX_TEXT_CHARS),
    guardrails: normalizeList(record.guardrails),
    sampleOutput: normalizeText(record.sampleOutput).slice(0, MAX_TEXT_CHARS),
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : now,
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : now,
  }
}

async function readProfiles() {
  await ensureProfileDir()
  const raw = await readJsonFile<unknown[]>(profilesPath(), [])
  return raw
    .map((item) => normalizeProfileRecord(item))
    .filter((item): item is OutputProfile => item !== null)
}

async function saveProfiles(items: OutputProfile[]) {
  await writeJsonFile(profilesPath(), items)
}

function assertTitle(title: string) {
  if (!title) throw new HttpError(400, 'Output profile title cannot be empty')
  if (title.length > MAX_TITLE_CHARS) {
    throw new HttpError(400, `Output profile title is too long. Max ${MAX_TITLE_CHARS} characters.`)
  }
}

function assertTextLength(name: string, value: string) {
  if (value.length > MAX_TEXT_CHARS) {
    throw new HttpError(400, `${name} is too long. Max ${MAX_TEXT_CHARS} characters.`)
  }
}

function buildProfileRecord(input: OutputProfileInput, fallback?: Partial<OutputProfile>): OutputProfile {
  const title = normalizeString(input.title ?? fallback?.title)
  const description = normalizeText(input.description ?? fallback?.description)
  const instructions = normalizeText(input.instructions ?? fallback?.instructions)
  const sampleOutput = normalizeText(input.sampleOutput ?? fallback?.sampleOutput)
  assertTitle(title)
  assertTextLength('Output profile description', description)
  assertTextLength('Output profile instructions', instructions)
  assertTextLength('Output profile sampleOutput', sampleOutput)

  const now = Date.now()
  return {
    id: fallback?.id ?? createId(),
    title,
    description,
    active: typeof input.active === 'boolean' ? input.active : fallback?.active ?? true,
    isDefault: typeof input.isDefault === 'boolean' ? input.isDefault : fallback?.isDefault ?? false,
    priority: normalizePriority(input.priority, fallback?.priority ?? 'normal'),
    modes: normalizeList(input.modes ?? fallback?.modes),
    tags: normalizeList(input.tags ?? fallback?.tags),
    cognitiveModels: normalizeRefs(input.cognitiveModels ?? fallback?.cognitiveModels),
    writingStyles: normalizeRefs(input.writingStyles ?? fallback?.writingStyles),
    materials: normalizeRefs(input.materials ?? fallback?.materials),
    instructions,
    guardrails: normalizeList(input.guardrails ?? fallback?.guardrails),
    sampleOutput,
    createdAt: fallback?.createdAt ?? now,
    updatedAt: now,
  }
}

function matchesQuery(profile: OutputProfile, query: string) {
  if (!query) return true
  const lower = query.toLowerCase()
  const haystack = [
    profile.id,
    profile.title,
    profile.description,
    profile.instructions,
    profile.sampleOutput,
    profile.modes.join('\n'),
    profile.tags.join('\n'),
    profile.guardrails.join('\n'),
    ...profile.cognitiveModels.flatMap((item) => [item.type, item.ref, item.label, item.note]),
    ...profile.writingStyles.flatMap((item) => [item.type, item.ref, item.label, item.note]),
    ...profile.materials.flatMap((item) => [item.type, item.ref, item.label, item.note]),
  ]
    .join('\n')
    .toLowerCase()
  return haystack.includes(lower)
}

function profileSort(a: OutputProfile, b: OutputProfile) {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  if (a.priority !== b.priority) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  return b.updatedAt - a.updatedAt
}

export async function listOutputProfiles(queryInput: OutputProfileQuery = {}) {
  const query = normalizeString(queryInput.query)
  const active =
    queryInput.active === 'true' || queryInput.active === true
      ? true
      : queryInput.active === 'false' || queryInput.active === false
        ? false
        : null
  const limit = normalizeLimit(queryInput.limit)

  return (await readProfiles())
    .filter((item) => (active === null ? true : item.active === active))
    .filter((item) => matchesQuery(item, query))
    .sort(profileSort)
    .slice(0, limit)
}

export async function getOutputProfile(idInput: unknown) {
  const id = normalizeId(idInput)
  const item = (await readProfiles()).find((profile) => profile.id === id)
  if (!item) throw new HttpError(404, 'Output profile not found')
  return item
}

export async function createOutputProfile(input: OutputProfileInput) {
  const item = buildProfileRecord(input)
  const items = await readProfiles()
  items.unshift(item)
  await saveProfiles(items)
  return item
}

export async function updateOutputProfile(idInput: unknown, input: OutputProfileInput) {
  const id = normalizeId(idInput)
  const items = await readProfiles()
  const index = items.findIndex((profile) => profile.id === id)
  if (index === -1) throw new HttpError(404, 'Output profile not found')

  const next = buildProfileRecord(input, items[index])
  items[index] = next
  await saveProfiles(items)
  return next
}

export async function deleteOutputProfile(idInput: unknown) {
  const id = normalizeId(idInput)
  const items = await readProfiles()
  const item = items.find((profile) => profile.id === id)
  if (!item) throw new HttpError(404, 'Output profile not found')
  await saveProfiles(items.filter((profile) => profile.id !== id))
  return { ok: true as const, deleted: item }
}

export async function getOutputProfileSummary(): Promise<OutputProfileSummary> {
  const items = await readProfiles()
  return {
    counts: {
      total: items.length,
      active: items.filter((item) => item.active).length,
      defaultProfiles: items.filter((item) => item.isDefault).length,
      highPriority: items.filter((item) => item.priority === 'high').length,
    },
    recent: items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
  }
}

function renderRefLine(item: OutputProfileRef) {
  const ref = item.ref ? `${item.type}:${item.ref}` : item.type
  const label = item.label ? ` ${item.label}` : ''
  const note = item.note ? ` - ${item.note}` : ''
  return `- [${ref}]${label}${note}`
}

function renderRefSection(title: string, items: OutputProfileRef[]) {
  if (items.length === 0) return []
  return [`### ${title}`, ...items.map((item) => renderRefLine(item)), '']
}

function renderProfile(profile: OutputProfile) {
  const lines = [
    `## ${profile.title}`,
    `- id: ${profile.id}`,
    `- priority: ${profile.priority}`,
    `- default: ${profile.isDefault ? 'yes' : 'no'}`,
  ]
  if (profile.description) lines.push(`- description: ${profile.description}`)
  if (profile.modes.length > 0) lines.push(`- output modes: ${profile.modes.join(' / ')}`)
  if (profile.tags.length > 0) lines.push(`- tags: ${profile.tags.join(' / ')}`)
  if (profile.instructions) lines.push('', '### Composition instructions', profile.instructions, '')
  lines.push(...renderRefSection('Core cognitive models', profile.cognitiveModels))
  lines.push(...renderRefSection('Writing style', profile.writingStyles))
  lines.push(...renderRefSection('Material scope', profile.materials))
  if (profile.guardrails.length > 0) {
    lines.push('### Guardrails', ...profile.guardrails.map((item) => `- ${item}`), '')
  }
  if (profile.sampleOutput) {
    lines.push('### Preferred sample', profile.sampleOutput, '')
  }
  return lines.join('\n')
}

export async function formatOutputProfileRuntimeContext(requestInput: unknown) {
  const request = normalizeText(requestInput)
  const activeProfiles = await listOutputProfiles({ active: true, limit: 8 })
  if (activeProfiles.length === 0) return ''

  const matching = request
    ? activeProfiles.filter((profile) => matchesQuery(profile, request))
    : []
  const defaults = activeProfiles.filter((profile) => profile.isDefault)
  const selected = [...new Map([...defaults, ...matching, ...activeProfiles].map((item) => [item.id, item])).values()]
    .sort(profileSort)
    .slice(0, 5)

  return [
    'Output profile runtime context:',
    'Output profiles are composition recipes. They combine approved cognitive models, preferred writing style, and material scopes for the final answer.',
    'They do not replace long-term memory or Wiki. If a referenced memory or material needs full content, request memory-pack or data-pack and read the referenced item instead of inventing missing context.',
    'When an active profile applies, follow its composition instructions and guardrails unless the user asks for a different output mode.',
    '',
    ...selected.map((profile) => renderProfile(profile)),
  ].join('\n')
}

export async function getOutputProfileRuntimePreview(requestInput: unknown) {
  const request = normalizeText(requestInput)
  const active = await listOutputProfiles({ active: true, limit: 8 })
  const rendered = await formatOutputProfileRuntimeContext(request)
  return {
    request,
    active,
    rendered,
  }
}
