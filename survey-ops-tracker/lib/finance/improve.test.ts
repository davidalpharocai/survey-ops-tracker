import { describe, it, expect } from 'vitest'
import {
  buildImproveModel, coverageCellDrill, loggingWeekDrill, rankGaps, writtenWithin, weekOf,
  LOG_ALERT_BELOW, PRICE_COVERAGE_GOAL,
  type Gap, type GapKey, type ImproveInput, type ImproveModel,
} from './improve'
import { buildIndex, type FinProject, type FinSegment } from './hub'
import { DEFAULT_FILTER, itemsOf, populationFor, type FinanceFilter } from './filters'
import { reconcile } from './drill'
import type { Blocked, FinanceRaw, FinLaunchFull, FinSupplierFull, FinCostFull, FinTermFull } from './load'
import type { FinBlastDated } from './savings'

/**
 * The Improve tab's model. Every gap is a RULE on the loaded rows — never a
 * typed figure — so each one is tested on a book built to trip it, and on the
 * book that clears it. The two properties that matter most:
 *
 *   · a gap the data shows closed drops to "resolved", and a gap whose table
 *     did not load is "blocked", never "resolved";
 *   · every drill reconciles against something other than its own rows.
 *
 * The coverage grid always shows every month (the date filter only highlights),
 * and its reliability lines move by themselves when earlier months are
 * backfilled — the case David is working toward 1 June.
 */

const TODAY = '2026-09-28'

