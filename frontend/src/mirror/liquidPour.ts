const KEY = 'mirror_pour_seen'

export function shouldShowPour(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false // sessionStorage unavailable (private mode) — skip pour
  }
}

export function markPourSeen(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    /* private mode — skip */
  }
}

export function resetPourSeen(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* skip */
  }
}
