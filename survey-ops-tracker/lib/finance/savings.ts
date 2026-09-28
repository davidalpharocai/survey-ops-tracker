/**
 * The savings engine — where more margin could come from.
 *
 * David, 2026-09-17: "there needs to be also be guidance/suggestions on how to
 * cut costs somewhere. this needs to think out of the box and learn … we need
 * to scale the business and cut costs."
 *
 * ── WHAT A LEVER IS ─────────────────────────────────────────────────────────
 * A number someone could act on next week, with what it costs to act. Every
 * lever carries a plain verb title, a range, how firm the range is, what acting
 * on it gives up, ONE sentence saying what to do, the computed evidence behind
 * it, and the surveys it counted — because a saving quoted without its cost is
 * not a saving, it is an argument for doing less work.
 *
 * The clearest case: blasts sent after a list stopped answering look like pure
 * waste until you notice they still produced completes, just expensively. The
 * lever is worth the DIFFERENCE from the book rate, not the whole spend.
 *
 * ── TWO KINDS OF MONEY, NEVER ADDED TOGETHER ────────────────────────────────
 * SAVE COST levers (1–5) are field cost we could stop spending. EARN MORE levers
 * (6–8) are client price we could quote for. A cost saving and a gross
 * client-price dollar are different currencies, so the two lists are drawn on
 * their own axes and never summed — and within a list the levers OVERLAP (the
 * same blast can be both after a dead streak and at a raised bid), so there is
 * no grand total either.
 *
 * ── OVER-DELIVERY IS NEVER BILLED ───────────────────────────────────────────
 * David, 2026-09-24: over-delivery is a courtesy (new clients are over-
 * delivered on purpose the first time) and is never billed or chased
 * afterwards. So the over-delivery lever (6) says to SELL A RANGE next time and
 * price the cushion into the quote. It must never tell anyone to invoice
 * respondents that were delivered past the N sold; savings.test.ts pins that.
 *
 * ── WHY NOTHING HERE IS A HARD GATE ─────────────────────────────────────────
 * The obvious rule — stop buying at `target ÷ expected QA yield` — has no input.
 * `n_actual` is written at DELIVERY, after the money is spent. Keep rate is not
 * forecastable from account history either. So these surface as warnings with
 * their numbers, and a human decides. An engine that silently capped spend would
 * cost more than it saved and the loss would land on client deliveries.
 *
 * ── EVERY THRESHOLD IS A PERCENTILE OF ITS OWN DATA ─────────────────────────
 * Nothing here is a hardcoded fact about the book. "Expensive" means "above the
 * comparable surveys", recomputed on every load, so the engine sharpens as data
 * accumulates. Every number in a lever's words is computed from the population
 * it was given — never typed — because typed numbers drift within days ("30% of
 * recorded cost" had become 28% by the time anyone read it).
 *
 * ── ONE DECLARED POPULATION ─────────────────────────────────────────────────
 * The caller passes the population (delivered + live work in the date window ×
 * account × route — filters.ts LEVER_RULE) and every lever is computed on it,
 * so a lever moves with the filters instead of describing the whole book under
 * a filtered header.
 */

import {
  buildIndex, finDate, routeOf, spendOf,
  type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier, type Route,
} from './hub'
import { classOf } from './lifecycle'
import { overDeliveredOf, revenueDetail, shortfallOf } from './revenue'
import { money, money2, moneyAuto } from './format'
import type { Cpqr } from './cpqr'

/** A class needs at least this many surveys before a percentile drawn from it
 *  may drive a recommendation. Below it the lever says "too few surveys here to
 *  call" instead. */
export const MIN_CLASS_N = 8

/**
 * How much weight a lever's range can bear:
 *   measured   — counted directly off recorded rows
 *   depends    — measured, but acting on it depends on something outside the
 *                data (a carrier, an audience, a client), so the low end may be
 *                far below the high
 *   direction  — points the right way, but the data cannot size it (panel
 *                capacity and per-panel QA are not recorded)
 */
export type Evidence = 'measured' | 'depends' | 'direction'

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  measured: 'Measured',
  depends: 'Depends on others',
  direction: 'Direction only',
}

export const EVIDENCE_HELP: Record<Evidence, string> = {
  measured: 'Counted directly off recorded rows.',
  depends: 'Measured, but acting on it depends on someone outside the data — a carrier, an audience, a client — so the low end may be much lower.',
  direction: 'Points the right way, but the data cannot size it, so the figure is the most it could be worth.',
}

/** The eight levers, in the order the finance spec numbers them. */
export type LeverKey =
  | 'bid-premium' | 'sms-rate' | 'wave-spread' | 'dead-streak' | 'launch-overrun'
  | 'sell-range' | 'top-up' | 'price-gap'

/** Plain verb titles. One copy, so a lever with nothing to say in this view
 *  still reads with the same name it has when it has a figure. The price-gap
 *  lever's own title names the two accounts it compares; this is its title
 *  when there is no pair to name. */
export const LEVER_TITLE: Record<LeverKey, string> = {
  'bid-premium': 'Stop raising the bid mid-field',
  'sms-rate': 'Get the SMS invoice, then negotiate the rate',
  'wave-spread': 'Buy the cheaper panel first in each wave',
  'dead-streak': 'Stop sending after two dead blasts',
  'launch-overrun': 'Set the PureSpectrum survey Goal, not SOCC’s cap',
  'sell-range': 'Sell a range on repeat work',
  'top-up': 'Top up short surveys',
  'price-gap': 'Bring low prices up to the best payer on the same route',
}

