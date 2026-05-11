import { useEffect, useState, type CSSProperties } from 'react'

const DURATION_MS = 1200

interface LiquidPourOverlayProps {
  onDone: () => void
}

/**
 * Mirror profile entry animation — "墨滴归心" (ink drops converging).
 *
 * Visual: at t=0 four soft dark ink drops sit at the corners. They drift
 * inward on independent eased arcs, overlap at center, shrink, fade.
 *
 * No backdrop-filter, no UI occlusion — the mirror UI is fully visible
 * underneath from frame 1. The blobs are *decorative shadows* on the
 * mirror surface, not a curtain blocking it.
 *
 * Reduced-motion: caller skips mount via shouldShowPour().
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

  // Each blob runs its own phased ease so the 4 arrive offset, not in
  // synchronized rigid-body motion. Sizes shrink as they meet center.
  const blobs = BLOB_SEEDS.map((b) => {
    const localT = easeInOutCubic(Math.min(1, Math.max(0, (progress - b.phase) / (1 - b.phase))))
    const x = lerp(b.x0, 50, localT)
    const y = lerp(b.y0, 50, localT)
    const size = lerp(b.size0, 12, localT)
    // Each blob also dims as it converges so the merged center stays soft.
    const alphaScale = 1 - localT * 0.4
    return { x, y, size, baseAlpha: b.baseAlpha * alphaScale }
  })

  // Overall overlay opacity: hold until 65% then fade over remaining 35%.
  const veilOpacity = progress < 0.65 ? 1 : Math.max(0, 1 - (progress - 0.65) / 0.35)

  const overlayStyle: CSSProperties = {
    opacity: veilOpacity,
  }

  return (
    <div className="mr-pour-overlay" style={overlayStyle} aria-hidden="true">
      {blobs.map((b, i) => (
        <div
          key={i}
          className="mr-pour-blob"
          style={{
            left: `${b.x.toFixed(2)}%`,
            top: `${b.y.toFixed(2)}%`,
            width: `${b.size.toFixed(2)}vmax`,
            height: `${b.size.toFixed(2)}vmax`,
            background: `radial-gradient(circle, rgba(6,8,10,${b.baseAlpha.toFixed(3)}) 0%, rgba(6,8,10,${(b.baseAlpha * 0.55).toFixed(3)}) 35%, transparent 70%)`,
          }}
        />
      ))}
    </div>
  )
}

interface BlobSeed {
  x0: number
  y0: number
  size0: number
  /** Phase offset 0..0.3 — blob doesn't start moving until t > phase. */
  phase: number
  /** Starting alpha of the gradient center. */
  baseAlpha: number
}

const BLOB_SEEDS: BlobSeed[] = [
  { x0: 18, y0: 26, size0: 38, phase: 0.0,  baseAlpha: 0.62 },
  { x0: 86, y0: 20, size0: 32, phase: 0.05, baseAlpha: 0.55 },
  { x0: 14, y0: 78, size0: 42, phase: 0.10, baseAlpha: 0.58 },
  { x0: 82, y0: 84, size0: 30, phase: 0.08, baseAlpha: 0.52 },
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
