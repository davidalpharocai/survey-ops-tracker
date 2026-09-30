import { describe, it, expect } from 'vitest'
import {
  aboutText, belowFloorDrill, buildPerRespondentModel, buyMultiples, capReplay, leverDrill, QUOTE_MULTIPLE, rangeText,
  roundCents, routeDrill, tile4ExportRows, timesText, TILE4_EXPORT_COLUMNS, TOO_FEW,
  type PerRespondentInput, type PerRespondentRaw,
} from './perRespondent'
import { buildIndex, type FinCost, type FinProject } from './hub'
import { DEFAULT_FILTER, itemsOf, populationFor, type FinanceFilter } from './filters'
import { reconcile } from './drill'
import { MIN_CLASS_N, type FinBlastDated, type FinLaunch, type FinSupplierRow } from './savings'
import { KEEP_GOAL } from './revenue'
import { money2 } from './format'

/**
 * The Per respondent tab's model, on a small book whose every figure can be
 * worked out by hand. The fixture carries the shapes the finance hub keeps
 * tripping on: a Hold survey and a Scoping one that must reach neither tile, an
 * empty placeholder (excluded) and one holding data (real work), a $0 price, a
 * survey whose N actual counts only one of its segments, a survey with no
 * date, one fielded both ways with no split, and live work that belongs to the
 * levers but not to a cost per qualified respondent.
 */

const TODAY = '2026-09-28'

const P = (id: string, o: Partial<FinProject> = {}): FinProject => ({
  id, project_code: id.toUpperCase(), project_name: null, client: null, client_id: 'acc-a',
  project_type: 'PS', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-07-15', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, ...o,
})
const S = (project_id: string, cpi: number, n: number, launch_id = `w-${project_id}`, supplier_id = 'prime'): FinSupplierRow =>
  ({ project_id, cpi, n_collected: n, launch_id, supplier_id })
const B = (project_id: string, o: Partial<FinBlastDated> = {}): FinBlastDated => ({
  project_id, bid: 50, completes: 10, people: 1000, cost_per_send: 0.02, channel: 'sms', blast_at: '2026-07-01', ...o,
})

/* Eight panel surveys: each bought 100 completes at $1 ($100 of spend). They
 * kept 90, 85, 80, 75, 70, 65, 60 and 50 after QA, against the N sold below. */
const KEPT = [90, 85, 80, 75, 70, 65, 60, 50]
const SOLD = [50, 60, 70, 80, 50, 60, 70, 40]
const panel = KEPT.map((d, i) => P(`p${i + 1}`, { n_collected: 100, n_actual: d, n_target: SOLD[i] }))
const panelRows = panel.map(p => S(p.id, 1, 100))

/* Three blast surveys: $50 × 10 completes + 1,000 texts at 2¢ = $520 each. */
const blast = [1, 2, 3].map(i => P(`b${i}`, { project_type: 'B2B', n_collected: 10, n_actual: 8, n_target: 8 }))
const blastRows = blast.map(p => B(p.id))

const mixed = P('m1', { project_type: 'B2B', n_collected: 120, n_actual: 100, n_target: 100 })
const partial = P('q1', {
  n_collected: 500, n_actual: 30, n_target: 400,
  segments: [
    { id: 's1', project_id: 'q1', n_target: 100, n_actual: 30 },
    { id: 's2', project_id: 'q1', n_target: 300, n_actual: null },
  ],
})
const hold = P('h1', { project_type: 'B2B', board_column: 'Fielding', status: 'Hold', n_collected: 10 })
const scoping = P('sc1', { board_column: 'Scoping', status: 'Open', phase: 'Scoping' })
const emptyShell = P('ph0', { board_column: 'Fielding', status: 'Open', is_placeholder: true })
const shellWithData = P('ph1', { board_column: 'Fielding', status: 'Open', is_placeholder: true, n_collected: 40 })
const live = P('live1', { project_type: 'B2B', board_column: 'Fielding', status: 'Open', deliver_date: '2026-10-20' })
const undated = P('u1', { deliver_date: null, n_collected: 100, n_actual: 80, n_target: 80 })

