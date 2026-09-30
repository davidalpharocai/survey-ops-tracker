import { describe, it, expect } from 'vitest'
import {
  buildPanelsModel, countryAsRecorded, supplierHref, vsAllText,
  CHART_BARS, HEATMAP_ROWS, NO_SUPPLIER, UNDATED, UNNAMED,
  type PanelLaunch, type PanelSupplierRow,
} from './panels'
import { buildIndex, costBreakdown, type FinBlast, type FinCost, type FinProject } from './hub'
import { waveSpreadLever } from './savings'
import { itemsOf, populationFor, DEFAULT_FILTER, type FinanceFilter, type FinItem } from './filters'

/**
 * The panel view splits two figures other parts of the page quote whole: the
 * Panel line of the spend waterfall (Results) and the within-wave price spread
 * (Per respondent, savings.ts waveSpreadLever). These pin that the splits add
 * back to the wholes, on fixtures built to hit every edge the live data has:
 * zero-completes rows (410 of 3,027 on 27 Sep), a missing CPI, a panel with no
 * name, a wave with one panel, a row with no launch, and a survey fielded both
 * ways.
 */

const P = (id: string, o: Partial<FinProject> = {}): FinProject => ({
  id, project_code: id.toUpperCase(), project_name: null, client: null, client_id: 'acc', project_type: 'PS',
  board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-07-01', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
const item = (p: FinProject): FinItem => ({ p, cls: 'delivered', route: 'panel', date: p.deliver_date })

let seq = 0
/** A supplier row. `name` undefined = named after the supplier id; null = no name on file. */
const S = (
  project_id: string, launch_id: string | null, supplier_id: string | null,
  cpi: number | null, n_collected: number | null, name?: string | null,
): PanelSupplierRow => ({
  id: `row${++seq}`, project_id, launch_id, supplier_id, cpi, n_collected,
  suppliers: name === null ? { name: null } : { name: name ?? supplier_id },
})
const L = (id: string, project_id: string, label: string | null, launch_date: string | null, note: string | null = null): PanelLaunch =>
  ({ id, project_id, label, launch_date, note })

function run(
  projects: FinProject[], suppliers: PanelSupplierRow[],
  o: {
    launches?: PanelLaunch[]; selected?: string | null; blasts?: FinBlast[]; costs?: FinCost[]
    ixSuppliers?: PanelSupplierRow[]
    items?: FinItem[]; filter?: FinanceFilter; today?: string
    blastsLoaded?: boolean
  } = {},
) {
  const blasts = o.blasts ?? []
  const costs = o.costs ?? []
  // The shell builds the index once from the raw rows; a test can hand it a
  // different set to prove the check turns red.
  const ix = buildIndex(blasts, o.ixSuppliers ?? suppliers, costs)
  return buildPanelsModel({
    population: projects.map(item), suppliers, launches: o.launches ?? [], blasts, costs, ix, selected: o.selected ?? null,
    blastsLoaded: o.blastsLoaded, items: o.items, filter: o.filter, today: o.today,
  })
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)

describe('buildPanelsModel — reconciles to the Panel (PureSpectrum) line of the spend breakdown', () => {
  const a = P('a'), b = P('b'), both = P('both', { project_type: 'B2B' }), out = P('out')
  const suppliers = [
    S('a', 'la', 'prime', 0.84, 120, 'Prime Insights API'),
    S('a', 'la', 'branded', 1.12, 60, 'Branded Research'),
    S('a', 'la', 'disqo', 1.8, 0, 'DISQO'), // on the wave, bought nothing
    S('b', 'lb', 'prime', 0.9, 45, 'Prime Insights API'),
    S('both', 'lc', 'fusion', 1.09, 33, 'Fusion'),
    S('out', 'lo', 'prime', 5, 1000, 'Prime Insights API'), // not in view
  ]
  const blasts: FinBlast[] = [{ project_id: 'both', bid: 50, people: 1000, completes: 4, cost_per_send: 0.02, channel: 'sms' }]
  const costs: FinCost[] = [
    { project_id: 'both', amount: 120, route: 'blast' },
    { project_id: 'a', amount: -30 },
  ]

  it('the Spend column adds up to the Panel line, and the strip says so', () => {
    const m = run([a, b, both], suppliers, { blasts, costs })
    const line = costBreakdown([a, b, both], blasts, suppliers, costs).panel
    expect(m.panelLine).toBeCloseTo(line, 9)
    expect(sum(m.rows.map(r => r.spend))).toBeCloseTo(line, 9)
    expect(m.reconciliation.ok).toBe(true)
    expect(m.check.ok).toBe(true)
    // No stored spend on these fixtures, so nothing outside the page checked
    // the total: green, but no tick, and the words say what was not done.
    expect(m.check.verified).toBe(false)
    expect(m.check.text).toBe(
      'The 3 panels below add up to $244 — the same purchases the Panel (PureSpectrum) line of the spend breakdown counts, summed study by study instead of panel by panel. ' +
      'None of the 2 studies here that bought only from panels records a spend of its own, so nothing outside this page confirmed the total.',
    )
    // Blast rewards, sends and cost lines on the mixed survey are not panel money.
    expect(m.total.spend).toBeCloseTo(0.84 * 120 + 1.12 * 60 + 0.9 * 45 + 1.09 * 33, 9)
    // The survey outside the population adds nothing.
    expect(m.rows.find(r => r.id === 'prime')!.completes).toBe(165)
  })

  it('turns red, naming the gap and the missing panel, when the index disagrees with the rows', () => {
    // The index (built by the shell) holds a purchase the rows do not: the
    // strip must say so rather than grade the rows against themselves.
    const extra = S('a', 'la', 'tap', 2, 10, 'Tap Research')
    const m = run([a, b, both], suppliers, { blasts, costs, ixSuppliers: [...suppliers, extra] })
    expect(m.reconciliation.sumAgrees).toBe(false)
    expect(m.reconciliation.missingIds).toEqual(['tap'])
    expect(m.check.ok).toBe(false)
    expect(m.check.text).toBe(
      'These panels add up to $244 but the Panel (PureSpectrum) line of the spend breakdown says $264 — a gap of $20. ' +
      '1 panel that bought on these studies is missing from the list. ' +
      'None of the 2 studies here that bought only from panels records a spend of its own, so nothing outside this page confirmed the total. ' +
      'Do not rely on either number until this is explained.',
    )
  })

  it('an empty view reconciles to a $0 Panel line and says there is nothing to show', () => {
    const m = run([P('z')], [])
    expect(m.rows).toEqual([])
    expect(m.check.ok).toBe(true)
    expect(m.check.verified).toBe(false)
    expect(m.check.text).toBe('No panel purchases in this view, and the Panel (PureSpectrum) line of the spend breakdown is $0 too.')
    expect(m.verdict).toMatch(/^No panel purchases in this view\. Widen the date range/)
  })

  it('prices per complete as Σ CPI × completes ÷ Σ completes, and shares add to 100%', () => {
    const m = run([a, b, both], suppliers)
    const prime = m.rows.find(r => r.id === 'prime')!
    expect(prime.cpc).toBeCloseTo((0.84 * 120 + 0.9 * 45) / 165, 12)
    const all = (0.84 * 120 + 1.12 * 60 + 0.9 * 45 + 1.09 * 33) / (120 + 60 + 45 + 33)
    expect(m.total.cpc).toBeCloseTo(all, 12)
    expect(prime.vsAll).toBeCloseTo(prime.cpc! / all - 1, 12)
    expect(sum(m.rows.map(r => r.share ?? 0))).toBeCloseTo(1, 12)
    expect(prime.surveys).toBe(2)
    expect(prime.waves).toBe(2)
    // Most spend first.
    expect(m.rows.map(r => r.id)).toEqual(['prime', 'branded', 'fusion'])
  })

  it('leaves a panel that bought nothing out of the table, and counts the waves it sat on', () => {
    const m = run([a, b, both], [...suppliers, S('b', 'lb', 'branded', 1.2, 0, 'Branded Research')])
    expect(m.rows.map(r => r.id)).not.toContain('disqo')
    expect(m.idle).toEqual([{ id: 'disqo', name: 'DISQO' }])
    expect(m.rows.find(r => r.id === 'branded')!.idleWaves).toBe(1)
    expect(m.reconciliation.ok).toBe(true)
  })
})

describe('buildPanelsModel — the outside check against the spend the database recorded', () => {
  // The Panel-line check grades the same rows twice (the shell builds the index
  // from this very array), so it can only catch a shape error. This one takes
  // actual_spend, which the recompute trigger writes and nothing on this page
  // computes, and can therefore actually disagree.
  const paid = (id: string, spend: number | null, o: Partial<FinProject> = {}) => P(id, { actual_spend: spend, ...o })

  it('ticks only when it ran, and says how many surveys it covered', () => {
    const rows = [S('a', 'w1', 'prime', 1, 100), S('b', 'w2', 'prime', 2, 50)]
    const m = run([paid('a', 100), paid('b', 100)], rows)
    expect(m.stored).toMatchObject({ checked: 2, skipped: 0, mismatches: [] })
    expect(m.check.ok).toBe(true)
    expect(m.check.verified).toBe(true)
    expect(m.check.text).toContain('On the 2 studies here that bought only from panels, it also agrees with the spend the database recorded for them, which nothing on this page computes.')
  })

  it('subtracts the cost lines, because a stored spend carries them too', () => {
    const rows = [S('a', 'w1', 'prime', 1, 100)]
    // $100 of panel money, a $40 vendor line and $15 of rewards that came back.
    const costs: FinCost[] = [{ project_id: 'a', amount: 40 }, { project_id: 'a', amount: -15 }]
    expect(run([paid('a', 125)], rows, { costs }).stored.mismatches).toEqual([])
    expect(run([paid('a', 165)], rows, { costs }).stored.mismatches).toHaveLength(1)
  })

  it('turns red and names the survey when a stored spend disagrees', () => {
    const rows = [S('a', 'w1', 'prime', 1, 100), S('b', 'w2', 'prime', 2, 50)]
    const m = run([paid('a', 100), paid('b', 40)], rows)
    expect(m.stored.mismatches).toHaveLength(1)
    expect(m.stored.mismatches[0]).toMatchObject({ id: 'b', code: 'B', rows: 100, stored: 40 })
    expect(m.check.ok).toBe(false)
    expect(m.check.verified).toBe(false)
    expect(m.check.text).toBe(
      'The 1 panel below adds up to $200 — the same purchases the Panel (PureSpectrum) line of the spend breakdown counts, summed study by study instead of panel by panel. ' +
      '1 of the 2 studies here that bought only from panels does not agree with the spend the database recorded for it (B). ' +
      'Do not rely on either number until this is explained.',
    )
  })

  it('a cent is a disagreement; a hundredth of a cent is float noise', () => {
    const rows = [S('a', 'w1', 'prime', 1, 100)]
    expect(run([paid('a', 100.01)], rows).stored.mismatches).toHaveLength(1)
    expect(run([paid('a', 100.0001)], rows).stored.mismatches).toEqual([])
  })

  it('leaves out surveys fielded both ways, because their stored spend is not panel money', () => {
    const blasts: FinBlast[] = [{ project_id: 'a', bid: 10, people: 100, completes: 5, cost_per_send: 0, channel: 'sms' }]
    const rows = [S('a', 'w1', 'prime', 1, 100)]
    // Stored spend is $150: $100 of panels and $50 of rewards. Nothing here can
    // split it, so the survey is not checked rather than wrongly flagged.
    const m = run([paid('a', 150)], rows, { blasts })
    expect(m.stored).toMatchObject({ checked: 0, skipped: 0, mismatches: [] })
    expect(m.check.verified).toBe(false)
    expect(m.check.text).toContain('No study here bought from panels alone, so nothing outside this page could confirm the total.')
  })

  it('stands down when the blast rows did not load, instead of flagging every survey', () => {
    // With project_blasts unread, a survey fielded both ways looks panel-only
    // and its stored spend carries blast money nothing here can see. Flagging
    // it would report a failed read as a data error.
    const rows = [S('a', 'w1', 'prime', 1, 100)]
    const m = run([paid('a', 150)], rows, { blastsLoaded: false })
    expect(m.stored).toMatchObject({ checked: 0, skipped: 0, mismatches: [], unavailable: true })
    expect(m.check.ok).toBe(true)
    expect(m.check.verified).toBe(false)
    expect(m.check.text).toContain('The blast rows did not load, so which studies bought from panels alone is not known')
  })

  it('skips a survey with no stored spend rather than counting it as agreeing', () => {
    const rows = [S('a', 'w1', 'prime', 1, 100), S('b', 'w2', 'prime', 2, 50)]
    const m = run([paid('a', 100), paid('b', null)], rows)
    expect(m.stored).toMatchObject({ checked: 1, skipped: 1, mismatches: [] })
    expect(m.check.verified).toBe(true)
    expect(m.check.text).toContain('1 more records no spend of its own and was left out.')
  })
})

describe('buildPanelsModel — the figure Per respondent quotes for the same rule', () => {
  // Same wave rule, wider population (LEVER_RULE: delivered AND live). The card
  // prints both so the reader who followed "See panels →" is not left with two
  // unexplained answers.
  const projects = [
    P('done', { deliver_date: '2026-07-01' }),
    P('live', { board_column: 'Fielding', status: 'Open', deliver_date: null, launch_date: '2026-07-02' }),
  ]
  const suppliers = [
    S('done', 'w1', 'prime', 1, 100), S('done', 'w1', 'social', 2, 100),
    S('live', 'w2', 'prime', 1, 100), S('live', 'w2', 'social', 4, 100),
  ]

  function build(o: { withLever: boolean }) {
    const ix = buildIndex([], suppliers, [])
    const items = itemsOf(projects, [], suppliers, [], ix)
    const population = populationFor(items, 'results', DEFAULT_FILTER, '2026-09-28')
    return buildPanelsModel({
      population, suppliers, launches: [], blasts: [], costs: [], ix,
      ...(o.withLever ? { items, filter: DEFAULT_FILTER, today: '2026-09-28' } : {}),
    })
  }

  it('counts finished work itself and names the delivered-plus-live figure beside it', () => {
    const m = build({ withLever: true })
    expect(m.total.above).toBeCloseTo(100, 9) // the delivered wave only
    expect(m.total.leverAbove).toBeCloseTo(100 + 300, 9) // plus the live one
    expect(m.leverNote).toBe(
      'This card counts finished work only, so $100 was paid above the cheapest panel here. ' +
      'Per respondent counts live work as well and shows $400 for the same rule.',
    )
  })

  it('says nothing when the caller did not hand over the surveys to compare', () => {
    const m = build({ withLever: false })
    expect(m.total.leverAbove).toBeNull()
    expect(m.leverNote).toBeNull()
  })

  it('says nothing when the two agree, rather than printing the same figure twice', () => {
    const only = [S('done', 'w1', 'prime', 1, 100), S('done', 'w1', 'social', 2, 100)]
    const ix = buildIndex([], only, [])
    const items = itemsOf(projects, [], only, [], ix)
    const m = buildPanelsModel({
      population: populationFor(items, 'results', DEFAULT_FILTER, '2026-09-28'),
      suppliers: only, launches: [], blasts: [], costs: [], ix,
      items, filter: DEFAULT_FILTER, today: '2026-09-28',
    })
    expect(m.total.leverAbove).toBe(m.total.above)
    expect(m.leverNote).toBeNull()
  })
})

describe('buildPanelsModel — paid above the cheapest panel agrees with waveSpreadLever', () => {
  // Built to hit every branch of the lever's rule: a two-panel wave, a
  // three-panel wave, a wave where one panel bought twice at two prices (one
  // panel — nothing to compare), zero-completes rows, a missing and a $0 CPI,
  // a row with no launch (its survey is the wave), a single-panel wave, and a
  // survey outside the population.
  const projects = [P('p1'), P('p2'), P('p3'), P('p4', { launch_date: '2026-06-03' })]
  const suppliers = [
    S('p1', 'w1', 'prime', 0.84, 97), S('p1', 'w1', 'branded', 1.12, 41), S('p1', 'w1', 'social', 1.31, 13),
    S('p1', 'w2', 'prime', 1.05, 30), S('p1', 'w2', 'fusion', 1.09, 77), S('p1', 'w2', 'disqo', 1.8, 0),
    S('p2', 'w3', 'prime', 0.7, 20), S('p2', 'w3', 'prime', 0.95, 25), // one panel, two prices
    S('p2', 'w4', 'fusion', 1.4, 18), S('p2', 'w4', 'social', null, 12), S('p2', 'w4', 'branded', 0, 9),
    S('p3', 'w5', 'fusion', 2.25, 50),
    S('p4', null, 'prime', 0.61, 300), S('p4', null, 'branded', 0.73, 120), S('p4', null, 'disqo', 1.93, 17),
    S('p9', 'w9', 'prime', 0.5, 999), S('p9', 'w9', 'fusion', 9, 999), // not in view
  ]

  it('per-panel amounts sum to the lever figure on the same population', () => {
    const m = run(projects, suppliers)
    const lever = waveSpreadLever(projects, suppliers)
    expect(lever).not.toBeNull()
    // Summed wave by wave in the lever's own order: bitwise the lever's figure.
    expect(m.total.above).toBe(lever!.high)
    // Split by panel and added back: equal to the lever within float noise.
    expect(Math.abs(sum(m.rows.map(r => r.above)) - lever!.high)).toBeLessThan(1e-9)
    expect(lever!.high).toBeGreaterThan(0)
  })

  it('reproduces the lever by hand, wave by wave', () => {
    const m = run(projects, suppliers)
    const w1 = (1.12 - 0.84) * 41 + (1.31 - 0.84) * 13
    const w2 = (1.09 - 1.05) * 77
    const w4 = 0 // fusion is the only panel that bought at a price above $0
    const w6 = (0.73 - 0.61) * 120 + (1.93 - 0.61) * 17
    expect(m.total.above).toBeCloseTo(w1 + w2 + w4 + w6, 9)
    expect(m.rows.find(r => r.id === 'branded')!.above).toBeCloseTo((1.12 - 0.84) * 41 + (0.73 - 0.61) * 120, 9)
    expect(m.rows.find(r => r.id === 'prime')!.above).toBe(0)
    expect(m.total.comparedWaves).toBe(3) // w1, w2 and p4's survey-wave
    expect(m.total.spreadWaves).toBe(3)
    expect(m.verdict).toMatch(/was paid above the cheapest panel in the same wave, on 3 of the 3 waves that bought from two or more panels\. Fill each wave from the cheapest panel/)
  })

  it('agrees when nothing was paid above the cheapest (the lever returns null)', () => {
    const flat = [S('p1', 'w1', 'prime', 1, 10), S('p1', 'w1', 'fusion', 1, 20), S('p2', 'w2', 'prime', 3, 5)]
    const m = run(projects, flat)
    expect(waveSpreadLever(projects, flat)).toBeNull()
    expect(m.total.above).toBe(0)
    expect(m.rows.every(r => r.above === 0)).toBe(true)
    expect(m.verdict).toMatch(/paid them the same price, so nothing was paid above the cheapest\. Keep filling/)
  })
})

describe('buildPanelsModel — edge cases', () => {
  it('a panel with no name reads "Unnamed panel", and a row with no supplier is still a row', () => {
    const rows = [
      S('a', 'w1', 'x1', 1, 10, null),
      { ...S('a', 'w1', 'x2', 2, 10), suppliers: null },
      S('a', 'w1', null, 3, 10, null),
    ]
    const m = run([P('a')], rows)
    expect(m.rows).toHaveLength(3)
    expect(m.rows.every(r => r.name === UNNAMED && !r.named)).toBe(true)
    expect(m.rows.map(r => r.id)).toContain(NO_SUPPLIER)
    expect(m.reconciliation.ok).toBe(true)
    // The lever counts a row with no supplier as its own panel ('?'): three
    // panels here, cheapest $1.
    expect(m.total.above).toBe(waveSpreadLever([P('a')], rows)!.high)
    expect(m.total.above).toBeCloseTo((2 - 1) * 10 + (3 - 1) * 10, 12)
  })

  it('a wave with one panel pays nothing above the cheapest, even at two prices', () => {
    const launches = [L('w1', 'a', 'PS 52350651', '2026-08-04')]
    const rows = [S('a', 'w1', 'prime', 0.8, 40), S('a', 'w1', 'prime', 1.2, 10), S('a', 'w1', 'disqo', 2, 0)]
    const m = run([P('a')], rows, { launches, selected: 'prime' })
    expect(m.total.above).toBe(0)
    expect(m.total.comparedWaves).toBe(0)
    const d = m.selected!
    expect(d.waves.map(w => w.basis)).toEqual(['only-panel', 'only-panel'])
    // Its own price is the cheapest there was.
    expect(d.waves.map(w => w.cheapest).sort()).toEqual([0.8, 1.2])
    expect(d.waves.every(w => w.above === 0)).toBe(true)
    expect(d.verdict).toMatch(/never shared a wave with another priced panel across its 1 wave, so there is nothing to compare/)
    expect(m.verdict).toMatch(/No wave here bought from more than one panel/)
  })

  it('a missing CPI is a floor, not a price: out of the price per complete and out of the comparison', () => {
    const launches = [L('w1', 'a', '52470052', '2026-09-02')]
    const rows = [
      S('a', 'w1', 'prime', 0.9, 100),
      S('a', 'w1', 'social', null, 50),
      S('a', 'w1', 'social', 1.5, 10),
      S('b', 'w2', 'nopr', null, 25, 'Never Priced'),
    ]
    const m = run([P('a'), P('b')], rows, { launches, selected: 'social' })
    const social = m.rows.find(r => r.id === 'social')!
    expect(social.completes).toBe(60)
    expect(social.unpricedCompletes).toBe(50)
    expect(social.spend).toBeCloseTo(15, 12) // the $0 the missing CPI adds, and no more
    expect(social.cpc).toBeCloseTo(1.5, 12) // not 15 ÷ 60
    const never = m.rows.find(r => r.id === 'nopr')!
    expect(never.cpc).toBeNull()
    expect(never.vsAll).toBeNull()
    expect(never.share).toBe(0)
    expect(m.total.unpricedCompletes).toBe(75)
    expect(m.floorNote).toBe('Spend is a floor: 75 completes from 2 panels have no price recorded, so their cost is missing, not zero.')
    // The unpriced purchase is not compared; the priced one is.
    const byBasis = Object.fromEntries(m.selected!.waves.map(w => [w.basis, w]))
    expect(byBasis['no-price'].cheapest).toBe(0.9)
    expect(byBasis['no-price'].above).toBe(0)
    expect(byBasis['no-price'].cost).toBe(0)
    expect(byBasis['compared'].above).toBeCloseTo((1.5 - 0.9) * 10, 12)
    expect(m.total.above).toBe(waveSpreadLever([P('a'), P('b')], rows)!.high)
    expect(m.reconciliation.ok).toBe(true)
  })
})

describe('buildPanelsModel — the drilldown', () => {
  const launches = [
    L('w1', 'a', '52470052', '2026-07-14', 'Consumer tracker · United States · PureSpectrum Survey# 52470052 · 120 completes, $100.80.'),
    L('w2', 'a', 'PS 50460796', '2026-08-02', 'Consumer tracker · en_US · PureSpectrum Survey# 50460796 · 80 completes.'),
    L('w3', 'b', '51809324', null, 'PureSpectrum dashboard snapshot 8/18 5:03PM — Total Cost $156.70.'),
  ]
  const rows = [
    S('a', 'w1', 'prime', 0.84, 120), S('a', 'w1', 'social', 1.02, 40),
    S('a', 'w2', 'prime', 0.8, 30), S('a', 'w2', 'social', 1.85, 50),
    S('b', 'w3', 'social', 1.4, 20),
    S('b', 'w3', 'social', 1.4, 0),
  ]
  const projects = [P('a', { launch_date: '2026-07-10' }), P('b')]

  it("lists the picked panel's waves with the launch, the country as recorded and the cheapest price", () => {
    const m = run(projects, rows, { launches, selected: 'social' })
    const d = m.selected!
    expect(m.selectedMissing).toBe(false)
    expect(d.waves).toHaveLength(3)
    // Largest cost above the cheapest first.
    const [first, second, third] = d.waves
    expect(first).toMatchObject({ code: 'A', label: 'PS 50460796', launchDate: '2026-08-02', country: 'en_US', cpi: 1.85, cheapest: 0.8, completes: 50, basis: 'compared' })
    expect(first.cost).toBeCloseTo(92.5, 9)
    expect(first.above).toBeCloseTo((1.85 - 0.8) * 50, 9)
    expect(second).toMatchObject({ label: '52470052', country: 'United States', cheapest: 0.84 })
    expect(second.above).toBeCloseTo((1.02 - 0.84) * 40, 9)
    expect(third).toMatchObject({ code: 'B', launchDate: null, country: null, basis: 'only-panel', cheapest: 1.4, above: 0 })
    // The detail adds back to the panel's own row.
    expect(d.totals.completes).toBe(d.row.completes)
    expect(d.totals.cost).toBeCloseTo(d.row.spend, 9)
    expect(d.totals.above).toBeCloseTo(d.row.above, 9)
    expect(d.sharedWaves).toBe(2)
    expect(d.verdict).toMatch(/^social was paid \$60 above the cheapest panel on 2 of its 3 waves; the largest gap was \$53 on A \(PS Survey# 50460796\)\. Before topping up from social again/)
  })

  it('says so when the picked panel bought nothing in this view', () => {
    const m = run(projects, rows, { launches, selected: 'nobody' })
    expect(m.selected).toBeNull()
    expect(m.selectedMissing).toBe(true)
  })

  it('draws launch month × panel, the picked panel on top, undated last', () => {
    const m = run(projects, rows, { launches, selected: 'social' })
    expect(m.heatmap.rows.map(r => r.key)).toEqual(['social', 'prime'])
    expect(m.heatmap.rows[0].description).toBe('The panel you picked')
    expect(m.heatmap.columns.map(c => c.key)).toEqual(['2026-07', '2026-08', UNDATED])
    expect(m.heatmap.columns.map(c => c.label)).toEqual(['Jul 2026', 'Aug 2026', 'Undated'])
    const cell = m.heatmap.cells.find(c => c.row === 'social' && c.col === '2026-08')!
    expect(cell.value).toBeCloseTo(1.85, 12)
    expect(cell.weight).toBe(50)
    expect(cell.countries).toEqual(['en_US'])
  })

  it('adds the picked panel to the heatmap when it is outside the top rows', () => {
    const many = Array.from({ length: HEATMAP_ROWS + 3 }, (_, i) => S('a', 'w1', `s${i}`, 1 + i, 10 + i))
    const small = S('a', 'w1', 'tiny', 0.5, 1)
    const m = run([P('a')], [...many, small], { selected: 'tiny' })
    expect(m.heatmap.rows).toHaveLength(HEATMAP_ROWS + 1)
    expect(m.heatmap.rows[0].key).toBe('tiny')
    // The chart keeps the biggest panels and folds the rest into one bar that
    // does not drill.
    expect(m.chart).toHaveLength(CHART_BARS + 1)
    const other = m.chart[CHART_BARS]
    expect(other.id).toBeNull()
    expect(other.name).toBe(`Other ${m.rows.length - CHART_BARS} panels`)
    expect(other.spend).toBeCloseTo(sum(m.rows.slice(CHART_BARS).map(r => r.spend)), 9)
  })

  it('draws a single leftover panel as itself, never as "Other 1 panels"', () => {
    const eleven = Array.from({ length: CHART_BARS + 1 }, (_, i) => S('a', 'w1', `s${i}`, 1 + i, 10))
    const m = run([P('a')], eleven)
    expect(m.chart).toHaveLength(CHART_BARS + 1)
    expect(m.chart.every(b => b.id != null)).toBe(true)
  })
})

describe('buildPanelsModel — on the Results population the shell hands it', () => {
  // The model counts exactly the population it is given. These are the
  // brief's fixture shapes run through the real classifier and filter, so the
  // panel view and the Results tab can never disagree about which surveys'
  // panel money is in view.
  const projects = [
    P('del', { deliver_date: '2026-07-01' }),
    P('hold', { board_column: 'Pipeline', status: 'Hold', deliver_date: '2026-07-05' }),
    P('scoping', { board_column: null, status: 'Open', phase: 'Scoping', deliver_date: '2026-07-06' }),
    P('ph-empty', { board_column: null, status: 'Open', is_placeholder: true, n_collected: 0, n_actual: null, deliver_date: '2026-07-07' }),
    P('ph-data', { is_placeholder: true, deliver_date: '2026-08-01' }),
    P('undated', { deliver_date: null }),
    P('both', { project_type: 'B2B', deliver_date: '2026-09-01' }),
  ]
  const suppliers = [
    S('del', 'w1', 'prime', 1, 10), S('del', 'w1', 'fusion', 1.5, 10),
    S('hold', 'w2', 'prime', 5, 100),
    S('ph-data', 'w3', 'fusion', 2, 10),
    S('undated', 'w4', 'prime', 3, 10), S('undated', 'w4', 'fusion', 4, 10),
    S('both', 'w5', 'prime', 0, 40), // a CPI recorded as $0: a price, never compared
  ]
  const blasts: FinBlast[] = [{ project_id: 'both', bid: 60, people: 500, completes: 3, cost_per_send: 0.02, channel: 'sms' }]

  function population(range: 'since-jun' | 'all') {
    const ix = buildIndex(blasts, suppliers, [])
    const items = itemsOf(projects, blasts, suppliers, [], ix)
    const f = range === 'all' ? { ...DEFAULT_FILTER, range: { preset: 'all' as const, from: null, to: null } } : DEFAULT_FILTER
    return { ix, pop: populationFor(items, 'results', f, '2026-09-28') }
  }

  it('counts delivered work only (a placeholder holding data included), and drops undated work once a range is picked', () => {
    const { ix, pop } = population('since-jun')
    expect(pop.map(i => i.p.id).sort()).toEqual(['both', 'del', 'ph-data'])
    const m = buildPanelsModel({ population: pop, suppliers, launches: [], blasts, costs: [], ix })
    expect(m.check.ok).toBe(true)
    expect(m.total.spend).toBeCloseTo(10 + 15 + 20 + 0, 12)
    expect(m.total.above).toBe(waveSpreadLever(pop.map(i => i.p), suppliers)?.high ?? 0)
    expect(m.total.above).toBeCloseTo(5, 12) // del's wave only
    // $0 CPI: priced (so it pulls prime's price per complete down) but not compared.
    const prime = m.rows.find(r => r.id === 'prime')!
    expect(prime.completes).toBe(50)
    expect(prime.pricedCompletes).toBe(50)
    expect(prime.cpc).toBeCloseTo(10 / 50, 12)
  })

  it('takes the undated survey in under All time, and still agrees with the lever', () => {
    const { ix, pop } = population('all')
    expect(pop.map(i => i.p.id)).toContain('undated')
    const m = buildPanelsModel({ population: pop, suppliers, launches: [], blasts, costs: [], ix })
    expect(m.check.ok).toBe(true)
    expect(m.total.above).toBe(waveSpreadLever(pop.map(i => i.p), suppliers)!.high)
    expect(m.total.above).toBeCloseTo(5 + 10, 12)
    expect(m.rows.find(r => r.id === 'prime')!.surveys).toBe(3)
  })
})

describe('countryAsRecorded', () => {
  it('reads the country from both note conventions, exactly as written', () => {
    expect(countryAsRecorded('BAM POS · United States · PureSpectrum Survey# 52470052 · 120 completes, $100.80.')).toBe('United States')
    expect(countryAsRecorded('BAM POS · en_US · PureSpectrum Survey# 52470052 · 120 completes.')).toBe('en_US')
    expect(countryAsRecorded('AWRVTGR20260908 · Germany · $3.00/complete · 15 PureSpectrum surveys rolled up')).toBe('Germany')
    expect(countryAsRecorded('Tracker · en_GB · $1.25-$2.50/complete · PureSpectrum Survey# 1')).toBe('en_GB')
  })
  it('returns null when the note carries no country', () => {
    expect(countryAsRecorded('BAM POS · PureSpectrum Survey# 52470052 · 120 completes.')).toBeNull()
    expect(countryAsRecorded('PureSpectrum dashboard snapshot 8/18 5:03PM — Total Cost $156.70.')).toBeNull()
    expect(countryAsRecorded('Imported from PureSpectrum_x_Suppliers.pdf (2026-09-22)')).toBeNull()
    expect(countryAsRecorded('')).toBeNull()
    expect(countryAsRecorded(null)).toBeNull()
  })
})

describe('supplierHref and vsAllText', () => {
  it('keeps every other parameter and anchors to the detail, or back to the card when cleared', () => {
    expect(supplierHref('/finance', 'tab=results&by=panel&account=c1', 'abc'))
      .toBe('/finance?tab=results&by=panel&account=c1&supplier=abc#panel-supplier-detail')
    expect(supplierHref('/finance', new URLSearchParams('by=panel&supplier=abc'), null))
      .toBe('/finance?by=panel#panel-suppliers')
    expect(supplierHref('/finance', '', null)).toBe('/finance#panel-suppliers')
  })
  it('prints a price against all panels with a sign, and "same" when it rounds to 0%', () => {
    expect(vsAllText(0.23)).toBe('+23%')
    expect(vsAllText(-0.1)).toBe('−10%')
    expect(vsAllText(0.004)).toBe('same')
    expect(vsAllText(null)).toBe('—')
  })
})
