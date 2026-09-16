import { describe, it, expect } from 'vitest'
import { cpqrByRoute, blastIncidence } from './cpqr'
import type { FinBlast, FinProject, FinSupplier } from './hub'

/**
 * Guards CPQR.
 *
 * The first shipped version of this file had no reconciliation guard and
 * rendered blast CPQR at $37.31 blended against its own $71.78 median, with an
 * implied QA yield of 116.5%. Both figures are impossible and both reached the
 * page. These tests exist so that cannot happen twice.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'BAM', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, ...o,
})
const B = (project_id: string, bid: number, completes: number, people = 0): FinBlast =>
  ({ project_id, bid, completes, people, cost_per_send: 0, channel: 'sms' })
const S = (project_id: string, cpi: number, n_collected: number): FinSupplier =>
  ({ project_id, cpi, n_collected })

describe('cpqrByRoute', () => {
  it('divides by what survived QA, not by what we bought', () => {
    // Bought 100 at $1 = $100. QA passed 50. A usable respondent cost $2, not $1.
    const rows = [P({ id: 'x', project_type: 'PS', n_collected: 100, n_actual: 50 })]
    const r = cpqrByRoute(rows, [], [S('x', 1, 100)], [])
    expect(r[0]).toMatchObject({ route: 'panel', blended: 2, qualified: 50, paid: 100 })
    expect(r[0].scrubRate).toBeCloseTo(0.5)
  })

  it('EXCLUDES a survey whose recorded completes do not cover its collected N', () => {
    // THE GUARD. 'bad' claims 100 delivered but its rows account for only 20;
    // dividing $20 by 100 would report $0.20 a respondent and drag the blended
    // figure below the median of every honest survey in the set.
    const rows = [
      P({ id: 'ok', n_collected: 10, n_actual: 10 }),
      P({ id: 'bad', n_collected: 100, n_actual: 100 }),
    ]
    const blasts = [B('ok', 5, 10), B('bad', 1, 20)]
    const r = cpqrByRoute(rows, blasts, [], [])
    expect(r[0]).toMatchObject({ route: 'blast', n: 1, blended: 5, excluded: 1 })
  })

  it('never reports a QA yield above 100%, which the unguarded version did', () => {
    // paid(100) covers n_collected(100) but NOT n_actual(150). Guarding on
    // n_collected alone would let this through and report a 150% yield — the
    // exact shape of the bug that shipped. max() closes it.
    const rows = [P({ id: 'x', n_collected: 100, n_actual: 150 })]
    expect(cpqrByRoute(rows, [B('x', 1, 100)], [], [])).toEqual([])
  })

  it('still admits a survey whose records cover both figures', () => {
    const rows = [P({ id: 'x', n_collected: 100, n_actual: 80 })]
    const r = cpqrByRoute(rows, [B('x', 1, 100)], [], [])
    expect(r[0]).toMatchObject({ n: 1, qualified: 80, paid: 100, excluded: 0 })
    expect(r[0].blended).toBeCloseTo(1.25)
  })

  it('counts exclusions PER ROUTE, not across both', () => {
    // A shared counter reported panel's exclusions on blast's card.
    const rows = [
      P({ id: 'b1', n_collected: 10, n_actual: 10 }),
      P({ id: 'bBad', n_collected: 100, n_actual: 100 }),
      P({ id: 'p1', project_type: 'PS', n_collected: 10, n_actual: 10 }),
    ]
    const r = cpqrByRoute(rows, [B('b1', 5, 10), B('bBad', 1, 20)], [S('p1', 1, 10)], [])
    expect(r.find(x => x.route === 'panel')!.excluded).toBe(0)
    expect(r.find(x => x.route === 'blast')!.excluded).toBe(1)
  })

  it('reports the typical survey as well as the portfolio figure', () => {
    // They answer different questions and diverge when one study is large.
    const rows = Array.from({ length: 5 }, (_, k) =>
      P({ id: `s${k}`, n_collected: 10, n_actual: 10 }))
    const r = cpqrByRoute(rows, rows.map(x => B(x.id, 3, 10)), [], [])
    expect(r[0]).toMatchObject({ n: 5, median: 3, blended: 3 })
  })

  it('ignores undelivered work, whose n_actual is not final', () => {
    const rows = [P({ id: 'x', board_column: 'Data QA', n_collected: 10, n_actual: 10 })]
    expect(cpqrByRoute(rows, [B('x', 5, 10)], [], [])).toEqual([])
  })

  it('measures route from rows, never from project_type', () => {
    // Typed B2B, holds only supplier rows. It is a panel survey.
    const rows = [P({ id: 'x', project_type: 'B2B', n_collected: 10, n_actual: 10 })]
    expect(cpqrByRoute(rows, [], [S('x', 2, 10)], [])[0].route).toBe('panel')
  })

  it('skips a survey with no post-QA count rather than assuming none was lost', () => {
    const rows = [P({ id: 'x', n_collected: 10, n_actual: null })]
    expect(cpqrByRoute(rows, [B('x', 5, 10)], [], [])).toEqual([])
  })
})

describe('blastIncidence', () => {
  it('measures completes per person reached', () => {
    const rows = [P({ id: 'x' })]
    const r = blastIncidence(rows, [B('x', 1, 10, 10_000)], [])
    expect(r).toMatchObject({ reach: 10_000, completes: 10 })
    expect(r!.rate).toBeCloseTo(0.001)
  })

  it('returns null rather than 0 when no reach was recorded', () => {
    // Panel has no reach column at all. A rate of 0 would read as "nobody
    // answered" instead of "nobody wrote it down".
    expect(blastIncidence([P({ id: 'x' })], [B('x', 1, 10, 0)], [])).toBeNull()
  })
})