const projects = [...panel, ...blast, mixed, partial, hold, scoping, emptyShell, shellWithData, live, undated]
const blasts: FinBlastDated[] = [
  ...blastRows,
  B('m1', { completes: 20 }),
  B('h1', { bid: 40 }), B('h1', { bid: 60 }),
  B('live1', { bid: 30, blast_at: '2026-09-01' }), B('live1', { bid: 45, blast_at: '2026-09-02' }),
]
const suppliers: FinSupplierRow[] = [
  ...panelRows, S('m1', 1, 100), S('q1', 1, 500), S('ph1', 1, 40), S('u1', 1, 100),
]
const costs: FinCost[] = []
const launches: FinLaunch[] = []
// P1 $3 and P4 $2 sit under the $3.33 floor, P2 $5 is above both floors, and
// P3 is given away at $0 — which must never enter a comparison with a price.
const rates = new Map<string, number>([['p1', 3], ['p2', 5], ['p3', 0], ['p4', 2], ['b1', 150]])
const raw: PerRespondentRaw = {
  blasts, suppliers, costs, launches, rates,
  accounts: [{ id: 'acc-a', name: 'Acme' }, { id: 'acc-b', name: 'Beta' }],
}

function model(filter: FinanceFilter = DEFAULT_FILTER, o: Partial<PerRespondentInput> = {}, r: PerRespondentRaw = raw, book = projects) {
  const ix = buildIndex(r.blasts, r.suppliers, r.costs)
  const items = itemsOf(book, r.blasts, r.suppliers, r.costs, ix)
  const population = populationFor(items, 'per-respondent', filter, TODAY)
  return buildPerRespondentModel({ items, population, filter, today: TODAY, raw: r, ix, ...o })
}

describe('Tile 4: the dumbbell is drawn on ONE population', () => {
  const m = model()
  const pc = m.cards.find(c => c.route === 'panel')!

  it('prices per complete bought and per qualified respondent on the same surveys', () => {
    const c = pc.cpqr!
    // $800 over 800 bought and 575 kept (the partial-roll-up survey is held out).
    expect(c.ids.sort()).toEqual(panel.map(p => p.id).sort())
    expect(c.perComplete).toBeCloseTo(1)
    expect(c.blended).toBeCloseTo(800 / 575)
  })

  it('labels the connector with exactly the scrub those surveys lost to QA', () => {
    const c = pc.cpqr!
    const byHand = 1 - 575 / 800
    expect(pc.qaRemoved).toBeCloseTo(byHand, 10)
    expect(pc.qaRemoved).toBeCloseTo(c.scrubRate, 10)
    // And from the card's own rows, independently: Σdelivered ÷ Σbought.
    const kept = pc.rows.reduce((t, r) => t + r.delivered, 0) / pc.rows.reduce((t, r) => t + r.paid, 0)
    expect(pc.qaRemoved).toBeCloseTo(1 - kept, 10)
  })

  it('ranks the route’s surveys by (their CPQR − the typical CPQR) × delivered N', () => {
    const med = pc.cpqr!.median
    const want = pc.rows.map(r => (100 / r.delivered - med) * r.delivered)
    expect(pc.rows.map(r => r.aboveTypical)).toEqual(want.map(x => expect.closeTo(x, 9)))
    expect([...want].sort((a, b) => b - a)).toEqual(want)
    // The dearest survey is the one that kept the least.
    expect(pc.rows[0].id).toBe('p8')
  })

  it('never averages the routes: each card is its own route and its own axis', () => {
    expect(m.cards.map(c => c.route)).toEqual(['panel', 'blast'])
    const bc = m.cards.find(c => c.route === 'blast')!
    expect(bc.cpqr!.ids.sort()).toEqual(['b1', 'b2', 'b3'])
    expect(bc.cpqr!.blended).toBeCloseTo(520 * 3 / 24)
  })

  it('opens a drill that reconciles to spend summed off the raw rows', () => {
    const spec = routeDrill(pc, raw, 'chip')!
    const rec = reconcile(spec)
    expect(rec.ok).toBe(true)
    expect(spec.expectedTotal).toBeCloseTo(800)
    expect(spec.rows[0].id).toBe('p8')
  })
})

