import { describe, it, expect } from 'vitest'
import {
  billableN, valueCredits, creditRevenue, impliedCreditRate, creditCoverage, creditValues,
  type CreditedProject,
} from './credits'

/**
 * Guards the credits model.
 *
 * The rule the whole file exists to protect: credits price the SCOPE and
 * price_per_n prices the DELIVERY, so a survey carrying both has two figures
 * and one revenue. Adding them would double-count the same sale.
 */

const P = (o: Partial<CreditedProject> = {}): CreditedProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'DE Shaw', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: 50, n_collected: 60, n_actual: 50, credits: null, term_id: null, ...o,
})
const VALUES = new Map([['t1', 200]])

describe('billableN', () => {
  it('caps at the promise, because billing does', () => {
    expect(billableN(P({ n_target: 50, n_actual: 80 }))).toBe(50)
    expect(billableN(P({ n_target: 50, n_actual: 30 }))).toBe(30)
  })

  it('is null when either figure is missing, never 0', () => {
    expect(billableN(P({ n_actual: null }))).toBeNull()
    expect(billableN(P({ n_target: null }))).toBeNull()
  })
})

describe('valueCredits', () => {
  it('values a survey at credits x the rate on its own contract', () => {
    const v = valueCredits(P({ credits: 35, term_id: 't1', n_target: 50, n_actual: 50 }), VALUES)!
    expect(v).toMatchObject({ credits: 35, creditValue: 200, contracted: 7000 })
    // $7,000 over 50 billable N — the $/N David asked to see.
    expect(v.impliedRatePerN).toBe(140)
    expect(v.impliedBasis).toBe('billable')
  })

  it('returns null contracted — not 0 — when the contract has no agreed rate', () => {
    // "Nobody has agreed a rate" and "this is free" are different facts.
    const v = valueCredits(P({ credits: 35, term_id: 'unknown' }), VALUES)!
    expect(v.creditValue).toBeNull()
    expect(v.contracted).toBeNull()
    expect(v.impliedRatePerN).toBeNull()
  })

  it('cannot value credits that draw down nothing', () => {
    // Credits with no contract attached move no balance anywhere.
    const v = valueCredits(P({ credits: 35, term_id: null }), VALUES)!
    expect(v.contracted).toBeNull()
  })

  it('falls back to TARGET while a survey is still running, and says so', () => {
    const v = valueCredits(
      P({ credits: 10, term_id: 't1', board_column: 'Fielding', n_target: 100, n_actual: null }),
      VALUES)!
    expect(v.contracted).toBe(2000)
    expect(v.impliedRatePerN).toBe(20)
    expect(v.impliedBasis).toBe('target')
  })

  it('ignores a survey with no credits', () => {
    expect(valueCredits(P({ credits: null }), VALUES)).toBeNull()
    expect(valueCredits(P({ credits: 0 }), VALUES)).toBeNull()
  })
})

describe('creditRevenue: one revenue, never the sum', () => {
  it('prefers the client rate, and reports credits as the ALTERNATE', () => {
    // PR00378 exactly: 35 credits at $200 = $7,000 contracted, and $140/N x 50
    // billable = $7,000 delivered. They agree here; the point is that they are
    // reported as two figures and never added to $14,000.
    const p = P({ credits: 35, term_id: 't1', n_target: 50, n_actual: 50 })
    const r = creditRevenue(p, 140, VALUES)
    expect(r).toMatchObject({ revenue: 7000, source: 'rate', alternate: 7000, alternateSource: 'credits' })
  })

  it('shows the GAP when a survey came up short', () => {
    // PR00257: 15 credits agreed for a 50-N study that delivered 7.
    // Contracted 15 x $200 = $3,000. Delivered $125 x 7 = $875.
    // Neither number is wrong; the distance is the finding.
    const p = P({ credits: 15, term_id: 't1', n_target: 50, n_actual: 7 })
    const r = creditRevenue(p, 125, VALUES)
    expect(r.revenue).toBe(875)
    expect(r.alternate).toBe(3000)
  })

  it('uses credits when that is the only price on file', () => {
    const p = P({ credits: 19, term_id: 't1', n_target: 400, n_actual: 400 })
    const r = creditRevenue(p, null, VALUES)
    expect(r).toMatchObject({ revenue: 3800, source: 'credits', alternate: null })
  })

  it('returns null when neither unit is priced', () => {
    expect(creditRevenue(P(), null, VALUES)).toMatchObject({ revenue: null, source: null })
  })

  it('honours a real rate of $0 rather than falling through to credits', () => {
    // A free trial is priced. Falling back to credits would invent revenue on a
    // survey somebody decided to give away.
    const p = P({ credits: 10, term_id: 't1' })
    expect(creditRevenue(p, 0, VALUES)).toMatchObject({ revenue: 0, source: 'rate' })
  })
})

