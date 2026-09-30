/**
 * The data banner: how much of the book the page can see, and from when.
 *
 * ── NOTHING HERE IS TYPED IN ────────────────────────────────────────────────
 * The first version of this banner said "most reliable from 1 June 2026" in
 * the copy. A typed date cannot notice that David is backfilling client prices
 * back toward 1 June (decision 8, 2026-09-24), so every date below comes from
 * lib/finance/coverage.ts `reliabilityDates` — the first month from which a
 * field's coverage STAYS at or above its bar — and every count from the
 * surveys in view. When the backfill lifts June's price coverage over the bar,
 * the banner moves to June by itself, and the "prices are still thin" line
 * disappears by itself when the last thin month clears.
 *
 * The reliability dates are measured on the WHOLE delivered book, never on the
 * filtered view: the month record-keeping became dependable is a fact about
 * the records, not about the account you happen to be looking at. The "in this
 * view" counts are the view's.
 *
 * ── TONE ────────────────────────────────────────────────────────────────────
 * Plain when every delivered survey in view is from a month whose costs are
 * reliable. Amber when the view reaches before that (or into surveys with no
 * date): such a view mixes two eras, and its coverage and medians read worse
 * than the business did.
 *
 * Pure, so the words can be tested against fixtures with no DOM.
 */

import {
  coverageByMonth, firstBlastAt, MIN_MONTH_SURVEYS, monthLabel, RELIABILITY, reliabilityDates,
  type CoverageMetric, type CoverageMonth, type ReliabilityDate, type ReliabilityKey,
} from '@/lib/finance/coverage'
import {
  DEFAULT_FILTER, populationFor, RELIABLE_FROM, undatedDropped,
  type FinanceFilter, type FinanceTab, type FinItem,
} from '@/lib/finance/filters'
import { marginOf, spendOf, type FinIndex } from '@/lib/finance/hub'
import { costFloorText, isBlocked, type Blocked, type FinanceRaw } from '@/lib/finance/load'
import { hasPrice } from '@/lib/finance/revenue'
import { pctText } from '@/lib/finance/format'
import { fmtNum } from '@/lib/utils/number'

export interface BannerInput {
  tab: FinanceTab
  filter: FinanceFilter
  today: string
  /** Every survey but empty placeholders, classified once (the shell's items). */
  items: FinItem[]
  raw: Pick<FinanceRaw, 'rates' | 'blasts' | 'suppliers' | 'costs'>
  ix: FinIndex
  blocked: Blocked[]
  /** load.integrity.pricesReturned — zero means the prices did not arrive,
   *  which is a read problem, not an unpriced book. */
  pricesReturned: number
}

