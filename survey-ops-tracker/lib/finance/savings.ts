/**
 * The savings engine.
 *
 * David, 2026-09-17: "there needs to be also be guidance/suggestions on how to
 * cut costs somewhere. this needs to think out of the box and learn … we need
 * to scale the business and cut costs."
 *
 * ── WHAT A LEVER IS ─────────────────────────────────────────────────────────
 * A number someone could act on next week, with what it costs to act. Every
 * lever here carries `forgone` — the completes or the delivery risk it gives up
 * — because a saving quoted without its cost is not a saving, it is an
 * argument for doing less work.
 *
 * The clearest case: "stop after two dead blasts" looks like $70,175 of waste
 * until you notice those blasts still produced 1,177 completes, at $59.62 each
 * against a book median near $50. That is roughly 20% expensive, not worthless,
 * and the lever is worth the DIFFERENCE, not the whole spend. An engine that
 * reported the whole spend would be lying by omission.
 *
 * ── WHY NOTHING HERE IS A HARD GATE ─────────────────────────────────────────
 * The obvious rule — stop buying at `target ÷ expected QA yield` — has no input.
 * `n_actual` is written at DELIVERY, after the money is spent; it lands before a
 * survey's last blast on 11 of 412 surveys. Keep rate is not forecastable from
 * account history either (BofA's own p25 keep is 0.444 against a 0.801 median).
 * Replayed wave by wave, a 1.13x cap would have saved $13,625 and broken twelve
 * deliveries worth $28,714. So these surface as warnings with their numbers, and
 * a human decides. An engine that silently capped spend would cost more than it
 * saved and the loss would land on client deliveries.
 *
 * ── EVERY THRESHOLD IS A PERCENTILE OF ITS OWN DATA ─────────────────────────
 * Nothing here is a hardcoded constant. "Expensive" means "above the p75 of
 * comparable surveys", recomputed on every load, so the engine sharpens as data
 * accumulates instead of going stale the way the 1.13x buy multiple did. Each
 * rule states the minimum n its comparison class needs before it may fire at
 * all — a percentile over four surveys is noise wearing a number's clothes.
 */

import {
  buildIndex, isDelivered, routeOf, spendOf,
  type FinBlast, type FinCost, type FinProject, type FinSupplier, type Route,
} from './hub'

/** A class needs at least this many surveys before a percentile drawn from it
 *  may drive a recommendation. Below it the engine says so instead. */
export const MIN_CLASS_N = 8

export interface Lever {
  key: string
  title: string
  /** The defensible saving. A RANGE, because most of these depend on something
   *  outside the data — a carrier's willingness, an audience's depth. */
  low: number
  high: number
  /** What acting on it gives up, in completes. 0 when genuinely free. */
  forgoneCompletes: number
  /** The population, stated so the figure can never travel without it. */
  population: string
  /** What to actually do. */
  rule: string
  /** What it costs to be wrong. */
  risk: string
  confidence: 'high' | 'medium' | 'low'
  /** Quotes a client rate, so finance-only. */
  financeOnly?: boolean
  /** Survey ids behind it, for the drill-down. */
  ids: string[]
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)
const quantile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
const blastDate = (b: FinBlast & { blast_at?: string | null; scheduled_at?: string | null; created_at?: string | null }) =>
  String(b.blast_at ?? b.scheduled_at ?? b.created_at ?? '')

export type FinBlastDated = FinBlast & {
  blast_at?: string | null
  scheduled_at?: string | null
  created_at?: string | null
}

/**
 * The send rate.
 *
 * Every blast in the database carries the same $0.02 per send — 842 rows, zero
 * variance, which is the signature of a number nobody has ever negotiated
 * rather than a rate that happens to be stable. It is the single largest
 * controllable line in the book and the only lever here that costs nothing in
 * quality, speed or client relationship: it is a phone call to the carrier.
 *
 * It is also the number most worth VERIFYING — 30% of recorded cost rests on a
 * constant backfilled by migration 095, not on an invoice.
 */
export function smsRateLever(
  rows: FinProject[], blasts: FinBlastDated[],
): Lever | null {
  const ids = new Set(rows.map(p => p.id))
  const sms = blasts.filter(b => ids.has(b.project_id) && b.channel !== 'email')
  if (!sms.length) return null
  const sends = sum(sms, b => Number(b.people ?? 0))
  const spend = sum(sms, b => Number(b.people ?? 0) * Number(b.cost_per_send ?? 0))
  if (spend <= 0) return null
  const rates = [...new Set(sms.map(b => Number(b.cost_per_send ?? 0)))]
  const flat = rates.length === 1
  return {
    key: 'sms-rate',
    title: 'Negotiate the SMS send rate',
    // A 25% cut is a routine volume tier; 12.5% is the cautious ask.
    low: spend - sends * 0.0175,
    high: spend - sends * 0.015,
    forgoneCompletes: 0,
    population: `${sends.toLocaleString()} messages across ${sms.length} non-email blasts, ${flat ? 'every one at the same rate' : `${rates.length} distinct rates`}`,
    rule: flat
      ? 'Every blast on file carries an identical send rate, which is what a never-negotiated price looks like. Ask the carrier for a volume tier — and get one invoice, because this rate was backfilled rather than observed and it carries 30% of recorded cost.'
      : 'Consolidate onto the lowest rate already being paid.',
    risk: 'None. No effect on quality, speed or any client.',
    confidence: flat ? 'high' : 'medium',
    ids: [...new Set(sms.map(b => b.project_id))],
  }
}