export const SAVE_KEYS: LeverKey[] = ['bid-premium', 'sms-rate', 'wave-spread', 'dead-streak', 'launch-overrun']
export const EARN_KEYS: LeverKey[] = ['sell-range', 'top-up', 'price-gap']

export interface Lever {
  key: LeverKey
  /** SAVE COST (field cost we could stop spending) or EARN MORE (client price
   *  we could quote for). Never summed across the two. */
  side: 'save' | 'earn'
  title: string
  /** The defensible figure. A RANGE, because most of these depend on something
   *  outside the data — a carrier's willingness, an audience's depth. */
  low: number
  high: number
  /** What acting on it gives up, in completes. 0 when it gives up none. */
  forgoneCompletes: number
  /** What acting on it gives up, as a phrase that follows "Gives up" ("about
   *  1,300 completes, bought dear"). */
  givesUp: string
  /** True only when acting costs nothing in quality, speed or delivery risk.
   *  "Gives up no completes" is NOT enough: raising a bid gives up none and may
   *  still be the only way to fill a hard survey. */
  free: boolean
  /** A short risk label for a badge, when there is a real one. */
  riskTag?: string
  /** The population, stated so the figure can never travel without it. */
  population: string
  /** What to actually do — ONE sentence. */
  rule: string
  /** The computed evidence behind the figure, in plain sentences. */
  why: string
  /** What it costs to be wrong. */
  risk: string
  evidence: Evidence
  /** Fewer than MIN_CLASS_N surveys behind it — the figure is withheld and the
   *  lever reads "too few surveys here to call". */
  tooFew: boolean
  /** Why there is no figure, when the plain "too few" count would mislead (the
   *  price-gap lever counts two sides) or the lever found nothing to act on. */
  note?: string
  /** Quotes a client price, so finance-only. */
  financeOnly?: boolean
  /** Survey ids behind it, for the drill-down and its check. */
  ids: string[]
  /** The price-gap lever only: the best payer it compares against, so its drill
   *  can say what each survey would have brought at that price. */
  benchmark?: { accountId: string; rate: number; costPerBilledN: number; surveys: number }
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)
const quantile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
const blastDate = (b: FinBlast & { blast_at?: string | null; scheduled_at?: string | null; created_at?: string | null }) =>
  String(b.blast_at ?? b.scheduled_at ?? b.created_at ?? '')
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const n = (x: number) => x.toLocaleString('en-US')
const s = (k: number, one: string, many = one + 's') => (k === 1 ? one : many)

export type FinBlastDated = FinBlast & {
  blast_at?: string | null
  scheduled_at?: string | null
  created_at?: string | null
}

/** Suppliers as the engine reads them: which panel, which wave. */
export type FinSupplierRow = FinSupplier & { supplier_id?: string | null; launch_id?: string | null }

export interface FinLaunch { id: string; project_id: string; target: number | null }

/* ────────────────────────────────────────────────────────────────────────────
 * SAVE COST
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The send rate.
 *
 * Every SMS blast on file tends to carry the same per-message rate, which is
 * the signature of a number nobody has ever negotiated rather than a rate that
 * happens to be stable. It is the single largest controllable line in the book
 * and the only lever here that costs nothing in quality, speed or client
 * relationship: it is a phone call to the carrier. It is also the number most
 * worth VERIFYING — it was backfilled rather than taken from an invoice — so
 * the evidence states its share of recorded cost, computed on the population.
 */
export function smsRateLever(
  rows: FinProject[], blasts: FinBlastDated[], populationSpend = 0,
): Lever | null {
  const ids = new Set(rows.map(p => p.id))
  const sms = blasts.filter(b => ids.has(b.project_id) && b.channel !== 'email')
  if (!sms.length) return null
  const sends = sum(sms, b => Number(b.people ?? 0))
  const spend = sum(sms, b => Number(b.people ?? 0) * Number(b.cost_per_send ?? 0))
  if (spend <= 0) return null
  const rates = [...new Set(sms.map(b => Number(b.cost_per_send ?? 0)))]
  const flat = rates.length === 1
  const share = pctOf(spend, populationSpend)
  const surveys = [...new Set(sms.map(b => b.project_id))]
  // A 25% cut is a routine volume tier; 12.5% is the cautious ask.
  const CAUTIOUS = 0.125, ROUTINE = 0.25
  return {
    key: 'sms-rate',
    side: 'save',
    title: LEVER_TITLE['sms-rate'],
    low: spend * CAUTIOUS,
    high: spend * ROUTINE,
    forgoneCompletes: 0,
    givesUp: 'nothing — no effect on quality, speed or any client',
    free: true,
    population: `${n(sends)} messages across ${n(sms.length)} text blasts on ${n(surveys.length)} surveys, ` +
      (flat ? `every one at ${money2(rates[0])} a message` : `${n(rates.length)} different rates`),
    rule: 'Get one carrier invoice to confirm the per-message rate, then ask the carrier for a volume tier.',
    why: (flat
      ? `Every text blast here carries the same ${money2(rates[0])} per message, which is what a price nobody has negotiated looks like, and it was backfilled rather than read off an invoice. `
      : `Text blasts here carry ${n(rates.length)} different per-message rates, so start by moving onto the lowest one already being paid. `) +
      `Send cost is ${money(spend)} on ${n(sends)} messages${populationSpend > 0 ? ` — ${share}% of recorded cost in this view` : ''}. ` +
      `The range is a ${Math.round(CAUTIOUS * 1000) / 10}–${Math.round(ROUTINE * 100)}% cut.`,
    risk: 'None. No effect on quality, speed or any client.',
    evidence: flat ? 'measured' : 'depends',
    tooFew: surveys.length < MIN_CLASS_N,
    ids: surveys,
  }
}

