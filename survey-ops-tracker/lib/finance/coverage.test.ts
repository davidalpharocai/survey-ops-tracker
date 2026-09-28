import { describe, it, expect } from 'vitest'
import {
  coverageByMonth, coverageTotals, firstBlastAt, monthInRange, monthLabel, recoveriesMissing,
  reliabilityDates, reliableFrom,
  RELIABILITY, MIN_MONTH_SURVEYS, type CoverageMonth,
} from './coverage'
import type { FinBlast, FinCost, FinProject, FinSupplier } from './hub'

/**
 * Guards the coverage table and the COMPUTED reliability dates. The banner's
 * "most reliable from" dates used to be typed into the copy, and a typed date
 * cannot notice David backfilling client prices toward 1 June. These tests pin
 * the rule — the first month from which coverage STAYS over a named threshold —
 * and prove that a backfill moves the date with no code change.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p', project_code: 'PR00001', project_name: 'S', client: null, client_id: 'acc',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-06-10', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
const B = (project_id: string, bid = 10, completes = 10): FinBlast =>
  ({ project_id, bid, completes, people: 0, cost_per_send: 0, channel: 'sms' })
const S = (project_id: string): FinSupplier => ({ project_id, cpi: 1, n_collected: 10 })

describe('coverageByMonth', () => {
  const rows = [
    P({ id: 'jun-b2b-costed', budget: 500 }),
    P({ id: 'jun-b2b-bare', n_actual: null }),
    P({ id: 'jun-ps', project_type: 'PS' }),
    P({ id: 'jul', deliver_date: '2026-07-02' }),
    P({ id: 'undated', deliver_date: null }),
    // Placed by launch date when there is no deliver date.
    P({ id: 'by-launch', deliver_date: null, launch_date: '2026-07-20' }),
    // Not delivered: never in this table.
    P({ id: 'live', board_column: 'Fielding', deliver_date: '2026-06-15' }),
    // An empty rerun shell is not a survey.
    P({ id: 'shell', is_placeholder: true, n_collected: 0, n_actual: null }),
  ]
  const blasts = [B('jun-b2b-costed'), B('jul')]
  const suppliers = [S('jun-ps')]
  const rates = new Map([['jun-b2b-costed', 0], ['jul', 50]])
  const months = coverageByMonth(rows, rates, blasts, suppliers, [])
  const by = Object.fromEntries(months.map(m => [m.key, m]))

  it('buckets delivered surveys by deliver date, then launch date, with Undated last', () => {
    expect(months.map(m => m.key)).toEqual(['2026-06', '2026-07', 'undated'])
    expect(by['2026-06'].delivered).toBe(3)
    expect(by['2026-07'].delivered).toBe(2)
    expect(by.undated.delivered).toBe(1)
  })

  it('excludes empty placeholders and work that is not delivered', () => {
    // Six delivered surveys; the empty shell (on the Delivery column) and the
    // live survey are in no month.
    expect(months.reduce((t, m) => t + m.delivered, 0)).toBe(6)
    const everyId = months.flatMap(m => m.cells.date.missingIds.concat(m.cells.cost.missingIds))
    expect(everyId).not.toContain('shell')
  })

  it('counts each field, and lists the surveys missing it', () => {
    const jun = by['2026-06'].cells
    expect(jun.cost).toMatchObject({ have: 2, of: 3 })
    expect(jun.cost.missingIds).toEqual(['jun-b2b-bare'])
    // A $0 price is a real price, and counts as covered.
    expect(jun.price).toMatchObject({ have: 1, of: 3 })
    expect(jun.budget).toMatchObject({ have: 1, of: 3 })
    expect(jun.postQaN).toMatchObject({ have: 2, of: 3, missingIds: ['jun-b2b-bare'] })
  })

  it('measures route rows against the surveys FILED as that type, not all delivered', () => {
    const jun = by['2026-06'].cells
    expect(jun.b2bBlastRows).toMatchObject({ have: 1, of: 2 })
    expect(jun.psPanelRows).toMatchObject({ have: 1, of: 1, pct: 1 })
  })

  it('reports a field with nothing to divide as null, never 0%', () => {
    expect(by['2026-07'].cells.psPanelRows.pct).toBeNull()
  })

  it('totals across months, Undated included', () => {
    const t = coverageTotals(months)
    expect(t.date).toMatchObject({ have: 5, of: 6 })
    expect(t.cost.have).toBe(3)
  })
})

describe('recoveries pending', () => {
  it('flags a month whose rewarded blast surveys mostly have no recovery booked', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-07-01' }), P({ id: 'b', deliver_date: '2026-07-02' }),
      P({ id: 'c', deliver_date: '2026-09-01' }), P({ id: 'd', deliver_date: '2026-09-02' }),
    ]
    const costs: FinCost[] = [
      { project_id: 'a', amount: -10 }, { project_id: 'b', amount: -5 }, { project_id: 'c', amount: -3 },
    ]
    const m = coverageByMonth(rows, new Map(), ['a', 'b', 'c', 'd'].map(id => B(id)), [], costs)
    const jul = m.find(x => x.key === '2026-07')!, sep = m.find(x => x.key === '2026-09')!
    expect(jul.recoveries).toEqual({ rewarded: 2, credited: 2, pending: false, missingIds: [] })
    expect(sep.recoveries).toEqual({ rewarded: 2, credited: 1, pending: true, missingIds: ['d'] })
  })

  it('lists the rewarded surveys with no recovery booked, for a drill to check itself against', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-07-01' }), P({ id: 'b', deliver_date: '2026-07-02' }),
      P({ id: 'c', deliver_date: '2026-09-01' }), P({ id: 'd', deliver_date: '2026-09-02' }),
    ]
    const costs: FinCost[] = [{ project_id: 'a', amount: -10 }, { project_id: 'b', amount: -5 }]
    const m = coverageByMonth(rows, new Map(), ['a', 'b', 'c', 'd'].map(id => B(id)), [], costs)
    expect(recoveriesMissing(m).slice().sort()).toEqual(['c', 'd'])
  })
})

/** A month with `n` delivered surveys and `share` of them priced. */
const month = (key: string, n: number, share: number): CoverageMonth => {
  const have = Math.round(n * share)
  const c = (h: number) => ({ have: h, of: n, pct: n ? h / n : null, missingIds: [] })
  return {
    key, delivered: n,
    cells: {
      cost: c(n), price: c(have), budget: c(0), postQaN: c(n),
      psPanelRows: c(0), b2bBlastRows: c(0), date: c(key === 'undated' ? 0 : n),
    },
    recoveries: { rewarded: 0, credited: 0, pending: false, missingIds: [] },
  }
}

