import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppearanceApi, type AppearanceThemeProfile } from './api/appearance'
import { SettingsApi } from './api/settings'
import { applyTheme, type ThemeMode } from './theme'
import { decideMediaListener, decideThemeUpdate } from './theme-context-logic'
import {
  resolveBaseFromProfile,
  resolveProfileForBase,
  resolveSystemColorScheme,
  type BaseThemeProfile,
  type ResolvedColorScheme,
} from './theme-resolver'

type ThemeContextValue = {
  theme: ThemeMode
  /**
   * Update the user's stored colorScheme preference. For mirror, this
   * additionally re-applies the matching builtin profile so dark↔light
   * actually swaps the gradient. For GPT, the call is a no-op for
   * locked schemes (UI should disable the segments).
   */
  setTheme: (theme: ThemeMode) => void
  activeThemeProfile: AppearanceThemeProfile | null
  refreshAppearanceTheme: () => Promise<void>

  /**
   * Currently-selected base profile in the switcher (classic / gpt / mirror).
   * Derived from `activeThemeProfile.id` via the canonical mapping; falls
   * back to 'classic' for null and for user-created custom profiles.
   */
  baseProfile: BaseThemeProfile

  /**
   * Apply a base profile by name. For classic this resets the appearance;
   * for gpt/mirror it resolves to the right builtin profile id (taking the
   * current colorScheme into account for mirror) and applies it via
   * AppearanceApi.
   */
  setBaseProfile: (base: BaseThemeProfile) => Promise<void>

  /**
   * When the active base locks the colorScheme, this carries the locked
   * value and Settings.appearance.theme is NOT mutated by stray writes;
   * the lock only affects rendering. **No v1 base locks today** (decision
   * #6 was reversed — GPT now has both dark and light variants), but the
   * field is preserved as the resolver's contract for any future locking
   * base.
   */
  lockedColorScheme: ResolvedColorScheme | undefined
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applicableThemeProfile(profile: AppearanceThemeProfile | null) {
  return profile && profile.review.safetyLevel !== 'rejected' ? profile : null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('dark')
  const [activeThemeProfile, setActiveThemeProfile] = useState<AppearanceThemeProfile | null>(null)
  // Tracks the most recently resolved profileId so we can avoid spurious
  // re-applies when re-resolving for mirror + auto media changes.
  const lastResolvedProfileIdRef = useRef<string | null>(null)

  const refreshAppearanceTheme = useCallback(async () => {
    const themes = await AppearanceApi.listThemes()
    const next = applicableThemeProfile(themes.activeProfile)
    setActiveThemeProfile(next)
    lastResolvedProfileIdRef.current = next?.id ?? null
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([SettingsApi.get(), AppearanceApi.listThemes()])
      .then(async ([settings, themes]) => {
        if (cancelled) return
        const userTheme = settings.appearance.theme
        const initial = applicableThemeProfile(themes.activeProfile)
        setThemeState(userTheme)
        setActiveThemeProfile(initial)
        lastResolvedProfileIdRef.current = initial?.id ?? null

        // Initialization sync (Codex P4a feedback): when colorScheme=auto and
        // the persisted variant disagrees with the current system signal, the
        // user would otherwise see e.g. gpt-dark until the OS flips. Eagerly
        // re-resolve once on boot. Skipped when there's no active profile or
        // the user explicitly chose dark/light.
        if (!initial || userTheme !== 'auto') return
        const base = resolveBaseFromProfile(initial.id)
        if (base !== 'gpt' && base !== 'mirror') return
        const resolution = resolveProfileForBase(base, 'auto', resolveSystemColorScheme)
        if (!resolution.profileId || resolution.profileId === initial.id) return

        await AppearanceApi.applyTheme(resolution.profileId, { confirmed: true })
        const refreshed = await AppearanceApi.listThemes()
        if (cancelled) return
        const synced = applicableThemeProfile(refreshed.activeProfile)
        setActiveThemeProfile(synced)
        lastResolvedProfileIdRef.current = synced?.id ?? null
      })
      .catch(() => {
        if (!cancelled) setThemeState('dark')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Derive: which base profile does the switcher consider "selected"?
  const baseProfile = useMemo<BaseThemeProfile>(
    () => resolveBaseFromProfile(activeThemeProfile?.id ?? null),
    [activeThemeProfile?.id],
  )

  // Derive: does the active base lock the colorScheme? (GPT → dark)
  // Re-resolve via resolveProfileForBase so the lock follows the resolver
  // contract — keeping a single source of truth.
  const lockedColorScheme = useMemo<ResolvedColorScheme | undefined>(() => {
    return resolveProfileForBase(baseProfile, theme).lockedColorScheme
  }, [baseProfile, theme])

  // Derive: effective rendering scheme. Locked value beats the user's
  // stored preference; otherwise pass theme through to applyTheme which
  // resolves auto via the system query.
  const effectiveScheme = useMemo<ThemeMode>(() => {
    if (lockedColorScheme) return lockedColorScheme
    return theme
  }, [lockedColorScheme, theme])

  // (1) Apply theme tokens + base-profile attribute to the DOM root, in
  // ONE useLayoutEffect, before any child paints. Combining the two effects
  // closes the first-frame race where a child component (e.g. ThemeEffectLayer)
  // would mount and read stale CSS variables / data attributes before
  // ThemeProvider's normal useEffect ran.
  //
  // [data-base-profile] is the scope hook for mirror-only CSS
  // (backdrop-filter chain, inset shadows, wet-ceramic light mode).
  useLayoutEffect(() => {
    document.documentElement.dataset.baseProfile = baseProfile
    applyTheme(effectiveScheme, activeThemeProfile?.theme)
  }, [effectiveScheme, activeThemeProfile, baseProfile])

  // (2) Listen for system color-scheme changes when the system signal is
  // actually relevant. Dual-variant bases (gpt, mirror) re-apply the matching
  // builtin on flip; classic just updates the data-theme attribute.
  useEffect(() => {
    const decision = decideMediaListener(baseProfile, theme, lockedColorScheme)
    if (!decision.shouldListen) return

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const sync = async () => {
      if (decision.reapplyVariantOnSystemFlip) {
        const resolution = resolveProfileForBase(baseProfile, 'auto', resolveSystemColorScheme)
        if (
          resolution.profileId &&
          resolution.profileId !== lastResolvedProfileIdRef.current
        ) {
          await AppearanceApi.applyTheme(resolution.profileId, { confirmed: true })
          await refreshAppearanceTheme()
        }
      } else {
        // classic + auto: re-resolve the data-theme attribute.
        applyTheme('auto')
      }
    }
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme, baseProfile, lockedColorScheme, refreshAppearanceTheme])

  const setBaseProfile = useCallback(
    async (base: BaseThemeProfile) => {
      const resolution = resolveProfileForBase(base, theme, resolveSystemColorScheme)
      if (resolution.profileId === null) {
        await AppearanceApi.resetTheme({ confirmed: true })
      } else {
        await AppearanceApi.applyTheme(resolution.profileId, { confirmed: true })
      }
      await refreshAppearanceTheme()
    },
    [theme, refreshAppearanceTheme],
  )

  // setTheme wrapper: persist user preference AND, when the active base is
  // a dual-variant base (gpt or mirror), re-apply the matching builtin variant
  // so dark↔light actually swaps the gradient. Locked schemes (no v1 base
  // uses this today) drop stray writes silently.
  // Decision logic lives in theme-context-logic.ts for unit-test coverage.
  const setTheme = useCallback(
    (next: ThemeMode) => {
      const decision = decideThemeUpdate(baseProfile, next, lockedColorScheme)
      if (!decision.acceptStateUpdate) return
      setThemeState(next)
      if (
        decision.reapplyVariantProfileId &&
        decision.reapplyVariantProfileId !== lastResolvedProfileIdRef.current
      ) {
        void AppearanceApi.applyTheme(decision.reapplyVariantProfileId, { confirmed: true })
          .then(() => refreshAppearanceTheme())
          .catch(() => undefined)
      }
    },
    [baseProfile, lockedColorScheme, refreshAppearanceTheme],
  )

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      activeThemeProfile,
      refreshAppearanceTheme,
      baseProfile,
      setBaseProfile,
      lockedColorScheme,
    }),
    [
      theme,
      setTheme,
      activeThemeProfile,
      refreshAppearanceTheme,
      baseProfile,
      setBaseProfile,
      lockedColorScheme,
    ],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
