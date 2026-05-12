import { describe, expect, it } from 'vitest'
import { shouldDisableMotion } from './use-reduced-motion'

describe('shouldDisableMotion (spec §4.2 short-circuit logic)', () => {
  it('reduceMotion=true overrides system (force on)', () => {
    expect(shouldDisableMotion(true, false)).toBe(true)
    expect(shouldDisableMotion(true, true)).toBe(true)
  })

  it('reduceMotion=false overrides system (force off)', () => {
    expect(shouldDisableMotion(false, false)).toBe(false)
    expect(shouldDisableMotion(false, true)).toBe(false)
  })

  it('reduceMotion=null follows system query (true when system prefers reduce)', () => {
    expect(shouldDisableMotion(null, true)).toBe(true)
  })

  it('reduceMotion=null follows system query (false when system does not)', () => {
    expect(shouldDisableMotion(null, false)).toBe(false)
  })

  it('reduceMotion=undefined treated same as null (follow system)', () => {
    expect(shouldDisableMotion(undefined, true)).toBe(true)
    expect(shouldDisableMotion(undefined, false)).toBe(false)
  })
})
