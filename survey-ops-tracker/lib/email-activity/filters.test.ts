import { describe, it, expect } from 'vitest'
import { chunkSenders, generateFilterXml } from './filters'

describe('chunkSenders', () => {
  it('dedupes, lowercases, and sorts', () => {
    expect(chunkSenders(['B@x.com', 'a@x.com', 'A@x.com'])).toEqual(['a@x.com OR b@x.com'])
  })

  it('splits into multiple groups each within the length cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => `user${i}@example.com`)
    const chunks = chunkSenders(many, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
  })

  it('keeps a single over-long sender as its own group rather than dropping it', () => {
    const long = `${'x'.repeat(120)}@example.com`
    expect(chunkSenders([long], 50)).toEqual([long])
  })
})

describe('generateFilterXml', () => {
  it('emits one <entry> per chunk with from + forwardTo', () => {
    const xml = generateFilterXml(['a@x.com'], 'activity@alpharoc.ai')
    expect(xml).toContain("<apps:property name='from' value='a@x.com'/>")
    expect(xml).toContain("<apps:property name='forwardTo' value='activity@alpharoc.ai'/>")
    expect((xml.match(/<entry>/g) ?? []).length).toBe(1)
  })

  it('XML-escapes special characters in an address', () => {
    const xml = generateFilterXml(["o'brien@x.com"])
    expect(xml).toContain('o&apos;brien@x.com')
  })

  it('does not archive (no shouldArchive) so captains keep their own copy', () => {
    expect(generateFilterXml(['a@x.com'])).not.toContain('shouldArchive')
  })
})