describe('Tile 4: the quote floor is set on cost per BILLED respondent', () => {
  const pc = model().cards.find(c => c.route === 'panel')!
  const q = pc.quote!

  it('uses min(delivered, N sold) — not the qualified count CPQR divides by', () => {
    // Spend ÷ billed N: 2, 1.67, 1.43, 1.33, 2, 1.67, 1.67, 2.5 → typical 1.67, p75 2.
    expect(q.typical).toBeCloseTo(1.67)
    expect(q.p75).toBeCloseTo(2)
    expect(q.floor).toBeCloseTo(3.34)
    expect(q.safeFloor).toBeCloseTo(4)
    // The same surveys' typical CPQR would give a different — lower — floor.
    expect(q.floor).not.toBeCloseTo(2 * pc.cpqr!.median, 2)
    expect(q.n).toBe(8)
  })

  it('rounds the typical cost BEFORE multiplying, so the sentence’s own sum works out', () => {
    // 100 ÷ 60 is $1.6666…: printed "$1.67", and the floor beside it has to be
    // 2 × $1.67 = $3.34, not 2 × 1.6666 rounded to $3.33.
    expect(roundCents(100 / 60)).toBe(1.67)
    expect(q.floor).toBeCloseTo(q.typical * q.multiple, 10)
    expect(q.safeFloor).toBeCloseTo(q.p75 * q.multiple, 10)
    expect(pc.lines.quote).toContain('Quote at least $3.34 per billed respondent — 2× the typical $1.67')
    expect(pc.lines.quote).toContain('quote $4.00 (2× the dearer quarter’s $2.00)')
    // And above $10, where the house rule would otherwise print whole dollars
    // and lose the multiplication by a dollar: $75.36 × 2 is $150.72, not $151.
    expect(roundCents(75.3608)).toBe(75.36)
    expect(money2(roundCents(75.3608) * QUOTE_MULTIPLE)).toBe('$150.72')
  })

  it('takes its multiple from the 50% goal, not a typed 2', () => {
    expect(QUOTE_MULTIPLE).toBeCloseTo(1 / (1 - KEEP_GOAL))
    expect(q.multiple).toBe(QUOTE_MULTIPLE)
  })

  it('counts the surveys priced below it, leaving the $0 price out of the comparison', () => {
    expect(q.priced).toBe(3) // p1, p2, p4 — never p3 at $0
    expect(q.below).toBe(2)
    expect(q.belowIds.sort()).toEqual(['p1', 'p4'])
    expect(q.belowSafe).toBe(2)
    expect(q.safeCovers).toBe(7)
    expect(pc.lines.quotePriced).toContain('2 of 3 panel studies priced above $0')
  })

  it('has a below-floor drill whose total comes from revenue.ts on the survey records', () => {
    const m = model()
    const byId = new Map(projects.map(p => [p.id, p]))
    const spec = belowFloorDrill(m.cards[0], m, byId, rates, 'chip')!
    expect(reconcile(spec).ok).toBe(true)
    // p1: $3 × 50 billed; p4: $2 × 75 billed.
    expect(spec.expectedTotal).toBeCloseTo(150 + 150)
  })

  it('reads the price comparison as missing, not zero, when prices are blocked', () => {
    const m = model(DEFAULT_FILTER, { priceBlock: 'Blocked: project_financials did not load' })
    const pb = m.cards[0]
    expect(pb.quote!.priced).toBeNull()
    expect(pb.lines.quotePriced).toBeNull()
    // …and says so where the comparison would have been, on the card AND in
    // the verdict. Dropping the sentence silently is how a failed read comes
    // to read as a book nobody priced.
    expect(pb.priceNote).toContain('Blocked: project_financials did not load')
    expect(pb.priceNote).toContain('missing, not zero')
    expect(pb.priceNote).toContain('no panel study here can be checked against the floor')
    expect(m.tile4Verdict).toContain('Blocked: project_financials did not load')
    expect(m.tile4Verdict).toContain('no study in view can be checked against the floor')
    // Nothing is counted as "not placed" either: there is no comparison to
    // be outside of.
    expect(m.unplacedPriced).toBeNull()
    // With prices in hand there is no note to print.
    expect(model().cards[0].priceNote).toBeNull()
  })

  it('counts the priced surveys no card could place, instead of shrinking the denominator', () => {
    const m = model()
    // b1 is priced at $150 but sits on the blast card, which is too thin to
    // set a floor — so it is in neither the numerator nor the denominator.
    expect(m.unplacedPriced).toMatchObject({ surveys: 1, mixed: 0, noRows: 0, noFloor: 1 })
    expect(m.unplacedPriced!.text).toContain('One more priced study in view could not be checked against a route floor')
    expect(m.unplacedPriced!.text).toContain('on a route with no quote floor in this view')
    expect(m.tile4Verdict).toContain(m.unplacedPriced!.text)
  })
})

