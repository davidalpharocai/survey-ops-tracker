import { describe, it, expect } from 'vitest'
import { normalizeUrl, isGoogleNative, extractDeliverableLinks, linkDisplayName } from './links'

describe('deliverables/links', () => {
  it('normalizeUrl drops hash + utm params + trailing slash', () => {
    expect(normalizeUrl('https://a.com/x/?utm_source=z&id=5#frag')).toBe('https://a.com/x/?id=5'.replace(/\/$/, ''))
  })

  it('detects deliverable links by known host, ignoring noise', () => {
    const body = `Report: https://app.occamdata.com/study/42
      Survey: https://edwin.alpharoc.ai/survey?source=PII_X
      Sheet: https://docs.google.com/spreadsheets/d/abc/edit
      Unsub: https://mailchimp.com/unsubscribe?u=1`
    expect(extractDeliverableLinks(body)).toEqual([
      'https://app.occamdata.com/study/42',
      'https://edwin.alpharoc.ai/survey?source=PII_X',
      'https://docs.google.com/spreadsheets/d/abc/edit',
    ])
  })

  it('flags Google-native links (for shortcut vs bookmark)', () => {
    expect(isGoogleNative('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(true)
    expect(isGoogleNative('https://app.occamdata.com/study/42')).toBe(false)
  })
})

describe('linkDisplayName', () => {
  it('uses host + final path segment (dashes/underscores → spaces)', () => {
    expect(linkDisplayName('https://app.occamdata.com/study/42?x=1')).toBe('app.occamdata.com — 42')
    expect(linkDisplayName('https://docs.google.com/spreadsheets/d/abc/edit')).toBe('docs.google.com — edit')
  })
  it('falls back to the host alone when there is no path', () => {
    expect(linkDisplayName('https://example.com')).toBe('example.com')
  })
  it('falls back to the raw string for an unparseable url', () => {
    expect(linkDisplayName('not a url')).toBe('not a url')
  })
})
