import { randomUUID } from 'node:crypto'
import { httpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import type {
  AppearanceApplyHistoryEntry,
  AppearanceThemeProfile,
  AppearanceThemeProfileSource,
  AppearanceThemeStore,
  PublicAppearanceThemes,
  ThemeSpec,
} from './appearance.types.js'
import { normalizeAndReviewThemeSpec } from './theme-compatibility.service.js'

const BUILTIN_PROFILE_ID_PREFIX = 'builtin:'

const FILE = 'appearance/theme-profiles.json'
const APPLY_HISTORY_LIMIT = 5

const DEFAULT_STORE: AppearanceThemeStore = {
  schemaVersion: 1,
  activeProfileId: '',
  applyHistory: [],
  profiles: [],
}

function sanitizeProfileId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') return null
  const trimmed = rawId.trim()
  if (!trimmed) return null
  // 保留 `builtin:` 前缀（冒号在白名单内），其余仅允许字母数字下划线短横线
  return trimmed.replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 96)
}

function normalizeSource(value: unknown): AppearanceThemeProfileSource | undefined {
  return value === 'user' || value === 'builtin' ? value : undefined
}

function normalizeBuiltinVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeProfile(input: unknown): AppearanceThemeProfile | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<AppearanceThemeProfile>
  const { theme, review } = normalizeAndReviewThemeSpec(raw.theme)
  if (!theme) return null
  const sanitized = sanitizeProfileId(raw.id)
  const id = sanitized ?? randomUUID()
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt
  const profile: AppearanceThemeProfile = { id, theme, review, createdAt, updatedAt }
  const source = normalizeSource(raw.source)
  if (source) profile.source = source
  const builtinVersion = normalizeBuiltinVersion(raw.builtinVersion)
  if (builtinVersion !== undefined) profile.builtinVersion = builtinVersion
  return profile
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
    source: 'user',
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
  const target = store.profiles.find((profile) => profile.id === profileId)
  if (!target) throw httpError(404, '未找到主题 Profile')
  if (target.source === 'builtin' || target.id.startsWith(BUILTIN_PROFILE_ID_PREFIX)) {
    throw httpError(403, '内置主题 Profile 不可删除')
  }
  const nextProfiles = store.profiles.filter((profile) => profile.id !== profileId)
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

/**
 * 内置 builtin profile seed 定义。
 *
 * 与 RFC #47 (Appearance Theme Studio) 接口对齐：三个内置 profile 作为 ThemeSpec 形式入库，
 * 用户的自定义 profile 与 builtin 共存于同一 store，通过 source/builtinVersion 字段区分。
 *
 * - id 必须以 `builtin:` 开头（命名空间约定，避免与 user profile 冲突）
 * - builtinVersion: 升级后 bump 此数字 → 服务重启时自动覆盖现有 builtin profile
 * - 实际 token 在后续阶段填充；当前为骨架（占位 token，仅用于通过 ThemeSpec 校验）
 */
type BuiltinProfileSeed = {
  id: string
  builtinVersion: number
  theme: ThemeSpec
}

const PLACEHOLDER_CORE_TOKENS = {
  bg: '#000000',
  surface: '#000000',
  fg: '#ffffff',
  accent: '#ffffff',
  success: '#22c55e',
  danger: '#ef4444',
} as const

const PLACEHOLDER_TOKENS = {
  ...PLACEHOLDER_CORE_TOKENS,
  bgGrad1: '#000000',
  bgGrad2: '#000000',
  surface0: '#000000',
  surface1: '#000000',
  surface2: '#000000',
  surface3: '#000000',
  surfaceHover: '#111111',
  hairline: '#222222',
  hairline2: '#222222',
  hairlineStrong: '#333333',
  fg2: '#cccccc',
  fg3: '#999999',
  fg4: '#666666',
  accent2: '#ffffff',
  accentSoft: '#222222',
  accentRing: '#ffffff',
} as const

export const BUILTIN_PROFILES: readonly BuiltinProfileSeed[] = [
  {
    id: 'builtin:gpt-dark',
    builtinVersion: 1,
    theme: {
      schemaVersion: 1,
      name: 'GPT 风格 (深色)',
      mode: 'dark',
      scope: 'all',
      safetyLevel: 'safe',
      coreTokens: { ...PLACEHOLDER_CORE_TOKENS },
      tokens: { ...PLACEHOLDER_TOKENS },
    },
  },
  {
    id: 'builtin:mirror-dark',
    builtinVersion: 1,
    theme: {
      schemaVersion: 1,
      name: '水面 (深色)',
      mode: 'dark',
      scope: 'all',
      safetyLevel: 'safe',
      coreTokens: { ...PLACEHOLDER_CORE_TOKENS },
      tokens: { ...PLACEHOLDER_TOKENS },
    },
  },
  {
    id: 'builtin:mirror-light',
    builtinVersion: 1,
    theme: {
      schemaVersion: 1,
      name: '水面 (浅色)',
      mode: 'light',
      scope: 'all',
      safetyLevel: 'safe',
      coreTokens: { ...PLACEHOLDER_CORE_TOKENS, bg: '#ffffff', surface: '#f4f4f6', fg: '#161719' },
      tokens: { ...PLACEHOLDER_TOKENS, bg: '#ffffff', surface: '#f4f4f6', fg: '#161719' },
    },
  },
] as const

/**
 * 服务启动时调用：幂等 upsert builtin profile。
 *
 * 行为：
 * - 缺失：直接创建（source='builtin', builtinVersion=N）
 * - 已存在且 source='builtin' 且 builtinVersion < N：覆盖 theme 与 builtinVersion
 * - 已存在但 source !== 'builtin'：日志警告并跳过（不应发生，命名空间冲突）
 *
 * 不会动用户自定义 profile（source='user'）。
 */
export async function seedBuiltinAppearanceProfiles(): Promise<void> {
  const store = await getStore()
  const profilesById = new Map(store.profiles.map((profile) => [profile.id, profile]))
  let mutated = false
  const now = Date.now()

  for (const builtin of BUILTIN_PROFILES) {
    const { theme, review } = normalizeAndReviewThemeSpec(builtin.theme)
    if (!theme) {
      console.warn(`[appearance.seed] 内置 profile ${builtin.id} ThemeSpec 校验失败，跳过`)
      continue
    }
    const existing = profilesById.get(builtin.id)

    if (!existing) {
      const seeded: AppearanceThemeProfile = {
        id: builtin.id,
        theme,
        review,
        createdAt: now,
        updatedAt: now,
        source: 'builtin',
        builtinVersion: builtin.builtinVersion,
      }
      profilesById.set(builtin.id, seeded)
      mutated = true
      continue
    }

    if (existing.source !== 'builtin') {
      console.warn(
        `[appearance.seed] profile id ${builtin.id} 命名空间冲突（source=${existing.source ?? 'user'}），跳过覆盖以保护用户数据`,
      )
      continue
    }

    if ((existing.builtinVersion ?? 0) < builtin.builtinVersion) {
      profilesById.set(builtin.id, {
        ...existing,
        theme,
        review,
        builtinVersion: builtin.builtinVersion,
        updatedAt: now,
      })
      mutated = true
    }
  }

  if (!mutated) return

  const nextProfiles = Array.from(profilesById.values())
  await saveStore({
    ...store,
    profiles: nextProfiles,
  })
}
