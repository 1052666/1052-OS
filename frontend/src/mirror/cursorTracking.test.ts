// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { computeAngle, attachCursorTracking } from './cursorTracking'

// jsdom doesn't implement matchMedia — provide a default stub so spyOn works.
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

describe('cursorTracking', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = ''
    // Stub rAF BEFORE vi.useFakeTimers — vitest's full fake-timer shim
    // overwrites requestAnimationFrame even when it's listed in toFake.
    // Stubbing first + limiting toFake keeps our synchronous shim intact.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now())
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    stubMatchMedia(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('computeAngle returns 0deg when cursor is directly right of center', () => {
    expect(computeAngle({ x: 200, y: 100 }, { cx: 100, cy: 100 })).toBeCloseTo(0)
  })

  it('computeAngle returns 90deg when cursor is directly below center', () => {
    expect(computeAngle({ x: 100, y: 200 }, { cx: 100, cy: 100 })).toBeCloseTo(90)
  })

  it('computeAngle returns 180deg when cursor is directly left of center', () => {
    const a = computeAngle({ x: 0, y: 100 }, { cx: 100, cy: 100 })
    expect(Math.abs(a)).toBeCloseTo(180)
  })

  it('attachCursorTracking writes --mr-cursor-angle on mousemove (after rAF)', () => {
    // rAF is synchronous in tests — CSS var is set during dispatchEvent itself.
    const detach = attachCursorTracking()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }))
    const val = document.documentElement.style.getPropertyValue('--mr-cursor-angle')
    expect(val).toMatch(/^-?\d+(\.\d+)?deg$/)
    detach()
  })

  it('idle > 3s removes --mr-cursor-angle (returns to auto-sweep)', () => {
    const detach = attachCursorTracking()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50 }))
    // rAF is sync — CSS var is already set
    vi.advanceTimersByTime(3500)
    expect(document.documentElement.style.getPropertyValue('--mr-cursor-angle')).toBe('')
    detach()
  })

  it('reduced-motion disables tracking entirely', () => {
    stubMatchMedia(true)
    const detach = attachCursorTracking()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }))
    expect(document.documentElement.style.getPropertyValue('--mr-cursor-angle')).toBe('')
    detach()
  })

  it('detach cleans up listeners + removes CSS var', () => {
    const detach = attachCursorTracking()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }))
    expect(document.documentElement.style.getPropertyValue('--mr-cursor-angle')).not.toBe('')
    detach()
    expect(document.documentElement.style.getPropertyValue('--mr-cursor-angle')).toBe('')
  })
})
