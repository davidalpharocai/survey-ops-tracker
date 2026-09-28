import { describe, it, expect } from 'vitest'
import { reconcile, reconcileText, spendOfIds, CENT, type DrillRow } from './drill'
import { spendOf, type FinBlast, type FinCost, type FinProject, type FinSupplier } from './hub'
import { money } from './format'

/**
 * Guards the drill-down check. The old strip summed the rows it was checking
 * and compared them with THEMSELVES, so it could not turn red: a lever with 57
 * surveys behind it opened onto "Σ of the 0 rows below = $0 ✓" in green. Every
 * test here builds the expectation from something other than the rows.
 */

const R = (id: string, contribution: number): DrillRow => ({ id, code: id.toUpperCase(), contribution })

describe('reconcile: two checks, neither graded by the rows themselves', () => {
  it('passes when the rows add up to an independent total and list every id', () => {
    const r = reconcile({ rows: [R('a', 10), R('b', 5.5)], expectedTotal: 15.5, expectedIds: ['a', 'b'] })
    expect(r).toMatchObject({ ok: true, sumAgrees: true, idsAgree: true, rowSum: 15.5, gap: 0 })
  })

  it('turns red on a gap of a cent or more, and ignores float dust under one', () => {
    expect(reconcile({ rows: [R('a', 10)], expectedTotal: 10.004, expectedIds: ['a'] }).ok).toBe(true)
    const r = reconcile({ rows: [R('a', 10)], expectedTotal: 10 + CENT, expectedIds: ['a'] })
    expect(r.sumAgrees).toBe(false)
    expect(r.ok).toBe(false)
  })

  it('an EMPTY drill behind a non-empty figure is red, never "0 rows ✓"', () => {
    // The old lever drill: 57 ids counted, 0 rows shown, $0 = $0 in green.
    const r = reconcile({ rows: [], expectedTotal: null, expectedIds: ['a', 'b', 'c'] })
    expect(r.ok).toBe(false)
    expect(r.missingIds).toEqual(['a', 'b', 'c'])
  })

  it('names rows the figure never counted', () => {
    const r = reconcile({ rows: [R('a', 1), R('z', 1)], expectedTotal: 2, expectedIds: ['a'] })
    expect(r.extraIds).toEqual(['z'])
    expect(r.ok).toBe(false)
  })

  it('catches a duplicated row even though the id sets match', () => {
    const r = reconcile({ rows: [R('a', 1), R('a', 1)], expectedTotal: 2, expectedIds: ['a'] })
    expect(r.missingIds).toEqual([])
    expect(r.extraIds).toEqual([])
    expect(r.idsAgree).toBe(false)
  })

  it('with no total to compare (a saving range), checks the ids only', () => {
    const r = reconcile({ rows: [R('a', 100)], expectedTotal: null, expectedIds: ['a'] })
    expect(r).toMatchObject({ ok: true, gap: null, sumAgrees: true })
  })

  it('never lets a non-finite contribution poison the sum', () => {
    const r = reconcile({ rows: [R('a', 5), R('b', Number.NaN)], expectedTotal: 5, expectedIds: ['a', 'b'] })
    expect(r.rowSum).toBe(5)
  })
})

describe('reconcileText: plain words, red only for a real disagreement', () => {
  it('says the rows match', () => {
    const t = reconcileText(reconcile({ rows: [R('a', 1200), R('b', 34)], expectedTotal: 1234, expectedIds: ['a', 'b'] }), money)
    expect(t).toEqual({ ok: true, text: 'The 2 rows below add up to $1,234, which matches the figure.' })
    const one = reconcileText(reconcile({ rows: [R('a', 1200)], expectedTotal: 1200, expectedIds: ['a'] }), money)
    expect(one.text).toBe('The row below adds up to $1,200, which matches the figure.')
  })

  it('says what disagrees and tells the reader not to rely on either number', () => {
    const t = reconcileText(reconcile({ rows: [R('a', 100)], expectedTotal: 3686, expectedIds: ['a', 'b'] }), money)
    expect(t.ok).toBe(false)
    expect(t.text).toContain('$100 but the figure says $3,686')
    expect(t.text).toContain('1 of the surveys the figure counted are missing')
    expect(t.text).toContain('Do not rely on either number')
  })

  it('prints a negative gap with a real minus sign', () => {
    const t = reconcileText(reconcile({ rows: [R('a', -3586)], expectedTotal: 0, expectedIds: ['a'] }), money)
    expect(t.text).toContain('−$3,586')
  })
})

describe('spendOfIds: the same money by a different road', () => {
  const P = (id: string): FinProject => ({
    id, project_code: id, project_name: null, client: null, client_id: null, project_type: null,
    board_column: 'Delivery', status: 'Closed', phase: 'Active',
    deliver_date: null, launch_date: null, submitted_date: null,
    n_target: null, n_collected: null, n_actual: null,
  })
  const blasts: FinBlast[] = [
    { project_id: 'a', bid: 50, completes: 10, people: 1000, cost_per_send: 0.02, channel: 'sms' },
    // Email sends are free (112): only the reward counts.
    { project_id: 'a', bid: 50, completes: 2, people: 5000, cost_per_send: 0.02, channel: 'email' },
    { project_id: 'b', bid: 10, completes: 1, people: 0, cost_per_send: 0, channel: null },
  ]
  const suppliers: FinSupplier[] = [{ project_id: 'a', cpi: 1.25, n_collected: 40 }, { project_id: 'c', cpi: 2, n_collected: 10 }]
  // A recovered reward is a negative line and nets out.
  const costs: FinCost[] = [{ project_id: 'a', amount: 300 }, { project_id: 'a', amount: -120 }]

  it('agrees with spendOf survey by survey, without grouping or indexing', () => {
    const want = ['a', 'b', 'c'].reduce((t, id) => t + spendOf(P(id), blasts, suppliers, costs).total, 0)
    expect(spendOfIds(['a', 'b', 'c'], blasts, suppliers, costs)).toBeCloseTo(want, 6)
  })

  it('counts only the ids it is given', () => {
    // a: 600 reward + 20 SMS + 50 panel + 300 − 120 = 850
    expect(spendOfIds(['a'], blasts, suppliers, costs)).toBeCloseTo(850, 6)
    expect(spendOfIds([], blasts, suppliers, costs)).toBe(0)
  })
})