/**
 * Blasts sent after the list stopped answering.
 *
 * Two consecutive sends returning zero completes is the clearest "this list is
 * finished" signal the data carries. But the sends AFTER that point are not
 * worthless — they still produced completes, just expensively — so the lever is
 * the premium over what those completes should have cost, never the whole
 * spend. Reporting the gross would overstate it roughly threefold.
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
    title: 'Stop sending after two dead blasts',
    low: premium * 0.5,
    high: premium,
    forgoneCompletes: completes,
    population: `${blastRows} blasts across ${surveys} surveys sent after two consecutive sends returned nothing`,
    rule: `Those blasts cost ${'$' + Math.round(spend).toLocaleString()} and produced ${completes.toLocaleString()} completes — ${'$' + actual.toFixed(2)} each against a book median of ${'$' + bookCostPerComplete.toFixed(2)}. They are not worthless, they are expensive, so the lever is the premium and not the spend. Two dead sends in a row is the moment to buy more list rather than send again.`,
    risk: `Acting on it forgoes ${completes.toLocaleString()} completes. On a survey already short of target that is a delivery risk, so this is a warning and never an automatic cap.`,
    confidence: 'medium',
    ids,
  }
}

/**
 * Raising the bid mid-field.
 *
 * Measured across every project that ran more than one bid level, the higher
 * bid bought completes at roughly twice the price and produced a WORSE response
 * rate in most head-to-heads. The confound is real and named: escalation is
 * sequential, so the expensive blast is chasing a list the cheap one already
 * worked. Either reading points the same way — buy more list before bidding up
 * — so the recommendation is safe even though the causal story is not settled.
 *
 * The low end is 0 deliberately: on a genuinely hard audience the raise may be
 * the only thing that fills the study, and none of this premium is recoverable.
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
    title: 'Freeze the bid at its opening level',
    // A quarter is the cautious recoverable share; the gross premium is the
    // ceiling and would only be reached if no raise was ever load-bearing.
    low: 0,
    high: premium,
    forgoneCompletes: 0,
    population: `${surveys} surveys that ran more than one bid level; ${'$' + Math.round(premium).toLocaleString()} paid above each survey's own opening bid`,
    rule: 'Do not raise the bid mid-field. Where a raise is genuinely needed, record why — the premium is only worth paying when the audience is provably thin, and today nothing distinguishes that case from habit.',
    risk: 'Real. On a hard audience the raise may be the only thing that fills the study, and the low end of this range is zero for that reason. Ship it as a prompt for a reason, not as a cap.',
    confidence: 'medium',
    ids,
  }
}

/** The same supplier bought at two different CPIs on the same project. Trimming
 *  the above-median rows to their own group's median is the saving; it is small
 *  and it is nearly free, because it is the same supplier either way. */
export function supplierCpiLever(
  rows: FinProject[], suppliers: (FinSupplier & { supplier_id?: string | null })[],
): Lever | null {
  const live = new Set(rows.map(p => p.id))
  const byProject = new Map<string, (FinSupplier & { supplier_id?: string | null })[]>()
  for (const s of suppliers) {
    if (!live.has(s.project_id)) continue
    const a = byProject.get(s.project_id)
    if (a) a.push(s); else byProject.set(s.project_id, [s])
  }
  let saving = 0, groups = 0, over = 0
  const ids: string[] = []
  for (const [pid, list] of byProject) {
    const bySupplier = new Map<string, typeof list>()
    for (const s of list) {
      const k = s.supplier_id ?? '?'
      const a = bySupplier.get(k)
      if (a) a.push(s); else bySupplier.set(k, [s])
    }
    let touched = false
    for (const rowsFor of bySupplier.values()) {
      const cpis = [...new Set(rowsFor.map(r => Number(r.cpi ?? 0)))].filter(v => v > 0)
      if (cpis.length < 2) continue
      const med = quantile(cpis, 0.5)
      for (const r of rowsFor) {
        const c = Number(r.cpi ?? 0)
        if (c > med) { saving += (c - med) * Number(r.n_collected ?? 0); over++ }
      }
      groups++; touched = true
    }
    if (touched) ids.push(pid)
  }
  if (saving <= 0) return null
  return {
    key: 'supplier-cpi',
    title: 'One CPI per supplier per project',
    low: saving * 0.5,
    high: saving,
    forgoneCompletes: 0,
    population: `${groups} project/supplier pairs bought at two or more CPIs; ${over} rows priced above their own pair's median`,
    rule: 'The same supplier is being bought at different prices on the same study. Agree one rate per supplier per project and hold it across waves.',
    risk: 'Some of the spread is a late top-up bought at short notice, where the premium is buying speed. Per-supplier QA quality is not recorded, so a cheaper row cannot be shown to be as good.',
    confidence: 'medium',
    ids,
  }
}

