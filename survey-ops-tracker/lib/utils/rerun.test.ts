import { describe, it, expect } from 'vitest'
import { ordinal, baseRerunName, nextRerunName } from './rerun'

describe('ordinal', () => {
  it('handles the common cases and teens', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
  })
})

describe('baseRerunName', () => {
  it('strips an existing rerun suffix so names do not compound', () => {
    expect(baseRerunName('BAM Consumer Study')).toBe('BAM Consumer Study')
    expect(baseRerunName('BAM Consumer Study - 2nd Rerun')).toBe('BAM Consumer Study')
    expect(baseRerunName('BAM Consumer Study - 10th Rerun')).toBe('BAM Consumer Study')
  })
})

describe('nextRerunName', () => {
  it('appends the next ordinal to the base name', () => {
    expect(nextRerunName('BAM Consumer Study', 2)).toBe('BAM Consumer Study - 2nd Rerun')
    expect(nextRerunName('BAM Consumer Study - 2nd Rerun', 3)).toBe('BAM Consumer Study - 3rd Rerun')
  })
})
