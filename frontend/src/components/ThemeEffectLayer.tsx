import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme-context'
import { useReducedMotion } from '../use-reduced-motion'
import {
  createThemeEffect,
  hexToRgb,
  type ThemeEffectInstance,
  type ThemeEffectUniforms,
} from '../theme-effect-shader'
import { resolveSystemColorScheme } from '../theme-resolver'

/**
 * Mirror-theme background effect layer.
 *
 * Renders a fullscreen <canvas> that runs a viscous displacement shader
 * behind the app content. Active only when:
 *   - the user picked the "水面" (mirror) base profile, AND
 *   - reduced-motion is not in effect (user pref or system query).
 *
 * Reads live CSS variables (set by ThemeProvider via applyTheme) so the
 * shader stays in sync with whatever palette is active.
 *
 * Sits at z-index 0 with pointer-events: none under the app content
 * (z-index 1), per the spec §2.1 layering contract.
 */

const FADE_OUT_MS = 200

/**
 * Idle / active intensity targets. Per the mirror visual spec: luxury
 * materials don't perform unprompted — the shader runs near-silent
 * (intensity 0.4) when the mouse is still, then lifts to full (1.0)
 * for the duration of any pointer activity, decaying back when idle.
 */
// v5 amplitudes are already micro (ΔL* ≈ 5 max), so idle stays much
// closer to active than v4's 0.4↔1.0 spread. The shader never gets loud,
// so we don't need a dramatic ramp to keep it 克制.
const IDLE_INTENSITY = 0.72
const ACTIVE_INTENSITY = 1.0
const IDLE_TIMEOUT_MS = 1500
const INTENSITY_RAMP_MS = 600

/**
 * Read the active palette off the live CSS variables. The fallback values
 * are the canonical mirror tokens from the spec — they only matter when a
 * var is missing for some reason (defensive, never crashes the page).
 */
function readUniforms(intensity: number): ThemeEffectUniforms {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const dataTheme = root.dataset.theme
  const isLight = dataTheme === 'light'
  const bgVar = styles.getPropertyValue('--bg').trim() || (isLight ? '#E7E8EA' : '#111315')
  // Highlight source: dark mode wants a real silver streak (lighter than bg);
  // light mode wants a softer mid-grey trace (darker than bg). Pull from
  // tokens that already match those luminance roles in both palettes:
  //   dark:  --fg-2 ≈ #9CA3AF  (much lighter than #111315 → silver gleam)
  //   light: --hairline-strong ≈ #A8AEB4  (softer than #E7E8EA → trace)
  const highlightVar = isLight
    ? styles.getPropertyValue('--hairline-strong').trim() || '#A8AEB4'
    : styles.getPropertyValue('--fg-2').trim() || '#9CA3AF'
  return {
    bg: hexToRgb(bgVar),
    highlight: hexToRgb(highlightVar),
    isLight,
    intensity,
  }
}

