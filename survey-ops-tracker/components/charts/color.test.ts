import { describe, it, expect } from 'vitest'
import { contrast, mixRgb, parseColor } from './color'

describe('colour maths for text on heatmap cells', () => {
  it('parses hex and rgb() colours', () => {
    expect(parseColor('#0076af')).toEqual([0, 118, 175])
    expect(parseColor(' #fff ')).toEqual([255, 255, 255])
    expect(parseColor('rgb(1, 11, 64)')).toEqual([1, 11, 64])
    expect(parseColor('var(--x)')).toBeNull()
  })

  it('mixes and measures contrast the WCAG way', () => {
    expect(mixRgb([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127.5, 127.5, 127.5])
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0)
    // White on brand teal reads better than navy ink on it.
    expect(contrast([255, 255, 255], [0, 118, 175])).toBeGreaterThan(contrast([1, 11, 64], [0, 118, 175]))
  })
})
