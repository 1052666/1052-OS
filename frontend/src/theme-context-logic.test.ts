import { describe, expect, it } from 'vitest'
import { decideMediaListener, decideThemeUpdate } from './theme-context-logic'
import { BUILTIN_PROFILE_IDS } from './theme-resolver'

describe('decideThemeUpdate — classic base', () => {
  it('accepts any colorScheme update; never schedules mirror reapply', () => {
    for (const scheme of ['dark', 'light', 'auto'] as const) {
      const decision = decideThemeUpdate('classic', scheme, undefined)
      expect(decision.acceptStateUpdate).toBe(true)
      expect(decision.reapplyMirrorProfileId).toBeNull()
    }
  })
})

describe('decideThemeUpdate — gpt base (locked dark)', () => {
  it('drops stray light/light-explicit writes when locked', () => {
    const decision = decideThemeUpdate('gpt', 'light', 'dark')
    expect(decision.acceptStateUpdate).toBe(false)
    expect(decision.reapplyMirrorProfileId).toBeNull()
  })

  it('drops auto under lock too (spec §5.1: follow-system segment is disabled under GPT)', () => {
    const decision = decideThemeUpdate('gpt', 'auto', 'dark')
    expect(decision.acceptStateUpdate).toBe(false)
    expect(decision.reapplyMirrorProfileId).toBeNull()
  })

  it('accepts dark write under dark lock (idempotent)', () => {
    const decision = decideThemeUpdate('gpt', 'dark', 'dark')
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyMirrorProfileId).toBeNull()
  })
})

describe('decideThemeUpdate — mirror base (must re-apply on dark↔light)', () => {
  it('mirror + dark → schedules mirror-dark reapply', () => {
    const decision = decideThemeUpdate('mirror', 'dark', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyMirrorProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorDark)
  })

  it('mirror + light → schedules mirror-light reapply', () => {
    const decision = decideThemeUpdate('mirror', 'light', undefined)
    expect(decision.acceptStateUpdate).toBe(true)
    expect(decision.reapplyMirrorProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorLight)
  })

  it('mirror + auto resolves through injected matcher (light)', () => {
    const decision = decideThemeUpdate('mirror', 'auto', undefined, () => 'light')
    expect(decision.reapplyMirrorProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorLight)
  })

  it('mirror + auto resolves through injected matcher (dark)', () => {
    const decision = decideThemeUpdate('mirror', 'auto', undefined, () => 'dark')
    expect(decision.reapplyMirrorProfileId).toBe(BUILTIN_PROFILE_IDS.mirrorDark)
  })
})

describe('decideMediaListener', () => {
  it('non-auto colorScheme: do not listen', () => {
    expect(decideMediaListener('classic', 'dark', undefined).shouldListen).toBe(false)
    expect(decideMediaListener('mirror', 'light', undefined).shouldListen).toBe(false)
  })

  it('auto + locked scheme: do not listen (system signal irrelevant)', () => {
    expect(decideMediaListener('gpt', 'auto', 'dark').shouldListen).toBe(false)
  })

  it('classic + auto: listen, but no mirror reapply', () => {
    const decision = decideMediaListener('classic', 'auto', undefined)
    expect(decision.shouldListen).toBe(true)
    expect(decision.mirrorReapplyOnSystemFlip).toBe(false)
  })

  it('mirror + auto: listen AND reapply mirror builtin on system flip', () => {
    const decision = decideMediaListener('mirror', 'auto', undefined)
    expect(decision.shouldListen).toBe(true)
    expect(decision.mirrorReapplyOnSystemFlip).toBe(true)
  })
})
