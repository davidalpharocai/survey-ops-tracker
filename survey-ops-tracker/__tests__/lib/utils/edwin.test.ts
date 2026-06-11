import { describe, it, expect } from 'vitest'
import { extractEdwinSurveyId, findEdwinUrl } from '@/lib/utils/edwin'

describe('extractEdwinSurveyId', () => {
  it('extracts the source param', () => {
    expect(
      extractEdwinSurveyId(
        'https://www.edwin.alpharoc.ai/survey?source=BFFIREDONOR202605&transaction_id=test_47136647'
      )
    ).toBe('BFFIREDONOR202605')
  })
  it('returns null for non-edwin urls', () => {
    expect(extractEdwinSurveyId('https://docs.google.com/document/d/x?source=ABC')).toBe(null)
  })
  it('returns null when no source param', () => {
    expect(extractEdwinSurveyId('https://www.edwin.alpharoc.ai/survey?id=1')).toBe(null)
  })
  it('returns null for invalid urls', () => {
    expect(extractEdwinSurveyId('not a url')).toBe(null)
  })
})

describe('findEdwinUrl', () => {
  it('finds plain edwin urls', () => {
    expect(findEdwinUrl(['https://docs.google.com/x', 'https://www.edwin.alpharoc.ai/survey?source=A'])).toContain('edwin')
  })
  it('finds edwin urls inside named JSON entries', () => {
    expect(
      findEdwinUrl([JSON.stringify({ name: 'Edwin', url: 'https://www.edwin.alpharoc.ai/survey?source=A' })])
    ).toContain('edwin')
  })
  it('returns null when absent', () => {
    expect(findEdwinUrl(['https://docs.google.com/x'])).toBe(null)
    expect(findEdwinUrl(null)).toBe(null)
  })
})
