import { describe, expect, it } from 'vitest'
import { decideMediaListener, decideThemeUpdate } from './theme-context-logic'
import { BUILTIN_PROFILE_IDS } from './theme-resolver'

describe('decideThemeUpdate — classic base', () => {
  it('accepts any colorScheme update; never schedules variant reapply', () => {
    for (const scheme of ['dark', 'light', 'auto'] as const) {
      const decision = decideThemeUpdate('classic', scheme, undefined)
      expect(decision.acceptStateUpdate).toBe(true)
      expect(decision.reapplyVariantProfileId).toBeNull()
    }
  })
})

describe('decideThemeUpdate — gpt base (dual variant after decision #6 reversal)', () => {
  it('gpt + dark → schedules gpt-dark reapply', () => {
    const decision = decideThemeUpdate('gpt', 'dark', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.gptDark)
  })

  it('gpt + light → schedules gpt-light reapply', () => {
    const decision = decideThemeUpdate('gpt', 'light', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.gptLight)
  })

  it('gpt + auto resolves through injected matcher (light)', () => {
    const decision = decideThemeUpdate('gpt', 'auto', undefined, () => 'light')
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.gptLight)
  })

  it('gpt + auto resolves through injected matcher (dark)', () => {
    const decision = decideThemeUpdate('gpt', 'auto', undefined, () => 'dark')
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.gptDark)
  })

  it('still rejects stray writes if a future caller passes lockedColorScheme', () => {
    // Defensive: if some future base does end up locking, the rejection path
    // is still wired correctly. No v1 base does this today.
    const decision = decideThemeUpdate('gpt', 'light', 'dark')
    expect(decision.acceptStateUpdate).toBe(false)
  })
})

describe('decideThemeUpdate — mirror base (dual variant)', () => {
  it('mirror + dark → schedules mirror-dark reapply', () => {
    const decision = decideThemeUpdate('mirror', 'dark', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorDark)
  })

  it('mirror + light → schedules mirror-light reapply', () => {
    const decision = decideThemeUpdate('mirror', 'light', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorLight)
  })

  it('mirror + auto resolves through injected matcher (light)', () => {
    const decision = decideThemeUpdate('mirror', 'auto', undefined, () => 'light')
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorLight)
  })

  it('mirror + auto resolves through injected matcher (dark)', () => {
    const decision = decideThemeUpdate('mirror', 'auto', undefined, () => 'dark')
    expect(decision.reapplyVariantProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorDark)
  })
})

describe('decideMediaListener', () => {
  it('non-auto colorScheme: do not listen', () => {
    expect(decideMediaListener('classic', 'dark', undefined).shouldListen).toBe(false)
    expect(decideMediaListener('mirror', 'light', undefined).shouldListen).toBe(false)
    expect(decideMediaListener('gpt', 'light', undefined).shouldListen).toBe(false)
  })

  it('auto + locked scheme: do not listen (system signal irrelevant)', () => {
    // No v1 base locks; the function still respects an explicit lock.
    expect(decideMediaListener('classic', 'auto', 'dark').shouldListen).toBe(false)
  })

  it('classic + auto: listen, but no variant reapply', () => {
    const decision = decideMediaListener('classic', 'auto', undefined)
    expect(decision.shouldListen).toBe(true)
    expect(decision.reapplyVariantOnSystemFlip).toBe(false)
  })

  it('gpt + auto: listen AND reapply gpt builtin on system flip', () => {
    const decision = decideMediaListener('gpt', 'auto', undefined)
    expect(decision.shouldListen).toBe(true)
    expect(decision.reapplyVariantOnSystemFlip).toBe(true)
  })

  it('mirror + auto: listen AND reapply mirror builtin on system flip', () => {
    const decision = decideMediaListener('mirror', 'auto', undefined)
    expect(decision.shouldListen).toBe(true)
    expect(decision.reapplyVariantOnSystemFlip).toBe(true)
  })
})