/**
 * Blasts sent after the list stopped answering.
 *
 * Two consecutive sends returning zero completes is the clearest "this list is
 * finished" signal the data carries. But the sends AFTER that point are not
 * worthless — they still produced completes, just expensively — so the lever is
 * the premium over what those completes should have cost, never the whole
 * spend. Reporting the gross would overstate it several times over.
 */
export function deadStreakLever(
  rows: FinProject[], blasts: FinBlastDated[], bookCostPerComplete: number,
): Lever | null {
  const ix = new Map<string, FinBlastDated[]>()
  const live = new Set(rows.map(p => p.id))
  for (const b of blasts) {
    if (!live.has(b.project_id) || b.completes == null) continue
    const a = ix.get(b.project_id)
    if (a) a.push(b); else ix.set(b.project_id, [b])
  }
  let spend = 0, completes = 0, surveys = 0, blastRows = 0
  const ids: string[] = []
  for (const [pid, list] of ix) {
    const ordered = list.slice().sort((a, b) => blastDate(a).localeCompare(blastDate(b)))
    let zeros = 0, stop = -1
    for (let i = 0; i < ordered.length; i++) {
      zeros = Number(ordered[i].completes) === 0 ? zeros + 1 : 0
      if (zeros >= 2) { stop = i + 1; break }
    }
    if (stop < 0 || stop >= ordered.length) continue
    const after = ordered.slice(stop)
    spend += sum(after, b => Number(b.bid ?? 0) * Number(b.completes ?? 0))
      + sum(after, b => (b.channel !== 'email' ? Number(b.people ?? 0) * Number(b.cost_per_send ?? 0) : 0))
    completes += sum(after, b => Number(b.completes ?? 0))
    surveys++; blastRows += after.length; ids.push(pid)
  }
  if (!surveys || spend <= 0) return null
  const actual = completes > 0 ? spend / completes : spend
  // The premium: what these completes cost ABOVE the book rate. If they were
  // no more expensive than usual there is no lever, and the range collapses.
  const premium = completes > 0 && bookCostPerComplete > 0
    ? Math.max(0, spend - completes * bookCostPerComplete)
    : spend
  return {
    key: 'dead-streak',
    side: 'save',
    title: LEVER_TITLE['dead-streak'],
    low: premium * 0.5,
    high: premium,
    forgoneCompletes: completes,
    givesUp: completes > 0 ? `about ${n(completes)} completes, bought dear` : 'no completes — those sends produced none',
    free: false,
    riskTag: completes > 0 ? `gives up ${n(completes)} completes` : undefined,
    population: `${n(blastRows)} blasts across ${n(surveys)} surveys sent after two sends in a row returned nothing`,
    rule: 'After two blasts in a row return no completes, buy more list instead of sending to the same one again.',
    why: `${n(blastRows)} ${s(blastRows, 'blast')} on ${n(surveys)} ${s(surveys, 'survey')} went out after two sends in a row returned nothing. ` +
      `They cost ${money(spend)} and produced ${n(completes)} completes — ${moneyAuto(actual)} each, against a typical ${moneyAuto(bookCostPerComplete)} per complete on blast surveys here. ` +
      'They are not worthless, they are expensive, so the lever is the premium over the typical rate and not the whole spend.',
    risk: `Acting on it gives up ${n(completes)} completes. On a survey already short of target that is a delivery risk, so this is a warning and never an automatic cap.`,
    evidence: 'depends',
    tooFew: surveys < MIN_CLASS_N,
    ids,
  }
}

/**
 * Raising the bid mid-field.
 *
 * Measured across every project that ran more than one bid level, the higher
 * bid bought completes at a higher price and often a WORSE response rate. The
 * confound is real and named: escalation is sequential, so the expensive blast
 * is chasing a list the cheap one already worked. Either reading points the
 * same way — buy more list before bidding up — so the recommendation is safe
 * even though the causal story is not settled.
 *
 * The low end is 0 deliberately, and the lever is NOT free: on a genuinely hard
 * audience the raise may be the only thing that fills the study. Rewards are
 * priced GROSS (as issued), because recoveries are booked per survey and cannot
 * be placed on one rung of the ladder.
 */
export function bidPremiumLever(
  rows: FinProject[], blasts: FinBlastDated[],
): Lever | null {
  const live = new Set(rows.map(p => p.id))
  const ix = new Map<string, FinBlastDated[]>()
  for (const b of blasts) {
    if (!live.has(b.project_id) || b.bid == null || b.completes == null) continue
    const a = ix.get(b.project_id)
    if (a) a.push(b); else ix.set(b.project_id, [b])
  }
  let premium = 0, surveys = 0
  const ids: string[] = []
  for (const [pid, list] of ix) {
    const bids = [...new Set(list.map(b => Number(b.bid)))]
    if (bids.length < 2) continue
    const low = Math.min(...bids)
    const p = sum(list.filter(b => Number(b.bid) > low), b => (Number(b.bid) - low) * Number(b.completes))
    if (p <= 0) continue
    premium += p; surveys++; ids.push(pid)
  }
  if (!surveys) return null
  return {
    key: 'bid-premium',
    side: 'save',
    title: LEVER_TITLE['bid-premium'],
    // The gross premium is the ceiling, reached only if no raise was ever
    // load-bearing; zero is the floor, for the case where every one was.
    low: 0,
    high: premium,
    forgoneCompletes: 0,
    givesUp: 'no completes, but a hard survey may finish short without the raise',
    free: false,
    riskTag: 'may leave a hard survey short',
    population: `${n(surveys)} surveys that ran more than one bid level; ${money(premium)} of rewards paid above each survey's own opening bid (as issued, before recoveries)`,
    rule: 'Hold the opening bid, and when a raise is genuinely needed, record why.',
    why: `${n(surveys)} ${s(surveys, 'survey')} ran more than one bid level and paid ${money(premium)} of rewards above each survey's own opening bid (as issued, before any came back). ` +
      'The premium is only worth paying when the audience is provably thin, and today nothing on record tells that case apart from habit.',
    risk: 'Real. On a hard audience the raise may be the only thing that fills the study, which is why the low end of this range is zero. Use it as a prompt to record a reason, not as a cap.',
    evidence: 'depends',
    tooFew: surveys < MIN_CLASS_N,
    ids,
  }
}

