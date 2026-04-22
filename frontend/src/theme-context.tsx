import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { SettingsApi } from './api/settings'
import { applyTheme, type ThemeMode } from './theme'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('dark')

  useEffect(() => {
    SettingsApi.get()
      .then((s) => setTheme(s.appearance.theme))
      .catch(() => setTheme('dark'))
  }, [])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'auto') return

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const sync = () => applyTheme('auto')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