describe('Tile 4: the buy multiple', () => {
  it('is 1 ÷ the keep rate a quarter of surveys fell below, and says how many it covers', () => {
    const pc = model().cards[0]
    // Keep rates .9 .85 .8 .75 .7 .65 .6 .5 → p25 (nearest rank) .65.
    expect(pc.buy!.keepP25).toBeCloseTo(0.65)
    expect(pc.buy!.multiple).toBeCloseTo(1 / 0.65)
    expect(pc.buy!.covered).toBe(6)
    expect(pc.buy!.of).toBe(8)
    expect(pc.lines.buy).toContain('Buy 1.5× the target')
    expect(pc.lines.buy).toContain('covers 6 of 8 past studies')
  })
})

describe('buyMultiples, for other tabs', () => {
  it('quotes the same multiple the card prints, and none for a route with too few surveys', () => {
    const delivered = projects.filter(p => p.board_column === 'Delivery' && p.deliver_date)
    const bm = buyMultiples(delivered, raw)
    expect(bm.panel!.multiple).toBeCloseTo(model().cards[0].buy!.multiple)
    expect(bm.blast).toBeNull()
  })
})

describe('Tile 4: the too-few rule', () => {
  it('withholds the quote floor and the buy multiple on a card with fewer than MIN_CLASS_N surveys', () => {
    const bc = model().cards.find(c => c.route === 'blast')!
    expect(bc.cpqr!.n).toBeLessThan(MIN_CLASS_N)
    expect(bc.thin).toBe(true)
    expect(bc.lines.quote).toContain(TOO_FEW.charAt(0).toUpperCase() + TOO_FEW.slice(1))
    expect(bc.lines.buy).toContain('buy multiple needs')
    expect(bc.lines.quotePriced).toBeNull()
    expect(bc.rows.every(r => r.belowFloor === null)).toBe(true)
    // The dumbbell itself is a measurement and still draws.
    expect(bc.qaRemoved).toBeCloseTo(0.2)
  })

  it('leaves a thin route out of the verdict', () => {
    const m = model()
    expect(m.tile4Verdict).toContain('Quote panel work at $3.34 or more')
    expect(m.tile4Verdict).not.toContain('blast work')
    expect(m.tile4Verdict).toContain('2 of 3 priced studies')
  })
})

describe('Tile 4: the population and the footnote', () => {
  const m = model()

  it('keeps Hold, Scoping, live work and empty placeholders out of the per-respondent cards', () => {
    const ids = m.cards.flatMap(c => c.cpqr?.ids ?? [])
    for (const x of ['h1', 'sc1', 'live1', 'ph0', 'ph1']) expect(ids).not.toContain(x)
  })

})