export default function ThemeEffectLayer() {
  const { baseProfile, theme: colorScheme, activeThemeProfile } = useTheme()
  const reducedMotion = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<ThemeEffectInstance | null>(null)

  // Resolve `auto` colorScheme to the actual system preference so we can
  // reliably gate the shader: mirror + light substrates run no shader at
  // all (the wet-ceramic look is pure CSS). Without this, switching the
  // OS to light mode while colorScheme=auto would leave the shader
  // running on a light bg — calibrated wrong, looks bad.
  const [systemScheme, setSystemScheme] = useState<'dark' | 'light'>(() =>
    resolveSystemColorScheme(),
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const sync = () => setSystemScheme(media.matches ? 'light' : 'dark')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const effectiveScheme = colorScheme === 'auto' ? systemScheme : colorScheme
  const isLightMirror = baseProfile === 'mirror' && effectiveScheme === 'light'

  const wantActive = baseProfile === 'mirror' && !reducedMotion && !isLightMirror

  // `mounted` lags behind `wantActive` so we can run a fade-out before
  // unmounting the canvas. When wantActive flips true, mounted flips
  // immediately (so the canvas exists for createThemeEffect to grab).
  // When wantActive flips false, we keep mounted=true for FADE_OUT_MS,
  // ramp intensity to 0, then drop the canvas.
  const [mounted, setMounted] = useState(wantActive)
  // recreateNonce forces the WebGL instance to be torn down + recreated
  // (used after a webglcontextrestored event).
  const [recreateNonce, setRecreateNonce] = useState(0)

  useEffect(() => {
    if (wantActive) {
      setMounted(true)
      return
    }
    // Begin fade-out, then unmount.
    if (instanceRef.current) {
      instanceRef.current.setUniforms({ intensity: 0 })
    }
    const t = window.setTimeout(() => setMounted(false), FADE_OUT_MS)
    return () => window.clearTimeout(t)
  }, [wantActive])

  // (1) Mount / teardown the GL effect when canvas is mounted.
  useEffect(() => {
    if (!mounted) return
    const canvas = canvasRef.current
    if (!canvas) return

    // Hide canvas until shader inits successfully. Chromium paints the
    // uncleared WebGL canvas as opaque mid-gray when shader compile fails,
    // occluding the body bg gradient. WebKit defaults to transparent so
    // works either way; this makes both engines behave consistently on
    // the failure path. Opacity flips to 1 once createThemeEffect succeeds.
    canvas.style.opacity = '0'

    // Start at idle intensity — luxury default is "near-silent until
    // engaged". Activity tracking below ramps to ACTIVE_INTENSITY.
    const instance = createThemeEffect(canvas, readUniforms(IDLE_INTENSITY))
    if (!instance) return // WebGL/shader failed — body bg shows through.
    canvas.style.opacity = '1'
    instanceRef.current = instance

    // Spec §2.2 lifecycle: pause on tab hide, resume on visible.
    const onVisibility = () => {
      if (document.hidden) instance.pause()
      else instance.resume()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // ─── Activity-driven intensity gating ────────────────────────────
    // Per Opus reviewer's "克制 = 不主动表演" principle: shader runs at
    // IDLE_INTENSITY whenever the mouse is still; any movement ramps
    // ACTIVE_INTENSITY for INTENSITY_RAMP_MS, holds while activity
    // continues, then decays back after IDLE_TIMEOUT_MS of stillness.
    // ────────────────────────────────────────────────────────────────
    let intensity = IDLE_INTENSITY
    let target = IDLE_INTENSITY
    let lastActivityAt = 0
    let intensityRafId: number | null = null

    const tickIntensity = () => {
      // Decide target based on idle window.
      const idleFor = performance.now() - lastActivityAt
      target = idleFor < IDLE_TIMEOUT_MS ? ACTIVE_INTENSITY : IDLE_INTENSITY
      // Linear ramp toward target. Frame delta is implicit (capped to ~16ms
      // at 60fps); INTENSITY_RAMP_MS controls how fast we cover the
      // [IDLE..ACTIVE] range. The arithmetic is cheap so we don't bother
      // computing real elapsed time.
      const step = (ACTIVE_INTENSITY - IDLE_INTENSITY) * (16 / INTENSITY_RAMP_MS)
      if (intensity < target) intensity = Math.min(target, intensity + step)
      else if (intensity > target) intensity = Math.max(target, intensity - step)
      instance.setUniforms({ intensity })
      intensityRafId = requestAnimationFrame(tickIntensity)
    }
    intensityRafId = requestAnimationFrame(tickIntensity)

    const markActive = () => {
      lastActivityAt = performance.now()
    }

    // Mouse tracking. Strength fades smoothly when the cursor leaves the
    // window so the attractor decays instead of snapping to zero (Codex C).
    const onMouseMove = (event: MouseEvent) => {
      instance.setMouse(event.clientX, event.clientY, 1)
      markActive()
    }
    const onMouseLeave = (event: MouseEvent) => {
      instance.setMouse(event.clientX, event.clientY, 0)
      // Don't markActive here — leaving the window should let intensity
      // decay back to idle, since the user has clearly turned away.
    }
    const onMouseDown = () => markActive()
    const onKeyDown = () => markActive()
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)

    // Spec §2.2: webglcontextrestored should bring the effect back.
    const offRestored = instance.onContextRestored(() => {
      setRecreateNonce((n) => n + 1)
    })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
      if (intensityRafId !== null) cancelAnimationFrame(intensityRafId)
      offRestored()
      instance.destroy()
      instanceRef.current = null
    }
  }, [mounted, recreateNonce])

  // (2) Sync palette colors when the active palette changes. Intensity
  // is owned by the activity-gating loop above, so we only push bg /
  // highlight / isLight here — leaving intensity untouched.
  useEffect(() => {
    if (!instanceRef.current) return
    if (!wantActive) return // Avoid clobbering the fade-out intensity=0.
    const next = readUniforms(IDLE_INTENSITY)
    instanceRef.current.setUniforms({
      bg: next.bg,
      highlight: next.highlight,
      isLight: next.isLight,
    })
  }, [wantActive, colorScheme, activeThemeProfile?.id])

  if (!mounted) return null
  return <canvas ref={canvasRef} className="theme-effect-layer" aria-hidden="true" />
}