/**
 * Buying from the dearer panel in the same wave.
 *
 * Replaces the old "one CPI per supplier per project" lever, which took a
 * median of DISTINCT prices (with two prices the "median" was the higher one,
 * so most pairs could never save anything) and counted rows that bought no
 * completes at all. This compares PURCHASES: within one PureSpectrum wave
 * (launch), among panels that actually delivered completes, what was paid above
 * the cheapest panel in that wave.
 *
 * Direction only. Panel capacity and per-panel QA quality are not recorded, so
 * the cheapest panel may not have had the volume, or may have scrubbed worse.
 * The figure is the most that buying cheapest-first could have saved, and the
 * low end is zero.
 *
 * lib/finance/panels.ts splits this same figure by panel and copies the wave
 * rule line for line, with a test that the two agree — change the arithmetic
 * here and that test goes red, as it should.
 */
export function waveSpreadLever(
  rows: FinProject[], suppliers: FinSupplierRow[],
  /**
   * The words that name the rows handed in, so the sentence says what its
   * share is a share OF. Per respondent prints this same figure twice — on
   * Tile 4 for delivered work, and here for delivered AND live work — a card
   * apart and with different totals, so neither may say only "here".
   */
  populationWords = 'the work in view',
): Lever | null {
  const live = new Set(rows.map(p => p.id))
  const waves = new Map<string, FinSupplierRow[]>()
  let panelSpend = 0
  for (const s of suppliers) {
    if (!live.has(s.project_id)) continue
    const got = Number(s.n_collected ?? 0), cpi = Number(s.cpi ?? 0)
    panelSpend += got * cpi
    // Only rows that BOUGHT something. A zero-N row has a price nobody paid.
    if (!(got > 0) || !(cpi > 0)) continue
    const k = s.launch_id ?? `project:${s.project_id}`
    const a = waves.get(k)
    if (a) a.push(s); else waves.set(k, [s])
  }
  let above = 0, spread = 0, rowsAbove = 0
  const ids = new Set<string>()
  for (const list of waves.values()) {
    const panels = new Set(list.map(r => r.supplier_id ?? '?'))
    if (panels.size < 2) continue
    const cheapest = Math.min(...list.map(r => Number(r.cpi)))
    let touched = false
    for (const r of list) {
      const extra = (Number(r.cpi) - cheapest) * Number(r.n_collected)
      if (extra > 0) { above += extra; rowsAbove++; touched = true }
    }
    if (touched) { spread++; ids.add(list[0].project_id) }
  }
  if (above <= 0) return null
  return {
    key: 'wave-spread',
    side: 'save',
    title: LEVER_TITLE['wave-spread'],
    low: 0,
    high: above,
    forgoneCompletes: 0,
    givesUp: 'possibly speed — the cheapest panel may not have the volume',
    free: false,
    riskTag: 'panel capacity not recorded',
    population: `${n(spread)} waves bought from two or more panels at different prices; ${money(above)} (${pctOf(above, panelSpend)}% of panel spend on ${populationWords}) was paid above the cheapest panel in the same wave, across ${n(rowsAbove)} panel purchases`,
    rule: 'In each PureSpectrum wave, fill from the cheapest panel that is delivering before topping up from dearer ones.',
    why: `${n(spread)} ${s(spread, 'wave')} bought from two or more panels at different prices. ` +
      `${money(above)} — ${pctOf(above, panelSpend)}% of panel spend on ${populationWords} — was paid above the cheapest panel in the same wave, across ${n(rowsAbove)} panel ${s(rowsAbove, 'purchase')}.`,
    risk: 'The cheaper panel may not have had the volume, and per-panel QA is not recorded, so a cheaper panel cannot be shown to be as good. This is the most the order could have saved, not a promise.',
    evidence: 'direction',
    tooFew: ids.size < MIN_CLASS_N,
    ids: [...ids],
  }
}

/** How many PureSpectrum waves in the population carry a target — what the
 *  wave-overrun lever can see — and the panel spend on the ones that do not.
 *  Exported so the lever's "nothing to act on" state can still say how much of
 *  the book it could not look at. */
