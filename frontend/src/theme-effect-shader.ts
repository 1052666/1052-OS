/**
 * Liquid graphite / silk mirror displacement shader.
 *
 * Renders a single fullscreen quad with a fragment shader that:
 *   - blends multiple octaves of value noise into a slow-moving displacement
 *     field (the "silk fold")
 *   - lifts a tiny specular highlight along the displacement gradient
 *   - adds an exponential mouse attractor for local distortion (hover damping)
 *
 * No DOM dependencies; pure WebGL. The React lifecycle wrapper lives in
 * ThemeEffectLayer.tsx and decides when to instantiate this.
 *
 * Design language: graphite mirror / wet silk / smoked chrome — see
 * the project-internal mirror visual spec. Specular intensity is held very
 * low (≤0.15) to keep the "克制 + 不吵" feel.
 */

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouse;          // normalized 0..1 (0,0 = bottom-left)
  uniform float uMouseStrength;  // 0..1, fades when mouse leaves window
  uniform vec3  uBg;             // base background, linear-ish rgb
  uniform vec3  uHighlight;      // specular tint
  uniform float uIsLight;        // 0.0 = dark theme, 1.0 = light theme
  uniform float uIntensity;      // overall opacity / amplitude scale

  // ---- Noise primitives ----
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // 3-octave fbm (one octave fewer than v1 — performance + the silk
  // signal we want is in the lower frequencies, micro grain was noise).
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.6;
    for (int i = 0; i < 3; i++) {
      v += amp * noise(p);
      p = p * 2.07 + vec2(13.0, 7.0);
      amp *= 0.5;
    }
    return v;
  }

  // ---- v5: low-contrast vertical wet silk ----
  //
  // v2-v4 all tried to draw a "feature" (sweep band, rim, hollow-tube).
  // User feedback after v4 + Opus reviewer's diagnosis converged on the
  // same point: a luxury liquid-graphite surface should have NO drawable
  // feature. ΔL* < 4. No edges. No band. The screen should look like a
  // single subtly-modulated wet sheet that "feels like it could move"
  // even when paused.
  //
  // v5 abandons feature rendering entirely:
  //   - vertical luminance falloff (顶亮底暗) — the dominant signal
  //   - two layers of long horizontal silk noise — slow drift, anisotropic
  //   - per-pixel film grain (~1.2% amplitude) — kills banding, gives skin
  //   - mouse halo — only on top of all this, very subtle
  //   - field amplitude clamped to ~0.05 of bg-to-highlight range
  //
  // The shader now contributes a max ΔL* ≈ 5 (matches Opus's Porsche
  // reference), so it never overpowers the CSS chain that does the
  // actual material work (backdrop-filter on the cards).

  // 2D rotation matrix.
  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  // Anisotropic noise — stretch the sample lattice so noise cells become
  // long horizontal threads. dirAngle rotates the stretch axis.
  float silkNoise(vec2 p, float dirAngle, float stretchAlong) {
    vec2 q = rot(-dirAngle) * p;
    q.x /= stretchAlong;
    return fbm(q);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;

    // Aspect-correct so silk threads don't squash on wide screens.
    vec2 aspect = uv;
    aspect.x *= uResolution.x / uResolution.y;
    float t = uTime;

    // (a) Vertical luminance falloff — strong enough to be the visible
    // backbone of the surface. v7 raises this so the top→bottom gradient
    // reads even before any silk layer is noticed.
    float vertical = smoothstep(0.0, 1.0, uv.y) * 0.055;

    // (b) Three slow silk layers at different anisotropic scales.
    // Amplitudes raised ~60% over v6 so the woven satin texture is
    // actually visible rather than hovering at ΔL*≈2.
    float silkA = silkNoise(aspect * 1.18 + vec2(t * 0.022, sin(t * 0.031) * 0.035), -0.08, 18.0);
    float silkB = silkNoise(aspect * 0.66 + vec2(sin(t * 0.026) * 0.11, t * 0.009),  0.05, 24.0);
    float satin = silkNoise(aspect * 0.42 + vec2(t * 0.006, -t * 0.004),             -0.18, 32.0);

    float wet = (silkA - 0.5) * 0.048
              + (silkB - 0.5) * 0.042
              + (satin - 0.5) * 0.058;

    // (c) Broad sheen — a sweeping cross-screen highlight band. Amplitude
    // 0.030 → 0.055 so the slow sliding light reads as the "光在丝绸上
    // 滑动" effect the visual spec asks for.
    float broadSheen = smoothstep(0.18, 0.92, uv.y)
                     * (0.55 + 0.45 * sin((uv.x * 1.7 + uv.y * 0.65) + t * 0.055))
                     * 0.055;

    // (d) Film grain — kept low so it doesn't read as TV noise.
    float grain = (hash(gl_FragCoord.xy + floor(t * 8.0)) - 0.5) * 0.010;

    // (e) Mouse halo — separate channel that can push past the ambient
    // clamp. Ambient field is the "still material" layer; halo is the
    // "you touched it" reply.
    vec2 mouseAspect = uMouse;
    mouseAspect.x *= uResolution.x / uResolution.y;
    float mouseDist = distance(aspect, mouseAspect);
    float mouseHalo = exp(-mouseDist * 6.0) * uMouseStrength * 0.22;

    // Ambient (everything except mouse halo). v7 clamp ±0.16 (v6 was
    // ±0.095) so the satin layer can contribute its full character
    // without being clipped to invisibility on most fragments.
    float ambient = vertical + wet + broadSheen + grain;

    // Mirror is dark-only as of v3, so the uIsLight branch here only
    // matters for any user that previously had mirror-light persisted
    // and hasn't reset yet — keeps the surface from looking inverted.
    float ambientAmount = (uIsLight > 0.5) ? -ambient : ambient;
    ambientAmount = clamp(ambientAmount, -0.16, 0.16);

    // Mouse halo polarity-matched, own clamp.
    float haloAmount = (uIsLight > 0.5) ? -mouseHalo : mouseHalo;
    haloAmount = clamp(haloAmount, -0.22, 0.22);

    float amount = clamp(ambientAmount + haloAmount, -0.34, 0.34);

    // Apply via mix so the highlight color always controls the direction
    // of luminance shift — never blow past the bg or highlight clamp.
    vec3 color = mix(uBg, uHighlight, max(amount, 0.0))
               + (uBg - uHighlight) * max(-amount, 0.0);

    // uIntensity multiplies the alpha so the React layer can fade in/out.
    // Inside-shader contribution is full strength regardless of uIntensity
    // since we already work in micro-amplitudes.
    gl_FragColor = vec4(color, uIntensity);
  }
