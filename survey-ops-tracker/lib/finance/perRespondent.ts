/**
 * The "Per respondent" tab — every figure it shows, as pure functions.
 *
 * Finance spec §4, Tab 3. Two tiles:
 *
 *   Tile 4  What one respondent costs — a card per route (panel, blast), each on
 *           its own axis and NEVER averaged together, because a qualified blast
 *           respondent costs tens of times a panel one. On each card, one
 *           reconciled set of surveys (cpqr.ts) gives both dumbbell dots, so the
 *           gap between them is exactly the QA scrub; the quote floor, the buy
 *           multiple and (panel only) the concentration line are drawn from the
 *           SAME surveys.
 *   Tile 5  Where more margin could come from — SAVE COST and EARN MORE, two
 *           lists of levers (savings.ts) on one declared population, never
 *           added together and with no grand total.
 *
 * plus the rules that were tested and rejected, recomputed where the data
 * allows. The React component only renders this model.
 *
 * ── ONE DENOMINATOR PER COMPARISON (spec rule 4) ────────────────────────────
 * CPQR — cost per QUALIFIED respondent — is a buying figure: what to buy, what
 * a scrub costs. A quote is compared with a price, and price is per BILLED
 * respondent (min(delivered, N sold)), so the quote floor is set on cost per
 * billed respondent, never on CPQR. The winning draft of the spec made exactly
 * that slip; the two sit on one card and must not be confused.
 *
 * ── WHERE "2×" COMES FROM ───────────────────────────────────────────────────
 * The quote floor is cost ÷ (1 − KEEP_GOAL). With the 50% goal (David,
 * 2026-09-24: a guide, not a rule) that is twice the cost: a price at which
 * the budget rule — spend about half the price — is just met. It is computed
 * from KEEP_GOAL, so the day the goal moves, so does the floor.
 */

import { cpqrWithCoverage, nearestRank, type Cpqr, type CpqrObservation, type MixedCoverage } from './cpqr'
import {
  buildIndex, foregone, routeOf,
  type FinCost, type FinIndex, type FinProject, type PartialRollUpNote,
} from './hub'
import { billedNOf, KEEP_GOAL, revenueOf, segmentCheck } from './revenue'
import { describe, LEVER_RULE, populationByRule, type FilterDescription, type FinanceFilter, type FinItem } from './filters'
import {
  EARN_KEYS, EVIDENCE_LABEL, LEVER_TITLE, MIN_CLASS_N, SAVE_KEYS,
  earnMore, savings, waveSpreadLever, waveTargetCoverage,
  type FinBlastDated, type FinLaunch, type FinSupplierRow, type Lever, type LeverKey,
} from './savings'
import { bidLadder, surveyPnl, type BidLadder, type SurveyPnl } from './analysis'
import { leverRows } from './drills'
import { routeSpendOfIds, spendOfIds, type DrillColumn, type DrillRow, type DrillSpec } from './drill'
import { money, money2, moneyAuto, pctText } from './format'
import { fmtNum } from '@/lib/utils/number'

export type RouteKey = 'panel' | 'blast'
export const ROUTES: RouteKey[] = ['panel', 'blast']

export const ROUTE_TITLE: Record<RouteKey, string> = {
  panel: 'Panel (PureSpectrum)',
  blast: 'Blast (B2B email and text)',
}

/** The smallest group of panels whose spend reaches this share is "the
 *  panels that carry the book" — the usual 80/20 cut, named once. */
export const CONCENTRATION_SHARE = 0.8

/** The quote floor's multiple of cost: a price at which spend is exactly the
 *  goal share of price. 2× at the 50% goal. */
export const QUOTE_MULTIPLE = 1 / (1 - KEEP_GOAL)

/* ── helpers ────────────────────────────────────────────────────────────── */

const plural = (k: number, one: string, many = one + 's') => (k === 1 ? one : many)
/** 1.6× / 2× — a multiple, one decimal unless it is whole. */
export const timesText = (x: number) => {
  const r = Math.round(x * 10) / 10
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}×`
}
/** A large count to two significant figures, in words: "100 million",
 *  "4.2 million", "36,000". For "about" sentences, where seven exact digits
 *  would claim a precision the estimate does not have. */
export function aboutText(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0'
  const mag = Math.pow(10, Math.floor(Math.log10(x)) - 1)
  const r = Math.round(x / mag) * mag
  if (r >= 1e9) return `${+(r / 1e9).toPrecision(2)} billion`
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(2)} million`
  return fmtNum(Math.round(r))
}

/**
 * A cost per respondent, rounded to the cent it is printed at.
 *
 * ── WHY THE QUOTE FLOOR KEEPS ITS CENTS ─────────────────────────────────────
 * The floor shows its working — "quote $150.72, 2× the typical $75.36" — and a
 * reader who multiplies the operand printed beside it has to land on the
 * figure. Rounding the product and the operand SEPARATELY does not: at whole
 * dollars (the house rule above $10) $75.36 prints as "$75" and 2 × 75.36
 * prints as "$151", so the sentence fails its own multiplication by a dollar.
 * So these four figures — the typical cost, the dearer quarter and the two
 * floors — are rounded to the CENT first and printed with `money2`, and the
 * floor is the multiple of the rounded figure everywhere: in the sentence, in
 * the comparison with what clients were quoted, and in the drill. They are
 * unit rates the page multiplies, which is the same reason the house rule
 * keeps cents under $10 at all.
 *
 * Rounding the value rather than the string also closes a second gap: the old
 * card compared prices against $150.7216 while printing "$151", so a survey
 * quoted at $150.90 read as at or above a floor it was under.
 */
export function roundCents(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x
}

/** "$0–$65,411", "up to $24,757", "$930". */
export function rangeText(low: number | null, high: number): string {
  if (low == null) return `up to ${money(high)}`
  if (Math.abs(high - low) < 0.5) return money(high)
  return `${money(low)}–${money(high)}`
}

/* ── input ──────────────────────────────────────────────────────────────── */

export interface PerRespondentRaw {
  blasts: FinBlastDated[]
  suppliers: (FinSupplierRow & { suppliers?: { name: string | null } | null })[]
  costs: FinCost[]
  launches: FinLaunch[]
  /** project_id → the survey's price per N. */
  rates: Map<string, number>
  accounts: { id: string; name: string | null }[]
}

export interface PerRespondentInput {
  /** Every survey but empty placeholders, classified once (the shell's items). */
  items: FinItem[]
  /** The tab's population: delivered × date × account × route. Tile 4. */
  population: FinItem[]
  filter: FinanceFilter
  today: string
  raw: PerRespondentRaw
  ix?: FinIndex
  /** The selected account's name, for the lever card's scope chip. */
  accountLabel?: string | null
  /** load.ts priceBlockText: why client prices cannot be read, or null. The
   *  EARN MORE list and the quote floor's price comparison need prices. */
  priceBlock?: string | null
  /** project_launches failed: the wave-overrun lever cannot see any wave. */
  launchesBlocked?: string | null
}

/* ── Tile 4 ─────────────────────────────────────────────────────────────── */

/** One survey's leg on the card, with what the drill and the export print. */
export interface RouteRow extends CpqrObservation {
  code: string | null
  account: string
  route: RouteKey
  /** spend ÷ completes bought on this leg. */
  perComplete: number | null
  /** (this survey's CPQR − the route's typical CPQR) × its delivered N — the
   *  dollars it cost above a typical survey. What the drill ranks by. */
  aboveTypical: number | null
  /** Single-route surveys only: a mixed survey's bill cannot be split by
   *  route, so it has no cost per billed respondent on either leg. */
  billedN: number | null
  costPerBilledN: number | null
  /** The survey's price per N (one rate for the whole survey). */
  rate: number | null
  belowFloor: boolean | null
  belowSafeFloor: boolean | null
}

export interface QuoteFloor {
  /** QUOTE_MULTIPLE — 2× at the 50% goal. */
  multiple: number
  /** Median cost per billed respondent on the card's single-route surveys,
   *  rounded to what the card prints (`roundLikeMoney`), so the floor beside it
   *  is exactly this figure times the multiple. */
  typical: number
  /** Its 75th percentile — the dearer quarter starts here — rounded the same way. */
  p75: number
  /** `typical` × `multiple`, and the figure the price comparison below uses. */
  floor: number
  safeFloor: number
  /** Surveys behind `typical` and `p75`. */
  n: number
  /** Of `n`, how many cost at or under p75 per billed respondent — what "safe"
   *  covers, counted rather than assumed to be three in four. */
  safeCovers: number
  ids: string[]
  /** Delivered single-route surveys on this route in view priced above $0 —
   *  null when prices could not be read. */
  priced: number | null
  below: number | null
  belowSafe: number | null
  belowIds: string[]
}

