import type {
  AppearanceReviewIssue,
  AppearanceReviewReport,
  ThemeCoreTokenName,
  ThemeCoreTokenSet,
  ThemeMode,
  ThemeSafetyLevel,
  ThemeScope,
  ThemeSpec,
  ThemeTokenSet,
} from './appearance.types.js'

export const THEME_CORE_TOKEN_NAMES: ThemeCoreTokenName[] = [
  'bg',
  'surface',
  'fg',
  'accent',
  'success',
  'danger',
]

const THEME_SPEC_KEYS = new Set([
  'schemaVersion',
  'name',
  'mode',
  'scope',
  'safetyLevel',
  'coreTokens',
  'tokens',
  'review',
])
const THEME_SCOPES = new Set<ThemeScope>(['chat', 'workspace', 'brief', 'all'])
const THEME_MODES = new Set<ThemeMode>(['dark', 'light'])

type Rgba = {
  r: number
  g: number
  b: number
  a: number
}

function issue(
  code: string,
  path: string,
  message: string,
  suggestedFix: string,
): AppearanceReviewIssue {
  return { code, path, message, suggestedFix }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unknownKeyIssues(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
) {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) =>
      issue(
        'unknown-field',
        `${path}.${key}`,
        'Theme JSON 只允许受控字段，不能携带 raw CSS、selector、背景图或布局字段。',
        '删除该字段，首版只导入 name/mode/scope/coreTokens。',
      ),
    )
}

function clamp255(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255)
}

function parseHexColor(value: string): Rgba | null {
  const hex = value.slice(1)
  if (![3, 4, 6, 8].includes(hex.length)) return null
  const expand = (part: string) => (part.length === 1 ? part + part : part)
  const parts =
    hex.length <= 4
      ? hex.split('').map(expand)
      : hex.length === 6
        ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8)]
  const [r, g, b, alpha = 255] = parts.map((part) => Number.parseInt(part, 16))
  if ([r, g, b, alpha].some((item) => Number.isNaN(item))) return null
  return { r, g, b, a: alpha / 255 }
}

function parseRgbColor(value: string): Rgba | null {
  const match = value.match(/^rgba?\((.+)\)$/i)
  if (!match) return null
  const parts = match[1].split(',').map((part) => part.trim())
  if (parts.length !== 3 && parts.length !== 4) return null
  const [r, g, b] = parts.slice(0, 3).map((part) => Number(part))
  const alpha = parts[3] === undefined ? 1 : Number(parts[3])
  if (![r, g, b, alpha].every(Number.isFinite)) return null
  if (alpha < 0 || alpha > 1) return null
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: alpha }
}

export function parseThemeColor(value: string): Rgba | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return parseHexColor(trimmed)
  if (/^rgba?\(/i.test(trimmed)) return parseRgbColor(trimmed)
  return null
}

function toRgbaString(color: Rgba, alpha = color.a) {
  return `rgba(${clamp255(color.r)}, ${clamp255(color.g)}, ${clamp255(color.b)}, ${Math.min(Math.max(alpha, 0), 1).toFixed(3)})`
}

function toHex(color: Rgba) {
  const part = (value: number) => clamp255(value).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function mix(a: Rgba, b: Rgba, amount: number): Rgba {
  const t = Math.min(Math.max(amount, 0), 1)
  return {
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t,
    a: 1,
  }
}

function blendOver(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a + background.a * (1 - foreground.a)
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
    a,
  }
}

function channelLuminance(value: number) {
  const normalized = value / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function relativeLuminance(color: Rgba) {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  )
}

function colorSaturation(color: Rgba) {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const lightness = (max + min) / 2
  return (max - min) / (1 - Math.abs(2 * lightness - 1))
}

