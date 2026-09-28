import { describe, it, expect } from 'vitest'
import {
  buildResultsModel, goalCostWords, goalKeptWords, GROUP_BY_OPTIONS, parseGroupBy, partsText, rawLineOfIds,
  RESULTS_NEEDS, resultsDrill, resultsExport, resultsInputOf,
  type ResultsDrillRequest, type ResultsGroupBy, type ResultsModel, type ResultsInput,
} from './results'
import { KEEP_GOAL } from './revenue'
import { centsText, pctText } from './format'
import { accountPnl, surveyPnl } from './analysis'
import { marginOf } from './hub'
import { reconcile } from './drill'
import { DEFAULT_FILTER, type FinanceFilter } from './filters'
import { fixtureLoad, TODAY } from './results.fixture'

/**
 * The Results tab's model, against a book whose figures are computed by hand
 * (lib/finance/results.fixture.ts). The absolute figures are asserted as well
 * as the agreements between consumers, because consumers that share code can
 * all be wrong the same way.
 */

const F = (o: Partial<FinanceFilter> = {}): FinanceFilter => ({ ...DEFAULT_FILTER, ...o })
const ALL: FinanceFilter['range'] = { preset: 'all', from: null, to: null }
const cents = (x: number) => Math.round(x * 100)
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)

function build(f: FinanceFilter = F(), by: ResultsGroupBy = 'account', load = fixtureLoad()) {
  const input = resultsInputOf(load, f, TODAY, by)
  return { input, model: buildResultsModel(input) }
}

describe('Tile 1 on the margin set (default view: since 1 Jun 2026)', () => {
  const { model } = build()
  const t1 = model.tile1

  it('counts exactly the margin set, hand-computed', () => {
    expect(t1.surveys).toBe(31)
    expect(cents(t1.clientPrice)).toBe(cents(86540))
    expect(cents(t1.ourCost)).toBe(cents(46021))
    expect(cents(t1.kept)).toBe(cents(40519))
    expect(t1.keptPct).toBeCloseTo(40519 / 86540, 10)
    expect(t1.costPerDollar).toBeCloseTo(46021 / 86540, 10)
  })

  it('leaves out priced work with no cost, priced work with no delivered N and unpriced work', () => {
    for (const id of ['priced-nocost', 'priced-no-n', 'unpriced']) expect(t1.ids).not.toContain(id)
    // A placeholder that holds data is real work; an empty one is nowhere.
    expect(t1.ids).toContain('ph-data')
    expect(model.ledger.map(l => l.id)).not.toContain('ph-empty')
  })

  it('never shows Scoping, Hold, live, cancelled or archived work as results', () => {
    const ids = model.ledger.map(l => l.id)
    for (const id of ['scoping', 'hold', 'live', 'cancelled', 'archived']) expect(ids).not.toContain(id)
  })

  it('counts a $0 price in the dollars and keeps it out of every ratio', () => {
    expect(t1.free).toEqual({ surveys: 1, cost: 660, ids: ['free'] })
    expect(t1.paid.surveys).toBe(30)
    expect(cents(t1.paid.kept)).toBe(cents(41179))
    expect(t1.paid.keptPct).toBeCloseTo(41179 / 86540, 10)
    const free = model.ledger.find(l => l.id === 'free')!
    expect(free.revenue).toBe(0)
    expect(free.keptPct).toBeNull()
    expect(free.spendPerPrice).toBeNull()
    expect(free.budgetPerPrice).toBeNull()
    expect(free.inMedian).toBe(false)
    expect(free.tags).toEqual(['over-budget', 'given-away'])
  })

  it('bills a partial segment roll-up at the survey N, and prints no cost per billed N for it', () => {
    const p = model.ledger.find(l => l.id === 'partial')!
    expect(p.billedN).toBe(280)
    expect(p.revenue).toBe(840)
    expect(p.kept).toBe(-60)
    expect(p.costPerBilledN).toBeNull()
    expect(p.tags).toContain('lost-money')
  })

  it('reads the budget against the price: median, n, over budget and still made money', () => {
    expect(t1.budget.n).toBe(5)
    expect(t1.budget.medianPerDollar).toBeCloseTo(1500 / 2700, 10)
    expect(t1.budget.overBudget).toBe(5)
    expect(t1.budget.overBudgetMadeMoney).toBe(3)
    expect(t1.budget.withBudget).toBe(6)
    expect(t1.budget.withBudgetInMargin).toBe(6)
    expect(t1.pricedAboveZero).toBe(30)
    expect(t1.spentOverGoal).toBe(13)
  })

  it('writes the four figures in the house format', () => {
    expect(t1.text.price).toEqual({ value: '$86,540', sub: 'On 31 surveys with both a client price and a recorded cost.' })
    expect(t1.text.cost).toEqual({ value: '$46,021', sub: '53¢ of every $1 of client price. Field cost only.' })
    expect(t1.text.kept.value).toBe('$40,519 · 47%')
    expect(t1.text.kept.sub).toBe('48% on paid work — excludes 1 survey given away at $0 (−$660). Goal: 50%.')
    expect(t1.text.budget).toEqual({
      value: '56¢ per $1',
      sub: 'Median of 5 surveys with a budget and a price above $0. Of the 6 surveys with a budget, 5 went over it; 3 of those still made money.',
    })
  })

  it('agrees with the per-survey ledger, the export and marginOf to the cent', () => {
    const ledgerPrice = sum(model.ledger.filter(l => l.inMargin).map(l => l.revenue ?? 0))
    expect(cents(ledgerPrice)).toBe(cents(t1.clientPrice))
    const exp = resultsExport(model)
    expect(exp.rows).toHaveLength(31)
    expect(cents(sum(exp.rows.map(r => Number(r.client_price))))).toBe(cents(t1.clientPrice))
    expect(cents(sum(exp.rows.map(r => Number(r.our_cost))))).toBe(cents(t1.ourCost))
    const { input } = build()
    const m = marginOf(input.population.map(i => i.p), input.load.raw.rates, input.load.raw.blasts, input.load.raw.suppliers, input.load.raw.costs)
    expect(cents(m.revenue)).toBe(cents(t1.clientPrice))
    expect(new Set(m.ids)).toEqual(new Set(t1.ids))
  })
})