describe('Tile 4: footnote money, worked by hand', () => {
  it('counts the unsplit mixed survey at its whole spend and the partial survey held out', () => {
    const m = model()
    // m1: $50 × 20 completes + 1,000 texts × 2¢ + 100 panel at $1 = $1,120.
    expect(m.footnote.bothWays!.spend).toBeCloseTo(1120)
    expect(m.footnote.bothWays).toMatchObject({ surveys: 1 })
    expect(m.footnote.bothWays!.text).toContain('1 needs the delivered N split by route')
    expect(m.footnote.partial!.codes).toEqual(['Q1'])
    expect(m.footnote.partial!.text).toContain('adds up only 1 of its 2 segments')
    expect(m.footnote.partial!.spend).toBeCloseTo(500)
  })

  it('drops the undated survey once a range is picked, and keeps it under All time', () => {
    const since = model().cards[0].cpqr!.ids
    expect(since).not.toContain('u1')
    const all = model({ ...DEFAULT_FILTER, range: { preset: 'all', from: null, to: null } }).cards[0].cpqr!.ids
    expect(all).toContain('u1')
  })
})

describe('Tile 4: the export', () => {
  it('writes one row per route leg behind the cards, under the declared columns', () => {
    const m = model()
    const rows = tile4ExportRows(m)
    expect(rows).toHaveLength(m.cards.reduce((t, c) => t + c.rows.length, 0))
    const keys = TILE4_EXPORT_COLUMNS.map(c => c.key)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...keys].sort())
    const p1 = rows.find(r => r.code === 'P1')!
    expect(p1).toMatchObject({ route: 'panel', paid: 100, delivered: 90, billedN: 50, rate: 3, belowFloor: 'yes' })
    expect(rows.find(r => r.code === 'P3')!.belowFloor).toBeNull() // $0 is never compared
  })
})

/* ── Tile 5 ─────────────────────────────────────────────────────────────── */

describe('Tile 5: one declared population', () => {
  const m = model()

  it('is delivered and live work in the window, and nothing else', () => {
    const ids = m.levers.population.map(p => p.id).sort()
    expect(ids).toContain('live1')
    expect(ids).toContain('ph1') // a placeholder holding data is real work
    for (const x of ['h1', 'sc1', 'ph0', 'u1']) expect(ids).not.toContain(x)
    expect(m.levers.scope.chip).toMatch(/^Delivered and live · From 1 Jun 2026 · \d+ studies$/)
  })

  it('keeps SAVE COST and EARN MORE apart, with no total anywhere', () => {
    expect(m.levers.save.every(s => s.side === 'save')).toBe(true)
    expect(m.levers.earn.every(s => s.side === 'earn')).toBe(true)
    expect(m.levers.save.map(s => s.key).sort()).toEqual(['bid-premium', 'dead-streak', 'launch-overrun', 'sms-rate', 'wave-spread'])
    expect(m.levers.earn.map(s => s.key).sort()).toEqual(['price-gap', 'sell-range', 'top-up'])
    expect(Object.keys(m.levers)).not.toContain('total')
    // Nothing in this small book is callable, and the verdict says what to do.
    expect(m.levers.verdict).toMatch(/widen the date range or clear a filter/)
  })

  it('reads "too few studies here to call" below MIN_CLASS_N and draws no bar', () => {
    // The live survey is the only one that raised its bid: one survey.
    const bid = m.levers.save.find(s => s.key === 'bid-premium')!
    expect(bid.lever!.ids).toEqual(['live1'])
    expect(bid.callable).toBe(false)
    expect(bid.range).toBe(TOO_FEW)
    expect(bid.low).toBeNull()
    expect(bid.high).toBeNull()
    expect(bid.reason).toContain(`1 of the ${MIN_CLASS_N} needed`)
  })

  it('still names a lever with nothing to say, with the reason', () => {
    const dead = m.levers.save.find(s => s.key === 'dead-streak')!
    expect(dead.lever).toBeNull()
    expect(dead.reason).toBe('No study in this view kept sending after two dead blasts.')
  })

  it('says what the wave lever cannot see even when it finds nothing', () => {
    const r = model(DEFAULT_FILTER, {}, {
      ...raw,
      launches: [{ id: 'w-p1', project_id: 'p1', target: 200 }, { id: 'w-p2', project_id: 'p2', target: null }],
    })
    const goal = r.levers.save.find(s => s.key === 'launch-overrun')!
    expect(goal.lever).toBeNull()
    expect(goal.reason).toContain('1 of 2 waves carry no target')
  })

  it('names the blocked table on the wave lever instead of reading the waves as none', () => {
    const r = model(DEFAULT_FILTER, { launchesBlocked: 'Blocked: project_launches did not load' })
    expect(r.levers.save.find(s => s.key === 'launch-overrun')!.reason).toContain('Blocked: project_launches did not load')
  })

  it('replaces the whole EARN MORE list with the reason when prices did not load', () => {
    const r = model(DEFAULT_FILTER, { priceBlock: 'Blocked: project_financials did not load' })
    expect(r.levers.earn).toEqual([])
    expect(r.levers.earnBlocked).toBe('Blocked: project_financials did not load')
    expect(r.levers.save.length).toBe(5)
  })
})

