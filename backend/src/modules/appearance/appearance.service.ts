import { randomUUID } from 'node:crypto'
import { httpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import type {
  AppearanceApplyHistoryEntry,
  AppearanceThemeProfile,
  AppearanceThemeStore,
  PublicAppearanceThemes,
} from './appearance.types.js'
import { normalizeAndReviewThemeSpec } from './theme-compatibility.service.js'

const FILE = 'appearance/theme-profiles.json'
const APPLY_HISTORY_LIMIT = 5

const DEFAULT_STORE: AppearanceThemeStore = {
  schemaVersion: 1,
  activeProfileId: '',
  applyHistory: [],
  profiles: [],
}

function normalizeProfile(input: unknown): AppearanceThemeProfile | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<AppearanceThemeProfile>
  const { theme, review } = normalizeAndReviewThemeSpec(raw.theme)
  if (!theme) return null
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96)
      : randomUUID()
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt
  return { id, theme, review, createdAt, updatedAt }
}

function normalizeHistoryEntry(
  input: unknown,
  profileIds: ReadonlySet<string>,
): AppearanceApplyHistoryEntry | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<AppearanceApplyHistoryEntry>
  if (typeof raw.profileId !== 'string' || !profileIds.has(raw.profileId)) return null
  return {
    profileId: raw.profileId,
    themeName: typeof raw.themeName === 'string' ? raw.themeName : '',
    safetyLevel:
      raw.safetyLevel === 'safe' || raw.safetyLevel === 'experimental'
        ? raw.safetyLevel
        : 'safe',
    appliedAt:
      typeof raw.appliedAt === 'number' && Number.isFinite(raw.appliedAt)
        ? raw.appliedAt
        : Date.now(),
  }
}

function normalizeStore(input: Partial<AppearanceThemeStore>): AppearanceThemeStore {
  const profiles = Array.isArray(input.profiles)
    ? input.profiles
        .map((profile) => normalizeProfile(profile))
        .filter((profile): profile is AppearanceThemeProfile => Boolean(profile))
    : []
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const activeProfile =
    typeof input.activeProfileId === 'string'
      ? profiles.find((profile) => profile.id === input.activeProfileId)
      : null
  const activeProfileId =
    activeProfile && activeProfile.review.safetyLevel !== 'rejected' ? activeProfile.id : ''
  const applyHistory = Array.isArray(input.applyHistory)
    ? input.applyHistory
        .map((entry) => normalizeHistoryEntry(entry, profileIds))
        .filter((entry): entry is AppearanceApplyHistoryEntry => Boolean(entry))
        .slice(0, APPLY_HISTORY_LIMIT)
    : []
  return {
    schemaVersion: 1,
    activeProfileId,
    applyHistory,
    profiles,
  }
}

function toPublic(store: AppearanceThemeStore): PublicAppearanceThemes {
  return {
    schemaVersion: 1,
    activeProfileId: store.activeProfileId,
    activeProfile:
      store.profiles.find((profile) => profile.id === store.activeProfileId) ?? null,
    applyHistory: store.applyHistory,
    profiles: store.profiles,
  }
}

async function getStore() {
  return normalizeStore(await readJson<Partial<AppearanceThemeStore>>(FILE, DEFAULT_STORE))
}

async function saveStore(store: AppearanceThemeStore) {
  await writeJson(FILE, normalizeStore(store))
}

export async function listAppearanceThemes(): Promise<PublicAppearanceThemes> {
  return toPublic(await getStore())
}

export function reviewAppearanceTheme(themeInput: unknown) {
  return normalizeAndReviewThemeSpec(themeInput)
}

export async function createAppearanceTheme(themeInput: unknown): Promise<PublicAppearanceThemes> {
  const { theme, review } = normalizeAndReviewThemeSpec(themeInput)
  if (!theme) throw httpError(400, '无效的 Theme JSON')
  if (review.safetyLevel === 'rejected') {
    throw httpError(
      400,
      '主题未通过兼容性检查：' +
        review.blockingIssues.map((item) => `${item.path} ${item.message}`).join('; '),
    )
  }

  const now = Date.now()
  const profile: AppearanceThemeProfile = {
    id: randomUUID(),
    theme,
    review,
    createdAt: now,
    updatedAt: now,
  }
  const store = await getStore()
  const next = {
    ...store,
    profiles: [profile, ...store.profiles],
  }
  await saveStore(next)
  return toPublic(next)
}

export async function deleteAppearanceTheme(profileId: string): Promise<PublicAppearanceThemes> {
  const store = await getStore()
  const nextProfiles = store.profiles.filter((profile) => profile.id !== profileId)
  if (nextProfiles.length === store.profiles.length) throw httpError(404, '未找到主题 Profile')
  const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id))
  const next: AppearanceThemeStore = {
    ...store,
    activeProfileId: store.activeProfileId === profileId ? '' : store.activeProfileId,
    applyHistory: store.applyHistory.filter((entry) => nextProfileIds.has(entry.profileId)),
    profiles: nextProfiles,
  }
  await saveStore(next)
  return toPublic(next)
}

export async function applyAppearanceTheme(
  profileId: string,
  options: { confirmed?: boolean; allowExperimental?: boolean } = {},
): Promise<PublicAppearanceThemes> {
  if (options.confirmed !== true) {
    throw httpError(400, '应用主题前必须先预览固定快照，并等待用户明确确认。')
  }

  const store = await getStore()
  const profile = store.profiles.find((item) => item.id === profileId)
  if (!profile) throw httpError(404, '未找到主题 Profile')
  if (profile.review.safetyLevel === 'rejected') {
    throw httpError(409, '主题安全等级为 rejected，不能应用。')
  }
  if (profile.review.safetyLevel === 'experimental' && options.allowExperimental !== true) {
    throw httpError(409, '主题安全等级为 experimental，需要更严格确认。')
  }

  const historyEntry: AppearanceApplyHistoryEntry = {
    profileId: profile.id,
    themeName: profile.theme.name,
    safetyLevel: profile.theme.safetyLevel,
    appliedAt: Date.now(),
  }
  const next: AppearanceThemeStore = {
    ...store,
    activeProfileId: profile.id,
    applyHistory: [
      historyEntry,
      ...store.applyHistory.filter((entry) => entry.profileId !== profile.id),
    ].slice(0, APPLY_HISTORY_LIMIT),
  }
  await saveStore(next)
  return toPublic(next)
}

export async function resetAppearanceTheme(
  options: { confirmed?: boolean } = {},
): Promise<PublicAppearanceThemes> {
  if (options.confirmed !== true) {
    throw httpError(400, '恢复默认主题前必须等待用户明确确认。')
  }
  const store = await getStore()
  const next: AppearanceThemeStore = {
    ...store,
    activeProfileId: '',
  }
  await saveStore(next)
  return toPublic(next)
}