const P = (o: Partial<FinProject> & { id: string }): FinProject => ({
  project_code: o.id.toUpperCase(), project_name: 'Survey', client: null, client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-10', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
const LIVE = { board_column: 'Fielding', status: 'Open', phase: 'Active', deliver_date: '2026-10-15' }

let seq = 0
const B = (project_id: string, o: Partial<FinBlastDated> = {}): FinBlastDated & { id: string } => ({
  id: `b${++seq}`, project_id, bid: 10, completes: 10, people: 0, cost_per_send: 0.02, channel: 'email',
  blast_at: '2026-08-05T15:00:00Z', created_at: '2026-08-06T15:00:00Z', ...o,
})
const S = (project_id: string, o: Partial<FinSupplierFull> = {}): FinSupplierFull => ({
  id: `s${++seq}`, project_id, supplier_id: 'sup', launch_id: null, cpi: 2, n_collected: 100,
  created_at: '2026-08-06T15:00:00Z', ...o,
})
const L = (id: string, project_id: string, o: Partial<FinLaunchFull> = {}): FinLaunchFull => ({
  id, project_id, label: id, launch_date: '2026-08-04', note: null, target: 100, created_at: null, ...o,
})
const C = (project_id: string, amount: number, o: Partial<FinCostFull> = {}): FinCostFull => ({
  id: `c${++seq}`, project_id, amount, kind: 'other', route: null, ...o,
})

const NAMES: Record<string, string> = { bam: 'BAM', ubs: 'UBS', arc: 'AlphaROC', dsh: 'DE Shaw' }

interface Book {
  projects: FinProject[]
  blasts?: (FinBlastDated & { id: string })[]
  suppliers?: FinSupplierFull[]
  launches?: FinLaunchFull[]
  costs?: FinCostFull[]
  /** project id → price per N */
  rates?: Record<string, number>
  terms?: FinTermFull[]
  segments?: FinSegment[]
}

function inputOf(b: Book, filter: FinanceFilter = DEFAULT_FILTER, blocked: Blocked[] = []): ImproveInput {
  const segBy = new Map<string, FinSegment[]>()
  for (const s of b.segments ?? []) segBy.set(s.project_id, [...(segBy.get(s.project_id) ?? []), s])
  const projects = b.projects.map(p => (segBy.has(p.id) ? { ...p, segments: segBy.get(p.id) } : p))
  const rates = new Map(Object.entries(b.rates ?? {}))
  const raw: FinanceRaw = {
    projects,
    blasts: b.blasts ?? [], suppliers: b.suppliers ?? [], launches: b.launches ?? [], costs: b.costs ?? [],
    financials: [...rates.entries()].map(([project_id, price_per_n]) => ({ project_id, price_per_n, updated_at: '2026-09-27T16:00:00Z' })),
    rates, segments: b.segments ?? [],
    accounts: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    contacts: [], terms: b.terms ?? [],
  }
  const ix = buildIndex(raw.blasts, raw.suppliers, raw.costs)
  const items = itemsOf(raw.projects, raw.blasts, raw.suppliers, raw.costs, ix)
  return {
    items,
    population: populationFor(items, 'improve', filter, TODAY),
    load: {
      raw, blocked,
      integrity: {
        loadedCounts: {} as never, expectedCounts: {} as never, countMismatches: [],
        spendRecomputedMatches: { matches: 0, of: 0, mismatchIds: [] },
        pricesReturned: rates.size, demoDropped: 0, loadedAt: `${TODAY}T12:00:00Z`,
      },
    },
    ix, filter, today: TODAY,
    accountName: id => (id ? NAMES[id] ?? '(unknown account)' : '(no account)'),
  }
}

const build = (b: Book, filter?: FinanceFilter, blocked?: Blocked[]) => buildImproveModel(inputOf(b, filter, blocked))
const gapOf = (m: ImproveModel, key: GapKey): Gap => {
  const g = [...m.gaps, ...m.resolved].find(x => x.key === key)
  if (!g) throw new Error(`no gap ${key}`)
  return g
}
const expectDrillOk = (g: Gap) => {
  expect(g.drill).not.toBeNull()
  const r = reconcile(g.drill!)
  expect(r.ok, JSON.stringify({ key: g.key, missing: r.missingIds, extra: r.extraIds, gap: r.gap })).toBe(true)
}

/* ── the live-logging rule ─────────────────────────────────────────────── */

describe('writtenWithin: the 7-day live-logging rule', () => {
  it('counts a row written up to 7 calendar days after the work, and not 8', () => {
    expect(writtenWithin('2026-09-15T16:00:00Z', '2026-09-08')).toBe(true)
    expect(writtenWithin('2026-09-16T16:00:00Z', '2026-09-08')).toBe(false)
  })
  it('counts a row written before the work (a scheduled blast) as on time', () => {
    expect(writtenWithin('2026-09-01T16:00:00Z', '2026-09-08T14:00:00Z')).toBe(true)
  })
  it('reads both dates on the Eastern calendar, not UTC', () => {
    // 03:00 UTC on the 16th is 23:00 on the 15th in New York: 7 days, on time.
    expect(writtenWithin('2026-09-16T03:00:00Z', '2026-09-08')).toBe(true)
  })
  it('refuses to guess when either date is missing', () => {
    expect(writtenWithin(null, '2026-09-08')).toBeNull()
    expect(writtenWithin('2026-09-10T12:00:00Z', null)).toBeNull()
  })
  it('weeks start on Monday', () => {
    expect(weekOf('2026-09-13')).toBe('2026-09-07') // Sunday
    expect(weekOf('2026-09-14')).toBe('2026-09-14') // Monday
  })
})

describe('the live-logging strip', () => {
  const book = (): Book => ({
    projects: [P({ id: 'a', deliver_date: '2026-09-20' }), P({ id: 'w', project_type: 'PS', deliver_date: '2026-09-20' })],
    blasts: [
      // week of 7 Sep (closed): one on time, one written 11 days later
      B('a', { blast_at: '2026-09-08T14:00:00Z', created_at: '2026-09-10T14:00:00Z' }),
      B('a', { blast_at: '2026-09-09T14:00:00Z', created_at: '2026-09-20T14:00:00Z' }),
      // week of 14 Sep (closed): on time
      B('a', { blast_at: '2026-09-15T14:00:00Z', created_at: '2026-09-15T18:00:00Z' }),
      // week of 21 Sep (still open)
      B('a', { blast_at: '2026-09-22T14:00:00Z', created_at: '2026-09-22T18:00:00Z' }),
      // no send date at all
      B('a', { blast_at: null, scheduled_at: null }),
    ],
    launches: [L('L1', 'w', { launch_date: '2026-09-15' })],
    suppliers: [
      // panel row for the 15 Sep wave, written 10 days later: late
      S('w', { launch_id: 'L1', created_at: '2026-09-25T15:00:00Z' }),
      // no wave, so no work date
      S('w', { launch_id: null }),
    ],
  })

  it('buckets rows by the week of the work and measures the share written within 7 days', () => {
    const s = build(book()).logging
    expect(s.weeks.map(w => w.key)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    const [w7, w14, w21] = s.weeks
    expect(w7).toMatchObject({ rows: 2, onTime: 1, late: 1, share: 0.5, open: false })
    expect(w14).toMatchObject({ rows: 2, onTime: 1, late: 1, open: false })
    expect(w14.blast).toEqual({ rows: 1, onTime: 1 })
    expect(w14.panel).toEqual({ rows: 1, onTime: 0 })
    expect(w21.open).toBe(true)
  })

  it('alerts on the latest CLOSED week below the bar, not on a week still open', () => {
    const s = build(book()).logging
    expect(s.latestClosed?.key).toBe('2026-09-14')
    expect(s.latestClosed!.share!).toBeLessThan(LOG_ALERT_BELOW)
    expect(s.alert).toBe(true)
    expect(s.verdict).toMatch(/below the 80% alert/)
  })

  it('names the rows it could not place instead of guessing a date', () => {
    const s = build(book()).logging
    expect(s.notes.join(' ')).toMatch(/1 blast has no send date/)
    expect(s.notes.join(' ')).toMatch(/1 panel row sits on a wave with no launch date/)
  })

  it('says so when the written-on time did not load at all', () => {
    const b = book()
    b.blasts = b.blasts!.map(x => {
      const copy: Partial<FinBlastDated & { id: string }> = { ...x }
      delete copy.created_at
      return copy as FinBlastDated & { id: string }
    })
    const s = build(b).logging
    expect(s.notes.join(' ')).toMatch(/created_at\) did not load/)
    expect(s.weeks.every(w => w.blast.rows === 0)).toBe(true)
  })

  it('says a table is blocked rather than showing an empty strip', () => {
    const s = build(book(), DEFAULT_FILTER, [{ table: 'project_launches', message: 'x' }]).logging
    expect(s.notes.join(' ')).toMatch(/Blocked: project_launches did not load/)
  })

  it('counts a blast written before it went out as on time, the published rule’s reading', () => {
    const b = book()
    // A blast scheduled ahead: written on 1 Sep for work on 8 Sep. The strip
    // reads writtenWithin(), so this cannot drift from the rule tested above.
    b.blasts = [B('a', { blast_at: '2026-09-08T14:00:00Z', created_at: '2026-09-01T14:00:00Z' })]
    b.suppliers = []
    const s = build(b).logging
    expect(s.weeks[0]).toMatchObject({ key: '2026-09-07', rows: 1, onTime: 1, late: 0 })
  })

  it('opens a week into its surveys, checked against the week’s own late count', () => {
    const input = inputOf(book())
    const m = buildImproveModel(input)
    const spec = loggingWeekDrill(input, m.logging, '2026-09-07')
    expect(spec.rows.map(r => r.id)).toEqual(['a'])
    expect(reconcile(spec).ok).toBe(true)
    expect(spec.expectedTotal).toBe(1)
  })

  it('turns RED when the strip disagrees with the raw rows, so the check is not green by construction', () => {
    const input = inputOf(book())
    const m = buildImproveModel(input)
    // Stand in for a placement bug: the strip now believes every row was
    // written on time. The drill recounts the week from the blast, supplier and
    // launch rows themselves, so it must refuse to agree.
    const tampered = { ...m.logging, obs: m.logging.obs.map(o => ({ ...o, onTime: true })) }
    const r = reconcile(loggingWeekDrill(input, tampered, '2026-09-07'))
    expect(r.ok).toBe(false)
    expect(r.rowSum).toBe(0)
    expect(r.expectedTotal).toBe(1)
  })
})

/* ── C6: the coverage grid ─────────────────────────────────────────────── */

/** Four delivered surveys a month, Jun–Sep, all costed; `priced` of them priced. */
function monthsBook(priced: Record<string, number>, budgets: Record<string, number> = {}): Book {
  const projects: FinProject[] = []
  const blasts: (FinBlastDated & { id: string })[] = []
  const rates: Record<string, number> = {}
  for (const m of ['06', '07', '08', '09']) {
    for (let i = 0; i < 4; i++) {
      const id = `m${m}-${i}`
      projects.push(P({ id, deliver_date: `2026-${m}-1${i}`, budget: i < (budgets[m] ?? 0) ? 500 : null }))
      blasts.push(B(id))
      if (i < (priced[m] ?? 0)) rates[id] = 20
    }
  }
  // Before June, an undated survey, live work, and an empty placeholder.
  projects.push(P({ id: 'may', deliver_date: '2026-05-10' }))
  projects.push(P({ id: 'undated', deliver_date: null }))
  projects.push(P({ id: 'live', ...LIVE }))
  projects.push(P({ id: 'shell', is_placeholder: true, n_collected: 0, n_actual: null, deliver_date: '2026-06-20' }))
  return { projects, blasts, rates }
}

describe('C6 coverage grid', () => {
  it('shows every month with delivered work plus Undated, whatever dates are picked', () => {
    const g = build(monthsBook({ '08': 2, '09': 2 })).grid
    expect(g.columns.map(c => c.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', 'undated'])
    // Delivered only; the empty placeholder and the live survey are not counted.
    expect(g.surveys).toBe(18)
    expect(g.columns.find(c => c.key === '2026-06')!.delivered).toBe(4)
  })

  it('highlights only the months the date filter selects', () => {
    const g = build(monthsBook({})).grid
    expect(g.highlight).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
    const all = build(monthsBook({}), { ...DEFAULT_FILTER, range: { preset: 'all', from: null, to: null } }).grid
    expect(all.highlight).toBeUndefined()
  })

  it('puts its rules at the COMPUTED reliability months, and they move when earlier months are backfilled', () => {
    const before = build(monthsBook({ '08': 2, '09': 2 }, { '08': 1, '09': 1 })).grid
    expect(before.reliability.price.month).toBe('2026-08')
    expect(before.rules).toEqual([
      { at: '2026-06', label: 'costs reliable from here', keys: ['cost'] },
      { at: '2026-08', label: 'prices and budgets start here', keys: ['price', 'budget'] },
    ])
    expect(before.verdict).toMatch(/Price Jun 2026 \(0% today\) and Jul 2026 \(0% today\) up to 25%/)

    // David backfills one price in each of June and July: the line moves itself.
    const after = build(monthsBook({ '06': 1, '07': 1, '08': 2, '09': 2 }, { '08': 1, '09': 1 })).grid
    expect(after.reliability.price.month).toBe('2026-06')
    expect(after.rules.find(r => r.keys.includes('price'))!.at).toBe('2026-06')
    expect(after.verdict).toMatch(/price line has reached Jun 2026/)
  })

  it('opens a cell into the surveys missing that field, checked against coverage.ts', () => {
    const input = inputOf(monthsBook({ '08': 2 }))
    const m = buildImproveModel(input)
    const { spec, month } = coverageCellDrill(input, m.grid, 'price', '2026-08')
    expect(spec.rows.map(r => r.id).sort()).toEqual(['m08-2', 'm08-3'])
    expect(reconcile(spec).ok).toBe(true)
    expect(month).toEqual({ key: '2026-08', label: 'Aug 2026', from: '2026-08-01', to: '2026-08-31' })
  })

  it('leaves the price row off, named, when prices did not load', () => {
    const g = build(monthsBook({ '08': 2 }), DEFAULT_FILTER, [{ table: 'project_financials', message: 'x' }]).grid
    expect(g.rows.map(r => r.key)).not.toContain('price')
    expect(g.blockedRows.join(' ')).toMatch(/Blocked: project_financials did not load/)
  })

  it('leaves the delivered-N row off when the segments did not load, so it cannot read as low coverage', () => {
    // The row rolls a segmented survey's segments up (revenue.ts deliveredNOf).
    // Without that table it would look uncounted, while gap 5 — the same
    // question — says Blocked.
    const g = build(monthsBook({ '08': 2 }), DEFAULT_FILTER, [{ table: 'project_segments', message: 'x' }]).grid
    expect(g.rows.map(r => r.key)).not.toContain('postQaN')
    expect(g.blockedRows.join(' ')).toMatch(/Delivered N \(after QA\): Blocked: project_segments did not load/)
  })

  it('names the months to work on from the cells beside it, not from the whole book', () => {
    // June: UBS delivers 3 and prices all 3; BAM delivers 12 and prices none,
    // so the BOOK sits at 20% and its price line cannot start until July.
    const projects: FinProject[] = []
    const blasts: (FinBlastDated & { id: string })[] = []
    const rates: Record<string, number> = {}
    const add = (id: string, client_id: string, deliver_date: string, priced: boolean) => {
      projects.push(P({ id, client_id, deliver_date }))
      blasts.push(B(id))
      if (priced) rates[id] = 20
    }
    for (let i = 0; i < 3; i++) add(`ju${i}`, 'ubs', '2026-06-10', true)
    for (let i = 0; i < 12; i++) add(`jb${i}`, 'bam', '2026-06-10', false)
    for (let i = 0; i < 3; i++) add(`lu${i}`, 'ubs', '2026-07-10', true)
    for (let i = 0; i < 3; i++) add(`lb${i}`, 'bam', '2026-07-10', true)
    const b: Book = { projects, blasts, rates }

    const whole = build(b).grid
    expect(whole.reliability.price.month).toBe('2026-07')
    expect(whole.verdict).toMatch(/Price Jun 2026 \(20% today\) up to 25% of delivered surveys/)

    // Filtered to UBS the cells read 100% in June, so asking for June again
    // would be asking for work this view has already done.
    const ubs = build(b, { ...DEFAULT_FILTER, account: 'ubs' }).grid
    expect(ubs.verdict).toMatch(/^The lines are the whole book’s, as in the banner\./)
    expect(ubs.verdict).not.toMatch(/20% today/)
    expect(ubs.verdict).toMatch(/In this view, every month back to Jun 2026 with enough delivered work is already at or above 25%/)
  })
})

/* ── the header ───────────────────────────────────────────────────────── */

const priceBook = (): Book => ({
  projects: [
    P({ id: 'a1' }), P({ id: 'a2' }),
    P({ id: 'u1', client_id: 'ubs' }), P({ id: 'r1', client_id: 'arc' }),
  ],
  blasts: [B('a1', { bid: 20 }), B('a2', { bid: 30 }), B('u1', { bid: 10 }), B('r1', { bid: 5 })],
  rates: { a1: 50 },
})

describe('header: client price coverage', () => {
  it('states surveys priced, the share of spend, and what pricing the top accounts would do', () => {
    const h = build(priceBook()).header
    expect(h).toMatchObject({ delivered: 4, priced: 1, spend: 650, pricedSpend: 200 })
    expect(h.top.map(a => a.name)).toEqual(['BAM', 'UBS', 'AlphaROC'])
    expect(h.sentence).toBe('Client price covers 1 of 4 delivered surveys (31% of spend). Pricing all 3 unpriced accounts would take it to 100%.')
  })
})

/* ── the gaps, one rule at a time ─────────────────────────────────────── */

describe('gap 1: client price missing on costed work', () => {
  it('lists costed, unpriced delivered surveys with their spend, by account, with a price to pre-fill from', () => {
    const g = gapOf(build(priceBook()), 'price')
    expect(g).toMatchObject({ status: 'open', count: 3, dollars: 450, dollarsKind: 'spend' })
    expect(g.accounts.map(a => a.note)).toEqual([
      'Last priced: blast $50/N (A1).', 'No price at this account yet.', 'Internal: record $0 or a transfer price.',
    ])
    expectDrillOk(g)
  })

  it('pre-fills from the same route, so a panel survey is never priced from a blast rate', () => {
    const b: Book = {
      projects: [
        P({ id: 'bp', project_type: 'B2B', deliver_date: '2026-09-01' }), P({ id: 'pp', project_type: 'PS', deliver_date: '2026-08-01' }),
        P({ id: 'bu', project_type: 'B2B' }), P({ id: 'pu', project_type: 'PS' }),
      ],
      blasts: [B('bp'), B('bu')],
      suppliers: [S('pp'), S('pu')],
      rates: { bp: 200, pp: 3 },
    }
    const g = gapOf(build(b), 'price')
    expect(g.accounts[0].note).toBe('Last priced: blast $200/N (BP); panel $3.00/N (PP).')
    const rows = Object.fromEntries(g.drill!.rows.map(r => [r.id, r.detail]))
    expect(rows.pu).toBe('Last panel price at this account: $3.00/N (PP)')
    expect(rows.bu).toBe('Last blast price at this account: $200/N (BP)')
  })

  it('warns, rather than suggests, when the only price at the account is on the other route', () => {
    const b: Book = {
      projects: [P({ id: 'bp', project_type: 'B2B' }), P({ id: 'pu', project_type: 'PS' })],
      blasts: [B('bp')],
      suppliers: [S('pu')],
      rates: { bp: 200 },
    }
    const row = gapOf(build(b), 'price').drill!.rows.find(r => r.id === 'pu')!
    expect(row.detail).toBe('No panel price at this account yet; its last price, $200/N (BP), is on another route — check before copying')
  })

  it('stays ranked until priced surveys hold the goal share of spend, then resolves with a note', () => {
    const b = priceBook()
    b.blasts![0] = B('a1', { bid: 900, completes: 10 }) // 9,000 priced vs 450 unpriced
    const g = gapOf(build(b), 'price')
    expect(g.status).toBe('resolved')
    expect(PRICE_COVERAGE_GOAL).toBeLessThan(9000 / 9450)
    expect(g.note).toMatch(/past the 90% goal; 3 costed surveys are still unpriced/)
  })

  it('is BLOCKED, never resolved, when prices did not load — or none came back', () => {
    expect(gapOf(build(priceBook(), DEFAULT_FILTER, [{ table: 'project_financials', message: 'x' }]), 'price').status).toBe('blocked')
    const none = priceBook(); none.rates = {}
    const g = gapOf(build(none), 'price')
    expect(g.status).toBe('blocked')
    expect(g.note).toMatch(/returned no prices/)
  })
})

describe('gap 2: SMS send cost assumed', () => {
  const sms = (rate2: number): Book => ({
    projects: [P({ id: 'a' }), P({ id: 'b' })],
    blasts: [
      B('a', { channel: 'sms', people: 100, cost_per_send: 0.02 }),
      B('b', { channel: 'sms', people: 50, cost_per_send: rate2 }),
      B('b', { channel: 'email', people: 999, cost_per_send: 0.02 }),
    ],
    rates: { a: 1 },
  })
  it('is open while every SMS blast carries one identical rate', () => {
    const g = gapOf(build(sms(0.02)), 'sms-rate')
    expect(g.status).toBe('open')
    expect(g.dollars).toBeCloseTo(3, 9)
    expect(g.what).toMatch(/costed at \$0\.02 a message/)
    expectDrillOk(g)
  })
  it('resolves once the rates differ', () => {
    expect(gapOf(build(sms(0.015)), 'sms-rate').status).toBe('resolved')
  })
})

describe('gaps 3 and 16: field rows missing on the route a survey was filed as', () => {
  const book = (): Book => ({
    projects: [
      P({ id: 'p1', project_type: 'PS' }), P({ id: 'p2', project_type: 'PS' }), P({ id: 'p3', project_type: 'PS' }),
      P({ id: 'pm', project_type: 'PS', n_collected: 50 }),
      P({ id: 'pb', project_type: 'PS' }), // filed PS, fielded by blast
      P({ id: 'b1' }), P({ id: 'b2' }), P({ id: 'b3' }),
      P({ id: 'bm', n_collected: 40 }),
    ],
    suppliers: [S('p1', { cpi: 1 }), S('p2', { cpi: 2 }), S('p3', { cpi: 3 })],
    blasts: [B('pb'), B('b1', { completes: 100 }), B('b2', { completes: 100 }), B('b3', { completes: 100 })],
    rates: { p1: 1 },
  })
  it('estimates the missing panel cost at the book’s median cost per complete, and flags a mis-filed type', () => {
    const g = gapOf(build(book()), 'ps-rows')
    expect(g).toMatchObject({ status: 'open', count: 2, dollarsKind: 'estimate' })
    expect(g.dollars).toBe(100) // 50 completes × the $2 median
    expect(g.what).toMatch(/filed as PS but fielded by blast/)
    expectDrillOk(g)
  })
  it('estimates the missing blast cost the same way', () => {
    const g = gapOf(build(book()), 'b2b-rows')
    expect(g).toMatchObject({ status: 'open', count: 1, dollars: 400 }) // 40 × $10
    expectDrillOk(g)
  })
  it('resolves when every filed survey has its rows', () => {
    const b = book()
    b.suppliers!.push(S('pm'), S('pb'))
    expect(gapOf(build(b), 'ps-rows').status).toBe('resolved')
  })

  /**
   * One B2B survey twelve times the usual size was 98% of a $82,544 estimate,
   * and it had almost certainly been fielded off a client's own list. A survey
   * bigger than any of its kind that DOES record its rows is listed and left
   * unsized, and where one sized survey is most of what is left, the sentence
   * names it.
   */
  it('refuses to size a survey larger than any recorded survey of its kind, and names a concentrated estimate', () => {
    const projects: FinProject[] = []
    const blasts: (FinBlastDated & { id: string })[] = []
    // Five recorded B2B surveys of 10 to 50 completes at $10 a complete: the
    // sample the size line and the rate are both drawn on.
    for (const n of [10, 20, 30, 40, 50]) {
      projects.push(P({ id: `r${n}`, n_collected: n }))
      blasts.push(B(`r${n}`, { completes: n }))
    }
    projects.push(P({ id: 'small', n_collected: 40 }))
    projects.push(P({ id: 'mid', n_collected: 5 }))
    projects.push(P({ id: 'huge', n_collected: 500 }))
    const g = gapOf(build({ projects, blasts, rates: { r10: 1 } }), 'b2b-rows')
    expect(g).toMatchObject({ status: 'open', count: 3, dollarsKind: 'estimate' })
    // 40 + 5 completes × $10. The 500-complete survey adds nothing.
    expect(g.dollars).toBe(450)
    expect(g.what).toMatch(/SMALL alone is about \$400 of that\./)
    expect(g.what).toMatch(/1 survey is too large to size this way and is left out of the estimate/)
    const rows = Object.fromEntries(g.drill!.rows.map(r => [r.id, r]))
    expect(rows.huge.amount).toBeNull()
    expect(rows.huge.detail).toMatch(/larger than 90% of the 5 B2B surveys that do record their blasts \(50 and under\): not sized/)
    expectDrillOk(g)
  })
})

describe('gap 4: surveys fielded both ways, not split', () => {
  it('holds the cost of an unsplit mixed survey out of both cards, and clears a measured split', () => {
    const b: Book = {
      projects: [
        P({ id: 'm1', n_actual: 55 }),
        P({ id: 'm2', n_actual: 55, n_actual_panel: 30, n_actual_blast: 25, n_actual_split_method: 'measured' }),
      ],
      blasts: [B('m1'), B('m2')],
      suppliers: [S('m1', { n_collected: 50 }), S('m2', { n_collected: 50 })],
      rates: { m1: 1 },
    }
    const g = gapOf(build(b), 'route-split')
    expect(g).toMatchObject({ status: 'open', count: 1, ids: ['m1'], dollars: 200 })
    expect(g.details).toEqual(['1: no delivered N by route'])
    expectDrillOk(g)
  })
})

describe('gap 5: N actual missing', () => {
  it('counts delivered work with no N actual, but not a segmented survey whose every segment is counted', () => {
    const b: Book = {
      projects: [P({ id: 'q1', n_actual: null }), P({ id: 'q2', n_actual: null }), P({ id: 'ok' })],
      blasts: [B('q1'), B('q2'), B('ok')],
      segments: [
        { id: 's1', project_id: 'q2', n_target: 50, n_actual: 40 },
        { id: 's2', project_id: 'q2', n_target: 50, n_actual: 45 },
      ],
      rates: { q1: 20 },
    }
    const g = gapOf(build(b), 'post-qa-n')
    expect(g).toMatchObject({ status: 'open', ids: ['q1'], dollars: 100 })
    expect(g.what).toMatch(/1 of them is priced/)
    expectDrillOk(g) // ids checked against coverage.ts, which reads the same delivered N
  })
})

describe('gap 6: no date', () => {
  it('counts undated delivered work even though no date range can reach it', () => {
    const b: Book = { projects: [P({ id: 'u1', deliver_date: null }), P({ id: 'd1' })], blasts: [B('u1'), B('d1')], rates: { d1: 1 } }
    const m = build(b) // default range: since 1 June
    const g = gapOf(m, 'no-date')
    expect(g).toMatchObject({ status: 'open', ids: ['u1'], dollars: 100 })
    expectDrillOk(g)
  })
})

describe('gap 7: reward recoveries not booked', () => {
  it('sizes what may come back at the share already recovered on swept surveys', () => {
    const b: Book = {
      projects: [P({ id: 'r1' }), P({ id: 'r2' }), P({ id: 'r3' })],
      blasts: [B('r1'), B('r2', { bid: 20 }), B('r3', { bid: 5 })],
      costs: [C('r1', -20)],
      rates: { r1: 1 },
    }
    const g = gapOf(build(b), 'recoveries')
    expect(g).toMatchObject({ status: 'open', count: 2, dollarsKind: 'estimate' })
    expect(g.dollars).toBeCloseTo(50, 9) // 20% of (200 + 50)
    expect(g.details).toEqual(['Aug 2026: 2 of 3 not booked'])
    expectDrillOk(g)
  })
})

describe('gap 8: budgets', () => {
  it('counts margin-set and live spending surveys with no budget, and suggests one at half the price', () => {
    const b: Book = {
      projects: [P({ id: 'b1' }), P({ id: 'b2', budget: 1000 }), P({ id: 'bl', ...LIVE })],
      blasts: [B('b1', { bid: 20 }), B('b2'), B('bl', { bid: 8 })],
      rates: { b1: 50, b2: 50 },
    }
    const g = gapOf(build(b), 'budgets')
    expect(g).toMatchObject({ status: 'open', count: 2, dollars: 280 })
    expect(g.details[0]).toMatch(/come to \$2,500 across the 1 survey/)
    expectDrillOk(g)
  })
})

describe('gap 9: priced but not in the margin', () => {
  it('counts only the price on file, and reports what a missing N would book as an estimate beside it', () => {
    const b: Book = {
      projects: [P({ id: 'pc' }), P({ id: 'pn', n_actual: null })],
      rates: { pc: 40, pn: 50 },
    }
    const g = gapOf(build(b), 'priced-blocked')
    // 40 × 90 delivered on PC. PN's price is NOT added: it has no N actual, so
    // there is no price on file to count, and n_collected is the pre-QA count
    // the bill never reads (David's decision 1).
    expect(g).toMatchObject({ status: 'open', count: 2, dollars: 3600, dollarsKind: 'price' })
    expect(g.details.join(' ')).toMatch(/Entering the N actual on 1 of them would book about \$5,000 more/)
    expect(g.details.join(' ')).toMatch(/An estimate, not a price on file\./)
    expectDrillOk(g)
  })

  it('promises nothing on a survey with no N target: entering the N alone would still book $0', () => {
    const b: Book = {
      projects: [P({ id: 'pn', n_actual: null }), P({ id: 'px', n_actual: null, n_target: null })],
      rates: { pn: 50, px: 60 },
    }
    const g = gapOf(build(b), 'priced-blocked')
    expect(g.dollars).toBe(0)
    // Only PN is sized: the bill is rate × min(N actual, the N sold), so with no
    // N sold there is nothing an N actual could book (revenue.ts, 'no-cap').
    expect(g.details.join(' ')).toMatch(/on 1 of them would book about \$5,000 more/)
    const rows = Object.fromEntries(g.drill!.rows.map(r => [r.id, r]))
    expect(rows.px.detail).toBe('No N actual and no N target: entering the N alone would still book nothing')
    expect(rows.px.where).toBe('Project page → N Actual and N Target')
    expectDrillOk(g)
  })
  it('flags a rate far above the usual price on its route before the N is entered', () => {
    const projects = [1, 2, 3, 4, 5].map(i => P({ id: `n${i}` }))
    projects.push(P({ id: 'px', n_actual: null }))
    const b: Book = {
      projects,
      blasts: projects.map(p => B(p.id)),
      rates: { n1: 20, n2: 20, n3: 20, n4: 20, n5: 20, px: 200 },
    }
    const g = gapOf(build(b), 'priced-blocked')
    expect(g.details.join(' ')).toMatch(/PX: Check the rate first: \$200\/N is 10× the usual blast price/)
  })
})

describe('gap 10: $0 prices to confirm', () => {
  const b = (): Book => ({
    projects: [P({ id: 'z1' }), P({ id: 'z2' }), P({ id: 'z3', client_id: 'ubs' })],
    blasts: [B('z1', { bid: 5 }), B('z2'), B('z3')],
    rates: { z1: 0, z2: 30, z3: 0 },
  })
  it('asks to confirm a $0 price at an account that pays elsewhere, and notes the deliberate ones', () => {
    const g = gapOf(build(b()), 'zero-price')
    expect(g).toMatchObject({ status: 'open', ids: ['z1'], dollars: 50 })
    expect(g.what).toMatch(/1 more \$0 price sits at accounts that pay on no survey/)
    expectDrillOk(g)
  })
  it('resolves when every $0 price looks deliberate', () => {
    const x = b(); x.rates!.z1 = 25
    expect(gapOf(build(x), 'zero-price').status).toBe('resolved')
  })
})

describe('gap 11: placeholder flag on real work', () => {
  it('lists a flagged wave that holds data, never an empty shell', () => {
    const b: Book = {
      projects: [
        P({ id: 'f1', is_placeholder: true, ...LIVE }),
        P({ id: 'f2', is_placeholder: true, n_collected: 0, n_actual: null, ...LIVE }),
      ],
      blasts: [B('f1')],
      rates: { f1: 1 },
    }
    const g = gapOf(build(b), 'placeholder-flag')
    expect(g).toMatchObject({ status: 'open', ids: ['f1'], dollars: 100 })
    expectDrillOk(g)
  })
})

describe('gap 12: segments that disagree with the survey', () => {
  it('holds a partial roll-up out of cost per respondent, and notes a segment priced differently', () => {
    const b: Book = {
      projects: [P({ id: 's1', n_actual: 40 }), P({ id: 's2' })],
      blasts: [B('s1', { bid: 7 }), B('s2')],
      segments: [
        { id: 'x1', project_id: 's1', n_target: 50, n_actual: 40 },
        { id: 'x2', project_id: 's1', n_target: 50, n_actual: null },
        { id: 'y1', project_id: 's2', n_target: 50, n_actual: 45, price_per_n: 10 },
        { id: 'y2', project_id: 's2', n_target: 50, n_actual: 45 },
      ],
      rates: { s2: 20 },
    }
    const g = gapOf(build(b), 'segments')
    expect(g).toMatchObject({ status: 'open', count: 2, dollars: 70 })
    expect(g.what).toMatch(/1 of them is only the sum of the counted segments/)
    expect(g.what).toMatch(/1 survey has a segment priced differently/)
    expectDrillOk(g)
  })
})

describe('gap 13: stale Scoping phase', () => {
  it('finds a survey still marked Scoping that is buying respondents', () => {
    const b: Book = {
      projects: [P({ id: 'st', ...LIVE, phase: 'Scoping' }), P({ id: 'sc', ...LIVE, phase: 'Scoping' })],
      blasts: [B('st')],
      rates: { st: 1 },
    }
    const g = gapOf(build(b), 'stale-phase')
    // 'sc' has no field rows, so it really is scoping and outside the tab.
    expect(g).toMatchObject({ status: 'open', ids: ['st'], dollars: 100 })
    expectDrillOk(g)
  })
})

describe('gap 14: empty contract terms', () => {
  const terms: FinTermFull[] = [
    { id: 't1', client_id: 'dsh', name: '2026 - 2027 Contract', credits_total: null, starts_on: null, renews_on: null },
    { id: 't2', client_id: 'dsh', name: '2026 Contract', credits_total: 375, starts_on: '2026-03-30', renews_on: '2027-03-29' },
  ]
  it('names a term with no pool, no dates and no surveys, with a link to the client page', () => {
    const g = gapOf(build({ projects: [P({ id: 'a' })], terms, rates: { a: 1 } }), 'empty-term')
    expect(g).toMatchObject({ status: 'open', count: 1, unit: 'contract term', dollars: null })
    expect(g.what).toMatch(/“2026 - 2027 Contract” at DE Shaw/)
    expect(g.link).toEqual({ href: '/clients/dsh', label: 'Open DE Shaw' })
  })
  it('follows the account filter', () => {
    const g = gapOf(build({ projects: [P({ id: 'a' })], terms, rates: { a: 1 } }, { ...DEFAULT_FILTER, account: 'bam' }), 'empty-term')
    expect(g.status).toBe('resolved')
  })
})

describe('gap 15: PureSpectrum waves with no target', () => {
  it('counts the waves and the panel cost on them', () => {
    const b: Book = {
      projects: [P({ id: 'w1', project_type: 'PS' })],
      launches: [L('L1', 'w1', { target: null }), L('L2', 'w1')],
      suppliers: [S('w1', { launch_id: 'L1', n_collected: 50 }), S('w1', { launch_id: 'L2', n_collected: 50 })],
      rates: { w1: 1 },
    }
    const g = gapOf(build(b), 'wave-target')
    expect(g).toMatchObject({ status: 'open', count: 1, unit: 'wave', surveys: 1, dollars: 100 })
    expectDrillOk(g)
  })
})

/* ── surveys on hold ──────────────────────────────────────────────────── */

describe('a survey on hold', () => {
  // David keeps holds in their own bucket, out of live totals (BUILD_BRIEF
  // decision 4). This tab has no hold bucket of its own, so a held survey must
  // simply not be here: not in the population, not in the header, not in a gap.
  const book = (): Book => ({
    projects: [
      P({ id: 'd1' }),                      // delivered, priced, costed, no budget
      P({ id: 'd2' }),                      // delivered, costed, UNPRICED
      P({ id: 'lv', ...LIVE }),             // live, costed, no budget
      P({ id: 'h1', board_column: 'Fielding', status: 'Hold', deliver_date: '2026-08-10' }),
    ],
    blasts: [B('d1'), B('d2'), B('lv'), B('h1', { bid: 99 })],
    rates: { d1: 50 },
  })

  it('is left out of the population, the header and the coverage grid', () => {
    const m = build(book())
    expect(m.header.delivered).toBe(2)
    expect(m.header.priced).toBe(1)
    // $100 each on the two delivered surveys; the held survey's $990 is not here.
    expect(m.header.spend).toBe(200)
    expect(m.grid.surveys).toBe(2)
  })

  it('is in no gap: not the price gap, and not the budgets gap’s live-spending count', () => {
    const m = build(book())
    expect(gapOf(m, 'price').ids).toEqual(['d2'])
    const budgets = gapOf(m, 'budgets')
    expect(budgets.ids.slice().sort()).toEqual(['d1', 'lv'])
    expect(budgets.what).toMatch(/1 of 1 live survey is spending with none/)
    expect([...m.gaps, ...m.resolved].flatMap(g => g.ids)).not.toContain('h1')
  })
})

/* ── the list as a whole ──────────────────────────────────────────────── */

describe('the ranked list', () => {
  const book = (): Book => ({
    projects: [
      P({ id: 'a1' }), P({ id: 'a2' }), P({ id: 'u1', deliver_date: null }),
      P({ id: 'q1', n_actual: null }), P({ id: 'l1', ...LIVE }),
    ],
    blasts: [B('a1'), B('a2', { bid: 50 }), B('u1', { bid: 3 }), B('q1', { bid: 2 }), B('l1')],
    rates: { a1: 50 },
  })

  it('ranks open gaps by dollars hidden, and moves closed ones to a resolved note', () => {
    const m = build(book())
    const open = m.gaps.filter(g => g.status === 'open')
    const dollars = open.map(g => g.dollars ?? -1)
    expect(dollars).toEqual([...dollars].sort((a, b) => b - a))
    expect(open[0].key).toBe('price')
    expect(m.resolved.map(g => g.key)).toContain('route-split')
    expect(m.resolved.every(g => g.note)).toBe(true)
    expect(m.verdict).toMatch(/^Start with “Client price missing on costed work”: it hides \$520 of recorded cost that no margin can see on 2 surveys\. 5 gaps are open and 11 resolved\./)
  })

  it('ranks a gap with no dollar figure after every gap that has one', () => {
    const mk = (key: GapKey, dollars: number | null, count: number, specNo: number) =>
      ({ key, dollars, count, specNo } as Gap)
    expect(rankGaps([mk('empty-term', null, 1, 14), mk('sms-rate', 3, 1, 2), mk('price', 900, 9, 1)]).map(g => g.key))
      .toEqual(['price', 'sms-rate', 'empty-term'])
  })

  it('lists blocked checks as blocked, never resolved', () => {
    const m = build(book(), DEFAULT_FILTER, [{ table: 'project_costs', message: 'x' }])
    expect(gapOf(m, 'recoveries').status).toBe('blocked')
    expect(m.resolved.map(g => g.key)).not.toContain('recoveries')
    expect(m.gaps.slice(-1)[0].status).toBe('blocked')
  })

  it('every open gap drill reconciles on a mixed book', () => {
    const m = build(book())
    for (const g of m.gaps.filter(x => x.status === 'open' && x.drill)) expectDrillOk(g)
  })

  it('exports the ranked list with counts and dollars', () => {
    const m = build(book())
    const e = m.exportData
    expect(e.name).toBe('finance-improve-gaps')
    expect(e.rows.length).toBe(16)
    expect(e.rows[0]).toMatchObject({ rank: 1, status: 'Open', gap: 'Client price missing on costed work', count: 2, dollars: 520 })
    expect(e.columns.map(c => c.key)).toEqual(expect.arrayContaining(['count', 'dollars', 'who', 'when']))
  })

  it('lists the six blocked-data items, computing a count where the data allows', () => {
    const m = build(book())
    expect(m.blockedData.map(b => b.key)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'])
    expect(m.blockedData[0].what).toMatch(/of \d+ blast surveys in view carry no contact-list cost line/)
    expect(m.blockedData[4].what).toMatch(/price × delivered N/)
    expect(m.blockedData.every(b => b.help.length > 0)).toBe(true)
  })

  it('says B1 is blocked when a table it counts on did not load, never “no blast survey”', () => {
    // Without the blast rows nothing is routed as a blast survey, so the count
    // would read as a clean zero. A failed read is not "none".
    const m = build(book(), DEFAULT_FILTER, [{ table: 'project_blasts', message: 'x' }])
    expect(m.blockedData[0].what).toMatch(/^Blocked: project_blasts did not load/)
    expect(m.blockedData[0].what).not.toMatch(/No blast survey in view/)
  })
})
