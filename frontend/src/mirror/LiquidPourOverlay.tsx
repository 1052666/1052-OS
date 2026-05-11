import { useEffect, useState, type CSSProperties } from 'react'

const DURATION_MS = 1500

interface LiquidPourOverlayProps {
  onDone: () => void
}

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

  // Cubic bezier for "ease-out-in" pour feel (matches 0.4, 0, 0.2, 1).
  const eased = easeInOutCubic(progress)
  const radius = eased * 130 // 0% → 130% to overshoot edges

  const maskStyle: CSSProperties = {
    WebkitMaskImage: `radial-gradient(circle at 50% 50%, black ${radius}%, transparent ${radius + 8}%)`,
    maskImage: `radial-gradient(circle at 50% 50%, black ${radius}%, transparent ${radius + 8}%)`,
  }

  return (
    <div className="mr-pour-overlay" style={maskStyle} aria-hidden="true">
      <div className="mr-pour-fill" />
    </div>
  )
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