/** Panel launches that collected past their own target. Small, and the least
 *  arguable of the levers — the cap already exists as a field. */
export function launchOverrunLever(
  rows: FinProject[],
  suppliers: (FinSupplier & { launch_id?: string | null })[],
  launches: { id: string; project_id: string; target: number | null }[],
): Lever | null {
  const live = new Set(rows.map(p => p.id))
  const byLaunch = new Map<string, (FinSupplier & { launch_id?: string | null })[]>()
  for (const s of suppliers) {
    if (!s.launch_id) continue
    const a = byLaunch.get(s.launch_id)
    if (a) a.push(s); else byLaunch.set(s.launch_id, [s])
  }
  let cost = 0, n = 0
  const ids = new Set<string>()
  for (const l of launches) {
    if (!live.has(l.project_id)) continue
    const rowsFor = byLaunch.get(l.id) ?? []
    const got = sum(rowsFor, r => Number(r.n_collected ?? 0))
    const t = Number(l.target ?? 0)
    if (!(t > 0 && got > t)) continue
    const blended = sum(rowsFor, r => Number(r.cpi ?? 0) * Number(r.n_collected ?? 0)) / Math.max(1, got)
    cost += (got - t) * blended
    n += got - t
    ids.add(l.project_id)
  }
  if (cost <= 0) return null
  return {
    key: 'launch-overrun',
    title: 'Cap launches at their own target',
    low: cost * 0.5,
    high: cost,
    forgoneCompletes: n,
    population: `${n.toLocaleString()} completes bought past a launch's own target`,
    rule: 'project_suppliers already has a completes_cap. Set it to the launch target so a wave stops itself.',
    risk: 'Low. A wave that stops exactly on target leaves no headroom for QA loss, so cap at the target plus the route\'s measured p75 buy multiple, not at the target itself.',
    confidence: 'high',
    ids: [...ids],
  }
}

export interface SavingsView {
  levers: Lever[]
  /** Sum of the low ends and of the high ends. Deliberately two numbers: a
   *  single figure would be read as a target. */
  totalLow: number
  totalHigh: number
  /** Recorded spend the levers are drawn from, so the total can be read as a
   *  share rather than as an absolute. A lever list that sums past its own
   *  spend is worthless, and this is what makes that visible. */
  spend: number
  /** Completes given up if every lever were pulled. */
  forgone: number
}

/**
 * Every lever, live.
 *
 * Recomputed on each load from the current data rather than read from a stored
 * figure, so the engine cannot quote a saving that was captured months ago.
 */
export function savings(
  rows: FinProject[],
  blasts: FinBlastDated[],
  suppliers: (FinSupplier & { supplier_id?: string | null; launch_id?: string | null })[],
  costs: FinCost[],
  launches: { id: string; project_id: string; target: number | null }[] = [],
): SavingsView {
  const ix = buildIndex(blasts, suppliers, costs)
  // The book rate the dead-streak lever is judged against: the median cost per
  // complete on delivered blast surveys whose records reconcile. Measured, so
  // it moves with the data instead of being a constant.
  const per: number[] = []
  for (const p of rows) {
    if (!isDelivered(p)) continue
    if (routeOf(p, blasts, suppliers, ix) !== ('blast' as Route)) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    const got = Number(p.n_collected ?? 0)
    if (sp.total <= 0 || sp.paidCompletes <= 0) continue
    if (!(got > 0 && sp.paidCompletes >= got)) continue
    per.push(sp.total / sp.paidCompletes)
  }
  const bookRate = quantile(per, 0.5)

  const levers = [
    smsRateLever(rows, blasts),
    deadStreakLever(rows, blasts, bookRate),
    bidPremiumLever(rows, blasts),
    supplierCpiLever(rows, suppliers),
    launchOverrunLever(rows, suppliers, launches),
  ].filter((l): l is Lever => l !== null)
    .sort((a, b) => b.high - a.high)

  let spend = 0
  for (const p of rows) spend += spendOf(p, blasts, suppliers, costs, ix).total

  return {
    levers,
    totalLow: sum(levers, l => l.low),
    totalHigh: sum(levers, l => l.high),
    spend,
    forgone: sum(levers, l => l.forgoneCompletes),
  }
}
