import { api } from './client'

export type ThemeScope = 'chat' | 'workspace' | 'brief' | 'all'
export type ThemeMode = 'dark' | 'light'
export type ThemeSafetyLevel = 'safe' | 'experimental' | 'rejected'

export type ThemeCoreTokenSet = {
  bg: string
  surface: string
  fg: string
  accent: string
  success: string
  danger: string
}

export type ThemeTokenSet = ThemeCoreTokenSet & {
  bgGrad1: string
  bgGrad2: string
  surface0: string
  surface1: string
  surface2: string
  surface3: string
  surfaceHover: string
  hairline: string
  hairline2: string
  hairlineStrong: string
  fg2: string
  fg3: string
  fg4: string
  accent2: string
  accentSoft: string
  accentRing: string
}

export type ThemeSpec = {
  schemaVersion: 1
  name: string
  mode: ThemeMode
  scope: ThemeScope
  safetyLevel: ThemeSafetyLevel
  coreTokens: ThemeCoreTokenSet
  tokens: ThemeTokenSet
}

export type ThemeImportSpec = {
  schemaVersion?: 1
  name: string
  mode: ThemeMode
  scope: ThemeScope
  coreTokens: ThemeCoreTokenSet
}

export type AppearanceReviewIssue = {
  code: string
  path: string
  message: string
  suggestedFix: string
}

export type AppearanceReviewReport = {
  passed: boolean
  safetyLevel: ThemeSafetyLevel
  blockingIssues: AppearanceReviewIssue[]
  warnings: AppearanceReviewIssue[]
}

export type AppearanceThemeProfile = {
  id: string
  theme: ThemeSpec
  review: AppearanceReviewReport
  createdAt: number
  updatedAt: number
}

export type AppearanceApplyHistoryEntry = {
  profileId: string
  themeName: string
  safetyLevel: ThemeSafetyLevel
  appliedAt: number
}

export type PublicAppearanceThemes = {
  schemaVersion: 1
  activeProfileId: string
  activeProfile: AppearanceThemeProfile | null
  applyHistory: AppearanceApplyHistoryEntry[]
  profiles: AppearanceThemeProfile[]
}

export type AppearanceApplyOptions = {
  confirmed: boolean
  allowExperimental?: boolean
}

export type AppearanceResetOptions = {
  confirmed: boolean
}

export const AppearanceApi = {
  listThemes: () => api.get<PublicAppearanceThemes>('/appearance/themes'),
  createTheme: (theme: ThemeImportSpec | ThemeSpec) =>
    api.post<PublicAppearanceThemes>('/appearance/themes', { theme }),
  reviewTheme: (theme: ThemeImportSpec | ThemeSpec) =>
    api.post<{ theme: ThemeSpec | null; review: AppearanceReviewReport }>(
      '/appearance/themes/review',
      { theme },
    ),
  applyTheme: (profileId: string, options: AppearanceApplyOptions) =>
    api.post<PublicAppearanceThemes>(
      `/appearance/themes/${encodeURIComponent(profileId)}/apply`,
      options,
    ),
  resetTheme: (options: AppearanceResetOptions) =>
    api.post<PublicAppearanceThemes>('/appearance/themes/reset', options),
  deleteTheme: (profileId: string) =>
    api.delete<PublicAppearanceThemes>(`/appearance/themes/${encodeURIComponent(profileId)}`),
}
