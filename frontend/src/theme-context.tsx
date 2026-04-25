import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AppearanceApi, type AppearanceThemeProfile } from './api/appearance'
import { SettingsApi } from './api/settings'
import { applyTheme, type ThemeMode } from './theme'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  activeThemeProfile: AppearanceThemeProfile | null
  refreshAppearanceTheme: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applicableThemeProfile(profile: AppearanceThemeProfile | null) {
  return profile && profile.review.safetyLevel !== 'rejected' ? profile : null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const [activeThemeProfile, setActiveThemeProfile] = useState<AppearanceThemeProfile | null>(null)

  const refreshAppearanceTheme = useCallback(async () => {
    const themes = await AppearanceApi.listThemes()
    setActiveThemeProfile(applicableThemeProfile(themes.activeProfile))
  }, [])

  useEffect(() => {
    Promise.all([SettingsApi.get(), AppearanceApi.listThemes()])
      .then(([settings, themes]) => {
        setTheme(settings.appearance.theme)
        setActiveThemeProfile(applicableThemeProfile(themes.activeProfile))
      })
      .catch(() => setTheme('dark'))
  }, [])

  useEffect(() => {
    applyTheme(theme, activeThemeProfile?.theme)
    if (theme !== 'auto' || activeThemeProfile) return

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const sync = () => applyTheme('auto')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme, activeThemeProfile])

  const value = useMemo(
    () => ({ theme, setTheme, activeThemeProfile, refreshAppearanceTheme }),
    [theme, activeThemeProfile, refreshAppearanceTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
