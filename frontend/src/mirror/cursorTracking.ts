interface Point { x: number; y: number }
interface Center { cx: number; cy: number }

export function computeAngle(p: Point, center: Center): number {
  const rad = Math.atan2(p.y - center.cy, p.x - center.cx)
  return rad * 180 / Math.PI
}

export function attachCursorTracking(): () => void {
  const mq = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
  if (mq?.matches) return () => {}

  let rafId: number | null = null
  let idleTimer: number | null = null
  let lastPoint: Point | null = null

  function update() {
    rafId = null
    if (!lastPoint) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const angle = computeAngle(lastPoint, { cx, cy })
    document.documentElement.style.setProperty('--mr-cursor-angle', `${angle}deg`)
  }

  function onMove(e: MouseEvent) {
    lastPoint = { x: e.clientX, y: e.clientY }
    if (rafId == null) rafId = requestAnimationFrame(update)
    if (idleTimer != null) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      document.documentElement.style.removeProperty('--mr-cursor-angle')
      idleTimer = null
    }, 3000)
  }

  window.addEventListener('mousemove', onMove, { passive: true })
  return () => {
    window.removeEventListener('mousemove', onMove)
    if (rafId != null) cancelAnimationFrame(rafId)
    if (idleTimer != null) window.clearTimeout(idleTimer)
    document.documentElement.style.removeProperty('--mr-cursor-angle')
  }
}