/** A book big enough for every lever to be called: nine panel surveys and
 *  nine blast surveys at two accounts, over-delivered, short and re-bid. */
function bigBook() {
  const ps: FinProject[] = []
  const bs: FinProject[] = []
  const sup: FinSupplierRow[] = []
  const bl: FinBlastDated[] = []
  const rt = new Map<string, number>()
  for (let i = 0; i < 9; i++) {
    // Panel, repeat work at Acme: 120 delivered against 100 sold → 20 over each.
    const p = P(`bp${i}`, { deliver_date: `2026-07-${String(10 + i).padStart(2, '0')}`, n_collected: 150, n_actual: 120, n_target: 100 })
    ps.push(p); sup.push(S(p.id, 1, 150)); rt.set(p.id, 4)
    // Blast at Acme and at Beta, 9 each: Acme pays $100, Beta $140, same cost.
    for (const [acc, price] of [['acc-a', 100], ['acc-b', 140]] as const) {
      const b = P(`bb-${acc}-${i}`, {
        client_id: acc, project_type: 'B2B', deliver_date: `2026-08-${String(10 + i).padStart(2, '0')}`,
        n_collected: 12, n_actual: 9, n_target: 10,
      })
      bs.push(b)
      // Two dead sends, then one more, at two bid levels: every lever fires.
      bl.push(B(b.id, { bid: 40, completes: 6, blast_at: '2026-08-01' }))
      bl.push(B(b.id, { bid: 40, completes: 0, blast_at: '2026-08-02' }))
      bl.push(B(b.id, { bid: 40, completes: 0, blast_at: '2026-08-03' }))
      bl.push(B(b.id, { bid: 60, completes: 6, blast_at: '2026-08-04' }))
      rt.set(b.id, price)
    }
  }
  // Acme's first ever survey is an older one, so every panel survey above is repeat work.
  const first = P('first', { deliver_date: '2026-01-05', n_collected: 50, n_actual: 70, n_target: 40 })
  sup.push(S('first', 1, 50)); rt.set('first', 4)
  const r: PerRespondentRaw = {
    blasts: bl, suppliers: sup, costs: [], launches: [], rates: rt,
    accounts: [{ id: 'acc-a', name: 'Acme' }, { id: 'acc-b', name: 'Beta' }],
  }
  return { r, book: [...ps, ...bs, first] }
}

