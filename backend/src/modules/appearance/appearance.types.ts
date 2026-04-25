export type ThemeScope = 'chat' | 'workspace' | 'brief' | 'all'

export type ThemeMode = 'dark' | 'light'

export type ThemeSafetyLevel = 'safe' | 'experimental' | 'rejected'

export type ThemeCoreTokenName = 'bg' | 'surface' | 'fg' | 'accent' | 'success' | 'danger'

export type ThemeDerivedTokenName =
  | 'bgGrad1'
  | 'bgGrad2'
  | 'surface0'
  | 'surface1'
  | 'surface2'
  | 'surface3'
  | 'surfaceHover'
  | 'hairline'
  | 'hairline2'
  | 'hairlineStrong'
  | 'fg2'
  | 'fg3'
  | 'fg4'
  | 'accent2'
  | 'accentSoft'
  | 'accentRing'

export type ThemeTokenName = ThemeCoreTokenName | ThemeDerivedTokenName

export type ThemeCoreTokenSet = Record<ThemeCoreTokenName, string>

export type ThemeTokenSet = Record<ThemeTokenName, string>

export type ThemeSpec = {
  schemaVersion: 1
  name: string
  mode: ThemeMode
  scope: ThemeScope
  safetyLevel: ThemeSafetyLevel
  coreTokens: ThemeCoreTokenSet
  tokens: ThemeTokenSet
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

export type AppearanceThemeStore = {
  schemaVersion: 1
  activeProfileId: string
  applyHistory: AppearanceApplyHistoryEntry[]
  profiles: AppearanceThemeProfile[]
}

export type PublicAppearanceThemes = {
  schemaVersion: 1
  activeProfileId: string
  activeProfile: AppearanceThemeProfile | null
  applyHistory: AppearanceApplyHistoryEntry[]
  profiles: AppearanceThemeProfile[]
}

