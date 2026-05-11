// Cross-card light coupling controller (IU-15, Wow A).
//
// Given a "source" point (typically the center of the currently hovered
// mirror card) and a set of registered cards, this controller writes
// `--mr-coupled-angle` and `--mr-coupled-strength` CSS variables on each
// registered card element so that adjacent specular highlights tilt
// toward the source and brighten with distance-based decay.
//
// Decay rules (kept simple + chunky so the effect reads as physical):
//   distance <  200px  →  strength 0.15
//   distance <  500px  →  strength 0.08
//   distance >= 500px  →  strength 0
//
// `prefers-reduced-motion: reduce` disables coupling entirely (strength
// stays 0, no angle writes). Card centers are kept in a JS map keyed by
// react `useId()` strings — no DOM `data-*` storage (per IU-3 codex nit).

import { createContext, useContext } from 'react'

interface CardEntry {
  ref: HTMLElement
  cx: number
  cy: number
}

export interface Point {
  cx: number
  cy: number
}

export function computeStrength(distance: number): number {
  if (distance < 200) return 0.15
  if (distance < 500) return 0.08
  return 0
}

export function computeAngle(from: Point, to: Point): number {
  return (Math.atan2(to.cy - from.cy, to.cx - from.cx) * 180) / Math.PI
}

export class CouplingController {
  private map = new Map<string, CardEntry>()
  private source: Point | null = null
  private reduced: boolean

  constructor() {
    this.reduced =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
  }

  get size() {
    return this.map.size
  }

  register(id: string, ref: HTMLElement, center: Point) {
    this.map.set(id, { ref, cx: center.cx, cy: center.cy })
  }

  unregister(id: string) {
    this.map.delete(id)
  }

  updatePosition(id: string, center: Point) {
    const entry = this.map.get(id)
    if (entry) {
      entry.cx = center.cx
      entry.cy = center.cy
    }
  }

  setSource(s: Point | null) {
    this.source = s
  }

  /** Re-read every registered card's bounding rect (call on scroll). */
  refreshAll() {
    this.map.forEach((entry) => {
      if (!entry.ref.isConnected) return
      const r = entry.ref.getBoundingClientRect()
      entry.cx = r.left + r.width / 2
      entry.cy = r.top + r.height / 2
    })
  }

  /** Write CSS vars for every registered card based on current source. */
  tick() {
    if (this.reduced || !this.source) {
      this.map.forEach(({ ref }) => {
        ref.style.setProperty('--mr-coupled-strength', '0')
      })
      return
    }
    const src = this.source
    this.map.forEach(({ ref, cx, cy }) => {
      const d = Math.hypot(cx - src.cx, cy - src.cy)
      const strength = computeStrength(d)
      const angle = computeAngle(src, { cx, cy })
      ref.style.setProperty('--mr-coupled-strength', String(strength))
      ref.style.setProperty('--mr-coupled-angle', `${angle}deg`)
    })
  }
}

export const CouplingContext = createContext<CouplingController | null>(null)

export function useCoupling(): CouplingController | null {
  return useContext(CouplingContext)
}
