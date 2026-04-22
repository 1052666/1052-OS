export type ThemeMode = 'dark' | 'light' | 'auto'

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode)
}
