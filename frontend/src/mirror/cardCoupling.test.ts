// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  CouplingController,
  computeStrength,
  computeAngle,
} from './cardCoupling'

// jsdom doesn't implement matchMedia — provide a stub so the controller
// constructor's reduced-motion probe is deterministic.
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

describe('cardCoupling — pure decay functions', () => {
  it('computeStrength returns 0.15 for distance < 200', () => {
    expect(computeStrength(0)).toBeCloseTo(0.15)
    expect(computeStrength(100)).toBeCloseTo(0.15)
    expect(computeStrength(199)).toBeCloseTo(0.15)
  })

  it('computeStrength returns 0.08 for distance 200-500', () => {
    expect(computeStrength(200)).toBeCloseTo(0.08)
    expect(computeStrength(300)).toBeCloseTo(0.08)
    expect(computeStrength(499)).toBeCloseTo(0.08)
  })

  it('computeStrength returns 0 for distance >= 500', () => {
    expect(computeStrength(500)).toBe(0)
    expect(computeStrength(1000)).toBe(0)
  })

  it('computeAngle returns 0 for target directly right of source', () => {
    expect(computeAngle({ cx: 0, cy: 0 }, { cx: 100, cy: 0 })).toBeCloseTo(0)
  })

  it('computeAngle returns 90 for target directly below source', () => {
    expect(computeAngle({ cx: 0, cy: 0 }, { cx: 0, cy: 100 })).toBeCloseTo(90)
  })
})

describe('CouplingController', () => {
  beforeEach(() => {
    stubMatchMedia(false)
  })

  it('register adds an entry to the internal map', () => {
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    ctrl.register('a', el, { cx: 100, cy: 100 })
    expect(ctrl.size).toBe(1)
  })

  it('unregister removes an entry from the internal map', () => {
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    ctrl.register('a', el, { cx: 100, cy: 100 })
    ctrl.unregister('a')
    expect(ctrl.size).toBe(0)
  })

  it('tick writes strength + angle when source is set', () => {
    const ctrl = new CouplingController()
    const elA = document.createElement('div')
    const elB = document.createElement('div')
    ctrl.register('a', elA, { cx: 0, cy: 0 })
    ctrl.register('b', elB, { cx: 100, cy: 0 })
    ctrl.setSource({ cx: 0, cy: 0 }) // hovering "a"
    ctrl.tick()
    expect(
      parseFloat(elB.style.getPropertyValue('--mr-coupled-strength')),
    ).toBeCloseTo(0.15)
    expect(elB.style.getPropertyValue('--mr-coupled-angle')).toMatch(
      /^-?\d+(\.\d+)?deg$/,
    )
  })

  it('tick with null source resets all strengths to 0', () => {
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    ctrl.register('a', el, { cx: 100, cy: 100 })
    el.style.setProperty('--mr-coupled-strength', '0.15')
    ctrl.setSource(null)
    ctrl.tick()
    expect(el.style.getPropertyValue('--mr-coupled-strength')).toBe('0')
  })

  it('reduced-motion disables coupling (strength stays 0)', () => {
    stubMatchMedia(true)
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    ctrl.register('a', el, { cx: 100, cy: 100 })
    ctrl.setSource({ cx: 0, cy: 0 })
    ctrl.tick()
    expect(el.style.getPropertyValue('--mr-coupled-strength')).toBe('0')
  })

  it('updatePosition updates a registered entry', () => {
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    ctrl.register('a', el, { cx: 0, cy: 0 })
    ctrl.updatePosition('a', { cx: 500, cy: 0 })
    ctrl.setSource({ cx: 0, cy: 0 })
    ctrl.tick()
    // 500px hits the >= 500 branch → strength 0
    expect(el.style.getPropertyValue('--mr-coupled-strength')).toBe('0')
  })

  it('refreshAll re-reads bounding rects for connected entries', () => {
    const ctrl = new CouplingController()
    const el = document.createElement('div')
    document.body.appendChild(el)
    ctrl.register('a', el, { cx: 0, cy: 0 })
    // Force a bounding rect that puts center at (50, 50).
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ctrl.refreshAll()
    ctrl.setSource({ cx: 50, cy: 50 })
    ctrl.tick()
    // distance 0 → strength 0.15
    expect(
      parseFloat(el.style.getPropertyValue('--mr-coupled-strength')),
    ).toBeCloseTo(0.15)
    document.body.removeChild(el)
  })
})