export function waveTargetCoverage(
  rows: FinProject[], suppliers: FinSupplierRow[], launches: FinLaunch[],
): { waves: number; seen: number; blind: number; blindSpend: number; panelSpend: number } {
  const live = new Set(rows.map(p => p.id))
  const byLaunch = new Map<string, FinSupplierRow[]>()
  for (const r of suppliers) {
    if (!r.launch_id) continue
    const a = byLaunch.get(r.launch_id)
    if (a) a.push(r); else byLaunch.set(r.launch_id, [r])
  }
  let seen = 0, blind = 0, blindSpend = 0, panelSpend = 0
  for (const l of launches) {
    if (!live.has(l.project_id)) continue
    const spend = sum(byLaunch.get(l.id) ?? [], r => Number(r.cpi ?? 0) * Number(r.n_collected ?? 0))
    panelSpend += spend
    if (Number(l.target ?? 0) > 0) seen++
    else { blind++; blindSpend += spend }
  }
  return { waves: seen + blind, seen, blind, blindSpend, panelSpend }
}

/**
 * PureSpectrum waves that collected past their own target.
 *
 * The old rule said "set completes_cap to the launch target", and that is what
 * already failed: SOCC's cap is a RECORD, not a limit — nothing reads it to stop
 * a supplier — and nearly every overrun wave already carried caps adding up to
 * more than its target. The only control that stops a wave is the survey's Goal
 * in PureSpectrum itself. And a wave with no target recorded cannot be judged at
 * all, so the lever states how many it cannot see.
 */
