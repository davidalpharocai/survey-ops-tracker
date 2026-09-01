import { describe, it, expect } from 'vitest'
import { audienceState, NEARLY_GONE_SHARE } from './audience'

describe('audienceState', () => {
  it('says nothing when no total was recorded', () => {
    expect(audienceState(null, null)).toEqual({ kind: 'unknown' })
    // Even a used figure on its own proves nothing about what is left.
    expect(audienceState(null, 500)).toEqual({ kind: 'unknown' })
    expect(audienceState(undefined, undefined)).toEqual({ kind: 'unknown' })
  })

  // THE LOAD-BEARING CASE. 42 projects have a total and none has a used figure,
  // so if a missing `used` collapsed to zero, every one of them would claim its
  // full list is untouched. That is the same class of bug migration 091 had to
  // undo for blast figures, where `default 0` made an unrecorded blast
  // indistinguishable from a free one.
  it('does not treat a missing used figure as zero used', () => {
    expect(audienceState(30_000, null)).toEqual({ kind: 'unrecorded', total: 30_000 })
    const zero = audienceState(30_000, 0)
    expect(zero.kind).toBe('remaining')
    expect(zero).toMatchObject({ left: 30_000, nearlyGone: false })
  })

  it('flags used above the total instead of returning a negative remainder', () => {
    // PR00060's shape: a pool of 1 against 178 collected. Impossible, so the
    // answer is "one of these is wrong", never "-177 left".
    expect(audienceState(1, 178)).toEqual({ kind: 'over', total: 1, used: 178 })
  })

  it('reports what is left when the list is partly spent', () => {
    expect(audienceState(10_000, 2_500)).toEqual({
      kind: 'remaining', total: 10_000, used: 2_500, left: 7_500, nearlyGone: false,
    })
  })

  it('warns before the list runs dry, not at zero', () => {
    // Exactly at the threshold counts as nearly gone: 10% of 10,000.
    expect(audienceState(10_000, 9_000)).toMatchObject({ kind: 'remaining', nearlyGone: true })
    // One contact above it does not.
    expect(audienceState(10_000, 8_999)).toMatchObject({ kind: 'remaining', nearlyGone: false })
    expect(NEARLY_GONE_SHARE).toBe(0.1)
  })

  it('calls a fully spent list exhausted rather than "0 remaining"', () => {
    // PR00309's real shape: the whole 31,545-contact pool used. This is the state
    // that means "more responses now costs incentive, or more contacts" — the
    // distinction the whole field split exists to make.
    expect(audienceState(31_545, 31_545)).toEqual({ kind: 'exhausted', total: 31_545 })
  })

  // Regression: a negative `used` used to slip past the `used > total` branch and
  // return kind:'remaining' with MORE left than the pool holds — audienceState(0, -5)
  // rendered "5 of 0 contacts still available — nearly exhausted". 094's CHECK stops
  // it persisting, but the optimistic update paints it for the whole round trip and
  // commitNumber accepts a leading minus.
  it('rejects a negative used instead of inflating what is left', () => {
    expect(audienceState(0, -5)).toEqual({ kind: 'over', total: 0, used: -5 })
    expect(audienceState(10_000, -1)).toEqual({ kind: 'over', total: 10_000, used: -1 })
  })

  it('handles undefined used the same as null', () => {
    expect(audienceState(500, undefined)).toEqual({ kind: 'unrecorded', total: 500 })
  })

  it('treats a recorded total of 0 as a statement, not as missing', () => {
    // "The team gave us nothing" is different from "nobody wrote it down", and
    // only the second should read as unknown.
    expect(audienceState(0, null)).toEqual({ kind: 'unrecorded', total: 0 })
    expect(audienceState(0, 0)).toEqual({ kind: 'exhausted', total: 0 })
  })
})