export interface BuyMultiple {
  /** 1 ÷ keepP25: buy this many times the target to deliver it on the surveys
   *  that kept at least as much as the worst quarter. */
  multiple: number
  keepP25: number
  /** Surveys whose own keep rate × the multiple reaches the target. */
  covered: number
  of: number
}

export interface Concentration {
  /** Panels with any spend in view. */
  panels: number
  /** The fewest panels carrying at least CONCENTRATION_SHARE of panel spend. */
  top: number
  share: number
  spend: number
  names: string[]
}

export interface RouteCard {
  route: RouteKey
  title: string
  /** The CPQR card for this route, or null when no survey in view reaches it. */
  cpqr: Cpqr | null
  /** Fewer than MIN_CLASS_N surveys behind the typical-survey figures: the
   *  dumbbell still draws (its dots are measurements), but the quote floor and
   *  the buy multiple — percentiles that would drive a decision — read "too
   *  few surveys here to call". */
  thin: boolean
  /** 1 − perComplete ÷ blended: what the dumbbell's connector says. On one
   *  population this IS cpqr.scrubRate; the tests hold it there. */
  qaRemoved: number | null
  /** Ranked by `aboveTypical`, dearest first. */
  rows: RouteRow[]
  quote: QuoteFloor | null
  /** Why this card cannot compare its floor with what clients were quoted:
   *  load.ts priceBlockText, in the card's own words. A failed price read is
   *  missing, not zero, and the card that drops the comparison has to say so
   *  rather than quietly print one sentence fewer (load.ts, priceBlockText). */
  priceNote: string | null
  buy: BuyMultiple | null
  /** Panel card only. */
  concentration: Concentration | null
  /** Panel card only: savings.ts waveSpreadLever on this tab's population. */
  waveSpread: { above: number; share: number | null; waves: string } | null
  /** Computed sentences, ready to print. */
  lines: {
    coverage: string
    recovered: string | null
    quote: string | null
    quotePriced: string | null
    buy: string | null
    concentration: string | null
  }
}

export interface Tile4Footnote {
  /** Mixed surveys with cost that are in neither card. */
  bothWays: { surveys: number; spend: number; text: string } | null
  /** Surveys held out because their N actual counts only some segments. */
  partial: { surveys: number; spend: number; codes: string[]; text: string } | null
}

/**
 * Priced surveys in view that NO card could check against a floor.
 *
 * The verdict's "x of y priced surveys in view" counts only the cards it calls,
 * and a card is one route's single-route surveys. A survey fielded both ways,
 * one with no field rows at all, and every priced survey on a card too thin to
 * set a floor therefore fall out of `y` — so the page showed 51 surveys
 * carrying a price, 47 of them above $0, and a verdict denominator of 43 with
 * nothing to explain the gaps. Counted here and named in the verdict.
 */
export interface UnplacedPriced {
  surveys: number
  /** Fielded both ways: a bill cannot be split by route, so neither floor applies. */
  mixed: number
  /** No recorded field cost, so the survey has no route to compare against. */
  noRows: number
  /** On a route with no quote floor in this view — usually too few surveys
   *  behind it, sometimes no survey on it with a billed N. */
  noFloor: number
  /** The clause the verdict prints. */
  text: string
}

/* ── Tile 5 ─────────────────────────────────────────────────────────────── */

export interface LeverSlot {
  key: LeverKey
  side: 'save' | 'earn'
  title: string
  lever: Lever | null
  /** A figure is drawn: the lever exists and has enough surveys behind it. */
  callable: boolean
  /** Why there is no figure, when there is not. */
  reason: string | null
  /** For the range chart: null low = "up to"; both null = no bar. */
  low: number | null
  high: number | null
  range: string
  confidence: string | null
  givesUp: string
}

export interface LeverTile {
  /** Delivered + live in the window × account × route (filters.ts LEVER_RULE). */
  population: FinProject[]
  scope: FilterDescription
  /** Recorded spend on the population. */
  spend: number
  save: LeverSlot[]
  earn: LeverSlot[]
  /** Why the EARN MORE list cannot be shown, when it cannot. */
  earnBlocked: string | null
  ladder: BidLadder | null
  verdict: string
}

/* ── rejected rules ─────────────────────────────────────────────────────── */

export interface RejectedRule {
  key: string
  title: string
  /** Computed on this view. */
  now: string[]
  /** What the 17 Sep 2026 test found that this page cannot recompute. */
  dated: string | null
}

export const REJECTED_TESTED_ON = '17 Sep 2026'