export interface BannerModel {
  tone: 'plain' | 'amber'
  /** "Costs are reliable from Jun 2026." + the price and budget sentence. */
  reliability: string[]
  /** The view's own coverage. */
  view: string[]
  /** Raised while client-price coverage is under its bar in any month whose
   *  costs are reliable — the months David is backfilling. Null once they clear. */
  priceGap: string | null
  /** The amber paragraph, when the view reaches before costs were reliable. */
  mixed: string | null
  /** Offer "Back to since 1 Jun 2026" (the view is amber and not the default). */
  offerDefault: boolean
  floor: string
  /** The (i): why each date is where it is, month by month. */
  help: string
  dates: Record<ReliabilityKey, ReliabilityDate>
  /** Client prices did not load, so no price sentence can be true. */
  pricesUnavailable: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jun and Jul 2026", "Jun, Jul and Aug 2026", "Dec 2025 and Jan 2026". */
export function listMonths(keys: string[]): string {
  if (keys.length === 0) return ''
  const years = new Set(keys.map(k => k.slice(0, 4)))
  const names = years.size === 1
    ? keys.map((k, i) => MONTHS[Number(k.slice(5, 7)) - 1] + (i === keys.length - 1 ? ` ${k.slice(0, 4)}` : ''))
    : keys.map(monthLabel)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "1 Jun 2026" from an ISO date or timestamp, in Eastern time. */
function dayET(iso: string): string {
  const d = iso.length > 10 ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : iso
  const [y, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS[m - 1]} ${y}`
}

const monthET = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7)

const surveys = (n: number) => `${fmtNum(n)} stud${n === 1 ? 'y' : 'ies'}`

/** The month most rows were written in, when it holds more than half of them —
 *  the sign of a bulk backfill rather than records kept as the work happened. */
function bulkMonth(rows: { created_at?: string | null }[]): { month: string; have: number; of: number } | null {
  const by = new Map<string, number>()
  let of = 0
  for (const r of rows) {
    if (!r.created_at) continue
    of++
    const m = monthET(r.created_at)
    by.set(m, (by.get(m) ?? 0) + 1)
  }
  let best: { month: string; have: number } | null = null
  for (const [month, have] of by) if (!best || have > best.have) best = { month, have }
  return best && of > 0 && best.have / of > 0.5 ? { ...best, of } : null
}

/** The months from `from` on, dated, with enough delivered surveys to say
 *  anything (the same rule reliableFrom uses). */
const monthsFrom = (months: CoverageMonth[], from: string) =>
  months.filter(m => m.key !== 'undated' && m.key >= from && m.delivered >= MIN_MONTH_SURVEYS)

function byMonthText(months: CoverageMonth[], metric: CoverageMetric): string {
  return months.map(m => `${MONTHS[Number(m.key.slice(5, 7)) - 1]} ${pctText(m.cells[metric].pct)}`).join(', ')
}

export function buildBannerModel(input: BannerInput): BannerModel {
  const { tab, filter, today, items, raw, ix, blocked } = input
  const { rates, blasts, suppliers, costs } = raw

  // Measured on the whole delivered book (see the header).
  const book = items.filter(i => i.cls === 'delivered').map(i => i.p)
  const months = coverageByMonth(book, rates, blasts, suppliers, costs, ix)
  const dates = reliabilityDates(months)
  const costMonth = dates.cost.month
  const costLabel = costMonth ? monthLabel(costMonth) : null
  const pricesUnavailable = isBlocked(blocked, 'project_financials') || input.pricesReturned === 0

  /* ── reliability ─────────────────────────────────────────────────────── */
  const reliability: string[] = [
    costLabel
      ? `Costs are reliable from ${costLabel}.`
      : 'Costs are not yet recorded on most delivered studies in any month.',
  ]
  const p = dates.price.month ? monthLabel(dates.price.month) : null
  const b = dates.budget.month ? monthLabel(dates.budget.month) : null
  if (pricesUnavailable) {
    reliability.push(
      (isBlocked(blocked, 'project_financials') ? 'Client prices did not load' : 'No client prices came back') +
      ', so how far back they are reliable cannot be shown. ' +
      (b ? `Budgets are set regularly from ${b}.` : 'Budgets are not yet set regularly in any month.'),
    )
  } else if (p && b && p === b) {
    reliability.push(`Client prices and budgets are entered regularly from ${p}.`)
  } else {
    reliability.push(
      (p ? `Client prices are entered regularly from ${p}` : 'Client prices are not yet entered regularly in any month') +
      (b ? `, and budgets from ${b}.` : ', and budgets in no month yet.'),
    )
  }

  /* ── the price gap: raised until it clears ───────────────────────────── */
  // The months whose costs are reliable but whose prices are not — exactly the
  // backfill David is doing. Before any month's costs are reliable, measured
  // from the default window's start.
  const gapFrom = costMonth ?? RELIABLE_FROM.slice(0, 7)
  const priceBar = RELIABILITY.price.threshold
  const thin = pricesUnavailable ? [] : monthsFrom(months, gapFrom)
    .filter(m => (m.cells.price.pct ?? 0) < priceBar)
  const priceGap = thin.length === 0 ? null : (() => {
    const have = thin.reduce((t, m) => t + m.cells.price.have, 0)
    const of = thin.reduce((t, m) => t + m.cells.price.of, 0)
    return `Client prices are still thin in ${listMonths(thin.map(m => m.key))}: ` +
      `${fmtNum(have)} of ${fmtNum(of)} delivered studies there carry one, under the ${pctText(priceBar)} a month needs. ` +
      'Every price added moves this line by itself.'
  })()

  /* ── this view ───────────────────────────────────────────────────────── */
  const view: string[] = []
  let mixed: string | null = null
  if (tab === 'this-week') {
    view.push('The date filter does not apply on this tab: live work matters whenever it launched.')
  } else {
    const inView = populationFor(items, 'results', filter, today)
    const n = inView.length
    const spendBy = new Map(inView.map(i => [i.p.id, spendOf(i.p, blasts, suppliers, costs, ix).total]))
    const costed = inView.filter(i => (spendBy.get(i.p.id) ?? 0) > 0).length
    if (n === 0) {
      view.push('There are no delivered studies in this view.')
    } else if (pricesUnavailable) {
      view.push(`In this view ${fmtNum(costed)} of ${fmtNum(n)} delivered studies (${pctText(costed / n)}) carry a recorded cost.`)
    } else {
      const priced = inView.filter(i => hasPrice(i.p, rates.get(i.p.id))).length
      const m = marginOf(inView.map(i => i.p), rates, blasts, suppliers, costs)
      view.push(
        `In this view ${fmtNum(costed)} of ${fmtNum(n)} delivered studies (${pctText(costed / n)}) carry a recorded cost, ` +
        `and ${fmtNum(priced)} carry a client price.`,
      )
      if (m.spend > 0) {
        view.push(
          `So the price-against-cost figures cover ${surveys(m.surveys)} holding ${pctText(m.cost / m.spend)} of the spend, not the whole business.`,
        )
      }
    }
    const floorLine = costFloorText({ blocked })
    if (floorLine) view.push(floorLine)
    const undated = undatedDropped(items, 'results', filter, today)
    if (undated > 0) {
      view.push(`${fmtNum(undated)} delivered ${undated === 1 ? 'study has' : 'studies have'} no date and ${undated === 1 ? 'appears' : 'appear'} in no date range.`)
    }

    // The two eras. Undated surveys only reach an unbounded view, so a range
    // that starts on or after the cost month has none of these.
    const costDate = dates.cost.date
    if (n > 0 && !costDate) {
      mixed = 'No month yet has a recorded cost on most of its delivered studies, so every figure here is a thin floor.'
    } else if (n > 0 && costDate) {
      const early = inView.filter(i => i.date == null || i.date < costDate)
      if (early.length > 0) {
        const e = early.length
        const earlyCosted = early.filter(i => (spendBy.get(i.p.id) ?? 0) > 0).length
        const later = n - e
        const laterCosted = costed - earlyCosted
        const spendAll = [...spendBy.values()].reduce((t, x) => t + x, 0)
        const spendEarly = early.reduce((t, i) => t + (spendBy.get(i.p.id) ?? 0), 0)
        const worse = later > 0 && earlyCosted / e < laterCosted / later
        mixed = e === n
          ? `Every delivered study in this view is from before ${costLabel} or has no date, when most studies carried no recorded cost (${fmtNum(earlyCosted)} of ${fmtNum(n)} here do). ` +
            'Use this view to find old records to fix, not to judge performance.'
          : `This view mixes two eras. It adds ${fmtNum(e)} delivered ${e === 1 ? 'study' : 'studies'} from before ${costLabel} or with no date: ` +
            `${pctText(e / n)} of the studies` + (spendAll > 0 ? ` but ${pctText(spendEarly / spendAll)} of the spend` : '') + '. ' +
            `${fmtNum(earlyCosted)} of them ${earlyCosted === 1 ? 'carries' : 'carry'} any cost` +
            (worse ? ', so coverage and medians read worse than the business did. ' : '. ') +
            'Use this view to find old records to fix, not to judge performance.'
      }
    }
  }

  /* ── the (i) ─────────────────────────────────────────────────────────── */
  const help: string[] = []
  const costBar = RELIABILITY.cost.threshold
  if (costMonth) {
    const dated = months.filter(m => m.key !== 'undated' && m.delivered >= MIN_MONTH_SURVEYS)
    const at = dated.findIndex(m => m.key === costMonth)
    const prev = at > 0 ? dated[at - 1] : null
    const cur = dated[at]
    help.push(
      `Why ${costLabel} for costs: ` +
      (prev ? `${pctText(prev.cells.cost.pct)} of delivered studies carried a recorded cost in ${monthLabel(prev.key)} and ` : '') +
      `${pctText(cur?.cells.cost.pct)} in ${costLabel}. A month counts as reliable once at least ${pctText(costBar)} of its delivered studies carry one and every later month stays there.`,
    )
  } else {
    help.push(`A month counts as reliable for costs once at least ${pctText(costBar)} of its delivered studies carry one and every later month stays there. No month has yet.`)
  }
  const fb = firstBlastAt(blasts)
  if (fb) help.push(`The first dated blast is ${dayET(fb)}, so no blast cost can be recorded before then.`)
  const shown = monthsFrom(months, gapFrom)
  if (shown.length && !pricesUnavailable) {
    help.push(`Client prices by month: ${byMonthText(shown, 'price')} (reliable at ${pctText(priceBar)} and above).`)
  }
  if (shown.length) {
    help.push(`Budgets by month: ${byMonthText(shown, 'budget')} (reliable at ${pctText(RELIABILITY.budget.threshold)} and above).`)
  }
  const bb = bulkMonth(blasts), bp = bulkMonth(suppliers as { created_at?: string | null }[])
  if (bb || bp) {
    const parts = [
      ...(bb ? [`${fmtNum(bb.have)} of ${fmtNum(bb.of)} blast rows were written in ${monthLabel(bb.month)}`] : []),
      ...(bp ? [`${fmtNum(bp.have)} of ${fmtNum(bp.of)} panel rows in ${monthLabel(bp.month)}`] : []),
    ]
    help.push(`Many field records were entered in bulk: ${parts.join(', and ')}.`)
  }

  const tone: BannerModel['tone'] = mixed ? 'amber' : 'plain'
  return {
    tone,
    reliability,
    view,
    priceGap,
    mixed,
    offerDefault: mixed != null && filter.range.preset !== DEFAULT_FILTER.range.preset,
    floor: 'Every total is a floor: a study with nothing logged adds $0.',
    help: help.join(' '),
    dates,
    pricesUnavailable,
  }
}
