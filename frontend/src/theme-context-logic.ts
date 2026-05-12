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
 *      - whether the active mirror builtin needs to be swapped (dark ↔ light)
 *
 * 2. system media change — given the current base + theme, decide whether
 *    the system color-scheme media listener should be registered, and what
 *    profileId to re-apply when the system flips.
 */

export type ThemeStateChangeDecision = {
  /**
   * Whether the user's intent should be persisted in `theme` state.
   * False when a locked scheme rejects the write (e.g. GPT + light).
   */
  acceptStateUpdate: boolean
  /**
   * If non-null, the active mirror builtin should be re-applied via
   * AppearanceApi.applyTheme to match the new scheme. Caller is
   * responsible for skipping the call when this id matches the
   * already-applied id (no-op optimization).
   */
  reapplyMirrorProfileId: string | null
}

export function decideThemeUpdate(
  base: BaseThemeProfile,
  nextScheme: ColorScheme,
  lockedColorScheme: ResolvedColorScheme | undefined,
  resolveAuto: () => ResolvedColorScheme = resolveSystemColorScheme,
): ThemeStateChangeDecision {
  // Locked schemes drop ALL stray writes including 'auto'.
  // Per spec §5.1: under GPT, the "follow system" segment is disabled too;
  // only the locked scheme itself (e.g. dark) remains selectable.
  if (lockedColorScheme && nextScheme !== lockedColorScheme) {
    return { acceptStateUpdate: false, reapplyMirrorProfileId: null }
  }

  if (base === 'mirror') {
    const resolution = resolveProfileForBase('mirror', nextScheme, resolveAuto)
    return {
      acceptStateUpdate: true,
      reapplyMirrorProfileId: resolution.profileId,
    }
  }

  return { acceptStateUpdate: true, reapplyMirrorProfileId: null }
}

export type SystemMediaListenerDecision = {
  /**
   * Whether a media-query listener should be registered. False when the
   * system signal is irrelevant (locked schemes, non-auto colorScheme).
   */
  shouldListen: boolean
  /**
   * When listener fires for mirror + auto, the profileId to re-apply.
   * Caller compares against last-applied id to skip no-ops.
   * Null means the listener only needs to update the data-theme
   * attribute, not call AppearanceApi (classic + auto case).
   */
  mirrorReapplyOnSystemFlip: boolean
}

export function decideMediaListener(
  base: BaseThemeProfile,
  theme: ColorScheme,
  lockedColorScheme: ResolvedColorScheme | undefined,
): SystemMediaListenerDecision {
  if (theme !== 'auto' || lockedColorScheme) {
    return { shouldListen: false, mirrorReapplyOnSystemFlip: false }
  }
  return {
    shouldListen: true,
    mirrorReapplyOnSystemFlip: base === 'mirror',
  }
}