`

type GLContext = WebGLRenderingContext

function compileShader(gl: GLContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error: ${info}`)
  }
  return shader
}

function linkProgram(gl: GLContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create program')
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link error: ${info}`)
  }
  return program
}

export type ThemeEffectUniforms = {
  bg: [number, number, number]
  highlight: [number, number, number]
  isLight: boolean
  intensity: number
}

export type ThemeEffectInstance = {
  /** Update colors / intensity at any time; cheap. */
  setUniforms: (next: Partial<ThemeEffectUniforms>) => void
  /** Update mouse position in CSS pixels relative to the canvas viewport. */
  setMouse: (x: number, y: number, strength: number) => void
  /** Pause the RAF (used on visibilitychange). */
  pause: () => void
  /** Resume the RAF after pause. */
  resume: () => void
  /** Tear down the GL context, listeners, and RAF. */
  destroy: () => void
  /**
   * True after a `webglcontextlost` event fires. The React wrapper polls
   * this (or listens via the onContextLost callback below) so it can
   * destroy + recreate the instance once the context restores. Spec §2.2
   * requires automatic recovery, not silent half-pause.
   */
  isLost: () => boolean
  /** Subscribe to context lost events; returns an unsubscribe function. */
  onContextLost: (handler: () => void) => () => void
  /** Subscribe to context restored events; returns an unsubscribe function. */
  onContextRestored: (handler: () => void) => () => void
}

/**
 * Hex color (#rrggbb) → linear-ish [r,g,b] in [0,1]. Strict: returns [0,0,0]
 * on parse failure rather than throwing, so a stray invalid token never
 * blows up the canvas at runtime.
 */
export function hexToRgb(hex: string): [number, number, number] {
  const trimmed = hex.trim().replace(/^#/, '')
  if (trimmed.length !== 6) return [0, 0, 0]
  const r = parseInt(trimmed.slice(0, 2), 16)
  const g = parseInt(trimmed.slice(2, 4), 16)
  const b = parseInt(trimmed.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0, 0, 0]
  return [r / 255, g / 255, b / 255]
}

/**
 * Mount a viscous-displacement effect on the given canvas. Returns null when
 * WebGL is unavailable so the caller can fall back to a static gradient.
 */
export function createThemeEffect(
  canvas: HTMLCanvasElement,
  initial: ThemeEffectUniforms,
): ThemeEffectInstance | null {
  const ctx = canvas.getContext('webgl', {
    premultipliedAlpha: false,
    antialias: false,
    powerPreference: 'low-power',
  }) as GLContext | null
  if (!ctx) return null
  const gl: GLContext = ctx

  let program: WebGLProgram
  try {
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    program = linkProgram(gl, vert, frag)
    gl.deleteShader(vert)
    gl.deleteShader(frag)
  } catch (err) {
    // Compile/link failed (e.g. driver blacklist) — caller falls back.
    console.warn('[theme-effect-shader] init failed:', err)
    return null
  }

  // Fullscreen quad: two triangles covering NDC [-1,1].
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )

  const positionLoc = gl.getAttribLocation(program, 'aPosition')
  const uTime = gl.getUniformLocation(program, 'uTime')
  const uResolution = gl.getUniformLocation(program, 'uResolution')
  const uMouse = gl.getUniformLocation(program, 'uMouse')
  const uMouseStrength = gl.getUniformLocation(program, 'uMouseStrength')
  const uBg = gl.getUniformLocation(program, 'uBg')
  const uHighlight = gl.getUniformLocation(program, 'uHighlight')
  const uIsLight = gl.getUniformLocation(program, 'uIsLight')
  const uIntensity = gl.getUniformLocation(program, 'uIntensity')

  let uniforms: ThemeEffectUniforms = { ...initial }
  let mouseX = 0.5
  let mouseY = 0.5
  let mouseStrength = 0
  const startTime = performance.now()
  let rafId: number | null = null
  let paused = false
  let destroyed = false

  function resize() {
    if (destroyed) return
    const dpr = Math.min(window.devicePixelRatio ?? 1, 1.5) // DPR cap per spec §3.3
    const w = canvas.clientWidth * dpr
    const h = canvas.clientHeight * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  function frame() {
    if (destroyed || paused) return
    rafId = requestAnimationFrame(frame)
    resize()

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    gl.uniform1f(uTime, (performance.now() - startTime) / 1000)
    gl.uniform2f(uResolution, canvas.width, canvas.height)
    gl.uniform2f(uMouse, mouseX, mouseY)
    gl.uniform1f(uMouseStrength, mouseStrength)
    gl.uniform3f(uBg, uniforms.bg[0], uniforms.bg[1], uniforms.bg[2])
    gl.uniform3f(uHighlight, uniforms.highlight[0], uniforms.highlight[1], uniforms.highlight[2])
    gl.uniform1f(uIsLight, uniforms.isLight ? 1 : 0)
    gl.uniform1f(uIntensity, uniforms.intensity)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  // WebGL context lost / restored handling. Spec §2.2 wants automatic
  // recovery rather than silent half-pause: we record the lost flag,
  // notify subscribers, and let the React wrapper trigger a destroy +
  // recreate. preventDefault() lets the browser surface the
  // restored event later.
  let lost = false
  const lostListeners = new Set<() => void>()
  const restoredListeners = new Set<() => void>()
  const handleContextLost = (event: Event) => {
    event.preventDefault()
    lost = true
    paused = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    for (const fn of lostListeners) fn()
  }
  const handleContextRestored = () => {
    // We don't auto-recreate here because shader programs / buffers tied
    // to the old context are gone. Notify the wrapper so it can mount a
    // fresh instance on a clean canvas.
    for (const fn of restoredListeners) fn()
  }
  canvas.addEventListener('webglcontextlost', handleContextLost, false)
  canvas.addEventListener('webglcontextrestored', handleContextRestored, false)

  rafId = requestAnimationFrame(frame)

  return {
    setUniforms(next) {
      uniforms = { ...uniforms, ...next }
    },
    setMouse(cssX, cssY, strength) {
      // CSS coords → normalized 0..1 with bottom-left origin (GL convention).
      const rect = canvas.getBoundingClientRect()
      mouseX = rect.width > 0 ? cssX / rect.width : 0.5
      mouseY = rect.height > 0 ? 1 - cssY / rect.height : 0.5
      mouseStrength = Math.max(0, Math.min(1, strength))
    },
    pause() {
      paused = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
    },
    resume() {
      if (destroyed || !paused) return
      paused = false
      rafId = requestAnimationFrame(frame)
    },
    destroy() {
      destroyed = true
      paused = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      lostListeners.clear()
      restoredListeners.clear()
      if (!lost) {
        // Don't poke a lost context — these calls would warn in the console.
        gl.deleteBuffer(buffer)
        gl.deleteProgram(program)
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
      }
    },
    isLost() {
      return lost
    },
    onContextLost(handler) {
      lostListeners.add(handler)
      return () => lostListeners.delete(handler)
    },
    onContextRestored(handler) {
      restoredListeners.add(handler)
      return () => restoredListeners.delete(handler)
    },
  }
}
