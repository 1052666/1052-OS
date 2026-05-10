/**
 * Theme profile resolver: maps the user-facing theme选 (classic / gpt / mirror)
 * + the current colorScheme (light / dark / auto) onto the concrete builtin
 * profile id that should be applied via AppearanceApi.
 *
 * This is the "outer layer" referenced by the theme spec — it does not modify
 * applyTheme()'s internal behavior and contains no DOM side effects.
 *
 * Canonical mapping (§1.1):
 *   - classic           ↔ activeProfileId === null
 *   - gpt               ↔ 'builtin:gpt-dark'    (GPT is locked to dark mode)
 *   - mirror + dark     ↔ 'builtin:mirror-dark'
 *   - mirror + light    ↔ 'builtin:mirror-light'
 *   - mirror + auto     → resolves to mirror-dark or mirror-light via system query
 */

export type BaseThemeProfile = 'classic' | 'gpt' | 'mirror'
export type ColorScheme = 'dark' | 'light' | 'auto'
export type ResolvedColorScheme = 'dark' | 'light'

export const BUILTIN_PROFILE_IDS = {
  gptDark: 'builtin:gpt-dark',
  mirrorDark: 'builtin:mirror-dark',
  mirrorLight: 'builtin:mirror-light',
} as const

export type BuiltinProfileId =
  | typeof BUILTIN_PROFILE_IDS.gptDark
  | typeof BUILTIN_PROFILE_IDS.mirrorDark
  | typeof BUILTIN_PROFILE_IDS.mirrorLight

const ALL_BUILTIN_IDS: ReadonlySet<string> = new Set<string>(Object.values(BUILTIN_PROFILE_IDS))

/**
 * Resolution result.
 * - `profileId`: the AppearanceApi profileId to apply, or `null` for classic (reset)
 * - `lockedColorScheme`: when present, the runtime should render at this resolved
 *   scheme regardless of the user's stored colorScheme (e.g. GPT locks dark).
 *   The stored `settings.appearance.theme` should NOT be mutated when locked.
 */
export type ProfileResolution = {
  profileId: BuiltinProfileId | null
  lockedColorScheme?: ResolvedColorScheme
}

/**
 * Resolve `auto` against the system preference.
 *
 * Accepts an injected matcher for SSR / unit tests (default uses the browser
 * `window.matchMedia`). Falls back to `dark` when matchMedia is unavailable.
 */
export function resolveSystemColorScheme(
  matchMedia: typeof window.matchMedia | undefined =
    typeof window !== 'undefined' ? window.matchMedia.bind(window) : undefined,
): ResolvedColorScheme {
  if (!matchMedia) return 'dark'
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * Pure resolver: given the user's chosen base profile + colorScheme,
 * return the concrete builtin profile id to apply.
 *
 * `colorScheme === 'auto'` is resolved using the system preference.
 */
export function resolveProfileForBase(
  baseProfileName: BaseThemeProfile,
  colorScheme: ColorScheme,
  resolveAuto: () => ResolvedColorScheme = resolveSystemColorScheme,
): ProfileResolution {
  if (baseProfileName === 'classic') {
    return { profileId: null }
  }

  if (baseProfileName === 'gpt') {
    // GPT is locked to dark for the v1 release (spec §5.1, §6.4).
    // Even when user's colorScheme is light or auto, render dark; do not write
    // back to settings.appearance.theme.
    return {
      profileId: BUILTIN_PROFILE_IDS.gptDark,
      lockedColorScheme: 'dark',
    }
  }

  // mirror — has both dark and light variants.
  const resolved = colorScheme === 'auto' ? resolveAuto() : colorScheme
  return {
    profileId:
      resolved === 'light'
        ? BUILTIN_PROFILE_IDS.mirrorLight
        : BUILTIN_PROFILE_IDS.mirrorDark,
  }
}

/**
 * Reverse mapping: given the currently-applied profileId, return the base
 * profile name the user sees in the switcher.
 *
 * Implements the canonical mapping (§1.1):
 * - null / unknown id → 'classic'
 * - any builtin:gpt-* → 'gpt'
 * - any builtin:mirror-* → 'mirror'
 *
 * User-created custom profile ids fall through to 'classic' for switcher
 * purposes; the actual custom theme remains applied (handled elsewhere).
 */
export function resolveBaseFromProfile(profileId: string | null | undefined): BaseThemeProfile {
  if (!profileId) return 'classic'
  if (profileId === BUILTIN_PROFILE_IDS.gptDark) return 'gpt'
  if (
    profileId === BUILTIN_PROFILE_IDS.mirrorDark ||
    profileId === BUILTIN_PROFILE_IDS.mirrorLight
  ) {
    return 'mirror'
  }
  // Forward-compat: any other future builtin under known prefixes.
  if (profileId.startsWith('builtin:gpt-')) return 'gpt'
  if (profileId.startsWith('builtin:mirror-')) return 'mirror'
  return 'classic'
}

/** Whether a profileId belongs to the v1 builtin set. */
export function isKnownBuiltinProfile(profileId: string | null | undefined): boolean {
  return typeof profileId === 'string' && ALL_BUILTIN_IDS.has(profileId)
}

/**
 * Telemetry helper: produces the canonical profileId string for analytics
 * events. `null` (classic) is reported as the virtual id `'builtin:classic'`,
 * keeping the three-way switcher symmetric in dashboards (§8.1).
 *
 * Important: this virtual id is for reporting only — it does NOT exist in
 * the AppearanceApi database. Do not pass it to `applyTheme()`.
 */
export const VIRTUAL_CLASSIC_PROFILE_ID = 'builtin:classic'

export function profileIdForTelemetry(profileId: string | null | undefined): string {
  if (!profileId) return VIRTUAL_CLASSIC_PROFILE_ID
  return profileId
}