describe('impliedCreditRate: the cross-check that makes a typed rate safe', () => {
  it('derives dollars per credit from surveys carrying both units', () => {
    const rows = [
      P({ id: 'a', credits: 35, n_target: 50, n_actual: 50 }),   // $140 x 50 / 35 = $200
      P({ id: 'b', credits: 10, n_target: 100, n_actual: 100 }), // $20 x 100 / 10 = $200
    ]
    const r = impliedCreditRate(rows, new Map([['a', 140], ['b', 20]]))!
    expect(r).toMatchObject({ median: 200, n: 2 })
  })

  it('is robust to a survey that came up short', () => {
    // A shortfall implies a LOW rate per credit and says nothing about the
    // contract. The median absorbs it; a mean would not.
    const rows = [
      P({ id: 'a', credits: 10, n_target: 100, n_actual: 100 }),
      P({ id: 'b', credits: 10, n_target: 100, n_actual: 100 }),
      P({ id: 'c', credits: 10, n_target: 100, n_actual: 5 }),
    ]
    const r = impliedCreditRate(rows, new Map([['a', 20], ['b', 20], ['c', 20]]))!
    expect(r.median).toBe(200)
    // The outlier sorts FIRST so it can be opened and explained.
    expect(r.rows[0].id).toBe('c')
    expect(r.rows[0].perCredit).toBe(10)
  })

  it('returns null rather than a rate from nothing', () => {
    expect(impliedCreditRate([P({ credits: 10 })], new Map())).toBeNull()
  })
})

describe('creditCoverage', () => {
  it('separates credited from attached from valued', () => {
    // Credits with no contract draw down nothing, and credits on a contract
    // with no agreed rate cannot show a $/N. Three different states.
    const rows = [
      P({ id: 'a', credits: 10, term_id: 't1' }),
      P({ id: 'b', credits: 20, term_id: 'norate' }),
      P({ id: 'c', credits: 30, term_id: null }),
      P({ id: 'd', credits: null }),
    ]
    const c = creditCoverage(rows, new Map(), VALUES)
    expect(c).toMatchObject({ credited: 3, attached: 2, valued: 1, unattachedCredits: 30 })
  })

  it('counts the surveys priced BOTH ways', () => {
    const rows = [P({ id: 'a', credits: 10, term_id: 't1' }), P({ id: 'b', credits: 10 })]
    expect(creditCoverage(rows, new Map([['a', 50]]), VALUES).both).toBe(1)
  })
})

describe('creditValues: derived, never stored', () => {
  it('divides the contract total by its credits', () => {
    // Migration 100 already holds both halves. Storing a third number that
    // could disagree with them is the mistake this codebase keeps paying for.
    const terms = [{ id: 't1', client_id: 'c', name: '2026 Contract', credits_total: 375 }]
    expect(creditValues(terms, new Map([['t1', 75_000]])).get('t1')).toBe(200)
  })

  it('omits a contract missing either half rather than guessing', () => {
    const terms = [
      { id: 'a', client_id: 'c', name: 'no dollars', credits_total: 100 },
      { id: 'b', client_id: 'c', name: 'no credits', credits_total: null },
      { id: 'c', client_id: 'c', name: 'zero credits', credits_total: 0 },
    ]
    const m = creditValues(terms, new Map([['b', 1000], ['c', 1000]]))
    expect(m.size).toBe(0)
  })
})
