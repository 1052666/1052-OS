import type { ThemeSpec } from './api/appearance'

export type ThemeMode = 'dark' | 'light' | 'auto'

const THEME_VAR_MAP: Record<keyof ThemeSpec['tokens'], string> = {
  bg: '--bg',
  surface: '--surface-theme-core',
  fg: '--fg',
  accent: '--accent',
  success: '--success',
  danger: '--danger',
  bgGrad1: '--bg-grad-1',
  bgGrad2: '--bg-grad-2',
  surface0: '--surface-0',
  surface1: '--surface-1',
  surface2: '--surface-2',
  surface3: '--surface-3',
  surfaceHover: '--surface-hover',
  hairline: '--hairline',
  hairline2: '--hairline-2',
  hairlineStrong: '--hairline-strong',
  fg2: '--fg-2',
  fg3: '--fg-3',
  fg4: '--fg-4',
  accent2: '--accent-2',
  accentSoft: '--accent-soft',
  accentRing: '--accent-ring',
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function clearCustomThemeVariables() {
  const root = document.documentElement
  for (const cssVar of Object.values(THEME_VAR_MAP)) root.style.removeProperty(cssVar)
  root.style.removeProperty('--accent-glow')
  root.removeAttribute('data-custom-theme')
}

function applyCustomThemeVariables(theme: ThemeSpec) {
  const root = document.documentElement
  root.dataset.theme = theme.mode
  root.dataset.customTheme = 'true'
  for (const [token, cssVar] of Object.entries(THEME_VAR_MAP)) {
    root.style.setProperty(cssVar, theme.tokens[token as keyof ThemeSpec['tokens']])
  }
  root.style.setProperty('--accent-glow', `0 10px 40px -10px ${theme.tokens.accentRing}`)
}

export function applyTheme(mode: ThemeMode, customTheme?: ThemeSpec | null) {
  if (customTheme) {
    applyCustomThemeVariables(customTheme)
    return
  }
  clearCustomThemeVariables()
  document.documentElement.dataset.theme = resolveTheme(mode)
}
