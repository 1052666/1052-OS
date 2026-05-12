import { useCallback, useEffect, useState } from 'react'

export const ONBOARDING_STORAGE_KEY = '1052os.onboarding.completed'

/**
 * Onboarding gate hook.
 *
 * - On mount, reads `localStorage[ONBOARDING_STORAGE_KEY]`. If absent, the
 *   onboarding modal should auto-show.
 * - `markCompleted()` flips the flag so subsequent loads do not re-prompt.
 *   Called on both "use GPT" and "skip" paths so the user is never nagged.
 * - `restart()` clears the flag and re-shows; wired to the Settings page
 *   "重新开始引导 / Restart onboarding" button.
 *
 * SSR-safe: when window is unavailable, `shouldShow` stays false and
 * mutators are no-ops. The hook never blocks rendering.
 */
export function useOnboarding() {
  const [shouldShow, setShouldShow] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const completed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true'
    setShouldShow(!completed)
    setHydrated(true)
  }, [])

  const markCompleted = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    }
    setShouldShow(false)
  }, [])

  const restart = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    }
    setShouldShow(true)
  }, [])

  return { shouldShow, hydrated, markCompleted, restart }
}
