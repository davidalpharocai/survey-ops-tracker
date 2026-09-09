import { describe, it, expect } from 'vitest'
import { CHANGELOG, changelogFor } from './entries'

/**
 * The changelog audience filter is a DISCLOSURE BOUNDARY, not a formatting
 * choice: the sales portal renders this file, and before tagging it contained
 * our spend figures, what clients pay, margin, who holds the finance role, a
 * disclosed past vulnerability, and the existence of an internal target distinct
 * from the client-facing one — the single fact David asked to keep from sales.
 *
 * So these tests are about the DEFAULT, which has to be deny. An untagged bullet
 * is the one somebody adds on a Friday without thinking about who reads it.
 */

const salesText = () => changelogFor('all').flatMap(e => e.changes).map(c => c.text).join(' \n ')

describe('changelogFor', () => {
  it('shows an untagged bullet to nobody outside the team', () => {
    const tagged = CHANGELOG.flatMap(e => e.changes).filter(c => c.audience === 'all')
    const shown = changelogFor('all').flatMap(e => e.changes)
    expect(shown).toHaveLength(tagged.length)
    for (const c of shown) expect(c.audience, c.text.slice(0, 60)).toBe('all')
  })

  it('gives the internal reader everything, unfiltered', () => {
    expect(changelogFor('internal')).toBe(CHANGELOG)
    expect(changelogFor('internal').flatMap(e => e.changes))
      .toHaveLength(CHANGELOG.flatMap(e => e.changes).length)
  })

  it('drops a date whose bullets all filtered out', () => {
    // A run of empty date headings reads as a bug, and it also tells the reader
    // exactly how much they are not being shown.
    for (const e of changelogFor('all')) expect(e.changes.length, e.date).toBeGreaterThan(0)
  })

  it('does not mutate CHANGELOG while filtering', () => {
    const before = CHANGELOG.map(e => e.changes.length)
    changelogFor('all')
    expect(CHANGELOG.map(e => e.changes.length)).toEqual(before)
  })

  it('leaves the sales reader something to read', () => {
    // Default-deny with nothing tagged is safe but useless; if this ever hits
    // zero the portal is shipping an empty page.
    expect(changelogFor('all').flatMap(e => e.changes).length).toBeGreaterThan(0)
  })
})

describe('nothing restricted reaches the sales changelog', () => {
  // Belt and braces over the tagging itself. If someone tags a bullet 'all' that
  // talks about money we spend or targets we do not quote, this fails — the
  // reviewer of that change should not have to notice unaided.
  const FORBIDDEN: [RegExp, string][] = [
    [/\bmargin\b/i, 'margin'],
    [/\bbudget\b/i, 'budget'],
    [/\bspend(ing)?\b/i, 'what we spend'],
    [/\binternal target\b/i, 'the internal target'],
    [/\bcontract value\b/i, 'contract value'],
    [/\bprice per|price\/|per completed N\b/i, 'client pricing'],
    [/\bcost (us|to run|of)\b/i, 'cost to run'],
    [/\$[\d,]/, 'a dollar figure'],
    [/\bShanu\b|\bVineet\b/, 'who holds the finance role'],
    [/could have read them|vulnerabilit|leak/i, 'a past security gap'],
  ]

  const text = salesText()
  for (const [re, what] of FORBIDDEN) {
    it(`never mentions ${what}`, () => {
      const hit = changelogFor('all').flatMap(e => e.changes).find(c => re.test(c.text))
      expect(hit?.text ?? null, `tagged 'all' but mentions ${what}`).toBeNull()
    })
  }

  it('says nothing about a page the sales tier cannot open', () => {
    // The board, Insights, the Context tab, the guide, PureSpectrum, Edwin:
    // internal surfaces. A bullet about one is at best confusing and at worst a
    // description of machinery we do not discuss with clients.
    for (const w of ['Context tab', 'PureSpectrum', 'EdWin', 'Insights tab', 'the board']) {
      expect(text.toLowerCase(), w).not.toContain(w.toLowerCase())
    }
  })
})