describe('reliableFrom: the first month coverage STAYS over the line', () => {
  it('starts the run at the first month that never drops back below', () => {
    const ms = [month('2026-05', 20, 0.3), month('2026-06', 40, 0.1), month('2026-07', 40, 0.3), month('2026-08', 50, 0.5)]
    // May clears 25% but June falls back, so the run starts in July.
    expect(reliableFrom(ms, 'price', 0.25)).toBe('2026-07')
  })

  it('moves by itself when a backfill lifts an early month — no code change', () => {
    const before = [month('2026-06', 40, 0.1), month('2026-07', 40, 0.17), month('2026-08', 50, 0.27), month('2026-09', 40, 0.51)]
    expect(reliableFrom(before, 'price', RELIABILITY.price.threshold)).toBe('2026-08')
    const after = [month('2026-06', 40, 0.4), month('2026-07', 40, 0.35), month('2026-08', 50, 0.27), month('2026-09', 40, 0.51)]
    expect(reliableFrom(after, 'price', RELIABILITY.price.threshold)).toBe('2026-06')
  })

  it('is null ("not yet") when even the latest month falls short', () => {
    expect(reliableFrom([month('2026-08', 40, 0.5), month('2026-09', 40, 0.1)], 'price', 0.25)).toBeNull()
  })

  it('ignores Undated and months too small to say anything about practice', () => {
    const ms = [month('2026-06', 40, 0.5), month('2026-07', MIN_MONTH_SURVEYS - 1, 0), month('undated', 60, 0)]
    expect(reliableFrom(ms, 'price', 0.25)).toBe('2026-06')
  })

  it('returns all three banner dates with their thresholds and words', () => {
    const d = reliabilityDates([month('2026-06', 40, 0.1), month('2026-08', 40, 0.3)])
    expect(d.cost).toMatchObject({ month: '2026-06', date: '2026-06-01', threshold: RELIABILITY.cost.threshold })
    expect(d.price).toMatchObject({ month: '2026-08', date: '2026-08-01' })
    expect(d.budget).toMatchObject({ month: null, date: null })
    expect(d.price.words.length).toBeGreaterThan(0)
  })
})