export function launchOverrunLever(
  rows: FinProject[],
  suppliers: FinSupplierRow[],
  launches: FinLaunch[],
): Lever | null {
  const live = new Set(rows.map(p => p.id))
  const byLaunch = new Map<string, FinSupplierRow[]>()
  for (const r of suppliers) {
    if (!r.launch_id) continue
    const a = byLaunch.get(r.launch_id)
    if (a) a.push(r); else byLaunch.set(r.launch_id, [r])
  }
  let cost = 0, over = 0
  const ids = new Set<string>()
  for (const l of launches) {
    if (!live.has(l.project_id)) continue
    const rowsFor = byLaunch.get(l.id) ?? []
    const got = sum(rowsFor, r => Number(r.n_collected ?? 0))
    const spend = sum(rowsFor, r => Number(r.cpi ?? 0) * Number(r.n_collected ?? 0))
    const t = Number(l.target ?? 0)
    if (!(t > 0) || !(got > t)) continue
    const blended = spend / Math.max(1, got)
    cost += (got - t) * blended
    over += got - t
    ids.add(l.project_id)
  }
  if (cost <= 0) return null
  const { waves, seen, blind, blindSpend, panelSpend } = waveTargetCoverage(rows, suppliers, launches)
  const blindShare = pctOf(blind, waves)
  return {
    key: 'launch-overrun',
    side: 'save',
    title: LEVER_TITLE['launch-overrun'],
    low: cost * 0.5,
    high: cost,
    forgoneCompletes: over,
    givesUp: `about ${n(over)} completes past target — the QA cushion, if the Goal is set too tight`,
    free: false,
    riskTag: blind > 0 ? `cannot see ${blindShare}% of waves` : undefined,
    population: `${n(over)} completes bought past a wave's own target. ${n(seen)} of ${n(waves)} waves carry a target; ` +
      `the other ${n(blind)} (${money(blindSpend)}, ${pctOf(blindSpend, panelSpend)}% of panel spend here) have none, so this lever cannot see them`,
    rule: 'Set each wave’s Goal in PureSpectrum itself, because SOCC’s supplier cap is a record, not a limit — it stops nothing.',
    why: `${n(over)} ${s(over, 'complete')} were bought past a wave's own target, at each wave's own price per complete. ` +
      `${n(seen)} of ${n(waves)} waves carry a target; the other ${n(blind)} (${blindShare}% of waves, ${money(blindSpend)} of panel spend) have none, so this lever cannot see them — record a target on every wave.`,
    risk: 'Low. A wave that stops exactly on target leaves no room for QA loss, so set the Goal at the target times the route’s buy multiple, not at the target itself.',
    evidence: 'measured',
    tooFew: ids.size < MIN_CLASS_N,
    ids: [...ids],
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * EARN MORE — opportunities in client price, never billable amounts
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The FIRST survey each account ever bought: its earliest by date (deliver,
 * then launch, then submitted date), the survey code breaking a tie and an
 * undated survey counting as latest. Read from the whole book, not the view,
 * so a date filter cannot turn a repeat survey into a "first" one.
 */
export function firstSurveyIds(book: FinProject[]): Set<string> {
  const first = new Map<string, FinProject>()
  const key = (p: FinProject) => `${finDate(p) ?? '9999-99-99'}|${p.project_code ?? p.id}`
  for (const p of book) {
    if (!p.client_id) continue
    const cur = first.get(p.client_id)
    if (!cur || key(p) < key(cur)) first.set(p.client_id, p)
  }
  return new Set([...first.values()].map(p => p.id))
}

const rateOf = (rates: Map<string, number>, id: string): number | null => {
  const r = rates.get(id)
  return r == null || !Number.isFinite(Number(r)) ? null : Number(r)
}

/**
 * LEVER 6 — respondents delivered past the top of the N sold, on repeat work.
 *
 * Over-delivery is never billable (David, 2026-09-24), so this is NOT money
 * owed; it is the size of the cushion we keep handing over free. The only
 * place it can be earned is the NEXT quote: sell a range (the N the client
 * needs, up to the N we usually deliver) and price the cushion into it.
 *
 * Repeat work only. An account's first survey is over-delivered on purpose,
 * and that stays a courtesy, so those respondents are counted beside the
 * figure and never in it. Direction only: most over-delivery is QA cushion
 * bought deliberately, so the figure is the most a range could earn.
 */
export function sellRangeLever(
  rows: FinProject[], rates: Map<string, number>, book: FinProject[] = rows, ix?: FinIndex,
): Lever | null {
  const firsts = firstSurveyIds(book)
  let overN = 0, value = 0, firstN = 0, firstSurveys = 0
  const ids: string[] = []
  for (const p of rows) {
    if (classOf(p, ix) !== 'delivered') continue
    const rate = rateOf(rates, p.id)
    // A $0 price is excluded: respondents given away on a free survey are
    // worth $0 at its price, and a trial is not a quote to widen.
    if (rate == null || !(rate > 0)) continue
    const over = overDeliveredOf(p) ?? 0
    if (!(over > 0)) continue
    if (firsts.has(p.id)) { firstN += over; firstSurveys++; continue }
    overN += over; value += over * rate; ids.push(p.id)
  }
  if (!ids.length && !firstSurveys) return null
  return {
    key: 'sell-range',
    side: 'earn',
    title: LEVER_TITLE['sell-range'],
    low: 0,
    high: value,
    forgoneCompletes: 0,
    givesUp: 'nothing in the field — the quote carries a range instead of one number',
    free: false,
    population: `${n(ids.length)} repeat ${s(ids.length, 'survey')} priced above $0, delivered past the top of the N sold`,
    rule: 'On repeat work, quote a range — the N the client needs up to the N we usually deliver — and price the cushion into the quote.',
    why: `${n(overN)} ${s(overN, 'respondent')} went past the top of the N sold on ${n(ids.length)} repeat ${s(ids.length, 'survey')} priced above $0 — ${money(value)} at each client's own price. ` +
      'Over-delivery is a courtesy and is never charged for afterwards, so the next quote is the only place this can be earned.' +
      (firstSurveys > 0
        ? ` Another ${n(firstN)} on ${n(firstSurveys)} first ${s(firstSurveys, 'survey')} for an account are left out: over-delivering a new client the first time is deliberate.`
        : ''),
    risk: 'Most of this is QA cushion bought on purpose, so the figure is the most a range could earn, not a promise. Keep over-delivering a new client the first time.',
    evidence: 'direction',
    tooFew: ids.length < MIN_CLASS_N,
    financeOnly: true,
    ids,
  }
}

/**
 * LEVER 7 — surveys delivered short of the N sold, net of what topping them up
 * would cost.
 *
 * At the client's price the gap is revenue foregone (hub.ts foregone), but
 * fielding the missing respondents is not free, so the range is the price less
 * the route's cost per qualified respondent: the typical survey's (median) at
 * the high end and a dear survey's (p75) at the low end, never below zero per
 * survey. A survey fielded both ways, or on a route with no CPQR in view, has
 * no route cost to net against, so it is counted and left unsized.
 */
export function topUpLever(
  rows: FinProject[], rates: Map<string, number>, cards: Pick<Cpqr, 'route' | 'median' | 'p75'>[],
  blasts: FinBlast[], suppliers: FinSupplier[], ix?: FinIndex,
): Lever | null {
  const card = new Map(cards.map(c => [c.route as Route, c]))
  let shortN = 0, gross = 0, netHigh = 0, netLow = 0, unsized = 0, unsizedGross = 0, losing = 0
  const ids: string[] = []
  for (const p of rows) {
    if (classOf(p, ix) !== 'delivered') continue
    const rate = rateOf(rates, p.id)
    if (rate == null || !(rate > 0)) continue
    const sh = shortfallOf(p, rate)
    if (!sh || !(sh.n > 0) || sh.dollars == null) continue
    ids.push(p.id)
    shortN += sh.n; gross += sh.dollars
    const c = card.get(routeOf(p, blasts, suppliers, ix))
    if (!c) { unsized++; unsizedGross += sh.dollars; continue }
    netHigh += Math.max(0, sh.n * (rate - c.median))
    netLow += Math.max(0, sh.n * (rate - c.p75))
    if (rate <= c.median) losing++
  }
  if (!ids.length) return null
  const med = (r: 'panel' | 'blast') => card.get(r) ? `${moneyAuto(card.get(r)!.median)} on ${r}` : null
  const typical = [med('panel'), med('blast')].filter(Boolean).join(', ')
  return {
    key: 'top-up',
    side: 'earn',
    title: LEVER_TITLE['top-up'],
    low: netLow,
    high: netHigh,
    forgoneCompletes: 0,
    givesUp: 'time — fielding the rest can push the delivery date',
    free: false,
    riskTag: 'may delay delivery',
    population: `${n(ids.length)} delivered ${s(ids.length, 'survey')} priced above $0 that came in short of the N sold`,
    rule: 'When a survey is heading for fewer respondents than it sold and its price per respondent is above what one costs us on that route, field the rest before delivery.',
    why: `${n(shortN)} ${s(shortN, 'respondent')} short on ${n(ids.length)} ${s(ids.length, 'survey')} priced above $0, worth ${money(gross)} at the client's own price. ` +
      (typical
        ? `Net of fielding them at the route's typical cost per qualified respondent (${typical}), that is ${money(netHigh)}; at a dear survey's cost, ${money(netLow)}.`
        : 'No route in view has a cost per qualified respondent to net against, so none of it is sized.') +
      (losing > 0 ? ` On ${n(losing)} of them the price is at or below the route's typical cost, so topping up would lose money.` : '') +
      (unsized > 0 ? ` ${n(unsized)} ${s(unsized, 'survey')} (${money(unsizedGross)} at price) fielded both ways or on a route with no cost per respondent here ${unsized === 1 ? 'is' : 'are'} counted but not sized.` : ''),
    risk: 'The audience may be exhausted — often why the survey came in short — so some of these cannot be filled at a sensible price, which is why the low end assumes a dear top-up.',
    evidence: 'depends',
    tooFew: ids.length < MIN_CLASS_N,
    financeOnly: true,
    ids,
  }
}

/** A price gap is only called where the account's work costs us at least this
 *  share of the best payer's cost per billed respondent — "work that costs us
 *  the same". A cheaper-to-serve account paying less is not a gap. */
export const PRICE_GAP_COST_FLOOR = 0.9

/** The side a price is compared WITH needs fewer surveys than the side being
 *  re-priced: it is the price an account actually pays (usually a contract
 *  rate), not a percentile drawn from a spread. Half the class minimum. */
export const MIN_BENCHMARK_N = Math.ceil(MIN_CLASS_N / 2)

interface AccountRouteGroup {
  accountId: string
  route: 'blast' | 'panel'
  surveys: number
  revenue: number
  cost: number
  billedN: number
  ids: string[]
}

/** Per account and route: delivered surveys priced above $0 with a bill and a
 *  recorded cost, fielded one way. Straight off the survey records through
 *  revenue.ts and hub.ts spendOf — deliberately NOT through analysis.ts
 *  surveyPnl, so the lever's drill (built from SurveyPnl) is checked against a
 *  figure that took a different path. */
export function accountRouteGroups(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[], ix?: FinIndex,
): AccountRouteGroup[] {
  const index = ix ?? buildIndex(blasts, suppliers, costs)
  const by = new Map<string, AccountRouteGroup>()
  for (const p of rows) {
    if (!p.client_id || classOf(p, index) !== 'delivered') continue
    const route = routeOf(p, blasts, suppliers, index)
    if (route !== 'blast' && route !== 'panel') continue
    const rv = revenueDetail(p, rates.get(p.id))
    // $0 never enters a ratio (revenue.ts ratioEligible), and a price per
    // billed respondent is a ratio.
    if (!rv.ratioEligible || rv.revenue == null || !(rv.billedN != null && rv.billedN > 0)) continue
    const cost = spendOf(p, blasts, suppliers, costs, index).total
    if (!(cost > 0)) continue
    const k = `${p.client_id}|${route}`
    const g = by.get(k) ?? { accountId: p.client_id, route, surveys: 0, revenue: 0, cost: 0, billedN: 0, ids: [] }
    g.surveys++; g.revenue += rv.revenue; g.cost += cost; g.billedN += rv.billedN; g.ids.push(p.id)
    by.set(k, g)
  }
  return [...by.values()]
}

/**
 * LEVER 8 — an account paying less per billed respondent than another account
 * on the same route, for work that costs us as much.
 *
 * Found in the data, never named in code. On each route, every account with at
 * least MIN_CLASS_N priced surveys is compared with every account that pays
 * more and has at least MIN_BENCHMARK_N; a pair counts only when the cheaper
 * payer's work costs us at least PRICE_GAP_COST_FLOOR of the dearer payer's
 * cost per billed respondent (a client that is cheaper to serve paying less is
 * not a gap). The pair's gap is (the higher price − the lower) × the lower
 * payer's billed N, and the largest gap is the lever. On one denominator (per
 * BILLED respondent, finance spec rule 4) price and cost subtract. Meeting
 * halfway is the low end.
 */
export function priceGapLever(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accountName: (id: string) => string = id => id, ix?: FinIndex,
): Lever | null {
  const groups = accountRouteGroups(rows, rates, blasts, suppliers, costs, ix)
  const rate = (g: AccountRouteGroup) => g.revenue / g.billedN
  const costPer = (g: AccountRouteGroup) => g.cost / g.billedN
  // One candidate per re-priced account: its largest gap to any dearer payer.
  const candidates: { g: AccountRouteGroup; b: AccountRouteGroup; gap: number }[] = []
  let comparable = false, sized = false
  for (const route of ['blast', 'panel'] as const) {
    const on = groups.filter(g => g.route === route)
    if (on.length >= 2) comparable = true
    for (const g of on) {
      if (g.surveys < MIN_CLASS_N) continue
      let top: { g: AccountRouteGroup; b: AccountRouteGroup; gap: number } | null = null
      for (const b of on) {
        if (b === g || b.surveys < MIN_BENCHMARK_N) continue
        sized = true
        if (!(rate(b) > rate(g))) continue
        if (costPer(g) < costPer(b) * PRICE_GAP_COST_FLOOR) continue
        const gap = (rate(b) - rate(g)) * g.billedN
        if (!top || gap > top.gap) top = { g, b, gap }
      }
      if (top) candidates.push(top)
    }
  }
  const common = {
    key: 'price-gap' as const, side: 'earn' as const, forgoneCompletes: 0,
    givesUp: 'possibly the client, if they will not pay more', free: false,
    risk: 'A price review can lose a client; it is a conversation for the next quote, not a charge on work already delivered.',
    evidence: 'depends' as const, financeOnly: true,
  }
  if (!candidates.length) {
    // Two accounts were fielded the same way, but no pair can be called: say
    // which, rather than going silent.
    if (!comparable) return null
    const ids = groups.flatMap(g => g.ids)
    const note = sized
      ? 'No account here pays less per billed respondent than another fielded the same way for work that costs us as much.'
      : `No two accounts fielded the same way have enough priced surveys to compare: the one being re-priced needs ${n(MIN_CLASS_N)}, the one it is compared with ${n(MIN_BENCHMARK_N)}.`
    return {
      ...common, title: LEVER_TITLE['price-gap'], low: 0, high: 0,
      population: `${n(groups.length)} account-and-route groups priced above $0`,
      rule: 'Compare what each account pays per billed respondent with the best payer on the same route.',
      why: note, note, tooFew: !sized, ids,
    }
  }
  candidates.sort((x, y) => y.gap - x.gap)
  const { g, b, gap } = candidates[0]
  const others = candidates.length - 1
  const A = accountName(g.accountId), B = accountName(b.accountId)
  return {
    ...common,
    title: `Bring ${A}’s ${g.route} prices up to ${B}’s`,
    low: gap / 2,
    high: gap,
    riskTag: 'the client may push back',
    population: `${A}'s ${n(g.surveys)} ${g.route} surveys priced above $0, against ${B}'s ${n(b.surveys)}`,
    rule: `Re-price ${A}’s next ${g.route} quotes toward the ${moneyAuto(rate(b))} per billed respondent ${B} pays, because its work costs us as much or more.`,
    why: `${A} pays ${moneyAuto(rate(g))} per billed respondent on ${n(g.surveys)} ${g.route} surveys; ${B} pays ${moneyAuto(rate(b))} on ${n(b.surveys)}. ` +
      `Per billed respondent, ${A}’s work cost us ${moneyAuto(costPer(g))} against ${moneyAuto(costPer(b))} for ${B}. ` +
      `At ${B}’s price, ${A}’s ${n(g.billedN)} billed respondents would have brought ${money(gap)} more; meeting halfway, ${money(gap / 2)}.` +
      (others > 0 ? ` ${n(others)} other ${s(others, 'account')} also ${others === 1 ? 'pays' : 'pay'} less than another fielded the same way, for work that costs as much.` : ''),
    tooFew: false,
    ids: g.ids,
    benchmark: { accountId: b.accountId, rate: rate(b), costPerBilledN: costPer(b), surveys: b.surveys },
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE ENGINE
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SavingsView {
  levers: Lever[]
  /** Recorded spend the levers are drawn from, so each can be read as a share.
   *  The levers overlap, so they are NEVER summed into one figure. */
  spend: number
  /** Surveys in the population. */
  surveys: number
  /** The typical cost per complete on reconciled delivered blast surveys in the
   *  population — the yardstick the dead-streak lever is judged against. */
  bookRate: number
}

/**
 * Every SAVE COST lever, live, on ONE declared population.
 *
 * `rows` is that population — the caller's delivered + live surveys in the date
 * window, under the account and route filters. Recomputed on each load from the
 * current data rather than read from a stored figure, so the engine cannot
 * quote a saving that was captured months ago.
 */
export function savings(
  rows: FinProject[],
  blasts: FinBlastDated[],
  suppliers: FinSupplierRow[],
  costs: FinCost[],
  launches: FinLaunch[] = [],
  ixIn?: FinIndex,
): SavingsView {
  const ix = ixIn ?? buildIndex(blasts, suppliers, costs)
  const population = rows.filter(p => classOf(p, ix) !== 'placeholder')
  // The book rate the dead-streak lever is judged against: the median cost per
  // complete on delivered blast surveys whose records reconcile, priced GROSS
  // of recovered rewards like the blasts it is compared with. Measured, so it
  // moves with the data instead of being a constant.
  const per: number[] = []
  for (const p of population) {
    if (classOf(p, ix) !== 'delivered') continue
    if (routeOf(p, blasts, suppliers, ix) !== ('blast' as Route)) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    const got = Number(p.n_collected ?? 0)
    const gross = sp.total - sp.recovered
    if (gross <= 0 || sp.paidCompletes <= 0) continue
    if (!(got > 0 && sp.paidCompletes >= got)) continue
    per.push(gross / sp.paidCompletes)
  }
  const bookRate = quantile(per, 0.5)

  let spend = 0
  for (const p of population) spend += spendOf(p, blasts, suppliers, costs, ix).total

  const levers = [
    smsRateLever(population, blasts, spend),
    deadStreakLever(population, blasts, bookRate),
    bidPremiumLever(population, blasts),
    // These levers run on the declared lever population (filters.ts
    // LEVER_RULE), so the wave sentence names it rather than saying "here".
    waveSpreadLever(population, suppliers, 'the delivered and live work in view'),
    launchOverrunLever(population, suppliers, launches),
  ].filter((l): l is Lever => l !== null)
    .sort((a, b) => b.high - a.high)

  return { levers, spend, surveys: population.length, bookRate }
}

/**
 * Every EARN MORE lever on the same declared population. Client-price dollars,
 * so it is a separate list from `savings` and never added to it.
 *
 * `book` is every survey (for "is this the account's first survey"), and
 * `cards` the route CPQR cards the top-up lever nets against — the caller's
 * Tile 4 cards, so the two tiles quote one cost per qualified respondent.
 */
export function earnMore(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  opts: {
    book?: FinProject[]
    cards?: Pick<Cpqr, 'route' | 'median' | 'p75'>[]
    accountName?: (id: string) => string
    ix?: FinIndex
  } = {},
): Lever[] {
  const ix = opts.ix ?? buildIndex(blasts, suppliers, costs)
  const population = rows.filter(p => classOf(p, ix) !== 'placeholder')
  return [
    sellRangeLever(population, rates, opts.book ?? population, ix),
    topUpLever(population, rates, opts.cards ?? [], blasts, suppliers, ix),
    priceGapLever(population, rates, blasts, suppliers, costs, opts.accountName, ix),
  ].filter((l): l is Lever => l !== null)
    .sort((a, b) => b.high - a.high)
}
