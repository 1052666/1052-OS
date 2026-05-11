import { useEffect, useState, type CSSProperties } from 'react'

const DURATION_MS = 1500

interface LiquidPourOverlayProps {
  onDone: () => void
}

/**
 * Mirror profile entry animation — "液态凝聚" (liquid condensation).
 *
 * Visual narrative: the viewport starts as a coarse fog of dark particles
 * obscuring blurred + desaturated UI. Over 1.5s the particles "compact"
 * (turbulence baseFrequency rises, cells shrink), opacity fades, and the
 * underlying UI sharpens + regains saturation. The effect reads as the
 * mirror surface "condensing" out of vapor.
 *
 * Implementation:
 *   - SVG <feTurbulence> renders animated noise; React updates baseFrequency
 *     each rAF tick. Color via feColorMatrix mapping noise → black alpha.
 *   - backdrop-filter on the overlay div blurs + desaturates whatever sits
 *     below (the entire MirrorChrome tree), then ramps to identity.
 *   - Pure CSS / SVG — no canvas, no WebGL allocation. Throw-away once
 *     onDone fires.
 *
 * Reduced-motion: caller (LiquidPour gate in MirrorChrome) returns false
 * from shouldShowPour() under prefers-reduced-motion, so this component
 * never mounts in that case.
 */
export function LiquidPourOverlay({ onDone }: LiquidPourOverlayProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = performance.now()
    let rafId: number | null = null

    const tick = (now: number) => {
      const elapsed = now - start
      const t = Math.min(1, elapsed / DURATION_MS)
      setProgress(t)
      if (t < 1) {
        rafId = requestAnimationFrame(tick)
      } else {
        onDone()
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [onDone])

  const eased = easeInOutCubic(progress)

  // Turbulence baseFrequency: coarse (0.008 → big cells = "vapor") to fine
  // (0.078 → small cells = "near-solid"). Higher = denser particles.
  const baseFreq = 0.008 + eased * 0.07

  // Overlay opacity fades — fog dissipates as UI emerges.
  const opacity = 1 - eased

  // Backdrop blur ramps: UI is heavily blurred at start, sharpens to clear.
  // Saturation rises in parallel — UI "regains color" as it solidifies.
  const blurPx = (1 - eased) * 28
  const sat = 0.4 + eased * 0.6

  const overlayStyle: CSSProperties = {
    opacity,
    // CSS custom properties picked up by .mr-pour-overlay backdrop-filter
    ['--pour-blur' as unknown as string]: `${blurPx.toFixed(2)}px`,
    ['--pour-sat' as unknown as string]: sat.toFixed(3),
  }

  return (
    <div className="mr-pour-overlay" style={overlayStyle} aria-hidden="true">
      <svg
        className="mr-pour-svg"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
      >
        <defs>
          <filter id="mr-liquid-fog" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={baseFreq.toFixed(4)}
              numOctaves="2"
              seed="11"
            />
            {/* Map grayscale noise to BLACK with alpha 0.85 — particles
                read as dark vapor obscuring the UI underneath. */}
            <feColorMatrix
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0.85 0"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#mr-liquid-fog)" />
      </svg>
    </div>
  )
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