describe('delivered N follows the bill (revenue.ts deliveredNOf)', () => {
  it('counts a segmented survey whose own figure is blank but every segment is counted', () => {
    const seg = (id: string, n: number | null) => ({ id, project_id: 'seg', n_target: 50, n_actual: n })
    const rows = [
      P({ id: 'seg', n_actual: null, segments: [seg('a', 40), seg('b', 45)] }),
      P({ id: 'half', n_actual: null, segments: [seg('c', 40), seg('d', null)] }),
    ]
    const jun = coverageByMonth(rows, new Map(), [], [], [])[0].cells.postQaN
    expect(jun).toMatchObject({ have: 1, of: 2, missingIds: ['half'] })
  })
})

describe('the backfill case, end to end through survey rows', () => {
  // Four costed, delivered surveys a month, Jun–Sep; prices only from August.
  const book = (junJulPriced: number) => {
    const rows: FinProject[] = []
    const blasts: FinBlast[] = []
    const rates = new Map<string, number>()
    for (const m of ['06', '07', '08', '09']) {
      for (let i = 0; i < 4; i++) {
        const id = `${m}-${i}`
        rows.push(P({ id, deliver_date: `2026-${m}-1${i}` }))
        blasts.push(B(id))
        const priced = m === '08' || m === '09' ? 2 : junJulPriced
        if (i < priced) rates.set(id, 20)
      }
    }
    // An empty placeholder parked in June must not dilute June's coverage.
    rows.push(P({ id: 'shell', deliver_date: '2026-06-20', is_placeholder: true, n_collected: 0, n_actual: null }))
    return coverageByMonth(rows, rates, blasts, [], [])
  }

  it('leaves placeholders out of the month they are dated in', () => {
    expect(book(0).find(m => m.key === '2026-06')!.delivered).toBe(4)
  })

  it('moves the price date from August to June once June and July are priced — no code change', () => {
    expect(reliabilityDates(book(0)).price.month).toBe('2026-08')
    expect(reliabilityDates(book(1)).price.month).toBe('2026-06')
    // Cost was reliable all along, and stays put.
    expect(reliabilityDates(book(1)).cost.month).toBe('2026-06')
  })
})

describe('monthInRange: which heatmap columns a date filter highlights', () => {
  it('selects a month when any day of it is inside the range', () => {
    expect(monthInRange('2026-06', { from: '2026-06-01', to: null })).toBe(true)
    expect(monthInRange('2026-05', { from: '2026-06-01', to: null })).toBe(false)
    expect(monthInRange('2026-08', { from: '2026-08-31', to: '2026-09-02' })).toBe(true)
    expect(monthInRange('2026-10', { from: '2026-06-01', to: '2026-09-30' })).toBe(false)
  })

  it('selects Undated only when the range is open at both ends', () => {
    expect(monthInRange('undated', { from: null, to: null })).toBe(true)
    expect(monthInRange('undated', { from: '2026-06-01', to: null })).toBe(false)
  })
})

describe('small helpers', () => {
  it('finds the earliest dated blast', () => {
    const b = [{ ...B('a'), blast_at: '2026-06-03T10:00:00Z' }, { ...B('b'), blast_at: '2026-06-01T21:30:00Z' }, { ...B('c'), blast_at: null }]
    expect(firstBlastAt(b)).toBe('2026-06-01T21:30:00Z')
    expect(firstBlastAt([])).toBeNull()
  })

  it('labels months plainly', () => {
    expect(monthLabel('2026-06')).toBe('Jun 2026')
    expect(monthLabel('undated')).toBe('Undated')
  })
})
