import { describe, it, expect } from 'vitest'
import { DEFAULT_FILTER, parseFilter, type FinanceFilter, type FinanceTab } from '@/lib/finance/filters'
import {
  canonicalHref, DEFAULT_RANGE_WORDS, financeHref, LEGACY_TAB, needsCanonical, TAB_ORDER, tabFromParam,
  withoutDimension,
} from './url'

/**
 * The page's address. Two things break silently if these regress: an old
 * bookmark resets to the default instead of landing on the tab that answers
 * the same question, and a link built by one tab drops the filter (or the
 * page's own tab) on the way to another.
 */

const F = (o: Partial<FinanceFilter> = {}): FinanceFilter => ({ ...DEFAULT_FILTER, ...o })
const parse = (href: string) => {
  const u = new URL(href, 'https://socc.test')
  return { path: u.pathname, filter: parseFilter(u.searchParams), tab: tabFromParam(u.searchParams.get('tab')), params: u.searchParams }
}

describe('tabFromParam — the old tab ids land somewhere sensible', () => {
  it('maps every legacy id to the tab that now answers the same question', () => {
    expect(tabFromParam('now')).toBe('this-week')
    expect(tabFromParam('unit')).toBe('per-respondent')
    expect(tabFromParam('book')).toBe('results')
    expect(tabFromParam('save')).toBe('per-respondent')
    expect(Object.keys(LEGACY_TAB).sort()).toEqual(['book', 'now', 'save', 'unit'])
  })

  it('keeps the four current ids, and sends anything else to Results', () => {
    for (const t of TAB_ORDER) expect(tabFromParam(t)).toBe(t)
    expect(tabFromParam(null)).toBe('results')
    expect(tabFromParam('')).toBe('results')
    expect(tabFromParam('margin')).toBe('results')
  })
})

describe('financeHref — a real href that round-trips', () => {
  const cases: [FinanceFilter, FinanceTab][] = [
    [F(), 'results'],
    [F({ account: 'bam' }), 'this-week'],
    [F({ route: 'panel' }), 'per-respondent'],
    [F({ range: { preset: 'all', from: null, to: null } }), 'improve'],
    [F({ range: { preset: 'last-month', from: null, to: null }, account: 'coa', route: 'both' }), 'results'],
    [F({ range: { preset: 'custom', from: '2026-07-01', to: '2026-08-31' }, route: 'blast' }), 'improve'],
  ]

  it.each(cases)('parses back to the same filter and tab (%o on %s)', (f, tab) => {
    // Built from the default view, patched to (f, tab).
    const href = financeHref('', DEFAULT_FILTER, 'results', { ...f, tab })
    const back = parse(href)
    expect(back.path).toBe('/finance')
    expect(back.filter).toEqual(f)
    expect(back.tab).toBe(tab)
  })

  it('leaves the default view as a plain /finance', () => {
    expect(financeHref('', DEFAULT_FILTER, 'results')).toBe('/finance')
    expect(financeHref('tab=results', DEFAULT_FILTER, 'results')).toBe('/finance')
  })

  it('keeps the filter when switching tab', () => {
    const f = F({ account: 'bam', route: 'panel' })
    const back = parse(financeHref('account=bam&route=panel', f, 'results', { tab: 'this-week' }))
    expect(back.filter).toEqual(f)
    expect(back.tab).toBe('this-week')
  })

  it("keeps a tab's own keys on the same tab, and drops them on another", () => {
    const cur = 'tab=results&group=account&account=bam'
    const f = F({ account: 'bam' })
    const same = parse(financeHref(cur, f, 'results', { route: 'blast' }))
    expect(same.params.get('group')).toBe('account')
    expect(same.filter.route).toBe('blast')
    const other = parse(financeHref(cur, f, 'results', { tab: 'improve' }))
    expect(other.params.get('group')).toBeNull()
    expect(other.filter.account).toBe('bam')
  })

  it("never carries the old page's keys forward", () => {
    const cur = 'tab=book&lifecycle=all&type=PS&contact=c1&drill=scrub&preset=mtd'
    const href = financeHref(cur, parseFilter(new URLSearchParams(cur)), 'results', { account: 'bam' })
    const back = parse(href)
    for (const k of ['lifecycle', 'type', 'contact', 'drill', 'preset']) expect(back.params.get(k)).toBeNull()
    // …but the legacy preset's meaning survives as the new key.
    expect(back.filter.range.preset).toBe('this-month')
  })

  it('patching one dimension leaves the others alone', () => {
    const f = F({ account: 'bam', route: 'panel', range: { preset: 'all', from: null, to: null } })
    const back = parse(financeHref('', f, 'results', { route: 'blast' }))
    expect(back.filter).toEqual({ ...f, route: 'blast' })
  })
})

describe('canonical addresses', () => {
  it('rewrites a legacy bookmark once, to the tab that replaced it', () => {
    const p = new URLSearchParams('tab=now&account=bam&lifecycle=all')
    expect(needsCanonical(p)).toBe(true)
    const back = parse(canonicalHref(p, parseFilter(p)))
    expect(back.tab).toBe('this-week')
    expect(back.filter.account).toBe('bam')
    expect(back.params.get('lifecycle')).toBeNull()
    // The rewritten address is itself canonical: no redirect loop.
    expect(needsCanonical(back.params)).toBe(false)
  })

  it('leaves an already canonical address alone', () => {
    expect(needsCanonical(new URLSearchParams(''))).toBe(false)
    expect(needsCanonical(new URLSearchParams('tab=improve&route=panel'))).toBe(false)
  })
})

describe('chips', () => {
  it('each ✕ puts exactly one dimension back to its default', () => {
    const f = F({ account: 'bam', route: 'panel', range: { preset: 'all', from: null, to: null } })
    expect(withoutDimension(f, 'account')).toEqual({ ...f, account: null })
    expect(withoutDimension(f, 'route')).toEqual({ ...f, route: 'all' })
    expect(withoutDimension(f, 'range')).toEqual({ ...f, range: DEFAULT_FILTER.range })
  })

  it("names the default window with the preset's own label", () => {
    expect(DEFAULT_RANGE_WORDS).toBe('since 1 Jun 2026')
  })
})
