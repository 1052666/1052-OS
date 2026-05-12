import {
  resolveProfileForBase,
  resolveSystemColorScheme,
  type BaseThemeProfile,
  type ColorScheme,
  type ResolvedColorScheme,
} from './theme-resolver'

/**
 * Pure decision logic extracted from ThemeProvider so it can be unit-tested
 * without spinning up React + DOM + matchMedia.
 *
 * The two decisions modeled here:
 *
 * 1. setTheme — given the current base profile and a candidate next
 *    colorScheme, decide:
 *      - whether to accept the user's intent (locked schemes drop stray writes)
 *      - if the active base has dark+light variants (gpt or mirror), which
 *        builtin profileId must be re-applied via AppearanceApi to match the
 *        new scheme.
 *
 * 2. system media change — given the current base + theme, decide whether
 *    the system color-scheme media listener should be registered, and on
 *    flip, whether a builtin variant re-apply is needed.
 *
 * Note: after Codex decision #6 was reversed, both `gpt` and `mirror` are
 * dual-variant bases. `classic` has neither variant nor lock.
 */

const DUAL_VARIANT_BASES: ReadonlySet<BaseThemeProfile> = new Set<BaseThemeProfile>([
  'gpt',
  'mirror',
])

export type ThemeStateChangeDecision = {
  /**
   * Whether the user's intent should be persisted in `theme` state.
   * False when a locked scheme rejects the write. No v1 base locks today,
   * but the field is preserved for future bases that might want to.
   */
  acceptStateUpdate: boolean
  /**
   * If non-null, the active dual-variant base needs its builtin re-applied
   * via AppearanceApi.applyTheme to match the new scheme. Caller is
   * responsible for skipping the call when this id matches the
   * already-applied id (no-op optimization).
   */
  reapplyVariantProfileId: string | null
}

export function decideThemeUpdate(
  base: BaseThemeProfile,
  nextScheme: ColorScheme,
  lockedColorScheme: ResolvedColorScheme | undefined,
  resolveAuto: () => ResolvedColorScheme = resolveSystemColorScheme,
): ThemeStateChangeDecision {
  // Locked schemes drop ALL stray writes including 'auto'. No v1 base locks,
  // but if a future base does, this path is wired up correctly.
  if (lockedColorScheme && nextScheme !== lockedColorScheme) {
    return { acceptStateUpdate: false, reapplyVariantProfileId: null }
  }

  if (DUAL_VARIANT_BASES.has(base)) {
    const resolution = resolveProfileForBase(base, nextScheme, resolveAuto)
    return {
      acceptStateUpdate: true,
      reapplyVariantProfileId: resolution.profileId,
    }
  }

  return { acceptStateUpdate: true, reapplyVariantProfileId: null }
}

export type SystemMediaListenerDecision = {
  /**
   * Whether a media-query listener should be registered. False when the
   * system signal is irrelevant (locked schemes, non-auto colorScheme).
   */
  shouldListen: boolean
  /**
   * When listener fires for a dual-variant base + auto, the variant builtin
   * needs to be re-applied via AppearanceApi. False when the base has no
   * variants (classic) — listener only updates the data-theme attribute.
   */
  reapplyVariantOnSystemFlip: boolean
}

export function decideMediaListener(
  base: BaseThemeProfile,
  theme: ColorScheme,
  lockedColorScheme: ResolvedColorScheme | undefined,
): SystemMediaListenerDecision {
  if (theme !== 'auto' || lockedColorScheme) {
    return { shouldListen: false, reapplyVariantOnSystemFlip: false }
  }
  return {
    shouldListen: true,
    reapplyVariantOnSystemFlip: DUAL_VARIANT_BASES.has(base),
  }
}