export interface PerRespondentModel {
  guidance: string
  /** Blast typical CPQR ÷ panel typical CPQR, when both exist. */
  routeRatio: number | null
  cards: RouteCard[]
  mixed: MixedCoverage
  partialRollUp: PartialRollUpNote
  footnote: Tile4Footnote
  /** Priced surveys the floor comparison could not place. null when prices
   *  could not be read at all (then there is no comparison to be outside of). */
  unplacedPriced: UnplacedPriced | null
  tile4Verdict: string
  levers: LeverTile
  rejected: RejectedRule[]
  /** The rejected-rules section's closing sentence, computed from the replay. */
  rejectedVerdict: string
  /** The P&L of the lever population, for the lever drills. */
  pnl: SurveyPnl[]
  /** The P&L of the tab population, for the quote-floor drill. */
  tabPnl: SurveyPnl[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * BUILD
 * ──────────────────────────────────────────────────────────────────────────── */

export function buildPerRespondentModel(input: PerRespondentInput): PerRespondentModel {
  const { raw } = input
  const ix = input.ix ?? buildIndex(raw.blasts, raw.suppliers, raw.costs)
  const names = new Map(raw.accounts.map(a => [a.id, a.name ?? '(unnamed account)']))
  const nameOf = (id: string | null | undefined) => (id && names.get(id)) || '(unknown account)'
  const pricesOk = !input.priceBlock

  const rows = input.population.map(i => i.p)
  const byId = new Map(input.items.map(i => [i.p.id, i.p]))
  for (const p of rows) byId.set(p.id, p)
  const routeOfId = (id: string) => {
    const p = byId.get(id)
    return p ? routeOf(p, raw.blasts, raw.suppliers, ix) : 'none'
  }

  // ── Tile 4: one reconciled survey set per route ───────────────────────────
  const cov = cpqrWithCoverage(rows, raw.blasts, raw.suppliers, raw.costs, ix)
  const cards = ROUTES.map(route => routeCard(route, cov.rates.find(c => c.route === route) ?? null, {
    rows, byId, raw, ix, nameOf, pricesOk, priceBlock: input.priceBlock ?? null, routeOfId,
  }))
  const panel = cards[0].cpqr, blast = cards[1].cpqr
  const routeRatio = panel && blast && panel.median > 0 ? blast.median / panel.median : null

  const guidance =
    'What one respondent costs us, by route, and what that means for the next quote. ' +
    'Panel (PureSpectrum) and blast (B2B email and text) are different products' +
    (routeRatio != null ? ` — a qualified blast respondent costs about ${fmtNum(Math.round(routeRatio))}× a panel one here —` : ',') +
    ' so they are never averaged. Quote from the typical survey; use the pooled figure to understand the book.'

  const footnote = tile4Footnote(cov.mixed, cov.partialRollUp, byId)
  const unplacedPriced = pricesOk ? unplacedPricedOf(rows, cards, raw.rates, routeOfId) : null
  const tile4Verdict = verdictTile4(cards, input.priceBlock ?? null, unplacedPriced)

  // ── Tile 5: one declared population ───────────────────────────────────────
  const leverItems = populationByRule(input.items, LEVER_RULE, input.filter, input.today)
  const leverRowsPop = leverItems.map(i => i.p)
  const scope = describe(input.filter, {
    tab: 'per-respondent', today: input.today, count: leverItems.length,
    accountName: input.accountLabel ?? (input.filter.account ? nameOf(input.filter.account) : null),
    rule: LEVER_RULE,
  })
  const pnl = surveyPnl(leverRowsPop, raw.rates, raw.blasts, raw.suppliers, raw.costs, names)
  const tabPnl = surveyPnl(rows, raw.rates, raw.blasts, raw.suppliers, raw.costs, names)
  const sv = savings(leverRowsPop, raw.blasts, raw.suppliers, raw.costs, input.launchesBlocked ? [] : raw.launches, ix)
  const earned = pricesOk
    ? earnMore(leverRowsPop, raw.rates, raw.blasts, raw.suppliers, raw.costs, {
      book: input.items.map(i => i.p),
      // The top-up lever nets against the SAME route cards Tile 4 draws.
      cards: cov.rates,
      accountName: id => nameOf(id),
      ix,
    })
    : []
  const cover = waveTargetCoverage(leverRowsPop, raw.suppliers, raw.launches)
  const save = SAVE_KEYS.map(k => slotFor(k, 'save', sv.levers.find(l => l.key === k) ?? null, nullReason(k, cover, input.launchesBlocked)))
  const earn = EARN_KEYS.map(k => slotFor(k, 'earn', earned.find(l => l.key === k) ?? null, nullReason(k, cover, null)))
  const levers: LeverTile = {
    population: leverRowsPop,
    scope,
    spend: sv.spend,
    save: rankSlots(save),
    earn: pricesOk ? rankSlots(earn) : [],
    earnBlocked: input.priceBlock ?? null,
    ladder: bidLadder(leverRowsPop, raw.blasts),
    verdict: '',
  }
  levers.verdict = verdictTile5(levers)

  const rejected = rejectedRules({ cards, byId, rates: raw.rates, nameOf, pricesOk, leverRows: leverRowsPop, blasts: raw.blasts })
  const replay = capReplay(cards, byId, raw.rates, pricesOk)
  const rejectedVerdict = replay.capped > 0 && replay.broken > 0
    ? `Keep the cap off the lever list: on this view it would have saved ${money(replay.saved)} and left ${fmtNum(replay.broken)} ${plural(replay.broken, 'delivery', 'deliveries')} short of the N sold. Buy more list rather than switching route or channel.`
    : replay.capped > 0
      ? `On this view the cap would have saved ${money(replay.saved)} without leaving a delivery short, but the keep rate it needs is only known at delivery, so it still cannot be set in advance — keep it off the lever list.`
      : 'Keep these off the lever list: each saves a little and breaks more than it saves. Buy more list rather than switching route or channel.'

  return {
    guidance, routeRatio, cards, mixed: cov.mixed, partialRollUp: cov.partialRollUp,
    footnote, unplacedPriced, tile4Verdict, levers, rejected, rejectedVerdict, pnl, tabPnl,
  }
}

/* ── one route card ─────────────────────────────────────────────────────── */

function routeCard(
  route: RouteKey, c: Cpqr | null,
  ctx: {
    rows: FinProject[]; byId: Map<string, FinProject>; raw: PerRespondentRaw; ix: FinIndex
    nameOf: (id: string | null | undefined) => string; pricesOk: boolean
    priceBlock: string | null
    routeOfId: (id: string) => string
  },
): RouteCard {
  const title = ROUTE_TITLE[route]
  if (!c) {
    return {
      route, title, cpqr: null, thin: true, qaRemoved: null, rows: [], quote: null, priceNote: null, buy: null,
      concentration: null, waveSpread: null,
      lines: {
        coverage: `No delivered ${route} survey in view has both a recorded cost and a post-QA count whose records add up.`,
        recovered: null, quote: null, quotePriced: null, buy: null, concentration: null,
      },
    }
  }
  const { raw } = ctx
  const thin = c.n < MIN_CLASS_N
  // What the connector prints. On one population this is exactly the pooled
  // scrub (blended × (1 − scrub) = perComplete); computed from the two dots so
  // the label can never describe a different set of surveys from the line.
  const qaRemoved = c.blended > 0 ? 1 - c.perComplete / c.blended : null

  // ── the quote floor: single-route surveys of THIS card, per billed N ──────
  const perBilled: { id: string; v: number }[] = []
  for (const o of c.observations) {
    if (o.mixed) continue
    const p = ctx.byId.get(o.id)
    const b = p ? billedNOf(p) : null
    if (b != null && b > 0) perBilled.push({ id: o.id, v: o.spend / b })
  }
  let quote: QuoteFloor | null = null
  if (perBilled.length) {
    const vals = perBilled.map(x => x.v)
    // Rounded to the cent the card prints BEFORE the multiple is applied, so
    // the floor beside "2× the typical $75.36" really is 2 × $75.36 (roundCents).
    const typical = roundCents(nearestRank(vals, 0.5))
    const p75 = roundCents(nearestRank(vals, 0.75))
    const floor = typical * QUOTE_MULTIPLE
    const safeFloor = p75 * QUOTE_MULTIPLE
    // Priced surveys in view on this route: every delivered single-route one
    // with a price above $0, reconciled or not — a quote is a quote. $0 never
    // enters a comparison with a price.
    let priced: number | null = null, below: number | null = null, belowSafe: number | null = null
    const belowIds: string[] = []
    if (ctx.pricesOk) {
      priced = 0; below = 0; belowSafe = 0
      for (const p of ctx.rows) {
        if (ctx.routeOfId(p.id) !== route) continue
        const rate = raw.rates.get(p.id)
        if (rate == null || !(Number(rate) > 0)) continue
        priced++
        if (Number(rate) < floor) { below++; belowIds.push(p.id) }
        if (Number(rate) < safeFloor) belowSafe++
      }
    }
    quote = {
      multiple: QUOTE_MULTIPLE, typical, p75, floor, safeFloor, n: vals.length,
      // Counted against the p75 the card PRINTS, so "safe on 41 of 55" and
      // "the dearer quarter's $1.89" describe one threshold. The epsilon keeps
      // a survey sitting exactly on it inside.
      safeCovers: vals.filter(v => v <= p75 + 1e-9).length,
      ids: perBilled.map(x => x.id), priced, below, belowSafe, belowIds,
    }
  }

  // ── the buy multiple: 1 ÷ the keep rate a quarter of surveys fell below ──
  const buy = buyMultipleOf(c)

  // ── rows, ranked by dollars above the typical survey ──────────────────────
  const perBilledById = new Map(perBilled.map(x => [x.id, x.v]))
  const rowsOut: RouteRow[] = c.observations.map(o => {
    const p = ctx.byId.get(o.id)
    const rate = p ? raw.rates.get(p.id) ?? null : null
    const cpb = perBilledById.get(o.id) ?? null
    const billedN = !o.mixed && p ? billedNOf(p) : null
    return {
      ...o,
      code: p?.project_code ?? null,
      account: ctx.nameOf(p?.client_id),
      route,
      perComplete: o.paid > 0 ? o.spend / o.paid : null,
      aboveTypical: o.cpqr != null ? (o.cpqr - c.median) * o.delivered : null,
      billedN,
      costPerBilledN: cpb,
      rate: ctx.pricesOk ? (rate == null ? null : Number(rate)) : null,
      belowFloor: !thin && ctx.pricesOk && quote && rate != null && Number(rate) > 0 && !o.mixed ? Number(rate) < quote.floor : null,
      belowSafeFloor: !thin && ctx.pricesOk && quote && rate != null && Number(rate) > 0 && !o.mixed ? Number(rate) < quote.safeFloor : null,
    }
  }).sort((a, b) => {
    // Dearest first; a leg that delivered nothing has no rate and goes last.
    if (a.aboveTypical == null || b.aboveTypical == null) {
      return a.aboveTypical == null ? (b.aboveTypical == null ? 0 : 1) : -1
    }
    return b.aboveTypical - a.aboveTypical
  })

  // ── panel only: who carries the spend, and the within-wave spread ────────
  let concentration: Concentration | null = null
  let waveSpread: RouteCard['waveSpread'] = null
  if (route === 'panel') {
    const inView = new Set(ctx.rows.map(p => p.id))
    const by = new Map<string, { name: string; spend: number }>()
    let total = 0
    for (const r of raw.suppliers) {
      if (!inView.has(r.project_id)) continue
      const spend = Number(r.cpi ?? 0) * Number(r.n_collected ?? 0)
      if (!(spend > 0)) continue
      const k = r.supplier_id ?? `name:${r.suppliers?.name ?? '?'}`
      const e = by.get(k) ?? { name: r.suppliers?.name ?? '(panel not named)', spend: 0 }
      e.spend += spend; total += spend
      by.set(k, e)
    }
    if (total > 0) {
      const sorted = [...by.values()].sort((a, b) => b.spend - a.spend)
      let cum = 0, top = 0
      for (const e of sorted) { cum += e.spend; top++; if (cum >= total * CONCENTRATION_SHARE - 1e-9) break }
      concentration = { panels: sorted.length, top, share: cum / total, spend: total, names: sorted.slice(0, top).map(e => e.name) }
    }
    const ws = waveSpreadLever(ctx.rows, raw.suppliers)
    if (ws) waveSpread = { above: ws.high, share: total > 0 ? ws.high / total : null, waves: ws.population }
  }

  // ── the sentences ─────────────────────────────────────────────────────────
  const bits: string[] = []
  bits.push(`${fmtNum(c.ids.length)} ${plural(c.ids.length, 'survey')} whose records add up`)
  if (c.mixed > 0) bits.push(`${fmtNum(c.mixed)} of them one side of a survey fielded both ways, counted on its own money`)
  if (c.excluded > 0) bits.push(`${fmtNum(c.excluded)} left out because their field rows do not cover the N they claim`)
  if (c.partialHeldOut > 0) bits.push(`${fmtNum(c.partialHeldOut)} left out because the N actual counts only some segments`)
  const coverage = bits.join('; ') + '.'

  const recovered = c.recovered < 0
    ? `Net of ${money(-c.recovered)} of rewards that came back; ${moneyAuto(c.blendedGross)} per qualified respondent before they did.`
    : null

  const tooFewHere = (what: string) =>
    `${TOO_FEW.charAt(0).toUpperCase() + TOO_FEW.slice(1)}: ${what} needs ${fmtNum(MIN_CLASS_N)} surveys with a delivered N, and this card has ${fmtNum(c.n)}.`
  // money2 on all four: a unit rate the sentence multiplies keeps its cents
  // (roundCents), or the multiplication printed beside it does not work out.
  const quoteLine = thin ? tooFewHere('a quote floor') : quote
    ? `Quote at least ${money2(quote.floor)} per billed respondent — ${timesText(quote.multiple)} the typical ${money2(quote.typical)} it costs us (${fmtNum(quote.n)} ${plural(quote.n, 'survey')}). ` +
      `At the ${pctText(KEEP_GOAL)} goal, that is the floor. To be safe on ${fmtNum(quote.safeCovers)} of ${fmtNum(quote.n)}, quote ${money2(quote.safeFloor)} (${timesText(quote.multiple)} the dearer quarter’s ${money2(quote.p75)}).`
    : `No survey on this card has a billed N (a delivered N and an N sold), so there is no quote floor.`
  const quotePriced = !thin && quote && quote.priced != null
    ? (quote.priced === 0
      ? `No ${route} survey in view is priced above $0 to compare with the floor.`
      : `${fmtNum(quote.below ?? 0)} of ${fmtNum(quote.priced)} ${route} ${plural(quote.priced, 'survey')} priced above $0 in view ${quote.priced === 1 ? 'was' : 'were'} quoted below the floor, and ${fmtNum(quote.belowSafe ?? 0)} below the safer one.`)
    : null

  const buyLine = thin ? tooFewHere('a buy multiple') : buy
    ? `Buy ${timesText(buy.multiple)} the target — that covers ${fmtNum(buy.covered)} of ${fmtNum(buy.of)} past surveys. (A quarter of surveys kept ${pctText(buy.keepP25)} or less of what we bought; 1 ÷ that is the multiple.)`
    : null

  // "Panel spend here" alone is ambiguous: the SAME sentence is printed by the
  // wave lever on Tile 5, on delivered AND live work, a card apart and with a
  // larger figure. Each says which surveys it counts, inside the sentence.
  const concLine = concentration
    ? `${fmtNum(concentration.top)} of ${fmtNum(concentration.panels)} ${plural(concentration.panels, 'panel')} ${concentration.panels === 1 ? 'carries' : 'carry'} ${pctText(concentration.share)} of panel spend on the delivered work this card counts` +
      (waveSpread
        ? `; ${money(waveSpread.above)}${waveSpread.share != null ? ` (${pctText(waveSpread.share)})` : ''} of it was paid above the cheapest panel in the same wave.`
        : '; no wave here bought from two panels at different prices.')
    : null

  // The comparison with what clients were quoted is missing, not absent: say
  // why, in place of the line it would have printed.
  const priceNote = !ctx.pricesOk && !thin && quote && ctx.priceBlock
    ? `${ctx.priceBlock}. Client prices are missing, not zero, so no ${route} survey here can be checked against the floor.`
    : null

  return {
    route, title, cpqr: c, thin, qaRemoved, rows: rowsOut, quote, priceNote, buy, concentration, waveSpread,
    lines: { coverage, recovered, quote: quoteLine, quotePriced, buy: buyLine, concentration: concLine },
  }
}

/**
 * The buy multiple for one route card: 1 ÷ keepP25, and how many of the
 * card's own surveys it would have covered (keep × multiple ≥ 1). null when
 * the card has no keep rate. Exported so any tab that says "stop buying at
 * N× the target" quotes the same multiple this tab prints.
 */
export function buyMultipleOf(c: Pick<Cpqr, 'keepP25' | 'observations'>): BuyMultiple | null {
  const keeps = c.observations.map(o => o.keep).filter((k): k is number => k != null && k > 0)
  if (!keeps.length || !(c.keepP25 > 0)) return null
  const multiple = 1 / c.keepP25
  return {
    multiple, keepP25: c.keepP25,
    // A hair of float tolerance, so the survey that IS the p25 counts as covered.
    covered: keeps.filter(k => k * multiple >= 1 - 1e-9).length,
    of: keeps.length,
  }
}

/**
 * The buy multiple per route on a set of delivered surveys — cpqr.ts on the
 * rows, then `buyMultipleOf`. For callers outside this tab (the This week
 * tab's STOP BUYING rows), so there is one definition of "buy 1.6× target".
 * A route with fewer than MIN_CLASS_N surveys behind it has no multiple.
 */
export function buyMultiples(
  rows: FinProject[], raw: Pick<PerRespondentRaw, 'blasts' | 'suppliers' | 'costs'>, ix?: FinIndex,
): Record<RouteKey, BuyMultiple | null> {
  const { rates } = cpqrWithCoverage(rows, raw.blasts, raw.suppliers, raw.costs, ix)
  const of = (r: RouteKey) => {
    const c = rates.find(x => x.route === r)
    return c && c.n >= MIN_CLASS_N ? buyMultipleOf(c) : null
  }
  return { panel: of('panel'), blast: of('blast') }
}

function tile4Footnote(mixed: MixedCoverage, partial: PartialRollUpNote, byId: Map<string, FinProject>): Tile4Footnote {
  const out = mixed.surveys - mixed.priced
  const reasons: string[] = []
  const r = mixed.reasons
  if (r['no-split']) reasons.push(`${fmtNum(r['no-split'])} ${plural(r['no-split'], 'needs', 'need')} the delivered N split by route`)
  if (r['unrouted-cost']) reasons.push(`${fmtNum(r['unrouted-cost'])} ${plural(r['unrouted-cost'], 'carries', 'carry')} a cost line that names no route`)
  if (r['split-mismatch']) reasons.push(`${fmtNum(r['split-mismatch'])} ${plural(r['split-mismatch'], 'has a split', 'have splits')} that no longer add up to the N actual`)
  if (r['estimated']) reasons.push(`${fmtNum(r['estimated'])} ${plural(r['estimated'], 'has', 'have')} only an estimated split`)
  if (r['no-n-actual']) reasons.push(`${fmtNum(r['no-n-actual'])} ${plural(r['no-n-actual'], 'has', 'have')} no N actual`)
  if (r['under-recorded']) reasons.push(`${fmtNum(r['under-recorded'])} ${plural(r['under-recorded'], 'has', 'have')} field rows that do not cover the N claimed`)
  const bothWays = out > 0
    ? {
      surveys: out, spend: mixed.blockedSpend,
      text: `${fmtNum(out)} ${plural(out, 'survey')} fielded both ways (${money(mixed.blockedSpend)}) ${out === 1 ? 'is' : 'are'} in neither card until ${out === 1 ? 'its' : 'their'} delivered N can be split by route` +
        (reasons.length ? `: ${reasons.join('; ')}.` : '.'),
    }
    : null
  const codes = partial.ids.map(id => byId.get(id)?.project_code ?? id)
  const partialNote = partial.surveys > 0
    ? {
      surveys: partial.surveys, spend: partial.spend, codes,
      text: `${codes.join(', ')} ${partial.surveys === 1 ? 'is' : 'are'} left out (${money(partial.spend)}): ` +
        partial.ids.map(id => {
          const p = byId.get(id)
          const s = p ? segmentCheck(p) : null
          return s ? `${p?.project_code ?? id}’s N actual adds up only ${fmtNum(s.segments - s.missing)} of its ${fmtNum(s.segments)} segments` : id
        }).join('; ') + '.',
    }
    : null
  return { bothWays, partial: partialNote }
}

/** The cards whose price comparison the verdict adds up. The "could not be
 *  placed" count below reads the SAME test, so the two can never drift. */
const comparedCards = (cards: RouteCard[]) =>
  cards.filter(c => !c.thin && (c.quote || c.buy) && c.quote?.priced != null)

/**
 * The priced surveys in view that no card's floor could take: fielded both
 * ways, with no field rows, or on a route too thin to set a floor. Without
 * this the verdict's denominator is quietly smaller than "priced surveys in
 * view" and nothing on the page accounts for the difference.
 */
export function unplacedPricedOf(
  rows: FinProject[], cards: RouteCard[], rates: Map<string, number>, routeOfId: (id: string) => string,
): UnplacedPriced | null {
  const compared = new Set(comparedCards(cards).map(c => c.route as string))
  let mixed = 0, noRows = 0, noFloor = 0
  for (const p of rows) {
    const rate = rates.get(p.id)
    if (rate == null || !(Number(rate) > 0)) continue
    const route = routeOfId(p.id)
    if (compared.has(route)) continue
    if (route === 'both') mixed++
    else if (route === 'panel' || route === 'blast') noFloor++
    else noRows++
  }
  const surveys = mixed + noRows + noFloor
  if (!surveys) return null
  const bits: string[] = []
  if (mixed) bits.push(`${fmtNum(mixed)} fielded both ways`)
  if (noRows) bits.push(`${fmtNum(noRows)} with no recorded field cost`)
  if (noFloor) bits.push(`${fmtNum(noFloor)} on a route with no quote floor in this view`)
  return {
    surveys, mixed, noRows, noFloor,
    text: `${surveys === 1 ? 'One more' : `Another ${fmtNum(surveys)}`} priced ${plural(surveys, 'survey')} in view could not be checked against a route floor: ${bits.join(', ')}.`,
  }
}

function verdictTile4(cards: RouteCard[], priceBlock: string | null, unplaced: UnplacedPriced | null): string {
  const called = cards.filter(c => !c.thin && (c.quote || c.buy))
  const parts = called
    .map(c => {
      const q = c.quote ? `quote ${c.route} work at ${money2(c.quote.floor)} or more per billed respondent` : null
      const b = c.buy ? `buy ${timesText(c.buy.multiple)} the target` : null
      return [q, b].filter(Boolean).join(' and ')
    })
  if (!parts.length) {
    if (cards.some(c => c.cpqr)) {
      return `${TOO_FEW.charAt(0).toUpperCase() + TOO_FEW.slice(1)}: neither route has ${fmtNum(MIN_CLASS_N)} surveys behind a quote floor in this view — widen the date range or clear a filter.`
    }
    return 'No delivered survey in view has a recorded cost and a post-QA count that add up, so there is nothing to price from yet — record the N actual at delivery.'
  }
  const first = parts.join('; ')
  const priced = called.reduce((t, c) => t + (c.quote?.priced ?? 0), 0)
  const below = called.reduce((t, c) => t + (c.quote?.below ?? 0), 0)
  const havePrices = called.some(c => c.quote?.priced != null)
  // No comparison at all. When that is because the prices did not load, the
  // verdict says so: dropping the sentence silently is how a failed read comes
  // to read as an unpriced book (load.ts priceBlockText).
  const tail = !havePrices
    ? (priceBlock
      ? ` ${priceBlock}. Client prices are missing, not zero, so no survey in view can be checked against the floor.`
      : '')
    : priced === 0
      ? ' No survey in view is priced above $0 to check against the floor.'
      : below > 0
        ? ` ${fmtNum(below)} of ${fmtNum(priced)} priced ${plural(priced, 'survey')} in view ${priced === 1 ? 'was' : 'were'} quoted below ${below === 1 ? 'its' : 'their'} route’s floor — re-price those accounts’ next waves.`
        : ` All ${fmtNum(priced)} priced ${plural(priced, 'survey')} in view ${priced === 1 ? 'was' : 'were'} quoted at or above the floor — keep quoting from it.`
  // The denominator above counts only the routes it could place; the rest are
  // named rather than dropped.
  const rest = havePrices && unplaced ? ` ${unplaced.text}` : ''
  return first.charAt(0).toUpperCase() + first.slice(1) + '.' + tail + rest
}

/* ── levers ─────────────────────────────────────────────────────────────── */

const NULL_REASON: Record<LeverKey, string> = {
  'bid-premium': 'No survey in this view ran more than one bid level.',
  'sms-rate': 'No text blasts in this view.',
  'wave-spread': 'No wave in this view bought from two panels at different prices.',
  'dead-streak': 'No survey in this view kept sending after two dead blasts.',
  'launch-overrun': 'No PureSpectrum wave in this view ran past its target.',
  'sell-range': 'No repeat survey priced above $0 was delivered past the N sold in this view.',
  'top-up': 'No survey priced above $0 came in short of the N sold in this view.',
  'price-gap': 'Needs two accounts fielded the same way, each with priced surveys, to compare.',
}

function nullReason(
  k: LeverKey, cover: ReturnType<typeof waveTargetCoverage>, launchesBlocked: string | null | undefined,
): string {
  if (k !== 'launch-overrun') return NULL_REASON[k]
  if (launchesBlocked) return `${launchesBlocked}, so no wave can be checked against its target.`
  if (cover.waves === 0) return 'No PureSpectrum waves in this view.'
  // The lever found nothing — but it still owes the reader the share of waves
  // it could not look at (finance spec, lever 5).
  return `No wave with a target ran past it here; ${fmtNum(cover.blind)} of ${fmtNum(cover.waves)} waves carry no target, so the lever cannot see ${cover.blind === 1 ? 'that one' : 'those'}.`
}

export const TOO_FEW = 'too few surveys here to call'

function slotFor(key: LeverKey, side: 'save' | 'earn', lever: Lever | null, reasonIfNull: string): LeverSlot {
  if (!lever) {
    return {
      key, side, title: LEVER_TITLE[key], lever: null, callable: false, reason: reasonIfNull,
      low: null, high: null, range: '—', confidence: null, givesUp: '',
    }
  }
  const callable = !lever.tooFew && lever.high > 0
  const TooFew = TOO_FEW.charAt(0).toUpperCase() + TOO_FEW.slice(1)
  const reason = lever.tooFew
    ? (lever.note ? `${TooFew}. ${lever.note}` : `${TooFew} (${fmtNum(lever.ids.length)} of the ${fmtNum(MIN_CLASS_N)} needed).`)
    : lever.high > 0 ? null : (lever.note ?? 'Nothing to act on in this view.')
  // Direction-only levers read "up to": their low end is zero by construction,
  // and "$0–$24,757" invites reading the midpoint as an estimate.
  const low = callable ? (lever.evidence === 'direction' && lever.low === 0 ? null : lever.low) : null
  return {
    key, side, title: lever.title, lever, callable, reason,
    low, high: callable ? lever.high : null,
    range: callable ? rangeText(low, lever.high) : (lever.tooFew ? TOO_FEW : '—'),
    confidence: EVIDENCE_LABEL[lever.evidence],
    givesUp: lever.givesUp,
  }
}

/** Callable levers first, dearest first; the rest after them in the spec's
 *  order, so a lever that has nothing to say stays where a reader expects it. */
function rankSlots(slots: LeverSlot[]): LeverSlot[] {
  const on = slots.filter(s => s.callable).sort((a, b) => (b.high ?? 0) - (a.high ?? 0))
  return [...on, ...slots.filter(s => !s.callable)]
}

function verdictTile5(t: LeverTile): string {
  const save = t.save.find(s => s.callable)
  const earn = t.earn.find(s => s.callable)
  if (!save && !earn) {
    return t.population.length
      ? 'Nothing here has enough surveys behind it to act on yet — widen the date range or clear a filter to see the levers.'
      : 'No delivered or live survey is in this view — widen the date range or clear a filter.'
  }
  const bits: string[] = []
  if (save) bits.push(`Start on cost with “${save.title}” (${save.range})`)
  if (earn) bits.push(`${save ? 'on price, ' : 'Start on price with '}“${earn.title}” (${earn.range})`)
  return bits.join('; ') + '. The two lists are different kinds of money, and the levers overlap, so none of them is added up.'
}

/* ── rejected rules, recomputed where the data allows ───────────────────── */

export interface CapReplay {
  /** Per route, the multiple the rule would have set: 1 ÷ the typical keep. */
  multiples: { route: RouteKey; multiple: number }[]
  tested: number
  capped: number
  saved: number
  broken: number
  /** Client price on the broken deliveries that carry a price above $0. */
  brokenWorth: number
  /** What the bill would have lost: N short of the N sold × price. */
  brokenLost: number
  brokenUnpriced: number
}

/**
 * The obvious rule — stop buying at target ÷ the typical QA keep — replayed
 * survey by survey on the card's own surveys: each survey keeps its OWN keep
 * rate on the completes the cap lets it buy. Single-route surveys with an N
 * sold only (a mixed leg's target cannot be split). It is a replay, not a
 * forecast: it shows the shape of the loss, which is that a rule set on the
 * typical keep under-buys on roughly half of all surveys.
 */
export function capReplay(cards: RouteCard[], byId: Map<string, FinProject>, rates: Map<string, number>, pricesOk: boolean): CapReplay {
  const out: CapReplay = { multiples: [], tested: 0, capped: 0, saved: 0, broken: 0, brokenWorth: 0, brokenLost: 0, brokenUnpriced: 0 }
  for (const card of cards) {
    const c = card.cpqr
    if (!c) continue
    const keepMedian = 1 - c.scrubRateMedian
    if (!(keepMedian > 0)) continue
    const m = 1 / keepMedian
    out.multiples.push({ route: card.route, multiple: m })
    for (const o of c.observations) {
      if (o.mixed || o.keep == null || !(o.paid > 0)) continue
      const p = byId.get(o.id)
      const t = Number(p?.n_target ?? 0)
      if (!p || !(t > 0)) continue
      out.tested++
      // A hair of tolerance each way, so 100 ÷ 0.8 is a cap of 125 and 125 ×
      // 0.8 delivers 100, not 126 and 99 by float rounding.
      const cap = Math.ceil(t * m - 1e-9)
      if (!(o.paid > cap)) continue
      out.capped++
      out.saved += (o.paid - cap) * (o.spend / o.paid)
      const after = Math.floor(cap * o.keep + 1e-9)
      if (after >= t) continue
      out.broken++
      const rate = pricesOk ? rates.get(p.id) : undefined
      const rv = pricesOk ? revenueOf(p, rate) : null
      if (rate != null && Number(rate) > 0 && rv != null) {
        out.brokenWorth += rv
        out.brokenLost += (t - after) * Number(rate)
      } else out.brokenUnpriced++
    }
  }
  return out
}

function rejectedRules(ctx: {
  cards: RouteCard[]; byId: Map<string, FinProject>; rates: Map<string, number>
  nameOf: (id: string | null | undefined) => string; pricesOk: boolean
  leverRows: FinProject[]; blasts: FinBlastDated[]
}): RejectedRule[] {
  // 1 ── cap spend at target ÷ expected QA yield
  const rp = capReplay(ctx.cards, ctx.byId, ctx.rates, ctx.pricesOk)
  const capNow: string[] = []
  if (rp.tested > 0) {
    const ms = rp.multiples.map(x => `${timesText(x.multiple)} on ${x.route}`).join(' and ')
    capNow.push(
      `Replayed survey by survey on the ${fmtNum(rp.tested)} ${plural(rp.tested, 'survey')} in this view with an N sold, a cap at ${ms} (the target ÷ the typical keep rate) ` +
      `would have stopped ${fmtNum(rp.capped)} early and saved ${money(rp.saved)} — and left ${fmtNum(rp.broken)} ${plural(rp.broken, 'delivery', 'deliveries')} short of the N sold` +
      (ctx.pricesOk && rp.broken > rp.brokenUnpriced
        ? `, ${money(rp.brokenWorth)} of client price on the priced ones, with ${money(rp.brokenLost)} less on the bill.`
        : '.'),
    )
  } else {
    capNow.push('No survey in this view has a reconciled cost, a keep rate and an N sold, so the replay cannot be run here.')
  }
  // Nor can the keep be forecast from the account: the widest spread in view.
  const byAccount = new Map<string, number[]>()
  for (const c of ctx.cards) {
    for (const o of c.cpqr?.observations ?? []) {
      if (o.keep == null) continue
      const acc = ctx.byId.get(o.id)?.client_id
      if (!acc) continue
      const a = byAccount.get(acc) ?? []
      a.push(o.keep); byAccount.set(acc, a)
    }
  }
  let widest: { acc: string; p25: number; median: number } | null = null
  for (const [acc, ks] of byAccount) {
    if (ks.length < MIN_CLASS_N) continue
    const p25 = nearestRank(ks, 0.25), median = nearestRank(ks, 0.5)
    if (!widest || median - p25 > widest.median - widest.p25) widest = { acc, p25, median }
  }
  capNow.push(widest
    ? `Nor can the keep rate be forecast from the account: at ${ctx.nameOf(widest.acc)}, a quarter of surveys kept ${pctText(widest.p25)} or less of what we bought, against a median of ${pctText(widest.median)}.`
    : `No account in this view has ${fmtNum(MIN_CLASS_N)} or more surveys with a keep rate, so the spread within an account cannot be shown here.`)

  // 2 ── move blast work onto the panel
  const [panel, blast] = [ctx.cards[0].cpqr, ctx.cards[1].cpqr]
  const moveNow = panel && blast && panel.median > 0
    ? [`Here a qualified blast respondent costs about ${fmtNum(Math.round(blast.median / panel.median))}× a panel one on the typical survey — and that gap is what the routes reach, not how well they are bought.`]
    : ['This view does not hold both routes, so the gap between them cannot be shown here.']

  // 3 ── switch text blasts to email
  const ids = new Set(ctx.leverRows.map(p => p.id))
  const per = new Map<string, { e: { people: number; completes: number }; t: { people: number; completes: number } }>()
  let textCompletes = 0, emailsSent = 0
  for (const b of ctx.blasts) {
    if (!ids.has(b.project_id)) continue
    const people = Number(b.people ?? 0), completes = Number(b.completes ?? 0)
    // An unrecorded channel pays for its sends (hub.ts), so it counts as text.
    const isEmail = b.channel === 'email'
    if (isEmail) emailsSent += people; else textCompletes += completes
    const e = per.get(b.project_id) ?? { e: { people: 0, completes: 0 }, t: { people: 0, completes: 0 } }
    const side = isEmail ? e.e : e.t
    side.people += people; side.completes += completes
    per.set(b.project_id, e)
  }
  const both = [...per.values()].filter(x => x.e.people > 0 && x.t.people > 0)
  const eP = both.reduce((t, x) => t + x.e.people, 0), eC = both.reduce((t, x) => t + x.e.completes, 0)
  const tP = both.reduce((t, x) => t + x.t.people, 0), tC = both.reduce((t, x) => t + x.t.completes, 0)
  const emailRate = eP > 0 ? eC / eP : 0, textRate = tP > 0 ? tC / tP : 0
  const smsNow: string[] = both.length && emailRate > 0 && textRate > 0
    ? [
      `Inside the same survey, email answered about ${fmtNum(Math.round(textRate / emailRate))}× worse than text (${fmtNum(both.length)} ${plural(both.length, 'survey')} in this view sent both). ` +
      `Replacing the ${fmtNum(textCompletes)} text completes here by email would need about ${aboutText(textCompletes / emailRate)} addresses, against ${fmtNum(emailsSent)} emails sent in this view.`,
    ]
    : ['No survey in this view sent both email and text blasts with a response, so the comparison cannot be recomputed here.']

  return [
    {
      key: 'cap-at-yield',
      title: 'Cap spend at target ÷ expected QA yield',
      now: [
        'The obvious rule, and the one three separate analyses reached for first. It has no input: the QA keep rate is written at delivery, after the money is spent.',
        ...capNow,
      ],
      dated: 'the keep rate had landed before a survey’s last blast on 11 of 412 surveys. That timing needs the change history, so it is not recomputed here.',
    },
    {
      key: 'blast-to-panel',
      title: 'Move blast work onto the panel because it is far cheaper',
      now: [
        'There is no audience overlap between the two routes to substitute across. A B2B audience is not on a consumer panel, so the cheap rate is not available at any volume.',
        ...moveNow,
      ],
      dated: null,
    },
    {
      key: 'sms-to-email',
      title: 'Switch text blasts to email because email sends are free',
      now: smsNow,
      dated: null,
    },
  ]
}

/* ────────────────────────────────────────────────────────────────────────────
 * DRILLS — expectedTotal always from a different function than the rows
 * ──────────────────────────────────────────────────────────────────────────── */

const cell = (r: DrillRow, k: string) => (r[k] == null ? null : (r[k] as number | string))
const moneyCell = (r: DrillRow, k: string) => (typeof r[k] === 'number' ? moneyAuto(r[k] as number) : '—')
const numCell = (r: DrillRow, k: string) => (typeof r[k] === 'number' ? fmtNum(r[k] as number) : '—')
const pctCell = (r: DrillRow, k: string) => (typeof r[k] === 'number' ? pctText(r[k] as number) : '—')

/**
 * A route card's surveys, ranked by the dollars each cost above the typical
 * survey. The strip checks the leg spend against drill.ts routeSpendOfIds —
 * summed off the raw rows, never through legsOf — and the ids against the
 * card's own ids.
 */
export function routeDrill(card: RouteCard, raw: Pick<PerRespondentRaw, 'blasts' | 'suppliers' | 'costs'>, chip: string): DrillSpec | null {
  const c = card.cpqr
  if (!c) return null
  const columns: DrillColumn[] = [
    { key: 'account', header: 'Account', tip: 'The client account.', value: r => cell(r, 'account') },
    { key: 'spend', header: 'Spend', num: true, tip: 'Recorded field cost on this route for the survey, net of rewards that came back.', value: r => moneyCell(r, 'spend') },
    { key: 'paid', header: 'Bought', num: true, tip: 'Completes we paid for on this route.', value: r => numCell(r, 'paid') },
    { key: 'delivered', header: 'Delivered', num: true, tip: 'Qualified respondents the client received from this route, after QA.', value: r => numCell(r, 'delivered') },
    { key: 'perComplete', header: 'Per complete', num: true, tip: 'Spend ÷ completes bought.', value: r => moneyCell(r, 'perComplete') },
    { key: 'cpqr', header: 'CPQR', num: true, tip: 'Cost per qualified respondent: spend ÷ delivered.', value: r => moneyCell(r, 'cpqr') },
    { key: 'keep', header: 'Kept', num: true, tip: 'Delivered ÷ bought: the share of what we paid for that survived QA.', value: r => pctCell(r, 'keep') },
    { key: 'aboveTypical', header: 'Above typical', num: true, tip: `(This survey’s CPQR − the typical ${moneyAuto(c.median)}) × its delivered N: what it cost above a typical survey. Negative means cheaper than typical.`, value: r => moneyCell(r, 'aboveTypical') },
  ]
  return {
    key: `per-respondent-${card.route}`,
    title: `${card.title}: surveys ranked by cost above the typical survey`,
    population: `${chip} · the ${fmtNum(c.ids.length)} surveys behind the ${card.route} rate, ranked by (their cost per qualified respondent − the typical ${moneyAuto(c.median)}) × delivered N`,
    columns,
    rows: card.rows.map(r => ({ ...r, contribution: r.spend })),
    expectedTotal: routeSpendOfIds(c.ids, card.route, raw.blasts, raw.suppliers, raw.costs),
    expectedIds: c.ids,
    totalLabel: 'Spend behind this rate (net of rewards that came back)',
    format: 'money',
  }
}

/**
 * The priced surveys on a route quoted below its floor. The rows come from the
 * tab's SurveyPnl; the expected total is client price read straight through
 * revenue.ts on the survey records.
 */
export function belowFloorDrill(card: RouteCard, model: Pick<PerRespondentModel, 'tabPnl'>, byId: Map<string, FinProject>, rates: Map<string, number>, chip: string): DrillSpec | null {
  const q = card.quote
  if (!q || !q.belowIds.length) return null
  const pnl = new Map(model.tabPnl.map(r => [r.id, r]))
  const rows: DrillRow[] = q.belowIds
    .map(id => pnl.get(id))
    .filter((r): r is SurveyPnl => r != null)
    .map(r => ({
      id: r.id, code: r.code, account: r.account, rate: r.rate, billableN: r.billableN,
      gapPer: r.rate != null ? q.floor - r.rate : null,
      revenue: r.revenue, marginPct: r.marginPct,
      contribution: r.revenue ?? 0,
    }))
    .sort((a, b) => Number(b.gapPer ?? 0) - Number(a.gapPer ?? 0))
  const expected = q.belowIds.reduce((t, id) => {
    const p = byId.get(id)
    return t + (p ? (revenueOf(p, rates.get(id)) ?? 0) : 0)
  }, 0)
  return {
    key: `per-respondent-${card.route}-below-floor`,
    title: `${card.title}: priced below the ${money2(q.floor)} floor`,
    population: `${chip} · ${card.route} surveys priced above $0 whose price per N is under ${timesText(q.multiple)} the typical cost per billed respondent`,
    columns: [
      { key: 'account', header: 'Account', tip: 'The client account.', value: r => cell(r, 'account') },
      { key: 'rate', header: 'Price / N', num: true, tip: 'The client’s price per respondent on this survey.', value: r => moneyCell(r, 'rate') },
      { key: 'gapPer', header: 'Below floor by', num: true, tip: `The floor (${money2(q.floor)}) minus this survey’s price per N.`, value: r => moneyCell(r, 'gapPer') },
      { key: 'billableN', header: 'Billed N', num: true, tip: 'min(delivered, the top of the N sold) — the N the price applies to.', value: r => numCell(r, 'billableN') },
      { key: 'revenue', header: 'Client price', num: true, tip: 'Price per N × billed N.', value: r => moneyCell(r, 'revenue') },
      { key: 'marginPct', header: 'We keep', num: true, tip: 'What is left after field cost, before salaries and overhead, as a share of client price.', value: r => pctCell(r, 'marginPct') },
    ],
    rows,
    expectedTotal: expected,
    expectedIds: q.belowIds,
    totalLabel: 'Client price on these surveys',
    format: 'money',
  }
}

/**
 * A lever's surveys. SAVE COST levers list each survey at its full recorded
 * cost — a saving is a slice of these rows and cannot be allocated row by row
 * without inventing an allocation — checked against spendOfIds off the raw
 * rows. EARN MORE levers list each survey's own share of the figure, checked
 * against the lever's figure (or, for the top-up, hub.ts foregone), which was
 * computed off the survey records rather than from these rows. The id check
 * always compares the rows with the lever's own ids.
 */
export function leverDrill(
  slot: LeverSlot, model: Pick<PerRespondentModel, 'pnl' | 'levers'>,
  raw: Pick<PerRespondentRaw, 'blasts' | 'suppliers' | 'costs' | 'rates'>,
  nameOf: (id: string) => string = id => id,
): DrillSpec | null {
  const l = slot.lever
  if (!l) return null
  const chip = model.levers.scope.chip
  const tooFew = l.tooFew ? ` (${TOO_FEW})` : ''
  const base: DrillColumn[] = [
    { key: 'account', header: 'Account', tip: 'The client account.', value: r => cell(r, 'account') },
    { key: 'route', header: 'Route', tip: 'How it was actually fielded, read from its cost records.', value: r => cell(r, 'route') },
  ]
  const costCols: DrillColumn[] = [
    ...base,
    { key: 'collected', header: 'Bought', num: true, tip: 'Completes collected (before QA).', value: r => numCell(r, 'collected') },
    { key: 'cost', header: 'Recorded cost', num: true, tip: 'Everything recorded against the survey, net of rewards that came back.', value: r => moneyCell(r, 'cost') },
  ]
  const pnl = new Map(model.pnl.map(r => [r.id, r]))
  const ladder = model.levers.ladder

  if (l.side === 'save') {
    const rows = leverRows(l, model.pnl)
    const extra = l.key === 'bid-premium' && ladder && ladder.headToHead > 0
      ? ` · Head to head (500+ sends at each bid), the higher bid got a worse response on ${fmtNum(ladder.worseAfterRaise)} of ${fmtNum(ladder.headToHead)} surveys; ` +
        `per complete it paid ${moneyAuto(ladder.raised.costPer)} against ${moneyAuto(ladder.base.costPer)} at each survey’s own lowest bid`
      : ''
    return {
      key: `lever-${l.key}`,
      title: l.title + tooFew,
      population: `${chip} · ${l.population}${extra}. Rows are each survey’s full recorded cost, not the saving`,
      columns: costCols,
      rows,
      expectedTotal: spendOfIds(l.ids, raw.blasts, raw.suppliers, raw.costs),
      expectedIds: l.ids,
      totalLabel: 'Recorded cost on these surveys — the saving is a slice of it, not all of it',
      format: 'money',
    }
  }

  /*
   * The price gap with no pair to call. It is an EARN MORE lever, so it must
   * never open onto recorded field COST under a total that calls itself a
   * saving — which is exactly what the save branch above used to do to it.
   * Instead: the priced surveys it weighed, on the two per-billed-respondent
   * figures the comparison would have used, and NO total, because nothing here
   * adds up to a figure (expectedTotal null — the ids are still checked).
   */
  if (l.key === 'price-gap' && !l.benchmark) {
    const rows: DrillRow[] = l.ids.map(id => pnl.get(id)).filter((r): r is SurveyPnl => r != null).map(r => ({
      id: r.id, code: r.code, account: r.account, route: r.route, rate: r.rate,
      billableN: r.billableN, revenue: r.revenue,
      costPerBilled: r.billableN ? r.cost / r.billableN : null,
      contribution: r.revenue ?? 0,
    })).sort((a, b) => b.contribution - a.contribution)
    return {
      key: `lever-${l.key}`,
      title: l.title + tooFew,
      population: `${chip} · ${l.population}. ${l.note ?? ''} Rows are the surveys weighed, at each client’s own price — no pair could be called, so no figure is claimed`,
      columns: [
        ...base,
        { key: 'rate', header: 'Price / N', num: true, tip: 'The client’s price per respondent on this survey.', value: r => moneyCell(r, 'rate') },
        { key: 'billableN', header: 'Billed N', num: true, tip: 'min(delivered, the top of the N sold).', value: r => numCell(r, 'billableN') },
        { key: 'revenue', header: 'Client price', num: true, tip: 'Price per N × billed N.', value: r => moneyCell(r, 'revenue') },
        { key: 'costPerBilled', header: 'Cost / billed N', num: true, tip: 'Recorded cost ÷ billed N — the same denominator as the price, which is what the comparison needs.', value: r => moneyCell(r, 'costPerBilled') },
      ],
      rows,
      expectedTotal: null,
      expectedIds: l.ids,
      totalLabel: 'Client price on the surveys weighed — no pair could be called, so no figure is claimed',
      format: 'money',
    }
  }

  if (l.key === 'sell-range') {
    const rows: DrillRow[] = l.ids.map(id => pnl.get(id)).filter((r): r is SurveyPnl => r != null).map(r => ({
      id: r.id, code: r.code, account: r.account, route: r.route, target: r.target, cap: r.cap,
      actual: r.actual, overN: r.overN, rate: r.rate,
      contribution: (r.overN ?? 0) * (r.rate ?? 0),
    })).sort((a, b) => b.contribution - a.contribution)
    return {
      key: `lever-${l.key}`,
      title: l.title + tooFew,
      population: `${chip} · ${l.population}. An opportunity for the next quote — never an amount to charge for work already delivered`,
      columns: [
        ...base,
        { key: 'cap', header: 'N sold (top)', num: true, tip: 'The top of the sold range — the most the bill counts.', value: r => numCell(r, 'cap') },
        { key: 'actual', header: 'Delivered', num: true, tip: 'The N actual the client received.', value: r => numCell(r, 'actual') },
        { key: 'overN', header: 'Past the N sold', num: true, tip: 'Delivered above the top of the sold range. A courtesy, never billed.', value: r => numCell(r, 'overN') },
        { key: 'rate', header: 'Price / N', num: true, tip: 'The client’s own price per respondent.', value: r => moneyCell(r, 'rate') },
      ],
      rows,
      expectedTotal: l.high,
      expectedIds: l.ids,
      totalLabel: 'Respondents past the N sold, at each client’s own price',
      format: 'money',
    }
  }

  if (l.key === 'top-up') {
    const rows: DrillRow[] = l.ids.map(id => pnl.get(id)).filter((r): r is SurveyPnl => r != null).map(r => ({
      id: r.id, code: r.code, account: r.account, route: r.route, target: r.target, actual: r.actual,
      shortN: r.shortN, rate: r.rate, cpqr: r.cpqr,
      contribution: r.shortValue ?? 0,
    })).sort((a, b) => b.contribution - a.contribution)
    const ids = new Set(l.ids)
    return {
      key: `lever-${l.key}`,
      title: l.title + tooFew,
      population: `${chip} · ${l.population}. Rows are the missing respondents at the client’s price, before the cost of fielding them`,
      columns: [
        ...base,
        { key: 'target', header: 'N sold', num: true, tip: 'The N the client bought.', value: r => numCell(r, 'target') },
        { key: 'actual', header: 'Delivered', num: true, tip: 'The N actual the client received.', value: r => numCell(r, 'actual') },
        { key: 'shortN', header: 'Short by', num: true, tip: 'N sold minus N delivered.', value: r => numCell(r, 'shortN') },
        { key: 'rate', header: 'Price / N', num: true, tip: 'The client’s own price per respondent.', value: r => moneyCell(r, 'rate') },
        { key: 'cpqr', header: 'Its CPQR', num: true, tip: 'What one qualified respondent cost on this survey.', value: r => moneyCell(r, 'cpqr') },
      ],
      rows,
      // hub.ts foregone: the same shortfall at the same price, summed off the
      // survey records by a different function.
      expectedTotal: foregone(model.levers.population.filter(p => ids.has(p.id)), raw.rates).dollars,
      expectedIds: l.ids,
      totalLabel: 'Missing respondents at the client’s price, before the cost of fielding them',
      format: 'money',
    }
  }

  // price-gap with a benchmark
  const b = l.benchmark!
  const rows: DrillRow[] = l.ids.map(id => pnl.get(id)).filter((r): r is SurveyPnl => r != null).map(r => ({
    id: r.id, code: r.code, account: r.account, route: r.route, rate: r.rate, billableN: r.billableN,
    revenue: r.revenue, costPerBilled: r.billableN ? r.cost / r.billableN : null,
    contribution: b.rate * (r.billableN ?? 0) - (r.revenue ?? 0),
  })).sort((a, c) => c.contribution - a.contribution)
  return {
    key: `lever-${l.key}`,
    title: l.title,
    population: `${chip} · ${l.population}. Each row: what it would have brought at ${nameOf(b.accountId)}’s ${moneyAuto(b.rate)} per billed respondent, less what it did bring`,
    columns: [
      ...base,
      { key: 'rate', header: 'Price / N', num: true, tip: 'The client’s price per respondent on this survey.', value: r => moneyCell(r, 'rate') },
      { key: 'billableN', header: 'Billed N', num: true, tip: 'min(delivered, the top of the N sold).', value: r => numCell(r, 'billableN') },
      { key: 'costPerBilled', header: 'Cost / billed N', num: true, tip: 'Recorded cost ÷ billed N — the same denominator as the price.', value: r => moneyCell(r, 'costPerBilled') },
      { key: 'revenue', header: 'Client price', num: true, tip: 'Price per N × billed N.', value: r => moneyCell(r, 'revenue') },
    ],
    rows,
    expectedTotal: l.high,
    expectedIds: l.ids,
    totalLabel: `More at ${nameOf(b.accountId)}’s price`,
    format: 'money',
  }
}

/* ── export: the per-route survey rows behind Tile 4 ────────────────────── */

export const TILE4_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'route', header: 'Route' },
  { key: 'code', header: 'Survey' },
  { key: 'account', header: 'Account' },
  { key: 'mixed', header: 'Fielded both ways' },
  { key: 'spend', header: 'Spend on this route (net)' },
  { key: 'recovered', header: 'Rewards recovered' },
  { key: 'paid', header: 'Completes bought' },
  { key: 'delivered', header: 'Qualified respondents' },
  { key: 'perComplete', header: 'Cost per complete bought' },
  { key: 'cpqr', header: 'Cost per qualified respondent' },
  { key: 'keep', header: 'Kept after QA' },
  { key: 'aboveTypical', header: 'Cost above the typical survey' },
  { key: 'billedN', header: 'Billed N' },
  { key: 'costPerBilledN', header: 'Cost per billed respondent' },
  { key: 'rate', header: 'Price per N' },
  { key: 'belowFloor', header: 'Priced below the floor' },
]

const r2 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100)

export function tile4ExportRows(model: Pick<PerRespondentModel, 'cards'>): Record<string, string | number | null>[] {
  return model.cards.flatMap(c => c.rows.map(r => ({
    route: c.route,
    code: r.code,
    account: r.account,
    mixed: r.mixed ? 'yes' : 'no',
    spend: r2(r.spend),
    recovered: r2(r.recovered),
    paid: r.paid,
    delivered: r.delivered,
    perComplete: r2(r.perComplete),
    cpqr: r2(r.cpqr),
    keep: r.keep == null ? null : Math.round(r.keep * 1000) / 10,
    aboveTypical: r2(r.aboveTypical),
    billedN: r.billedN,
    costPerBilledN: r2(r.costPerBilledN),
    rate: r2(r.rate),
    belowFloor: r.belowFloor == null ? null : r.belowFloor ? 'yes' : 'no',
  })))
}