describe('Tile 5: each EARN MORE lever on a fixture', () => {
  const { r, book } = bigBook()
  const m = model(DEFAULT_FILTER, {}, r, book)
  const slot = (k: string) => m.levers.earn.find(s => s.key === k)!

  it('lever 6 sells a range on repeat work and never says to bill the over-delivery', () => {
    const s6 = slot('sell-range')
    const l = s6.lever!
    expect(l.title).toBe('Sell a range on repeat work')
    expect(l.rule).toMatch(/price the cushion into the quote/i)
    // 9 repeat panel surveys × 20 over × $4.
    expect(l.high).toBeCloseTo(9 * 20 * 4)
    expect(s6.callable).toBe(true)
    expect(s6.low).toBeNull() // direction only reads "up to"
    expect(s6.range).toBe('up to $720')
    const words = [l.title, l.rule, l.why, l.risk, l.population, l.givesUp, s6.range].join(' ')
    expect(words).not.toMatch(/\bbill (it|them|the|for|over)/i)
    expect(words).not.toMatch(/\binvoice (it|them|the)\b/i)
    expect(words).not.toMatch(/\bcharge (for )?(it|them|the (extra|over))/i)
  })

  it('lever 6 leaves an account’s first survey out: over-delivering a new client is deliberate', () => {
    const all = model({ ...DEFAULT_FILTER, range: { preset: 'all', from: null, to: null } }, {}, r, book)
    const l = all.levers.earn.find(s => s.key === 'sell-range')!.lever!
    expect(l.ids).not.toContain('first')
    expect(l.why).toContain('Another 30 on 1 first study')
  })

  it('lever 7 nets the missing respondents against the route’s own cost per qualified respondent', () => {
    const s7 = slot('top-up')
    const l = s7.lever!
    // 18 blast surveys, each 1 short of 10; at $100 (Acme) and $140 (Beta).
    expect(l.ids).toHaveLength(18)
    const card = m.cards.find(c => c.route === 'blast')!.cpqr!
    const high = 9 * Math.max(0, 100 - card.median) + 9 * Math.max(0, 140 - card.median)
    const low = 9 * Math.max(0, 100 - card.p75) + 9 * Math.max(0, 140 - card.p75)
    expect(l.high).toBeCloseTo(high)
    expect(l.low).toBeCloseTo(low)
    const spec = leverDrill(s7, m, r)!
    expect(reconcile(spec).ok).toBe(true)
    expect(spec.expectedTotal).toBeCloseTo(9 * 100 + 9 * 140)
  })

  it('lever 8 prices the lower payer at the higher payer’s rate, on the same route and cost', () => {
    const s8 = slot('price-gap')
    const l = s8.lever!
    expect(l.title).toBe('Bring Acme’s blast prices up to Beta’s')
    // Billed N 9 on each of 9 surveys; $40 a billed respondent apart.
    expect(l.high).toBeCloseTo(40 * 81)
    expect(l.low).toBeCloseTo(20 * 81)
    const spec = leverDrill(s8, m, r, id => (id === 'acc-b' ? 'Beta' : 'Acme'))!
    expect(reconcile(spec).ok).toBe(true)
    expect(spec.rows).toHaveLength(9)
  })

  it('every lever drill checks its rows against the lever’s own ids', () => {
    for (const s of [...m.levers.save, ...m.levers.earn]) {
      if (!s.lever) continue
      const spec = leverDrill(s, m, r)!
      const rec = reconcile(spec)
      expect(rec.idsAgree).toBe(true)
      expect(spec.expectedIds).toEqual(s.lever.ids)
      expect(rec.ok).toBe(true)
    }
  })

  it('carries the bid ladder in the bid lever’s drill', () => {
    const s1 = m.levers.save.find(s => s.key === 'bid-premium')!
    expect(s1.callable).toBe(true)
    expect(s1.lever!.riskTag).toBe('may leave a hard study short')
    const spec = leverDrill(s1, m, r)!
    expect(spec.population).toMatch(/the higher bid got a worse response on \d+ of \d+ studies/)
  })

  it('ends in a verb and never adds the two lists together', () => {
    expect(m.levers.verdict).toMatch(/^Start on cost with “/)
    expect(m.levers.verdict).toContain('none of them is added up')
  })

  it('ranks callable levers by their high end, uncallable ones after', () => {
    const called = m.levers.save.filter(s => s.callable).map(s => s.high as number)
    expect(called).toEqual([...called].sort((a, b) => b - a))
    const firstUncalled = m.levers.save.findIndex(s => !s.callable)
    if (firstUncalled >= 0) expect(m.levers.save.slice(firstUncalled).every(s => !s.callable)).toBe(true)
  })
})

