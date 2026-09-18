import { describe, it, expect } from 'vitest'
import { accountIndex, accountNameOf, accountOptions, inAccounts } from './accountIndex'

/**
 * Guards the account picker.
 *
 * The measurement this exists for: 14 accounts wear more than one stale label,
 * so a chip-per-label picker shows 106 chips for 76 accounts. BAM alone wears
 * nine.
 */

const CLIENTS = [
  { id: 'bam', name: 'BAM' },
  { id: 'coa', name: 'Coatue' },
  { id: 'own', name: 'Owned but dormant' },
]
const row = (client_id: string | null, client: string | null) => ({ client_id, client })

describe('the key is client_id, never the label', () => {
  it('collapses nine BAM labels into one option', () => {
    const rows = [
      row('bam', 'BAM'),
      row('bam', 'BAM - James Cook'),
      row('bam', 'BAM - Grey Jones'),
      row('bam', 'BAM - Elliot'),
      row('coa', 'Coatue'),
    ]
    const opts = accountOptions(rows, CLIENTS)
    expect(opts.map(o => o.name)).toEqual(['BAM', 'Coatue'])
    expect(opts.find(o => o.id === 'bam')!.count).toBe(4)
  })

  it('filters through the key, so a suffixed row still matches its account', () => {
    expect(inAccounts(row('bam', 'BAM - James Cook'), ['bam'])).toBe(true)
    expect(inAccounts(row('coa', 'Coatue'), ['bam'])).toBe(false)
  })

  it('treats an empty selection as NO filter, not as nothing-matches', () => {
    expect(inAccounts(row('bam', 'BAM'), [])).toBe(true)
  })
})

describe('the options come from the rows, not the account table', () => {
  it('omits an account the reader owns but has no survey on', () => {
    // sales_clients is owner-scoped and sales_projects is owner-OR-named, so
    // the two disagree in both directions. Alex owns four accounts with no
    // surveys; offering them empties the page with no way to tell why.
    const opts = accountOptions([row('bam', 'BAM')], CLIENTS)
    expect(opts.map(o => o.id)).toEqual(['bam'])
    expect(opts.some(o => o.id === 'own')).toBe(false)
  })

  it('KEEPS an account that is in the book but not in the account table', () => {
    // The mirror case: Vineet sees 7 accounts he does not own. Dropping them
    // would hide a third of his book.
    const opts = accountOptions([row('xxx', 'Someone Else Ltd')], CLIENTS)
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ id: 'xxx', name: 'Someone Else Ltd', resolved: false })
  })

  it('marks resolvable accounts so only those render as links', () => {
    // /sales/accounts/[id] calls notFound() for an account the reader does not
    // own, so an unresolved option must filter but never link.
    const opts = accountOptions([row('bam', 'BAM'), row('xxx', 'Other')], CLIENTS)
    expect(opts.find(o => o.id === 'bam')!.resolved).toBe(true)
    expect(opts.find(o => o.id === 'xxx')!.resolved).toBe(false)
  })

  it('sorts alphabetically by the name on screen', () => {
    const opts = accountOptions(
      [row('z', 'Zulu'), row('a', 'Alpha'), row('m', 'Mike')], [])
    expect(opts.map(o => o.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  it('skips a row with no account rather than inventing a bucket', () => {
    expect(accountOptions([row(null, 'Orphan')], CLIENTS)).toEqual([])
  })
})

describe('accountNameOf', () => {
  it('prefers the canonical name', () => {
    expect(accountNameOf('bam', ['BAM - James Cook'], accountIndex(CLIENTS))).toBe('BAM')
  })

  it('falls back to the SHORTEST label, because a suffix is name-plus-something', () => {
    // Every one of the 416 live labels is either exactly clients.name or that
    // name plus a suffix — nothing else — so the shortest in a group is it.
    expect(accountNameOf('xxx', ['Acme - Jane Doe', 'Acme', 'Acme - Bob'], new Map()))
      .toBe('Acme')
  })

  it('says so rather than rendering an empty cell', () => {
    expect(accountNameOf(null, [], new Map())).toBe('(no account)')
  })
})