describe('the coverage line, the waterfall and what is not in the figures', () => {
  const { model } = build()

  it('says how much of the delivered spend the margin set holds', () => {
    const c = model.coverage
    expect(c.deliveredSurveys).toBe(34)
    expect(cents(c.deliveredSpend)).toBe(cents(50371))
    expect(c.share).toBeCloseTo(46021 / 50371, 10)
    expect(c.noPrice).toEqual({ spend: 2100, surveys: 1 })
    expect(c.pricedBlocked).toEqual({ surveys: 1, spend: 2250, ids: ['priced-no-n'] })
    expect(c.pricedNoCost.surveys).toBe(1)
    expect(partsText(c.parts)).toBe(
      'These 31 surveys hold 91% of the $50,371 spent on delivered work in this view. ' +
      '$2,100 of it is on 1 survey with no client price — price it from the Improve tab. ' +
      'Another $2,250 is on 1 priced survey that cannot be billed yet: no delivered N or no N target. ' +
      '1 priced survey carries no recorded cost and is left out, so it does not read as 100% kept.')
    expect(c.parts.filter(p => p.kind === 'action').map(p => p.kind === 'action' && p.action))
      .toEqual(['waterfall', 'unpriced', 'improve'])
  })

  it('splits the spend with recoveries on their own negative line, never in Other', () => {
    const w = model.waterfall
    const line = (k: string) => w.lines.find(l => l.key === k)!.amount
    expect(cents(line('panel'))).toBe(cents(6001))
    expect(cents(line('rewardsGross'))).toBe(cents(44150))
    expect(line('recovered')).toBe(-200)
    expect(cents(line('sends'))).toBe(cents(20))
    expect(line('other')).toBe(400)
    expect(cents(line('total'))).toBe(cents(model.coverage.deliveredSpend))
    expect(cents(sum(w.lines.filter(l => l.key !== 'total').map(l => l.amount)))).toBe(cents(w.total))
    expect(w.lines.find(l => l.key === 'recovered')!.label).toBe('Rewards recovered (money back)')
    expect(w.sms.rates).toEqual([0.02])
    expect(w.sms.words).toContain('1,000 text messages on 1 blast, at $0.02 a message')
    expect(w.note).toContain('$200 came back on 1 survey')
  })

  it('names cancelled and archived spend at any date, in the same account and route', () => {
    expect(model.notIn.cancelled).toEqual({ surveys: 1, spend: 50, ids: ['cancelled'], inClass: 1 })
    // Dated April — outside the default range — and still counted.
    expect(model.notIn.archived).toEqual({ surveys: 1, spend: 200, ids: ['archived'], inClass: 1 })
    expect(partsText(model.notIn.parts)).toBe(
      'Not in these figures: $50 spent by the 1 survey cancelled before delivery, and $200 spent by the 1 survey archived without delivery — at any date, in the same account and route.')
    const coa = build(F({ account: 'coa' })).model
    expect(coa.notIn.cancelled.surveys).toBe(1)
    expect(coa.notIn.archived.surveys).toBe(0)
    expect(partsText(coa.notIn.parts)).toContain('and no survey archived without delivery')
    expect(build(F({ route: 'panel' })).model.notIn.cancelled.surveys).toBe(0)
  })
})

