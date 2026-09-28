import { describe, it, expect } from 'vitest'
import {
  FIN_COLUMNS, finColumnsFor, finIncludedRestricted, buildFinanceCsv, dateBasis,
  buildTableCsv, drillHeader, drillTable, exportFileName, exportLogMessage, pnlExport,
  type ExportTable,
} from './exportFinance'
import type { DrillSpec } from './drill'
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

  it('writes the lifecycle in words, and never the retired "Archived"', () => {
    const get = (p: FinProject) => {
      const rows = pnlOf([p])
      return FIN_COLUMNS.find(c => c.header === 'Lifecycle')!.value(rows[0], p) as string
    }
    // Closed AND in the Delivery column: it really was delivered.
    expect(get(P())).toBe('Delivered')
    // Closed but it never reached Delivery. The classifier calls this class
    // 'archived'; David retired that word on 2026-09-28, and the file must not
    // print a raw enum id at a busy executive either.
    const stopped = get(P({ board_column: 'Fielding' }))
    expect(stopped).toBe('Closed before delivery')
    expect(stopped).not.toMatch(/archiv/i)
    expect(get(P({ status: 'Cancelled', board_column: 'Fielding' }))).toBe('Cancelled')
    expect(get(P({ status: 'Hold', board_column: 'Fielding' }))).toBe('On hold')
    expect(get(P({ status: 'Open', board_column: 'Fielding' }))).toBe('Live')
    // The RAW status column is the database's own value and stays untouched:
    // a recipient reconciling against a dump needs it to match.
    const csv = buildFinanceCsv(pnlOf([P({ board_column: 'Fielding' })]), finColumnsFor(false), new Map([['p1', P({ board_column: 'Fielding' })]]))
    const [head, body] = csv.split('\r\n')
    const cols = head.split(',')
    expect(body.split(',')[cols.indexOf('Status')]).toBe('Closed')
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

  it('measures over-target and shortfall on the SURVEY, never segment by segment', () => {
    // Buyers 120 of 100, Sellers 80 of 100, survey 200 of 200 (David,
    // 2026-09-27: the bill is the survey's). Segment by segment this row read
    // 180 billed, 20 over and 20 short.
    const p = P({ n_target: 200, n_collected: 230, n_actual: 200, segments: [
      { id: 'b', project_id: 'p1', n_target: 100, n_actual: 120 },
      { id: 's', project_id: 'p1', n_target: 100, n_actual: 80 },
    ] })
    const rows = pnlOf([p], new Map([['p1', 20]]))
    const get = (h: string) => FIN_COLUMNS.find(c => c.header === h)!.value(rows[0], p)
    expect(get('Billed N')).toBe(200)
    expect(get('Over-target N')).toBe(0)
    expect(get('Shortfall N')).toBe(0)
    expect(get('Revenue')).toBe(4000)
    expect(get('Segment check')).toBe('Segments add up')
  })

  it('says what the segments disagree about, and blanks the note for a survey without segments', () => {
    // 110 typed on the survey; the counted segment says 100 — not a roll-up.
    const missing = P({ n_actual: 110, segments: [
      { id: 'a', project_id: 'p1', n_target: 50, n_actual: 100 },
      { id: 'b', project_id: 'p1', n_target: 50, n_actual: null },
    ] })
    const off = P({ n_actual: 110, segments: [
      { id: 'a', project_id: 'p1', n_target: 50, n_actual: 50 },
      { id: 'b', project_id: 'p1', n_target: 50, n_actual: 50 },
    ] })
    const rolled = P({ n_actual: null, segments: [
      { id: 'a', project_id: 'p1', n_target: 50, n_actual: 60 },
      { id: 'b', project_id: 'p1', n_target: 50, n_actual: 40 },
    ] })
    const note = (p: FinProject) => FIN_COLUMNS.find(c => c.header === 'Segment check')!.value(pnlOf([p])[0], p)
    expect(note(missing)).toBe('1 of 2 segments has no N actual')
    expect(note(off)).toBe('Segments add up to 100; the survey says 110')
    expect(note(rolled)).toBe('Survey N actual blank; rolled up from the segments')
    expect(note(P())).toBeNull()
    // Counts, not prices: open to every reader.
    expect(finColumnsFor(false).map(c => c.header)).toContain('Segment check')
  })

  it('blanks CPQR and Scrub N on a partial segment roll-up, bills it, and says why (PR00231)', () => {
    // The survey's 110 is the counted segment's 110 and nothing more; 130 were
    // bought across both. "20 scrubbed" and a CPQR over 110 are not facts.
    const p = P({ n_actual: 110, segments: [
      { id: 'a', project_id: 'p1', n_target: 50, n_actual: 110 },
      { id: 'b', project_id: 'p1', n_target: 50, n_actual: null },
    ] })
    const rows = pnlOf([p], new Map([['p1', 5]]), [B('p1', 2, 130)])
    const get = (h: string) => FIN_COLUMNS.find(c => c.header === h)!.value(rows[0], p)
    expect(get('Scrub N')).toBeNull()
    expect(get('CPQR')).toBeNull()
    // The bill and the cost per complete bought are untouched.
    expect(get('Billed N')).toBe(100)
    expect(get('Revenue')).toBe(500)
    expect(get('Cost per complete')).toBe(2)
    expect(get('Segment check')).toBe('1 of 2 segments has no N actual; the survey N actual adds up only the others; CPQR and Scrub N left blank')
    // The file writes the note without quoting: no commas in it.
    const line = buildFinanceCsv(rows, FIN_COLUMNS, new Map([['p1', p]])).split('\r\n')[1]
    expect(line).toContain(',1 of 2 segments has no N actual; the survey N actual adds up only the others; CPQR and Scrub N left blank,')
  })

  it('names a segment priced differently in the restricted price status, and bills the survey rate', () => {
    const p = P({ segments: [{ id: 'a', project_id: 'p1', n_target: 100, n_actual: 110, price_per_n: 9 }] })
    const rows = pnlOf([p], new Map([['p1', 5]]))
    const get = (h: string) => FIN_COLUMNS.find(c => c.header === h)!.value(rows[0], p)
    expect(get('Revenue')).toBe(500)
    expect(get('Price status')).toBe('Priced; a segment is priced differently and the bill uses the survey rate')
    const unpriced = pnlOf([p])
    expect(FIN_COLUMNS.find(c => c.header === 'Price status')!.value(unpriced[0], p))
      .toBe('No price; only a segment carries one. Set the survey rate')
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

/* ── Export what you see (the four-tab shell) ───────────────────────────── */

describe('buildTableCsv — the rows a tab registered, under the header block', () => {
  const table: ExportTable = {
    name: 'finance-results-surveys',
    columns: [{ key: 'code', header: 'Survey' }, { key: 'name', header: 'Name' }, { key: 'kept', header: 'We keep' }],
    rows: [
      { code: 'PR00001', name: 'Buyers, Sellers and Holders', kept: -3586.25 },
      { code: 'PR00002', name: 'Say "hi"', kept: null },
    ],
  }

  it('writes the header block, a blank line, the column row, then one line per row', () => {
    const lines = buildTableCsv(table, ['SOCC finance export', 'As of: 27 Sep 2026, 6:40 PM Eastern', 'Rows: 2']).split('\r\n')
    // A header line with a comma is quoted like any cell; a spreadsheet shows it plain.
    expect(lines.slice(0, 4)).toEqual(['SOCC finance export', '"As of: 27 Sep 2026, 6:40 PM Eastern"', 'Rows: 2', ''])
    expect(lines[4]).toBe('Survey,Name,We keep')
    expect(lines).toHaveLength(7)
  })

  it('quotes commas and doubles quotes; a missing value is an empty cell, never 0', () => {
    const lines = buildTableCsv(table).split('\r\n')
    expect(lines[1]).toBe('PR00001,"Buyers, Sellers and Holders",-3586.25')
    expect(lines[2]).toBe('PR00002,"Say ""hi""",')
  })

  it('defuses text a spreadsheet would run as a formula', () => {
    const evil: ExportTable = {
      name: 'x', columns: [{ key: 'a', header: 'A' }],
      rows: [{ a: '=HYPERLINK("http://x","y")' }, { a: '+1+1' }, { a: '-2+3' }, { a: '@SUM(A1)' }, { a: '\tlead' }, { a: 'fine' }],
    }
    const cells = buildTableCsv(evil).split('\r\n').slice(1)
    expect(cells[0]).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(cells[1]).toBe("'+1+1")
    expect(cells[2]).toBe("'-2+3")
    expect(cells[3]).toBe("'@SUM(A1)")
    expect(cells[4]).toBe("'\tlead")
    expect(cells[5]).toBe('fine')
  })

  it('leaves a real negative NUMBER alone, so the spreadsheet can still add it up', () => {
    // A number cannot carry a formula; only text is defused.
    expect(buildTableCsv({ name: 'x', columns: [{ key: 'a', header: 'A' }], rows: [{ a: -7338.14 }] }).split('\r\n')[1]).toBe('-7338.14')
  })

  it('guards the header block too', () => {
    expect(buildTableCsv(table, ['=cmd']).split('\r\n')[0]).toBe("'=cmd")
  })

  it('guards the per-survey file as well (a survey name typed as a formula)', () => {
    const rows = pnlOf([P({ project_name: '=IMPORTXML("http://x")' })])
    expect(buildFinanceCsv(rows, finColumnsFor(false))).toContain('"\'=IMPORTXML(""http://x"")"')
  })
})

describe('exportFileName', () => {
  it('stamps the date and can never name a path', () => {
    expect(exportFileName('finance-results-surveys', '2026-09-28')).toBe('socc-finance-results-surveys-2026-09-28.csv')
    expect(exportFileName('../../etc/passwd', '2026-09-28')).toBe('socc-etc-passwd-2026-09-28.csv')
    expect(exportFileName('', '2026-09-28')).toBe('socc-finance-2026-09-28.csv')
  })
})

describe('pnlExport — FIN_COLUMNS as a table a tab can register', () => {
  it('keeps every column in order for a finance holder, and the restricted ones out otherwise', () => {
    const rows = pnlOf([P()])
    const all = pnlExport('finance-results-surveys', rows, [P()], { canViewFinancials: true })
    expect(all.columns.map(c => c.header)).toEqual(FIN_COLUMNS.map(c => c.header))
    const open = pnlExport('x', rows, [P()], { canViewFinancials: false })
    expect(open.columns.map(c => c.header)).not.toContain('Revenue')
    expect(all.rows[0][all.columns.find(c => c.header === 'Project code')!.key]).toBe('PR00001')
  })
})

describe('drill files', () => {
  const spec: DrillSpec = {
    key: 'margin', title: 'We keep', population: 'Delivered · From 1 Jun 2026 · 2 surveys',
    columns: [{ key: 'acct', header: 'Account', value: r => String(r.account ?? '') }],
    rows: [
      { id: 'a', code: 'PR00001', contribution: 100.004, account: 'BAM' },
      { id: 'b', code: null, contribution: 50, account: '=evil' },
    ],
    expectedTotal: 150, expectedIds: ['a', 'b'], totalLabel: 'We keep', format: 'money',
  }

  it('writes the code, the columns and the contribution to the cent', () => {
    const t = drillTable(spec)
    expect(t.columns.map(c => c.header)).toEqual(['Survey', 'Account', 'We keep'])
    expect(t.rows[0]).toEqual({ code: 'PR00001', c0: 'BAM', contribution: 100 })
    expect(t.rows[1].code).toBe('(no code)')
    expect(buildTableCsv(t).split('\r\n')[2]).toBe("(no code),'=evil,50")
  })

  it("adds what the drill is and what its check said to the page's header", () => {
    const h = drillHeader(spec, ['SOCC finance export'])
    expect(h[0]).toBe('SOCC finance export')
    expect(h).toContain('Drill: We keep')
    expect(h.find(l => l.startsWith('Check:'))).toMatch(/^Check: agrees — The 2 rows below add up to \$150/)
    const bad = drillHeader({ ...spec, expectedTotal: 900 }, [])
    expect(bad.find(l => l.startsWith('Check:'))).toMatch(/^Check: DOES NOT AGREE/)
  })
})

describe('exportLogMessage — what the page says after the file downloads', () => {
  it('names the export number when the log row was written', () => {
    expect(exportLogMessage({ ok: true, status: 200, id: '0f3c9a12-aaaa-bbbb-cccc-000000000000', error: null }).text)
      .toBe('Logged as export #0f3c9a12')
  })

  it('says it was NOT logged, and why, without suggesting the file failed', () => {
    const t = (r: Parameters<typeof exportLogMessage>[0]) => exportLogMessage(r).text
    expect(t({ ok: false, status: 500, id: null, error: 'the audit row could not be written' }))
      .toBe('Export not logged: the audit row could not be written (server answered 500). Your file still downloaded.')
    expect(t({ ok: false, status: 404, id: null, error: 'export log returned 404' })).toContain('the export log service was not found')
    expect(t({ ok: false, status: 401, id: null, error: 'Unauthorized' })).toContain('signed out')
    expect(t({ ok: false, status: 0, id: null, error: 'Failed to fetch' })).toContain('did not reach the server (Failed to fetch)')
    expect(exportLogMessage({ ok: false, status: 500, id: null, error: null }).ok).toBe(false)
  })
})
