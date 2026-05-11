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

/**
 * Builtin profile override: the RFC #47 review engine is for user-submitted
 * themes. Builtin profiles are preauthored by developers (spec §6.2) and
 * always treated as 'safe', symmetric to deleteAppearanceTheme's builtin
 * protection. theme.safetyLevel is preserved as a record of the engine's
 * verdict; review.safetyLevel is what apply gates against.
 */
function asBuiltinReview(
  review: ReturnType<typeof normalizeAndReviewThemeSpec>['review'],
): ReturnType<typeof normalizeAndReviewThemeSpec>['review'] {
  return { ...review, passed: true, safetyLevel: 'safe', warnings: [] }
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
  const source = normalizeSource(raw.source)
  const effectiveReview = source === 'builtin' ? asBuiltinReview(review) : review
  const profile: AppearanceThemeProfile = {
    id,
    theme,
    review: effectiveReview,
    createdAt,
    updatedAt,
  }
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

/**
 * GPT 风格 (深色) — builtin:gpt-dark
 *
 * 视觉对齐 ChatGPT 网页深色模式 (60-70% 既视感):
 * - 深黑背景 + 渐变层
 * - 青绿 (#027e6f) 主强调；蓝 (#3e6cf4) 次强调
 * - 系统字体由全局 CSS 提供，token 不持有字体
 * - safetyLevel='safe'：所有对比度满足 AA
 */
const GPT_DARK_CORE_TOKENS = {
  bg: '#1c1c1c',
  surface: '#27282e',
  fg: '#ffffff',
  accent: '#027e6f',
  success: '#34d399',
  danger: '#fb7185',
} as const

const GPT_DARK_TOKENS = {
  ...GPT_DARK_CORE_TOKENS,
  bgGrad1: '#27282e',
  bgGrad2: '#0d0d0d',
  surface0: '#1c1c1c',
  surface1: '#232325',
  surface2: '#27282e',
  surface3: '#2d2e35',
  surfaceHover: '#2a2b30',
  hairline: '#2d2e35',
  hairline2: '#27282e',
  hairlineStrong: '#474b58',
  // spec §1.2 checklist: 主 #fff / 次 #878da2 / 弱 #646b81
  fg2: '#878da2',
  fg3: '#646b81',
  fg4: '#474b58',
  accent2: '#3e6cf4',
  accentSoft: '#02382f',
  accentRing: '#027e6f',
} as const

/**
 * GPT 风格 (浅色) — builtin:gpt-light
 *
 * 视觉对齐 ChatGPT 网页浅色模式 (60–70% 既视感):
 * - 纯白背景 + 浅灰 surface
 * - 青绿主强调（与深色变体一致），accent2 蓝
 * - safetyLevel='safe'：所有对比度满足 AA
 *
 * Token 取自用户提供的 ChatGPT.html 设计系统导出（design system colors）。
 */
const GPT_LIGHT_CORE_TOKENS = {
  bg: '#ffffff',
  surface: '#f4f4f6',
  fg: '#161719',
  accent: '#027e6f',
  success: '#016a5e',
  danger: '#eb0a00',
} as const

const GPT_LIGHT_TOKENS = {
  ...GPT_LIGHT_CORE_TOKENS,
  bgGrad1: '#f8f9fa',
  bgGrad2: '#ffffff',
  surface0: '#ffffff',
  surface1: '#fbfbfc',
  surface2: '#f4f4f6',
  surface3: '#e2e4e9',
  surfaceHover: '#eef0f2',
  hairline: '#e2e4e9',
  hairline2: '#cdd1dc',
  hairlineStrong: '#878da2',
  // spec §1.2 三层 fg 反推到 light: 主 #161719 / 次 #646b81 / 弱 #878da2
  fg2: '#646b81',
  fg3: '#878da2',
  fg4: '#adb2c3',
  accent2: '#3e6cf4',
  accentSoft: '#eafaf9',
  accentRing: '#027e6f',
} as const

/**
 * 水面 (深色) — builtin:mirror-dark
 *
 * 设计语言：液态石墨 / 丝绸 / 雾化铅灰镜面（不是水蓝色，不是科幻 HUD）。
 * 关键审美：暗部里的层次变化 + 极弱 accent + 大面积低对比。
 * 参考：Porsche 官网 / B&O 高端音响 UI / 沙丘电影 UI。
 *
 * Hex 取自项目搭档（用户）确认的设计语言文档（2026-05-10）。
 * accent #7C8EA3 是冷灰带极弱蓝紫，绝不可换成霓虹蓝/青绿等强色。
 *
 * Phase A 仅做静态底；Phase B 加 viscous displacement shader。
 */
const MIRROR_DARK_CORE_TOKENS = {
  bg: '#111315',
  surface: '#1B1E22',
  fg: '#E5E7EA',
  accent: '#7C8EA3',
  success: '#34d399',
  danger: '#fb7185',
} as const

const MIRROR_DARK_TOKENS = {
  ...MIRROR_DARK_CORE_TOKENS,
  bgGrad1: '#1B1E22',
  bgGrad2: '#0E1012',
  surface0: '#111315',
  surface1: '#181B1F',
  surface2: '#1B1E22',
  surface3: '#24282D', // elevated surface
  surfaceHover: '#1F2226',
  hairline: '#2A2D32',
  hairline2: '#1F2226',
  hairlineStrong: '#3A3E45', // approximation of #8C949C22 (alpha not allowed in token contract)
  fg2: '#9CA3AF',
  fg3: '#6B7280',
  fg4: '#4B5158',
  accent2: '#9CA3AF', // pull accent2 toward neutral too — no neon
  accentSoft: '#2A3340',
  accentRing: '#7C8EA3',
} as const

/**
 * 水面 (浅色) — builtin:mirror-light
 *
 * 设计语言：浅灰液态丝绸 / 润湿陶瓷 / 微湿银漆 / 雾面铝（不是白玻璃，不是 frosted white）。
 * 关键差别：「微弱反射」≠「透明」。light 版的高级感来自有深度的灰白，不是亮。
 *
 * elevated #FFFFFFB8 (含 alpha) 在用户原稿中暗示半透叠层；
 * 本期 token 契约不接受 alpha hex，简化为 #FFFFFF；半透感留给 shader 与 box-shadow。
 */
const MIRROR_LIGHT_CORE_TOKENS = {
  bg: '#E7E8EA',
  surface: '#F3F4F6',
  fg: '#1A1D21',
  accent: '#708090',
  success: '#016a5e',
  danger: '#eb0a00',
} as const

const MIRROR_LIGHT_TOKENS = {
  ...MIRROR_LIGHT_CORE_TOKENS,
  bgGrad1: '#F3F4F6',
  bgGrad2: '#DCDDE0',
  surface0: '#E7E8EA',
  surface1: '#EDEEF0',
  surface2: '#F3F4F6',
  surface3: '#FFFFFF', // elevated; alpha removed from #FFFFFFB8
  surfaceHover: '#E2E3E5',
  hairline: '#CFD2D6',
  hairline2: '#DCDDE0',
  hairlineStrong: '#A8AEB4',
  fg2: '#6B7280',
  fg3: '#9CA3AF',
  fg4: '#B8BDC4',
  accent2: '#8C949C', // muted twin
  accentSoft: '#D8DDE3',
  accentRing: '#708090',
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
      coreTokens: { ...GPT_DARK_CORE_TOKENS },
      tokens: { ...GPT_DARK_TOKENS },
    },
  },
  {
    id: 'builtin:gpt-light',
    builtinVersion: 1,
    theme: {
      schemaVersion: 1,
      name: 'GPT 风格 (浅色)',
      mode: 'light',
      scope: 'all',
      safetyLevel: 'safe',
      coreTokens: { ...GPT_LIGHT_CORE_TOKENS },
      tokens: { ...GPT_LIGHT_TOKENS },
    },
  },
  {
    id: 'builtin:mirror-dark',
    // bump version to 3:
    //   v1 — placeholder palette (P0)
    //   v2 — real graphite/silk palette
    //   v3 — name changed 水面 → 液镜; mirror is now dark-only (mirror-light
    //        builtin removed), so any cached active mirror-light id should
    //        fail to resolve and the resolver will fall back to mirror-dark
    //        for any user who previously had mirror-light selected.
    builtinVersion: 3,
    theme: {
      schemaVersion: 1,
      name: '液镜',
      mode: 'dark',
      scope: 'all',
      safetyLevel: 'safe',
      coreTokens: { ...MIRROR_DARK_CORE_TOKENS },
      tokens: { ...MIRROR_DARK_TOKENS },
    },
  },
  // mirror-light deliberately removed — "liquid mirror" is a dark-only
  // material language. The visible color/scheme controls hide entirely
  // when the user is on the mirror profile (see Settings.tsx). The
  // MIRROR_LIGHT_* token constants are kept above for reference / future
  // revival but no longer seeded.
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
 *
 * 关于 review.safetyLevel：builtin profile 是开发者预审过的（spec §6.2），
 * 不应受 RFC #47 review 引擎判定为 experimental（review 引擎是为用户提交的
 * 自定义主题设计的，会对部分强对比配色发出 warning）。seed 强制将 builtin
 * profile 的 review.safetyLevel 写为 'safe' 并清空 warnings——这是 builtin
 * 与 user-submitted 的语义区别，与 deleteAppearanceTheme 拒绝 builtin 对称。
 *
 * theme.safetyLevel 字段（ThemeSpec 内）保留 review 引擎的判定结果，仅作记录；
 * 实际 apply 检查走 review.safetyLevel。
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
    const builtinReview = asBuiltinReview(review)
    const existing = profilesById.get(builtin.id)

    if (!existing) {
      const seeded: AppearanceThemeProfile = {
        id: builtin.id,
        theme,
        review: builtinReview,
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

    if (
      (existing.builtinVersion ?? 0) < builtin.builtinVersion ||
      existing.review.safetyLevel !== 'safe'
    ) {
      // Bump version OR self-heal a previously-seeded builtin whose review
      // got persisted at experimental (e.g. before the safe override fix).
      profilesById.set(builtin.id, {
        ...existing,
        theme,
        review: builtinReview,
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