describe('chart C1 by month', () => {
  it('draws price and cost from the margin set only, with the no-price spend beside them', () => {
    const { model } = build()
    expect(model.months.map(m => m.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
    const aug = model.months.find(m => m.key === '2026-08')!
    expect(aug.surveys).toBe(13)
    expect(cents(aug.price!)).toBe(cents(31700))
    expect(cents(aug.cost!)).toBe(cents(17441))
    expect(aug.spendNoPrice).toBe(2100)
    expect(aug.delivered).toBe(14)
    expect(cents(sum(model.months.map(m => m.price ?? 0)))).toBe(cents(model.tile1.clientPrice))
    expect(cents(sum(model.months.map(m => m.cost ?? 0)))).toBe(cents(model.tile1.ourCost))
  })

  it('fades a thin month and flags pending recoveries', () => {
    const { model } = build()
    const jul = model.months.find(m => m.key === '2026-07')!
    expect(jul.thin).toBe(true)
    expect(jul.note).toBe('Only 1 survey with both a client price and a cost')
    expect(model.months.find(m => m.key === '2026-06')!.thin).toBe(false)
    expect(model.months.find(m => m.key === '2026-09')!.recoveriesPending).toBe(true)
  })

  it('computes the cost-reliability month from the whole book and greys earlier months under All time', () => {
    const { model } = build(F({ range: ALL }))
    expect(model.costReliableFrom).toBe('2026-06')
    const may = model.months.find(m => m.key === '2026-05')!
    expect(may.beforeReliable).toBe(true)
    expect(may.note).toContain('Costs not recorded')
    expect(model.months.filter(m => m.beforeReliable).map(m => m.key)).toEqual(['2026-05'])
    // The undated survey is in the figures and in no month.
    expect(model.undated).toEqual({ delivered: 1, surveys: 1, spend: 360 })
    expect(model.tile1.surveys).toBe(33)
    // Filtering to one account does not move the book-level line.
    expect(build(F({ range: ALL, account: 'sig' })).model.costReliableFrom).toBe('2026-06')
  })
})

describe('the verdict', () => {
  it('states the trend when both months have 10 surveys, and the paid-work variant', () => {
    const { model } = build()
    expect(partsText(model.verdict)).toBe(
      'Aug 2026 45% → Sep 2026 41%, but Sep 2026 is 43% without the 1 survey given away at $0 — level with Aug 2026, ' +
      'and Sep 2026 blast cost is still waiting on reward recoveries. ' +
      "2 priced surveys lost money: LOSS −$1,400, PARTIAL −$60. Re-price those accounts' next waves. " +
      '13 of 30 priced surveys spent more than half their price.')
    const surveys = model.verdict.filter(p => p.kind === 'survey')
    expect(surveys.map(p => p.kind === 'survey' && p.id)).toEqual(['loss', 'partial'])
  })

  it('says "too few surveys to call" when a side has fewer than 10', () => {
    const { model } = build(F({ account: 'bam' }))
    const text = partsText(model.verdict)
    expect(text).toContain('Too few surveys to call a trend: Aug 2026 has 0 and Sep 2026 has 3')
    expect(text).not.toContain('→')
    expect(text).toContain("1 priced survey lost money: PARTIAL −$60. Re-price that account's next waves.")
    expect(text).toContain('1 of 7 priced surveys spent more than half their price.')
  })

  it('names at most four losses, then "and N more"', () => {
    const load = fixtureLoad()
    // Make every September bulk survey a loss.
    for (const b of load.raw.blasts) if (/^s\d+$/.test(b.project_id)) b.bid = 200
    const text = partsText(buildResultsModel(resultsInputOf(load, F(), TODAY)).verdict)
    expect(text).toMatch(/12 priced surveys lost money: [A-Z0-9]+ −\$[\d,]+, [A-Z0-9]+ −\$[\d,]+, [A-Z0-9]+ −\$[\d,]+, [A-Z0-9]+ −\$[\d,]+, and 8 more\./)
  })

  it('has nothing to call on an empty margin set, and says what to do', () => {
    const { model } = build(F({ range: { preset: 'custom', from: '2025-01-01', to: '2025-01-31' } }))
    expect(model.tile1.surveys).toBe(0)
    expect(partsText(model.verdict)).toBe(
      'No delivered survey in this view carries both a client price and a recorded cost, so there is nothing to call yet. Add the missing prices from the Improve tab.')
  })
})

describe('a failed or empty price read is missing, never $0', () => {
  it('blocks the price figures when a finance reader gets no prices back', () => {
    const { model } = build(F(), 'account', fixtureLoad({ prices: false }))
    expect(model.priceBlock).toBe('Blocked: project_financials returned no prices')
  })
  it('blocks when project_financials did not load', () => {
    const { model } = build(F(), 'account', fixtureLoad({ blocked: ['project_financials'] }))
    expect(model.priceBlock).toBe('Blocked: project_financials did not load')
  })
})

describe('a survey priced above $0 that billed no respondents', () => {
  /** n_actual = 0 on a delivered, priced survey is one edit away, and it used
   *  to fall between every bucket: revenue $0 makes it neither paid work nor a
   *  $0 giveaway, so the "excludes N given away" sentence quietly left it out
   *  and the ledger gave it no tag at all while its whole cost was a loss.
   *  Built by editing the fixture's one loss-maker rather than adding a survey,
   *  so the shared book's hand-computed totals stay the book everything else is
   *  checked against. */
  const zeroBilled = () => {
    const load = fixtureLoad()
    const p = load.raw.projects.find(x => x.id === 'loss')
    if (p) p.n_actual = 0
    return load
  }

  it('stays in the margin set and is in neither the paid nor the given-away bucket', () => {
    const { model } = build(F(), 'account', zeroBilled())
    expect(model.tile1.surveys).toBe(31)
    expect(model.tile1.paid.surveys).toBe(29)
    expect(model.tile1.free.surveys).toBe(1)
    expect(model.tile1.zeroBilled).toEqual({ surveys: 1, cost: 2400, ids: ['loss'] })
  })

  it('is named in the "We keep" sub-line, so "on paid work" says what it excludes', () => {
    const { model } = build(F(), 'account', zeroBilled())
    expect(model.tile1.text.kept.sub).toBe(
      '50% on paid work — excludes 1 survey given away at $0 (−$660) ' +
      'and 1 survey that billed no respondents (−$2,400). Goal: 50%.')
  })

  it('is tagged LOST MONEY and named in the verdict, because its whole cost is a loss', () => {
    const { model } = build(F(), 'account', zeroBilled())
    const row = model.ledger.find(l => l.id === 'loss')
    expect(row?.revenue).toBe(0)
    expect(row?.kept).toBe(-2400)
    expect(row?.free).toBe(false)
    expect(row?.tags).toEqual(['lost-money', 'over-budget'])
    expect(partsText(model.verdict)).toContain('LOSS −$2,400')
  })

  it('says so on the survey ledger verdict too', () => {
    const { model } = build(F(), 'survey', zeroBilled())
    // 2, not 1: the fixture's partial roll-up plus this one. Without the tag it
    // read as 1, and a $2,400 loss was in no list on the page.
    expect(partsText(model.tile2.verdict)).toContain('2 lost money')
  })
})

describe('the tables every figure needs', () => {
  /** `clients` is not divided by anywhere, but the loader builds the demo set
   *  from it and falls back to the stale `client` text column for names, so a
   *  failed read silently lets demo money in and splits one account into many.
   *  It has to block the card like any other missing input. */
  it('counts clients, because a failed read would change every figure silently', () => {
    expect(RESULTS_NEEDS).toContain('clients')
    expect(RESULTS_NEEDS).toContain('project_financials')
    expect(RESULTS_NEEDS).toContain('project_segments')
  })
})

describe('the 50% goal is written from the constant, never typed', () => {
  it('words the goal from KEEP_GOAL on both sides of the same coin', () => {
    expect(goalKeptWords()).toBe(pctText(KEEP_GOAL))
    expect(goalCostWords()).toBe(centsText(1 - KEEP_GOAL))
    expect(goalKeptWords()).toBe('50%')
    expect(goalCostWords()).toBe('50¢')
  })

  it('uses it in the drill column help rather than a typed number', () => {
    const { input, model } = build()
    const spec = resultsDrill(input, model, { kind: 'budget' })
    const col = spec.columns.find(c => c.key === 'budgetPerPrice')
    expect(col?.tip).toBe(`Cents of budget per $1 of client price. The goal is about ${goalCostWords()}.`)
  })
})

describe('Tile 2 groupings', () => {
  const byAll = GROUP_BY_OPTIONS.map(o => o.id).filter(b => b !== 'survey' && b !== 'panel')

  it.each(byAll)('by %s adds back to Tile 1 to the cent', by => {
    const { model } = build(F(), by)
    const rows = model.tile2.rows
    expect(cents(sum(rows.map(r => r.revenue)))).toBe(cents(model.tile1.clientPrice))
    expect(cents(sum(rows.map(r => r.cost)))).toBe(cents(model.tile1.ourCost))
    expect(sum(rows.map(r => r.measured))).toBe(model.tile1.surveys)
    expect(sum(rows.map(r => r.surveys))).toBe(model.ledger.length)
  })

  it('by account is exactly the account table, with route rows and no blended per-respondent figure', () => {
    const { input, model } = build()
    const raw = input.load.raw
    const pnl = surveyPnl(input.population.map(i => i.p), raw.rates, raw.blasts, raw.suppliers, raw.costs,
      new Map(raw.accounts.map(a => [a.id, a.name ?? ''])))
    const direct = accountPnl(pnl)
    for (const r of model.tile2.rows) {
      const a = direct.find(x => x.accountId === r.key)!
      expect(cents(r.revenue)).toBe(cents(a.revenue))
      expect(cents(r.kept)).toBe(cents(a.margin))
      expect(r.measured).toBe(a.measured)
    }
    expect(model.tile2.rows.map(r => r.label)).toEqual(['Coatue', 'BAM', 'UBS', 'SIG'])
    const bam = model.tile2.rows.find(r => r.label === 'BAM')!
    expect(bam.blended).toBe(true)
    expect(bam.pricePerBilledN).toBeNull()
    expect(bam.costPerBilledN).toBeNull()
    expect(bam.routes.map(r => r.route).sort()).toEqual(['blast', 'none', 'panel'])
    // Every route row prints both per-respondent figures except BAM's panel
    // row, whose one survey is the partial segment roll-up (see below).
    expect(bam.routes.filter(r => r.route !== 'panel').every(r => r.pricePerBilledN != null)).toBe(true)
    expect(bam.unpricedSpend).toBe(2100)
    const sig = model.tile2.rows.find(r => r.label === 'SIG')!
    expect(sig.tooFew).toBe(true)
    expect(model.tile2.tooFew).toBe(2)
    expect(partsText(model.tile2.verdict)).toBe(
      'Coatue kept the most: $23,659, 47% on 22 surveys. 1 account has fewer than 3 surveys and is too few to judge. ' +
      'UBS (−$660) had only work given away at $0; confirm the $0 price was meant. ' +
      'SIG lost money: −$1,400. Start the re-pricing with SIG.')
  })

  it('leaves a partial segment roll-up out of BOTH per-respondent figures', () => {
    // The group's cost covers every segment while its billed N counts only the
    // segments that have a count, so cost per respondent would read far too
    // high — the per-survey ledger blanks the same figure, and the two must
    // not give one survey two answers.
    // BAM's panel work is the partial roll-up and nothing else, so there is
    // nothing left to measure and both figures are blank, exactly as the
    // per-survey ledger prints that survey.
    const { model } = build(F({ account: 'bam' }), 'route')
    const panel = model.tile2.rows.find(r => r.key === 'panel')
    expect(panel?.ids).toEqual(['partial'])
    expect(panel?.partialExcluded).toBe(1)
    expect(panel?.costPerBilledN).toBeNull()
    expect(panel?.pricePerBilledN).toBeNull()
    expect(model.ledger.find(l => l.id === 'partial')?.costPerBilledN).toBeNull()

    // With other panel surveys in the group, the figures are computed on those
    // and the row says how many surveys it left out.
    const all = build(F(), 'route').model.tile2.rows.find(r => r.key === 'panel')!
    expect(all.ids).toContain('partial')
    expect(all.partialExcluded).toBe(1)
    expect(all.costPerBilledN).not.toBeNull()
  })

  it('still measures a group where only SOME members are partial roll-ups', () => {
    const { model } = build(F({ range: ALL }), 'account')
    for (const row of model.tile2.rows) {
      const members = row.ids.map(id => model.ledger.find(l => l.id === id)!)
      const clean = members.filter(m => !m.partialRollUp)
      expect(row.partialExcluded).toBe(row.blended ? 0 : members.length - clean.length)
      if (row.blended || !clean.length) continue
      const n = sum(clean.map(m => m.billedN ?? 0))
      if (n === 0) continue
      expect(cents(row.costPerBilledN as number)).toBe(cents(sum(clean.map(m => m.cost)) / n))
      expect(cents(row.pricePerBilledN as number)).toBe(cents(sum(clean.map(m => m.revenue ?? 0)) / n))
    }
  })

  it('by route puts a survey fielded both ways in its own group', () => {
    const { model } = build(F(), 'route')
    const both = model.tile2.rows.find(r => r.key === 'both')!
    expect(both.memberIds).toEqual(['both'])
    expect(both.revenue).toBe(8000)
    expect(model.tile2.rows.find(r => r.key === 'none')!.memberIds.sort()).toEqual(['ph-data', 'priced-nocost'])
  })

  it('by month reads in date order; by contact names the contact and its account', () => {
    expect(build(F(), 'month').model.tile2.rows.map(r => r.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
    const contact = build(F(), 'contact').model.tile2.rows
    const sam = contact.find(r => r.label === 'Sam Roe')!
    expect(sam.sub).toBe('Coatue')
    expect(sam.memberIds.sort()).toEqual(['both', 'short'])
    expect(contact.some(r => r.label === 'No contact recorded' && r.sub === 'BAM')).toBe(true)
  })

  it('by survey is the three-way ledger, worst kept first, several tags per row', () => {
    const { model } = build(F(), 'survey')
    expect(model.tile2.rows).toEqual([])
    expect(model.ledger.slice(0, 3).map(l => l.id)).toEqual(['loss', 'free', 'partial'])
    expect(model.ledger.find(l => l.id === 'loss')!.tags).toEqual(['lost-money', 'over-budget'])
    expect(model.ledger.find(l => l.id === 'unpriced')!.tags).toEqual(['no-price'])
    // Outside the margin set there is no kept figure — a priced survey with no
    // cost is not "100% kept".
    const nocost = model.ledger.find(l => l.id === 'priced-nocost')!
    expect(nocost.kept).toBeNull()
    expect(nocost.keptPct).toBeNull()
    expect(partsText(model.tile2.verdict)).toBe(
      'Of 34 surveys, 2 lost money, 5 went over budget, 1 was given away at $0 and 1 carries no price. ' +
      'Price the unpriced ones first: they hold $2,100 of spend that no margin figure can see.')
  })

  it('reads ?by= safely', () => {
    expect(parseGroupBy('route')).toBe('route')
    expect(parseGroupBy('nonsense')).toBe('account')
    expect(parseGroupBy(null)).toBe('account')
  })
})

describe('filters move every figure', () => {
  it('route = panel keeps only panel-only surveys', () => {
    const { model } = build(F({ route: 'panel' }))
    expect(model.tile1.ids.sort()).toEqual(['free', 'loss', 'partial', 'short'])
    expect(cents(model.tile1.clientPrice)).toBe(cents(4540))
    expect(cents(model.tile1.kept)).toBe(cents(4540 - 5741))
  })
  it('account = Coatue keeps only Coatue', () => {
    const { model } = build(F({ account: 'coa' }))
    expect(model.ledger.every(l => l.accountId === 'coa')).toBe(true)
    expect(cents(model.tile1.clientPrice)).toBe(cents(50700))
    expect(model.scope.chip).toBe('Delivered · From 1 Jun 2026 · Coatue · 23 surveys')
  })
})

describe('every drill reconciles against something other than its rows', () => {
  const requests = (model: ResultsModel): ResultsDrillRequest[] => [
    { kind: 'price' }, { kind: 'cost' }, { kind: 'kept' }, { kind: 'budget' },
    ...model.waterfall.lines.map(l => ({ kind: 'line' as const, line: l.key })),
    { kind: 'unpriced' }, { kind: 'cancelled' }, { kind: 'archived' },
    ...model.months.map(m => ({ kind: 'month' as const, key: m.key })),
    ...model.tile2.rows.flatMap(r => [
      { kind: 'group' as const, key: r.key },
      ...r.routes.map(x => ({ kind: 'group' as const, key: r.key, route: x.route })),
      ...(r.unpricedSurveys > 0 ? [{ kind: 'group-unpriced' as const, key: r.key }] : []),
    ]),
  ]
  const views: [string, FinanceFilter, ResultsGroupBy][] = [
    ['default', F(), 'account'],
    ['all time by route', F({ range: ALL }), 'route'],
    ['Coatue by contact', F({ account: 'coa' }), 'contact'],
    ['panel by month', F({ route: 'panel' }), 'month'],
    ['by type', F(), 'type'],
  ]

  it.each(views)('%s', (_name, f, by) => {
    const { input, model } = build(f, by)
    for (const req of requests(model)) {
      const spec = resultsDrill(input, model, req)
      const rec = reconcile(spec)
      expect(rec.ok, `${spec.key}: ${JSON.stringify({ sum: rec.rowSum, want: rec.expectedTotal, missing: rec.missingIds, extra: rec.extraIds })}`).toBe(true)
      for (const col of spec.columns) for (const row of spec.rows) expect(col.value(row)).not.toBeUndefined()
    }
  })

  it('turns red when a row goes missing', () => {
    const { input, model } = build()
    const spec = resultsDrill(input, model, { kind: 'price' })
    const broken = reconcile({ ...spec, rows: spec.rows.slice(1) })
    expect(broken.ok).toBe(false)
    expect(broken.missingIds).toHaveLength(1)
  })

  it('lists the margin drill worst first and the budget drill with "given away" for a $0 price', () => {
    const { input, model } = build()
    expect(resultsDrill(input, model, { kind: 'kept' }).rows[0].id).toBe('loss')
    const budget = resultsDrill(input, model, { kind: 'budget' })
    const perPrice = budget.columns.find(c => c.header === 'Spend ÷ price')!
    const free = budget.rows.find(r => r.id === 'free')!
    expect(perPrice.value(free)).toBe('given away')
    expect(budget.rows).toHaveLength(6)
  })

  it('sums a cost line straight off the raw rows', () => {
    const { input } = build()
    const ids = input.population.map(i => i.p.id)
    expect(rawLineOfIds(ids, 'recovered', input.load.raw)).toMatchObject({ total: -200, ids: ['seg'] })
    expect(rawLineOfIds(ids, 'sends', input.load.raw).ids).toEqual(['over'])
  })
})

describe('the export', () => {
  it('writes the margin-set surveys with every ledger column', () => {
    const { model } = build()
    const exp = resultsExport(model)
    expect(exp.name).toBe('finance-results-surveys')
    expect(exp.columns.map(c => c.key)).toContain('spend_per_budget_pct')
    const free = exp.rows.find(r => r.code === 'FREE')!
    expect(free.kept_pct).toBe('given away')
    expect(free.tags).toBe('OVER BUDGET; GIVEN AWAY $0')
    expect(exp.rows.some(r => r.code === 'UNPRICED')).toBe(false)
  })
})

// Type-only guard: the connector builds its input with the same helper.
const _check: ResultsInput = resultsInputOf(fixtureLoad(), F(), TODAY)
void _check
