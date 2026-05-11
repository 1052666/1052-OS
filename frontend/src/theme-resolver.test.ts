import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROFILE_IDS,
  VIRTUAL_CLASSIC_PROFILE_ID,
  isKnownBuiltinProfile,
  profileIdForTelemetry,
  resolveBaseFromProfile,
  resolveProfileForBase,
  resolveSystemColorScheme,
} from './theme-resolver'

describe('resolveProfileForBase', () => {
  it('returns null profileId for classic regardless of colorScheme', () => {
    expect(resolveProfileForBase('classic', 'dark').profileId).toBeNull()
    expect(resolveProfileForBase('classic', 'light').profileId).toBeNull()
    expect(resolveProfileForBase('classic', 'auto').profileId).toBeNull()
  })

  it('classic never carries a lockedColorScheme', () => {
    expect(resolveProfileForBase('classic', 'dark').lockedColorScheme).toBeUndefined()
  })

  it('returns gpt-dark for gpt + dark, no lock', () => {
    const result = resolveProfileForBase('gpt', 'dark')
    expect(result.profileId).toBe(BUILTIN_PROFILE_IDS.gptDark)
    expect(result.lockedColorScheme).toBeUndefined()
  })

  it('returns gpt-light for gpt + light, no lock', () => {
    const result = resolveProfileForBase('gpt', 'light')
    expect(result.profileId).toBe(BUILTIN_PROFILE_IDS.gptLight)
    expect(result.lockedColorScheme).toBeUndefined()
  })

  it('resolves gpt + auto via injected resolver (light)', () => {
    const result = resolveProfileForBase('gpt', 'auto', () => 'light')
    expect(result.profileId).toBe(BUILTIN_PROFILE_IDS.gptLight)
    expect(result.lockedColorScheme).toBeUndefined()
  })

  it('resolves gpt + auto via injected resolver (dark)', () => {
    const result = resolveProfileForBase('gpt', 'auto', () => 'dark')
    expect(result.profileId).toBe(BUILTIN_PROFILE_IDS.gptDark)
    expect(result.lockedColorScheme).toBeUndefined()
  })

  it('mirror is dark-only: returns mirror-dark with lock for any colorScheme', () => {
    for (const scheme of ['dark', 'light', 'auto'] as const) {
      const result = resolveProfileForBase('mirror', scheme)
      expect(result.profileId).toBe(BUILTIN_PROFILE_IDS.mirrorDark)
      expect(result.lockedColorScheme).toBe('dark')
    }
  })
})

describe('resolveBaseFromProfile', () => {
  it('maps null/undefined/empty to classic (canonical mapping §1.1)', () => {
    expect(resolveBaseFromProfile(null)).toBe('classic')
    expect(resolveBaseFromProfile(undefined)).toBe('classic')
    expect(resolveBaseFromProfile('')).toBe('classic')
  })

  it('maps known builtin gpt ids to gpt', () => {
    expect(resolveBaseFromProfile(BUILTIN_PROFILE_IDS.gptDark)).toBe('gpt')
    expect(resolveBaseFromProfile(BUILTIN_PROFILE_IDS.gptLight)).toBe('gpt')
  })

  it('maps known builtin mirror id to mirror', () => {
    expect(resolveBaseFromProfile(BUILTIN_PROFILE_IDS.mirrorDark)).toBe('mirror')
  })

  it('forward-compat: unknown gpt-* / mirror-* future builtin id still maps correctly', () => {
    expect(resolveBaseFromProfile('builtin:gpt-warm')).toBe('gpt')
    expect(resolveBaseFromProfile('builtin:mirror-auto')).toBe('mirror')
  })

  it('falls back to classic for unknown profile ids (e.g. user-created)', () => {
    expect(resolveBaseFromProfile('a-random-uuid-xxx')).toBe('classic')
    expect(resolveBaseFromProfile('builtin:other-future-theme')).toBe('classic')
  })
})

describe('isKnownBuiltinProfile', () => {
  it('recognizes the three v1 builtin ids (mirror is dark-only)', () => {
    expect(isKnownBuiltinProfile(BUILTIN_PROFILE_IDS.gptDark)).toBe(true)
    expect(isKnownBuiltinProfile(BUILTIN_PROFILE_IDS.gptLight)).toBe(true)
    expect(isKnownBuiltinProfile(BUILTIN_PROFILE_IDS.mirrorDark)).toBe(true)
  })

  it('rejects null / unknown / future builtin ids', () => {
    expect(isKnownBuiltinProfile(null)).toBe(false)
    expect(isKnownBuiltinProfile(undefined)).toBe(false)
    expect(isKnownBuiltinProfile('')).toBe(false)
    expect(isKnownBuiltinProfile('builtin:gpt-warm')).toBe(false)
    expect(isKnownBuiltinProfile('builtin:mirror-light')).toBe(false)
    expect(isKnownBuiltinProfile('user-created-uuid')).toBe(false)
  })
})

describe('profileIdForTelemetry (canonical mapping §8.1)', () => {
  it('maps null → virtual classic id', () => {
    expect(profileIdForTelemetry(null)).toBe(VIRTUAL_CLASSIC_PROFILE_ID)
    expect(profileIdForTelemetry(undefined)).toBe(VIRTUAL_CLASSIC_PROFILE_ID)
    expect(profileIdForTelemetry('')).toBe(VIRTUAL_CLASSIC_PROFILE_ID)
  })

  it('passes through real profile ids unchanged', () => {
    expect(profileIdForTelemetry(BUILTIN_PROFILE_IDS.gptDark)).toBe(BUILTIN_PROFILE_IDS.gptDark)
    expect(profileIdForTelemetry('user-uuid')).toBe('user-uuid')
  })

  it('virtual id is namespaced with builtin: prefix to keep telemetry symmetric', () => {
    expect(VIRTUAL_CLASSIC_PROFILE_ID.startsWith('builtin:')).toBe(true)
  })
})

describe('resolveSystemColorScheme', () => {
  it('returns light when prefers-color-scheme: light matches', () => {
    const matchMedia = ((query: string) => ({
      matches: query === '(prefers-color-scheme: light)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    expect(resolveSystemColorScheme(matchMedia)).toBe('light')
  })

  it('returns dark when prefers-color-scheme: light does not match', () => {
    const matchMedia = ((_query: string) => ({
      matches: false,
      media: _query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    expect(resolveSystemColorScheme(matchMedia)).toBe('dark')
  })

  it('falls back to dark when matchMedia is unavailable', () => {
    expect(resolveSystemColorScheme(undefined)).toBe('dark')
  })
})
