import { describe, it, expect } from 'vitest'
import { cpqrWithCoverage, blastIncidence, nearestRank } from './cpqr'
import { buildIndex, type FinBlast, type FinCost, type FinProject, type FinSupplier } from './hub'

// The rates alone. cpqrByRoute was this one-liner and had no caller outside
// its tests, so it was deleted; the tests keep their shape through this.
const cpqrByRoute = (...a: Parameters<typeof cpqrWithCoverage>) => cpqrWithCoverage(...a).rates

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

/**
 * 117: mixed-route surveys reaching CPQR at all.
 *
 * Seven delivered surveys use both routes and carry $32,878.54 of spend and
 * 2,554 delivered respondents. Every one of them was dropped by the opening
 * `if (route !== 'blast' && route !== 'panel') continue` — about 13% of costed
 * delivered spend, absent from the only per-respondent cost figure published.
 *
 * PR00425 is the worked example throughout: 995 PureSpectrum collected for
 * $2,085.70 and 236 delivered; 24 blast completes for $2,730.10 and 16
 * delivered; and an $8,697.85 ZoomInfo list that bought exactly the 124,255
 * sends those blasts used.
 */
describe('cpqrByRoute: mixed-route surveys', () => {
  const MIX = (o: Partial<FinProject> = {}) => P({
    id: 'm', project_type: 'B2B', n_collected: 1019, n_actual: 252,
    n_actual_panel: 236, n_actual_blast: 16, n_actual_split_method: 'measured', ...o,
  })
  const MB = [{ project_id: 'm', bid: 245 / 24, completes: 24, people: 124255, cost_per_send: 0.02, channel: 'sms' }]
  const MS = [S('m', 2085.70 / 995, 995)]
  const ZOOM = (route: string | null) => [{ project_id: 'm', amount: 8697.85, route }]

  it('prices each route on its own money and its own delivered N', () => {
    const r = cpqrByRoute([MIX()], MB, MS, ZOOM('blast'))
    const panel = r.find(x => x.route === 'panel')!
    const blast = r.find(x => x.route === 'blast')!
    // $8.84 against $714.25 — an 81x spread that the blended $53.63 hides
    // completely, which is the entire reason this exists.
    expect(panel.blended).toBeCloseTo(8.84, 2)
    expect(blast.blended).toBeCloseTo(714.25, 2)
    expect(panel.qualified).toBe(236)
    expect(blast.qualified).toBe(16)
    expect(panel.mixed).toBe(1)
    expect(blast.mixed).toBe(1)
  })

  it('never lets the same dollar reach both cards', () => {
    const r = cpqrByRoute([MIX()], MB, MS, ZOOM('blast'))
    const total = r.reduce((t, x) => t + x.spend, 0)
    expect(total).toBeCloseTo(13513.65, 2)
    expect(r.reduce((t, x) => t + x.qualified, 0)).toBe(252)
  })

  it('refuses the survey outright while its flat cost names no route', () => {
    // The failure this guard exists for: admitted with the list unplaced, the
    // blast leg prices at $170.63 — a quarter of the truth — and pools into a
    // median beside single-route surveys that DO carry their flat costs.
    const { rates, mixed } = cpqrWithCoverage([MIX()], MB, MS, ZOOM(null))
    expect(rates).toEqual([])
    expect(mixed).toMatchObject({ surveys: 1, priced: 0 })
    expect(mixed.reasons['unrouted-cost']).toBe(1)
    expect(mixed.unroutedSpend).toBeCloseTo(8697.85, 2)
    expect(mixed.blockedSpend).toBeCloseTo(13513.65, 2)
    expect(mixed.blockedN).toBe(252)
  })

  it('refuses a split that no longer sums to n_actual', () => {
    const { rates, mixed } = cpqrWithCoverage([MIX({ n_actual: 300 })], MB, MS, ZOOM('blast'))
    expect(rates).toEqual([])
    expect(mixed.reasons['split-mismatch']).toBe(1)
  })

  it('refuses an ESTIMATED split, and says so rather than dropping it silently', () => {
    const { rates, mixed } = cpqrWithCoverage(
      [MIX({ n_actual_split_method: 'estimated' })], MB, MS, ZOOM('blast'))
    expect(rates).toEqual([])
    expect(mixed.reasons['estimated']).toBe(1)
  })

  it('reports a mixed survey nobody has split yet as no-split, not as absent', () => {
    const { rates, mixed } = cpqrWithCoverage(
      [MIX({ n_actual_panel: null, n_actual_blast: null, n_actual_split_method: null })],
      MB, MS, ZOOM('blast'))
    expect(rates).toEqual([])
    expect(mixed).toMatchObject({ surveys: 1, priced: 0, blockedN: 252 })
    expect(mixed.reasons['no-split']).toBe(1)
  })

  it('counts a mixed survey with no n_actual at all, rather than losing it', () => {
    // PR00321 and PR00034 are exactly this. They are not "fine", they are
    // unmeasurable, and the coverage line is where that becomes visible.
    const { mixed } = cpqrWithCoverage([MIX({ n_actual: null })], MB, MS, ZOOM('blast'))
    expect(mixed.reasons['no-n-actual']).toBe(1)
    expect(mixed.blockedSpend).toBeCloseTo(13513.65, 2)
  })

  it('keeps the spend of a route that delivered nothing', () => {
    // Money spent on a route that produced no usable interview is a real
    // outcome. Dropping the leg would understate what a respondent costs.
    const r = cpqrByRoute([MIX({ n_actual_panel: 252, n_actual_blast: 0 })], MB, MS, ZOOM('blast'))
    const blast = r.find(x => x.route === 'blast')
    // No finite per-survey rate, so no median row…
    expect(blast).toBeUndefined()
    // …but the panel side is untouched and still prices its own 252.
    expect(r.find(x => x.route === 'panel')).toMatchObject({ qualified: 252 })
  })

  it('leaves single-route surveys exactly where they were', () => {
    // The no-op guarantee. A mixed survey in the set must not move a rate built
    // from single-route surveys by a cent.
    const solo = [P({ id: 'a', project_type: 'PS', n_collected: 100, n_actual: 50 })]
    const before = cpqrByRoute(solo, [], [S('a', 1, 100)], [])
    expect(before[0]).toMatchObject({ route: 'panel', n: 1, blended: 2, qualified: 50, spend: 100 })

    // Add a mixed survey whose flat cost is NOT routed: it must contribute
    // nothing, so every figure on the panel card has to come back identical.
    const blocked = cpqrByRoute([...solo, MIX()], MB, [...MS, S('a', 1, 100)], ZOOM(null))
    expect(blocked).toEqual(before)

    // Route the cost and it joins — as a SECOND observation, not by disturbing
    // the first. The solo survey's own $2.00 is still in there beside the mixed
    // leg's $8.84.
    const after = cpqrByRoute([...solo, MIX()], MB, [...MS, S('a', 1, 100)], ZOOM('blast'))
    const panelAfter = after.find(x => x.route === 'panel')!
    expect(panelAfter.n).toBe(2)
    expect(panelAfter.spend).toBeCloseTo(100 + 2085.70, 2)
    expect(panelAfter.qualified).toBe(50 + 236)
  })
})

