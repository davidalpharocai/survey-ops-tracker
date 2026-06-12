import { describe, it, expect } from 'vitest'
import { normalizeClientText } from './clientName'

describe('normalizeClientText', () => {
  it('capitalizes each word of the contact part', () => {
    expect(normalizeClientText('BAM - jared khoo')).toBe('BAM - Jared Khoo')
    expect(normalizeClientText('BAM - grey jones')).toBe('BAM - Grey Jones')
  })
  it('leaves intentional capitalization alone', () => {
    expect(normalizeClientText('Gingrich360 - Joe DeSantis')).toBe('Gingrich360 - Joe DeSantis')
    expect(normalizeClientText('Bain - L. Valentina')).toBe('Bain - L. Valentina')
    expect(normalizeClientText('Iowa - IC MainFrame')).toBe('Iowa - IC MainFrame')
  })
  it('never touches the firm part', () => {
    expect(normalizeClientText('lowercase firm - bob smith')).toBe('lowercase firm - Bob Smith')
    expect(normalizeClientText('Sportclips')).toBe('Sportclips')
  })
  it('handles multi-contact and separator characters', () => {
    expect(normalizeClientText('Holocene - ben abrams & felix tan')).toBe('Holocene - Ben Abrams & Felix Tan')
  })
  it('collapses stray whitespace', () => {
    expect(normalizeClientText('  BAM -  jeff cumming ')).toBe('BAM - Jeff Cumming')
  })
})
