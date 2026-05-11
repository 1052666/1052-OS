// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shouldShowPour, markPourSeen, resetPourSeen } from './liquidPour'

// jsdom doesn't implement matchMedia — provide a stub so the reduced-motion
// probe is deterministic.
function stubMatchMedia(prefersReducedMotion = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersReducedMotion ? query.includes('reduce') : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('liquidPour', () => {
  beforeEach(() => {
    sessionStorage.clear()
    stubMatchMedia(false)
  })

  it('shows on first call this session', () => {
    expect(shouldShowPour()).toBe(true)
  })

  it('does not show after markPourSeen()', () => {
    expect(shouldShowPour()).toBe(true)
    markPourSeen()
    expect(shouldShowPour()).toBe(false)
  })

  it('resetPourSeen clears the flag', () => {
    markPourSeen()
    expect(shouldShowPour()).toBe(false)
    resetPourSeen()
    expect(shouldShowPour()).toBe(true)
  })

  it('reduced-motion always returns false', () => {
    stubMatchMedia(true)
    expect(shouldShowPour()).toBe(false)
  })

  it('reduced-motion + already-seen returns false', () => {
    markPourSeen()
    stubMatchMedia(true)
    expect(shouldShowPour()).toBe(false)
  })
})
