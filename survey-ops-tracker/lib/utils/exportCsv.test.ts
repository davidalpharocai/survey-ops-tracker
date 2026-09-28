import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  csvColumnsFor,
  csvIncludedRestricted,
  buildProjectsCsv,
  logExport,
} from './exportCsv'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// A partial row is enough: every column reads one field, and a missing field
// renders as an empty cell — which is exactly what a sparse real project does.
const project = {
  project_code: 'PR00123',
  project_name: 'Homebuyer Sentiment',
  client: 'Holocene',
  n_target: 800,
  budget: 12500,
  actual_spend: 9100,
} as unknown as SurveyProject

const headersOf = (canViewFinancials: boolean) =>
  csvColumnsFor(canViewFinancials).map(c => c.header)

describe('csvColumnsFor', () => {
  it('omits Budget for a user without view_financials', () => {
    expect(headersOf(false)).not.toContain('Budget')
  })

  it('includes Budget for a capability holder', () => {
    expect(headersOf(true)).toContain('Budget')
  })

  it('keeps cost-to-run public — Actual Spend survives the strip', () => {
    // The locked decision: budget/price/margin are restricted, what we actually
    // spent is everyone's business.
    expect(headersOf(false)).toContain('Actual Spend')
  })

  it('strips ONLY the restricted columns', () => {
    const restricted = csvColumnsFor(true).filter(c => c.restricted).map(c => c.header)
    const gated = headersOf(false)
    expect(restricted.length).toBeGreaterThan(0)
    expect(headersOf(true).filter(h => !restricted.includes(h))).toEqual(gated)
  })

  it('does not mutate the shared column list between calls', () => {
    const before = headersOf(true).length
    headersOf(false)
    expect(headersOf(true)).toHaveLength(before)
  })
})

describe('csvIncludedRestricted', () => {
  it('is what gets logged: true only when restricted columns were written', () => {
    expect(csvIncludedRestricted(csvColumnsFor(true))).toBe(true)
    expect(csvIncludedRestricted(csvColumnsFor(false))).toBe(false)
  })
})

describe('buildProjectsCsv', () => {
  it("a non-holder's file contains neither the header nor the value", () => {
    const csv = buildProjectsCsv([project], csvColumnsFor(false))
    expect(csv).not.toContain('Budget')
    expect(csv).not.toContain('12500')
    // ...but the row is otherwise intact, including the public money.
    expect(csv).toContain('PR00123')
    expect(csv).toContain('9100')
  })

  it("a holder's file carries the budget", () => {
    const csv = buildProjectsCsv([project], csvColumnsFor(true))
    expect(csv).toContain('Budget')
    expect(csv).toContain('12500')
  })

  it('keeps header and row column counts in step after stripping', () => {
    const [header, row] = buildProjectsCsv([project], csvColumnsFor(false)).split('\r\n')
    expect(row.split(',')).toHaveLength(header.split(',').length)
  })

  it('writes a header-only file for no projects', () => {
    expect(buildProjectsCsv([], csvColumnsFor(false)).split('\r\n')).toHaveLength(1)
  })
})

// The guard that stops a CSV becoming a script. It lives in csvCell, which
// every exporter shares, so the board and list files get it as well as the
// finance ones — a project name is typed by people, and a spreadsheet runs a
// cell that starts with =, +, - or @ the moment the file is opened.
describe('the spreadsheet formula guard', () => {
  it('defuses a name and a client a spreadsheet would run', () => {
    const evil = { ...project, project_name: '=SUM(A1:A9)', client: '@holocene' } as unknown as SurveyProject
    const row = buildProjectsCsv([evil], csvColumnsFor(false)).split('\r\n')[1]
    // Behind an apostrophe, so the cell reads as the text somebody typed.
    expect(row).toContain("'=SUM(A1:A9)")
    expect(row).toContain("'@holocene")
  })

  it('leaves a real number alone, so the spreadsheet can still add it up', () => {
    const row = buildProjectsCsv([project], csvColumnsFor(true)).split('\r\n')[1]
    expect(row.split(',')).toContain('9100')
  })
})

// The audit note. For weeks the route was never deployed and production
// answered 404 to every export; nothing noticed, because nothing read the
// response. These pin the three things that fix: the answer is read, a failure
// is reported (console + returned status) and never thrown, and every filter —
// scoping included — travels in the payload.
describe('logExport', () => {
  const entry = {
    route: 'finance-results',
    rowCount: 41,
    filters: { tab: 'results', range: 'since-jun-1', account: 'bam', scoping_included: false },
    includedRestricted: true,
  }
  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(body == null ? '' : JSON.stringify(body), { status }))

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns the logged row id when the server wrote it', async () => {
    vi.stubGlobal('fetch', answer(200, { ok: true, id: 'abc123' }))
    await expect(logExport(entry)).resolves.toEqual({ ok: true, status: 200, id: 'abc123', error: null })
  })

  it('sends every filter, scoping included, to the audit route', async () => {
    const f = answer(200, { ok: true, id: 'x' })
    vi.stubGlobal('fetch', f)
    await logExport(entry)
    const [url, init] = (f.mock.calls[0] as unknown as [string, RequestInit])
    expect(url).toBe('/api/exports/log')
    expect(JSON.parse(String(init.body))).toEqual(entry)
  })

  it('reports a missing route (404) instead of treating it as logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', answer(404, null))
    const r = await logExport(entry)
    expect(r).toMatchObject({ ok: false, status: 404, id: null })
    expect(err).toHaveBeenCalled()
  })

  it('reports a server that answered but could not write the row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', answer(500, { ok: false, error: 'The export was not logged' }))
    await expect(logExport(entry)).resolves.toMatchObject({ ok: false, status: 500, error: 'The export was not logged' })
  })

  it('never throws when the request itself fails — the download already happened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(logExport(entry)).resolves.toMatchObject({ ok: false, status: 0, error: 'Failed to fetch' })
  })
})