describe('one population for the dumbbell', () => {
  it('prices per complete bought and per qualified respondent on the SAME surveys', () => {
    // So the gap between the two dots is exactly the scrub: blended × (1 − scrub)
    // = perComplete. The old cost-per-complete card used a different population
    // and a median, and its help text claimed the same identity falsely.
    const rows = [
      P({ id: 'a', project_type: 'PS', n_collected: 100, n_actual: 80 }),
      P({ id: 'b', project_type: 'PS', n_collected: 200, n_actual: 100 }),
    ]
    const r = cpqrByRoute(rows, [], [S('a', 1, 100), S('b', 2, 200)], [])[0]
    expect(r.perComplete).toBeCloseTo(500 / 300)
    expect(r.blended).toBeCloseTo(500 / 180)
    expect(r.blended * (1 - r.scrubRate)).toBeCloseTo(r.perComplete)
    expect(r.ids.sort()).toEqual(['a', 'b'])
  })

  it('hands back each admitted leg, so a per-survey figure can be drawn from the SAME surveys', () => {
    const rows = [
      P({ id: 'a', project_type: 'PS', n_collected: 100, n_actual: 80 }),
      P({ id: 'b', project_type: 'PS', n_collected: 200, n_actual: 100 }),
      P({ id: 'bad', project_type: 'PS', n_collected: 100, n_actual: 100 }), // under-recorded: out
    ]
    const r = cpqrByRoute(rows, [], [S('a', 1, 100), S('b', 2, 200), S('bad', 1, 20)], [])[0]
    expect(r.observations.map(o => o.id)).toEqual(['a', 'b'])
    expect(r.observations.map(o => o.id).sort()).toEqual([...r.ids].sort())
    const a = r.observations.find(o => o.id === 'a')!
    expect(a).toMatchObject({ spend: 100, paid: 100, delivered: 80, mixed: false })
    expect(a.cpqr).toBeCloseTo(1.25)
    expect(a.keep).toBeCloseTo(0.8)
    // The pooled figures are the observations added up.
    const spend = r.observations.reduce((t, o) => t + o.spend, 0)
    const got = r.observations.reduce((t, o) => t + o.delivered, 0)
    expect(r.blended).toBeCloseTo(spend / got)
    // And the typical-survey quartiles come from the same per-survey rates.
    expect(r.median).toBe(nearestRank(r.observations.map(o => o.cpqr as number), 0.5))
  })

  it('gives the same answer with the caller’s index as without it', () => {
    const rows = [P({ id: 'a', project_type: 'PS', n_collected: 100, n_actual: 80 })]
    const sup = [S('a', 1, 100)]
    const ix = buildIndex([], sup, [])
    expect(cpqrWithCoverage(rows, [], sup, [], ix)).toEqual(cpqrWithCoverage(rows, [], sup, []))
  })

  it('reports blast CPQR net of recovered rewards, with the gross beside it', () => {
    const rows = [P({ id: 'x', n_collected: 10, n_actual: 10 })]
    const c: FinCost[] = [{ project_id: 'x', amount: -20, route: 'blast' }]
    const r = cpqrByRoute(rows, [B('x', 10, 10)], [], c)[0]
    expect(r).toMatchObject({ spend: 80, recovered: -20 })
    expect(r.blended).toBeCloseTo(8)
    expect(r.blendedGross).toBeCloseTo(10)
  })

  it('holds OUT a survey whose N actual is only the partial segment roll-up, and names it (PR00231)', () => {
    // Its survey N actual (342) is the one counted segment's; its $9,000 bought
    // 9,000 N across both. Admitted, it read as $26 a respondent and 96%
    // scrubbed, and on live data (28 Sep) it moved the panel card's pooled
    // scrub from 26.5% to 34.4%. The bill still reads 342 (revenue.ts); a rate
    // cannot.
    const q = P({ id: 'q', project_type: 'PS', n_collected: 9000, n_actual: 342, segments: [
      { id: 's1', project_id: 'q', n_target: 400, n_actual: 342 },
      { id: 's2', project_id: 'q', n_target: 4600, n_actual: null },
    ] })
    const ok = P({ id: 'ok', project_type: 'PS', n_collected: 100, n_actual: 80 })
    const out = cpqrWithCoverage([q, ok], [], [S('q', 1, 9000), S('ok', 1, 100)], [])
    const panel = out.rates.find(r => r.route === 'panel')!
    // Only 'ok' is in the rate: $100 over 80, 20% scrubbed.
    expect(panel).toMatchObject({ n: 1, spend: 100, qualified: 80, paid: 100, ids: ['ok'], partialHeldOut: 1, excluded: 0 })
    expect(panel.scrubRate).toBeCloseTo(0.2)
    expect(out.partialRollUp).toEqual({ surveys: 1, spend: 9000, collected: 9000, ids: ['q'] })
    // It is held out, not "counted with a note".
    expect(out.segmentNotes.surveys).toBe(0)
    // Alone, it produces no card at all rather than a card built from it.
    expect(cpqrWithCoverage([q], [], [S('q', 1, 9000)], []).rates).toEqual([])
  })

  it('counts a survey whose TYPED N actual disagrees with its segments, and lists it', () => {
    // PR00257 / PR00288 / PR00230 shape: the survey's N actual was typed and is
    // not the counted segments' sum. It is the invoice's figure, so it is the
    // denominator; the segment counts are a note for the Improve tab.
    const p = P({ id: 't', project_type: 'PS', n_collected: 600, n_actual: 500, segments: [
      { id: 's1', project_id: 't', n_target: 250, n_actual: 342 },
      { id: 's2', project_id: 't', n_target: 250, n_actual: null },
    ] })
    const out = cpqrWithCoverage([p], [], [S('t', 1, 600)], [])
    expect(out.rates[0]).toMatchObject({ n: 1, spend: 600, qualified: 500, ids: ['t'], partialHeldOut: 0 })
    expect(out.segmentNotes).toMatchObject({ surveys: 1, spend: 600, ids: ['t'] })
    expect(out.partialRollUp.surveys).toBe(0)
    // Segments that add up raise no note.
    const even = P({ id: 'e', project_type: 'PS', n_collected: 100, n_actual: 90, segments: [
      { id: 's3', project_id: 'e', n_target: 50, n_actual: 60 },
      { id: 's4', project_id: 'e', n_target: 50, n_actual: 30 },
    ] })
    expect(cpqrWithCoverage([even], [], [S('e', 1, 100)], []).segmentNotes.surveys).toBe(0)
  })

  it('records a MIXED partial roll-up under the mixed coverage reasons, and in the note', () => {
    const m = P({
      id: 'm', n_collected: 550, n_actual: 100, n_actual_panel: 80, n_actual_blast: 20,
      n_actual_split_method: 'transaction_id', segments: [
        { id: 'a', project_id: 'm', n_target: 100, n_actual: 100 },
        { id: 'b', project_id: 'm', n_target: 400, n_actual: null },
      ],
    })
    const out = cpqrWithCoverage([m], [B('m', 10, 50)], [S('m', 1, 500)], [])
    expect(out.mixed).toMatchObject({ surveys: 1, priced: 0, blockedSpend: 1000 })
    expect(out.mixed.reasons['partial-n-actual']).toBe(1)
    expect(out.partialRollUp).toMatchObject({ surveys: 1, spend: 1000, ids: ['m'] })
  })
})
