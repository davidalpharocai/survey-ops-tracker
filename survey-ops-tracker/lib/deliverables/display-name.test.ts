import { describe, it, expect } from 'vitest'
import { normalizeDisplayName } from './display-name'

describe('normalizeDisplayName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeDisplayName('  Live   dashboard  ')).toBe('Live dashboard')
  })

  it('returns null for empty or whitespace-only input (reset to auto name)', () => {
    expect(normalizeDisplayName('')).toBeNull()
    expect(normalizeDisplayName('   ')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(normalizeDisplayName(null)).toBeNull()
    expect(normalizeDisplayName(undefined)).toBeNull()
  })

  it('caps length at 200 characters', () => {
    expect(normalizeDisplayName('x'.repeat(250))).toHaveLength(200)
  })

  it('leaves interior punctuation untouched (it is a label, not a filename)', () => {
    expect(normalizeDisplayName('Q3: buyers/sellers "final"')).toBe('Q3: buyers/sellers "final"')
  })
})
