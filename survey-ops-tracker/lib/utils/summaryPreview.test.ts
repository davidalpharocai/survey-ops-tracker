import { describe, it, expect } from 'vitest'
import { canSeeSummaryPreview } from './summaryPreview'

describe('canSeeSummaryPreview', () => {
  it('allows an allowlisted email', () => {
    expect(canSeeSummaryPreview('david@alpharoc.ai')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(canSeeSummaryPreview('David@AlphaROC.ai')).toBe(true)
  })
  it('denies a non-allowlisted email', () => {
    expect(canSeeSummaryPreview('someone.else@alpharoc.ai')).toBe(false)
  })
  it('denies null / empty', () => {
    expect(canSeeSummaryPreview(null)).toBe(false)
    expect(canSeeSummaryPreview(undefined)).toBe(false)
    expect(canSeeSummaryPreview('')).toBe(false)
  })
})
