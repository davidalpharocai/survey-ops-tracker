import { describe, it, expect } from 'vitest'
import {
  FIN_COLUMNS, finColumnsFor, finIncludedRestricted, buildFinanceCsv, dateBasis,
} from './exportFinance'
import { surveyPnl } from './analysis'
import type { FinBlast, FinProject } from './hub'

/**
 * Guards the finance CSV.
 *
 * The gate is the point: a file with a "Revenue" header and blank cells still
 * tells a reader that revenue is tracked and that they are not allowed to see
 * it. Restricted columns are ABSENT, not empty.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'Study', client: 'BAM', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 130, n_actual: 110, ...o,
})
const B = (project_id: string, bid: number, completes: number): FinBlast =>
  ({ project_id, bid, completes, people: 0, cost_per_send: 0, channel: 'sms' })
const ACC = new Map([['acc1', 'BAM']])

const pnlOf = (rows: FinProject[], rates = new Map<string, number>(), blasts: FinBlast[] = []) =>
  surveyPnl(rows, rates, blasts, [], [], ACC)

describe('the finance gate', () => {
  it('REMOVES restricted columns rather than blanking them', () => {
    const open = finColumnsFor(false).map(c => c.header)
    expect(open).not.toContain('Revenue')
    expect(open).not.toContain('Price per N')
    expect(open).not.toContain('Margin $')
    expect(open).not.toContain('Budget (ceiling)')
    // The cost side stays — analysts need it and it was always open to them.
    expect(open).toContain('Total cost')
    expect(open).toContain('CPQR')
  })

  it('keeps them for a holder', () => {
    expect(finColumnsFor(true).map(c => c.header)).toContain('Revenue')
  })

  it('reports whether restricted columns were actually written, not intent', () => {
    expect(finIncludedRestricted(finColumnsFor(true))).toBe(true)
    expect(finIncludedRestricted(finColumnsFor(false))).toBe(false)
  })

  it('never writes a restricted VALUE into an open file', () => {
    const rows = pnlOf([P()], new Map([['p1', 500]]), [B('p1', 10, 130)])
    const csv = buildFinanceCsv(rows, finColumnsFor(false), new Map([['p1', P({ budget: 9999 })]]))
    expect(csv).not.toContain('500')
    expect(csv).not.toContain('9999')
  })
})

describe('the three columns that exist nowhere else', () => {
  it('exports the MEASURED route, not the filed type', () => {
    // Typed B2B, holds no blast rows and no supplier rows.
    const rows = pnlOf([P({ project_type: 'B2B' })])
    const csv = buildFinanceCsv(rows, finColumnsFor(false), new Map([['p1', P()]]))
    const [head, body] = csv.split('\r\n')
    const cols = head.split(',')
    const cells = body.split(',')
    expect(cells[cols.indexOf('Type (as filed)')]).toBe('B2B')
    expect(cells[cols.indexOf('Route (measured)')]).toBe('none')
  })

  it('names which date field the row landed on', () => {
    expect(dateBasis(P())).toBe('deliver_date')
    expect(dateBasis(P({ deliver_date: null, launch_date: '2026-07-01' }))).toBe('launch_date')
    expect(dateBasis(P({ deliver_date: null, launch_date: null, submitted_date: '2026-06-01' }))).toBe('submitted_date')
    expect(dateBasis(P({ deliver_date: null, launch_date: null, submitted_date: null }))).toBe('undated')
  })

  it('exports whether the survey reconciles', () => {
    const ok = pnlOf([P({ n_collected: 10 })], new Map(), [B('p1', 1, 10)])
    const bad = pnlOf([P({ n_collected: 100 })], new Map(), [B('p1', 1, 10)])
    expect(ok[0].reconciled).toBe(true)
    expect(bad[0].reconciled).toBe(false)
    const csv = buildFinanceCsv(bad, finColumnsFor(false))
    expect(csv.split('\r\n')[1]).toContain('No')
  })
})

describe('the N columns', () => {
  it('derives scrub, over-target and shortfall from the same row', () => {
    // 100 target, 130 collected, 110 survived: scrub 20, over-target 10, no shortfall.
    const rows = pnlOf([P()])
    const cols = FIN_COLUMNS
    const get = (h: string) => cols.find(c => c.header === h)!.value(rows[0], P())
    expect(get('Scrub N')).toBe(20)
    expect(get('Over-target N')).toBe(10)
    expect(get('Shortfall N')).toBe(0)
  })

  it('reports a shortfall when we came up short, and no over-target', () => {
    const rows = pnlOf([P({ n_target: 100, n_collected: 80, n_actual: 70 })])
    const get = (h: string) => FIN_COLUMNS.find(c => c.header === h)!.value(rows[0], P())
    expect(get('Shortfall N')).toBe(30)
    expect(get('Over-target N')).toBe(0)
  })

  it('leaves a derived N BLANK rather than 0 when an input is missing', () => {
    // 0 would read as "nothing was scrubbed" instead of "nobody recorded it".
    const rows = pnlOf([P({ n_actual: null })])
    const get = (h: string) => FIN_COLUMNS.find(c => c.header === h)!.value(rows[0], P())
    expect(get('Scrub N')).toBeNull()
    expect(get('Shortfall N')).toBeNull()
  })
})

describe('csv shape', () => {
  it('quotes a field containing a comma', () => {
    const rows = pnlOf([P({ project_name: 'Buyers, Sellers and Holders' })])
    expect(buildFinanceCsv(rows, finColumnsFor(false))).toContain('"Buyers, Sellers and Holders"')
  })

  it('writes one header row and one row per survey', () => {
    const rows = pnlOf([P({ id: 'a' }), P({ id: 'b' })])
    expect(buildFinanceCsv(rows, finColumnsFor(false)).split('\r\n')).toHaveLength(3)
  })
})
