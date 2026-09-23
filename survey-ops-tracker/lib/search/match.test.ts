import { describe, it, expect } from 'vitest'
import { scoreField, scoreRow, ilikeOr, isSearchable, excerpt, RANK } from './match'

describe('scoreField', () => {
  it('puts an exact match first', () => {
    expect(scoreField('PR00412', 'pr00412')).toBe(RANK.exact)
  })

  it('ranks a prefix above a word start above a bare substring', () => {
    expect(scoreField('Wealth Manager Data', 'wealth')).toBeLessThan(
      scoreField('Q3 private wealth follow-up', 'wealth'))
    expect(scoreField('Q3 private wealth follow-up', 'wealth')).toBeLessThan(
      scoreField('Stealthy pilot', 'ealth'))
  })

  it('is a miss when the needle is absent', () => {
    expect(scoreField('Holocene Weekly', 'coatue')).toBe(RANK.miss)
  })

  it('treats null and empty as a miss rather than a match', () => {
    expect(scoreField(null, 'bam')).toBe(RANK.miss)
    expect(scoreField('', 'bam')).toBe(RANK.miss)
    // An empty needle must not match everything.
    expect(scoreField('anything', '')).toBe(RANK.miss)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(scoreField('  BAM  ', 'bam')).toBe(RANK.exact)
  })

  it('does not let regex characters in the needle throw', () => {
    expect(() => scoreField('a (b) c', '(b)')).not.toThrow()
    expect(scoreField('a (b) c', '(b)')).toBeLessThan(RANK.miss)
  })
})

describe('scoreRow', () => {
  it('takes the best field, not the first', () => {
    // The code matches exactly while the name does not match at all.
    expect(scoreRow(['Some unrelated name', 'PR00412'], 'PR00412')).toBe(RANK.exact)
  })

  it('is a miss only when every field misses', () => {
    expect(scoreRow(['a', 'b', null], 'zzz')).toBe(RANK.miss)
  })
})

describe('ilikeOr', () => {
  it('builds one clause per column', () => {
    expect(ilikeOr(['name', 'code'], 'bam')).toBe('name.ilike."%bam%",code.ilike."%bam%"')
  })

  it('quotes the value so a comma cannot split the filter', () => {
    // This is the bug the quoting exists to prevent: unquoted, "Smith, John"
    // would read as two separate half-filters.
    const f = ilikeOr(['name'], 'Smith, John')
    expect(f).toBe('name.ilike."%Smith, John%"')
    expect(f.split('",').length).toBe(1)
  })

  it('escapes a double quote in the needle rather than letting it close early', () => {
    expect(ilikeOr(['name'], 'the "big" one')).toBe('name.ilike."%the \\"big\\" one%"')
  })

  it('escapes a backslash', () => {
    expect(ilikeOr(['name'], 'a\\b')).toBe('name.ilike."%a\\\\b%"')
  })
})

describe('isSearchable', () => {
  it('needs two characters', () => {
    expect(isSearchable('a')).toBe(false)
    expect(isSearchable('ba')).toBe(true)
  })

  it('does not count whitespace toward the minimum', () => {
    expect(isSearchable('  a  ')).toBe(false)
  })

  it('rejects null, empty and undefined rather than returning everything', () => {
    expect(isSearchable(null)).toBe(false)
    expect(isSearchable(undefined)).toBe(false)
    expect(isSearchable('')).toBe(false)
  })
})

describe('excerpt', () => {
  it('centres the window on the hit', () => {
    const body = 'a'.repeat(200) + ' COPILOT ' + 'b'.repeat(200)
    const e = excerpt(body, 'copilot', 40)
    expect(e).toContain('COPILOT')
    expect(e.startsWith('…')).toBe(true)
    expect(e.endsWith('…')).toBe(true)
  })

  it('does not put a leading ellipsis on a match at the start', () => {
    expect(excerpt('Copilot rollout notes', 'copilot', 40)).toBe('Copilot rollout notes')
  })

  it('collapses whitespace so a pasted email does not render as a column', () => {
    expect(excerpt('one\n\n   two\tthree', 'two', 40)).toBe('one two three')
  })

  it('falls back to the head of the text when the needle is absent', () => {
    expect(excerpt('abcdefghij', 'zzz', 5)).toBe('abcde…')
  })

  it('handles null and empty without throwing', () => {
    expect(excerpt(null, 'x')).toBe('')
    expect(excerpt('', 'x')).toBe('')
  })
})
