import { useEffect, useState } from 'react'
import { SettingsApi } from './api/settings'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Pure decision: should motion-heavy effects be enabled?
 *
 * Decoupled from `effects.water.enabled` (spec §4.1). The two settings serve
 * different layers:
 *   - `reduceMotion` is the user's overall motion preference (overrides
 *     the system query when explicitly set; null = follow system).
 *   - `effects.water.enabled` is the water-specific advanced toggle for
 *     mirror-style ripple/wave; not exposed in v1 UI.
 *
 * Returns `false` when the user effectively prefers reduced motion. Caller
 * still needs to gate water specifically on `effects.water.enabled` and
 * runtime FPS, per spec §4.2.
 */
export function shouldDisableMotion(
  reduceMotion: boolean | null | undefined,
  systemReducedMotion: boolean,
): boolean {
  if (reduceMotion === true) return true
  if (reduceMotion === false) return false
  // null / undefined → follow system
  return systemReducedMotion
}

/**
 * Watches `prefers-reduced-motion` and the user's persisted preference and
 * returns a single boolean: true when motion should be disabled.
 *
 * SSR-safe: returns `false` when window is unavailable. The hook never
 * blocks rendering and re-evaluates on system query changes + when the
 * user updates `settings.appearance.reduceMotion` via SettingsApi.
 *
 * The hook reads settings.appearance.reduceMotion once on mount; callers
 * that need realtime updates after a SettingsApi.update should remount
 * the consumer or expose a refresh hook (out of scope for P4a).
 */
export function useReducedMotion(): boolean {
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  })

  const [userPreference, setUserPreference] = useState<boolean | null | undefined>(undefined)

  // Subscribe to system query changes.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    setSystemReducedMotion(media.matches)
    const sync = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  // Read the user's persisted preference once on mount. Re-mount the consumer
  // (or extend this hook) if you need to react to live SettingsApi.update
  // calls; v1 effects do not have a settings UI so this is sufficient.
  useEffect(() => {
    let cancelled = false
    SettingsApi.get()
      .then((settings) => {
        if (!cancelled) setUserPreference(settings.appearance.reduceMotion ?? null)
      })
      .catch(() => {
        if (!cancelled) setUserPreference(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return shouldDisableMotion(userPreference, systemReducedMotion)
}