export function contrastRatio(foreground: Rgba, background: Rgba) {
  const l1 = relativeLuminance(foreground)
  const l2 = relativeLuminance(background)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastIssue(
  foregroundPath: string,
  backgroundPath: string,
  ratio: number,
  minimum: number,
) {
  return issue(
    'contrast-too-low',
    `${foregroundPath}:${backgroundPath}`,
    `颜色对比度 ${ratio.toFixed(2)} 低于最低要求 ${minimum.toFixed(1)}。`,
    `调整 ${foregroundPath} 或 ${backgroundPath}，确保文字、强调色或语义色在固定预览里可读。`,
  )
}

function normalizeCoreTokens(
  input: unknown,
  issues: AppearanceReviewIssue[],
): { coreTokens: ThemeCoreTokenSet; parsed: Record<ThemeCoreTokenName, Rgba | null> } {
  const coreTokens = {} as ThemeCoreTokenSet
  const parsed = {} as Record<ThemeCoreTokenName, Rgba | null>

  if (!isPlainObject(input)) {
    issues.push(issue('invalid-core-tokens', 'coreTokens', 'coreTokens 必须是对象。', '导入 JSON 时只提供受控 coreTokens。'))
    for (const name of THEME_CORE_TOKEN_NAMES) {
      coreTokens[name] = ''
      parsed[name] = null
    }
    return { coreTokens, parsed }
  }

  issues.push(...unknownKeyIssues(input, new Set(THEME_CORE_TOKEN_NAMES), 'coreTokens'))
  for (const name of THEME_CORE_TOKEN_NAMES) {
    const value = input[name]
    if (typeof value !== 'string' || !value.trim()) {
      issues.push(issue('missing-core-token', `coreTokens.${name}`, `缺少 core token：${name}。`, '补齐 bg/surface/fg/accent/success/danger。'))
      coreTokens[name] = ''
      parsed[name] = null
      continue
    }
    const trimmed = value.trim()
    const color = parseThemeColor(trimmed)
    coreTokens[name] = trimmed
    parsed[name] = color
    if (!color) {
      issues.push(issue('invalid-color', `coreTokens.${name}`, `${name} 不是合法颜色。`, '使用 hex、rgb 或 rgba 颜色，不要使用 CSS 变量、函数或任意 CSS。'))
    } else if (color.a < 0.99) {
      issues.push(issue('transparent-core-token', `coreTokens.${name}`, `${name} 不能使用透明色。`, '首版 core token 必须是纯色，透明度由 derived token 生成。'))
    }
  }

  return { coreTokens, parsed }
}

function deriveTokens(core: Record<ThemeCoreTokenName, Rgba>): ThemeTokenSet {
  const { bg, surface, fg, accent, success, danger } = core
  return {
    bg: toHex(bg),
    surface: toHex(surface),
    fg: toHex(fg),
    accent: toHex(accent),
    success: toHex(success),
    danger: toHex(danger),
    bgGrad1: toHex(mix(bg, surface, 0.22)),
    bgGrad2: toHex(bg),
    surface0: toRgbaString(surface, 0.03),
    surface1: toRgbaString(surface, 0.07),
    surface2: toRgbaString(surface, 0.1),
    surface3: toRgbaString(surface, 0.14),
    surfaceHover: toRgbaString(surface, 0.09),
    hairline: toRgbaString(fg, 0.08),
    hairline2: toRgbaString(fg, 0.14),
    hairlineStrong: toRgbaString(fg, 0.22),
    fg2: toHex(mix(fg, bg, 0.18)),
    fg3: toHex(mix(fg, bg, 0.42)),
    fg4: toHex(mix(fg, bg, 0.62)),
    accent2: toHex(mix(accent, fg, 0.22)),
    accentSoft: toRgbaString(accent, 0.14),
    accentRing: toRgbaString(accent, 0.34),
  }
}

function safetyLevelFor(
  blockingIssues: readonly AppearanceReviewIssue[],
  warnings: readonly AppearanceReviewIssue[],
): ThemeSafetyLevel {
  if (blockingIssues.length > 0) return 'rejected'
  if (warnings.length > 0) return 'experimental'
  return 'safe'
}

export function normalizeAndReviewThemeSpec(input: unknown): {
  theme: ThemeSpec | null
  review: AppearanceReviewReport
} {
  const blockingIssues: AppearanceReviewIssue[] = []
  const warnings: AppearanceReviewIssue[] = []

  if (!isPlainObject(input)) {
    blockingIssues.push(issue('invalid-theme', 'theme', 'Theme JSON 必须是对象。', '提供受控 Theme JSON 对象。'))
    return {
      theme: null,
      review: { passed: false, safetyLevel: 'rejected', blockingIssues, warnings },
    }
  }

  blockingIssues.push(...unknownKeyIssues(input, THEME_SPEC_KEYS, 'theme'))
  if ('background' in input) {
    blockingIssues.push(issue('background-not-supported', 'theme.background', '首版不支持背景图或背景配置。', '删除 background；如果需要图片风格，后续只用于 palette 提取，不直接当 UI 背景。'))
  }

  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim().slice(0, 80)
      : 'Untitled Theme'
  const mode = THEME_MODES.has(input.mode as ThemeMode) ? (input.mode as ThemeMode) : 'dark'
  const scope = THEME_SCOPES.has(input.scope as ThemeScope)
    ? (input.scope as ThemeScope)
    : 'workspace'
  const { coreTokens, parsed } = normalizeCoreTokens(input.coreTokens, blockingIssues)

  const completeParsed = Object.values(parsed).every(Boolean)
  const tokens = completeParsed
    ? deriveTokens(parsed as Record<ThemeCoreTokenName, Rgba>)
    : ({
        ...coreTokens,
        bgGrad1: '',
        bgGrad2: '',
        surface0: '',
        surface1: '',
        surface2: '',
        surface3: '',
        surfaceHover: '',
        hairline: '',
        hairline2: '',
        hairlineStrong: '',
        fg2: '',
        fg3: '',
        fg4: '',
        accent2: '',
        accentSoft: '',
        accentRing: '',
      } as ThemeTokenSet)

  if (completeParsed) {
    const bg = parsed.bg as Rgba
    const surface1 = blendOver(parseThemeColor(tokens.surface1) as Rgba, bg)
    const fg = parsed.fg as Rgba
    const accent = parsed.accent as Rgba
    const success = parsed.success as Rgba
    const danger = parsed.danger as Rgba
    const fg2 = parseThemeColor(tokens.fg2) as Rgba

    if (contrastRatio(fg, bg) < 4.5) {
      blockingIssues.push(contrastIssue('coreTokens.fg', 'coreTokens.bg', contrastRatio(fg, bg), 4.5))
    }
    if (contrastRatio(fg, surface1) < 4.5) {
      blockingIssues.push(
        contrastIssue('coreTokens.fg', 'derived.surface1', contrastRatio(fg, surface1), 4.5),
      )
    }
    if (contrastRatio(fg2, surface1) < 3) {
      blockingIssues.push(contrastIssue('derived.fg2', 'derived.surface1', contrastRatio(fg2, surface1), 3))
    }
    if (contrastRatio(accent, surface1) < 3) {
      blockingIssues.push(
        contrastIssue('coreTokens.accent', 'derived.surface1', contrastRatio(accent, surface1), 3),
      )
    }
    if (contrastRatio(success, surface1) < 3) {
      blockingIssues.push(
        contrastIssue('coreTokens.success', 'derived.surface1', contrastRatio(success, surface1), 3),
      )
    }
    if (contrastRatio(danger, surface1) < 3) {
      blockingIssues.push(
        contrastIssue('coreTokens.danger', 'derived.surface1', contrastRatio(danger, surface1), 3),
      )
    }

    for (const [path, color] of [
      ['coreTokens.accent', accent],
      ['coreTokens.success', success],
      ['coreTokens.danger', danger],
    ] as const) {
      if (colorSaturation(color) > 0.96) {
        warnings.push(
          issue(
            'strong-style-token',
            path,
            '颜色饱和度过高，属于强风格主题，需要更严格确认后应用。',
            '降低饱和度，或作为 experimental 主题走二次确认。',
          ),
        )
      }
    }
  }

  const safetyLevel = safetyLevelFor(blockingIssues, warnings)
  const theme: ThemeSpec = {
    schemaVersion: 1,
    name,
    mode,
    scope,
    safetyLevel,
    coreTokens,
    tokens,
  }

  return {
    theme,
    review: {
      passed: safetyLevel !== 'rejected',
      safetyLevel,
      blockingIssues,
      warnings,
    },
  }
}