describe('Tile 5: the price gap with no pair to call', () => {
  /* Two accounts fielded the same way, neither with the 8 priced surveys the
   * comparison needs. The lever still appears, to say it was checked — and it
   * is an EARN MORE lever, so it must never open onto recorded field cost
   * under a total that calls itself a saving. */
  const book: FinProject[] = []
  const sup: FinSupplierRow[] = []
  const rt = new Map<string, number>()
  for (const acc of ['acc-a', 'acc-b'] as const) {
    for (let i = 0; i < 3; i++) {
      const p = P(`g-${acc}-${i}`, {
        client_id: acc, deliver_date: `2026-07-0${i + 1}`, n_collected: 100, n_actual: 80, n_target: 80,
      })
      book.push(p); sup.push(S(p.id, 1, 100)); rt.set(p.id, acc === 'acc-a' ? 3 : 5)
    }
  }
  const r: PerRespondentRaw = {
    blasts: [], suppliers: sup, costs: [], launches: [], rates: rt,
    accounts: [{ id: 'acc-a', name: 'Acme' }, { id: 'acc-b', name: 'Beta' }],
  }
  const m = model(DEFAULT_FILTER, {}, r, book)
  const slot = m.levers.earn.find(s => s.key === 'price-gap')!

  it('says why it cannot be called and opens onto the surveys it weighed, never onto cost', () => {
    expect(slot.callable).toBe(false)
    expect(slot.lever).not.toBeNull()
    expect(slot.reason).toContain('enough priced studies to compare')
    const spec = leverDrill(slot, m, r)!
    // No figure is claimed, and nothing in the strip mentions a saving.
    expect(spec.expectedTotal).toBeNull()
    expect(spec.totalLabel).not.toMatch(/saving/i)
    expect(spec.totalLabel).toContain('Client price')
    expect(reconcile(spec).idsAgree).toBe(true)
    // Client price on the six surveys, not the $600 of panel cost behind them.
    expect(spec.rows).toHaveLength(6)
    expect(spec.rows.reduce((t, x) => t + x.contribution, 0)).toBeCloseTo(3 * 80 * 3 + 3 * 80 * 5)
    expect(spec.columns.map(c => c.key)).toContain('costPerBilled')
  })
})

describe('the rejected rules, recomputed', () => {
  const { r, book } = bigBook()
  const m = model(DEFAULT_FILTER, {}, r, book)

  it('lists three, each with computed words and the one figure it cannot recompute dated', () => {
    expect(m.rejected.map(x => x.key)).toEqual(['cap-at-yield', 'blast-to-panel', 'sms-to-email'])
    const cap = m.rejected[0]
    expect(cap.now.join(' ')).toMatch(/Replayed study by study on the \d+ studies/)
    expect(cap.dated).toContain('11 of 412')
    expect(m.rejected[1].now.join(' ')).toMatch(/costs about \d+× a panel one/)
    // In this book every survey keeps exactly the typical rate, so the cap
    // breaks nothing — and the verdict must not claim it did.
    expect(m.rejectedVerdict).toMatch(/without leaving a delivery short/)
    expect(model().rejectedVerdict).toMatch(/^Keep the cap off the lever list: on this view it would have saved \$[\d,]+ and left \d+ deliver/)
  })

  it('replays a cap at target ÷ the typical keep on each survey’s own keep rate', () => {
    const byId = new Map(book.map(p => [p.id, p]))
    const rp = capReplay(m.cards, byId, r.rates, true)
    // Every panel survey kept 120 of 150 (0.8) against 100 sold: the cap is
    // ⌈100 ÷ 0.8⌉ = 125, and 125 × 0.8 = 100 still delivers the N sold.
    expect(rp.multiples.find(x => x.route === 'panel')!.multiple).toBeCloseTo(1.25)
    expect(rp.tested).toBeGreaterThanOrEqual(9)
    expect(rp.broken).toBe(0)
    expect(rp.saved).toBeCloseTo(9 * 25 * 1 + 18 * 0 /* blast legs are not over the cap */, 0)
  })
})

describe('formatting helpers', () => {
  it('prints ranges, multiples and rough counts plainly', () => {
    expect(rangeText(null, 24757)).toBe('up to $24,757')
    expect(rangeText(0, 65411)).toBe('$0–$65,411')
    expect(rangeText(930, 930)).toBe('$930')
    expect(timesText(2)).toBe('2×')
    expect(timesText(1 / 0.626)).toBe('1.6×')
    expect(aboutText(103_994_997)).toBe('100 million')
    expect(aboutText(4_210_000)).toBe('4.2 million')
    expect(aboutText(35_963)).toBe('36,000')
  })
})
