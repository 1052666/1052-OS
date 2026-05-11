import { describe, expect, it } from 'vitest'
import { hexToRgb } from './theme-effect-shader'

describe('hexToRgb (theme-effect-shader)', () => {
  it('parses #rrggbb to floats in [0,1]', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1])
  })

  it('parses without leading #', () => {
    const [r, g, b] = hexToRgb('111315')
    expect(r).toBeCloseTo(17 / 255, 5)
    expect(g).toBeCloseTo(19 / 255, 5)
    expect(b).toBeCloseTo(21 / 255, 5)
  })

  it('parses canonical mirror-dark bg', () => {
    const [r, g, b] = hexToRgb('#111315')
    expect(r).toBeCloseTo(17 / 255, 5)
    expect(g).toBeCloseTo(19 / 255, 5)
    expect(b).toBeCloseTo(21 / 255, 5)
  })

  it('parses canonical mirror-light bg', () => {
    const [r, g, b] = hexToRgb('#E7E8EA')
    expect(r).toBeCloseTo(231 / 255, 5)
    expect(g).toBeCloseTo(232 / 255, 5)
    expect(b).toBeCloseTo(234 / 255, 5)
  })

  it('returns [0,0,0] for malformed input (defensive — never throws at runtime)', () => {
    expect(hexToRgb('')).toEqual([0, 0, 0])
    expect(hexToRgb('#1234')).toEqual([0, 0, 0])
    expect(hexToRgb('not-a-color')).toEqual([0, 0, 0])
    expect(hexToRgb('#GGHHII')).toEqual([0, 0, 0])
  })

  it('trims whitespace tolerantly', () => {
    expect(hexToRgb('  #000000  ')).toEqual([0, 0, 0])
  })
})
