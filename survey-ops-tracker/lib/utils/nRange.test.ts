import { describe, it, expect } from 'vitest'
import { formatNRange, isInvertedNRange, resolveNRange, sumNRange } from './nRange'

describe('resolveNRange', () => {
  it('mirrors a null max onto the min — the single-number case pre-078', () => {
    expect(resolveNRange(1350, null)).toEqual({ min: 1350, max: 1350 })
  })

  it('mirrors a null min onto the max (hand-edited rows still have to render)', () => {
    expect(resolveNRange(null, 1600)).toEqual({ min: 1600, max: 1600 })
  })

  it('leaves a real range alone', () => {
    expect(resolveNRange(1350, 1600)).toEqual({ min: 1350, max: 1600 })
  })

  it('keeps "nothing agreed yet" as both null rather than inventing a 0', () => {
    expect(resolveNRange(null, null)).toEqual({ min: null, max: null })
    expect(resolveNRange(undefined, undefined)).toEqual({ min: null, max: null })
  })

  it('does not treat a real 0 as unset', () => {
    expect(resolveNRange(0, null)).toEqual({ min: 0, max: 0 })
  })
})

describe('formatNRange', () => {
  it('shows one number when both ends agree', () => {
    expect(formatNRange(1350, 1350)).toBe('1,350')
  })

  it('shows one number when only the min is set', () => {
    expect(formatNRange(1350, null)).toBe('1,350')
  })

  it('shows both ends, comma-grouped, when they differ', () => {
    expect(formatNRange(1350, 1600)).toBe('1,350 – 1,600')
  })

  it('falls back to the caller-supplied empty string', () => {
    expect(formatNRange(null, null)).toBe('—')
    expect(formatNRange(null, null, '')).toBe('')
  })
})

describe('isInvertedNRange', () => {
  it('is true only when the max really is below the min', () => {
    expect(isInvertedNRange(1000, 100)).toBe(true)
    expect(isInvertedNRange(100, 1000)).toBe(false)
    expect(isInvertedNRange(1000, 1000)).toBe(false)
  })

  it('is false for a half-set pair — a null end resolves to the other one', () => {
    expect(isInvertedNRange(1000, null)).toBe(false)
    expect(isInvertedNRange(null, 100)).toBe(false)
    expect(isInvertedNRange(null, null)).toBe(false)
  })
})

describe('sumNRange (mirrors sync_segment_totals from migration 078)', () => {
  it('sums the mins and the maxes independently', () => {
    const total = sumNRange([
      { n_target: 600, n_target_max: 800 },
      { n_target: 400, n_target_max: 500 },
    ])
    expect(total).toEqual({ min: 1000, max: 1300 })
  })

  it('counts a segment with no max at its min on BOTH ends', () => {
    // sum(coalesce(n_target_max, n_target)): one agreed number is a degenerate
    // range, so 400 contributes 400 to the top end too.
    const total = sumNRange([
      { n_target: 600, n_target_max: 800 },
      { n_target: 400, n_target_max: null },
    ])
    expect(total).toEqual({ min: 1000, max: 1200 })
  })

  it('leaves the max null when NO segment has one, rather than inventing a range', () => {
    const total = sumNRange([
      { n_target: 600, n_target_max: null },
      { n_target: 400 },
    ])
    expect(total).toEqual({ min: 1000, max: null })
  })

  it('skips segments with no N at all', () => {
    const total = sumNRange([
      { n_target: 600, n_target_max: 800 },
      { n_target: null, n_target_max: null },
    ])
    expect(total).toEqual({ min: 600, max: 800 })
  })

  it('is null/null for no segments and for segments with nothing filled in', () => {
    expect(sumNRange([])).toEqual({ min: null, max: null })
    expect(sumNRange([{ n_target: null, n_target_max: null }])).toEqual({ min: null, max: null })
  })

  it('rolls a single segment up to itself', () => {
    expect(sumNRange([{ n_target: 1350, n_target_max: 1600 }])).toEqual({ min: 1350, max: 1600 })
  })
})
