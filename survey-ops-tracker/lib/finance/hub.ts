/**
 * The finance hub's arithmetic.
 *
 * ── WHAT THIS CAN AND CANNOT ANSWER ─────────────────────────────────────────
 * It answers "what did our work COST, and where did the money go". It does not
 * answer "are we profitable", because SOCC cannot: 4 of 322 delivered surveys
 * carry a client rate, and there is no contracts, invoices or rate_cards table
 * in the database at all. A margin number here would be a number about four
 * surveys wearing the clothes of a number about the business.
 *
 * ── EVERY FIGURE CARRIES ITS COVERAGE ───────────────────────────────────────
 * Only about a third of delivered surveys have any recorded cost. A total drawn
 * from them is a FLOOR, not a total, and the difference is large enough to
 * change decisions — so `coverage` travels with every rollup and the UI is
 * expected to show it. A cost report that quietly reports a third of the cost
 * is worse than no cost report, because it will be believed.
 *
 * ── ROUTE IS MEASURED, NEVER LABELLED ───────────────────────────────────────
 * project_type is wrong on 11 of the 117 projects that hold any field row —
 * PR00425 is typed B2B and holds 294 PureSpectrum supplier rows. Route here is
 * always derived from the rows a survey actually has. Pricing a panel survey at
 * blast rates overstated one figure 24x earlier this week.
 */

export type Route = 'blast' | 'panel' | 'both' | 'none'

export interface FinProject {
  id: string
  project_code: string | null
  project_name: string | null
  client: string | null
  client_id: string | null
  project_type: string | null
  board_column: string | null
  status: string | null
  phase: string | null
  deliver_date: string | null
  launch_date: string | null
  submitted_date: string | null
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
}
export interface FinBlast {
  project_id: string
  bid: number | null
  people: number | null
  completes: number | null
  cost_per_send: number | null
  channel: string | null
}
export interface FinSupplier {
  project_id: string
  cpi: number | null
  n_collected: number | null
}
export interface FinCost {
  project_id: string
  amount: number | null
}

export interface Filters {
  /** Inclusive ISO bounds on the survey's own date (deliver, else launch, else submitted). */
  from?: string | null
  to?: string | null
  /** project_type as a LABEL filter — this is the one place the label is the
   *  right thing to filter on, because the user picked it from a list of labels. */
  type?: string | null
  client?: string | null
  route?: Route | null
}

/** The date a survey belongs to. Same precedence the sales Home uses: the
 *  delivery commitment first, because it is the better-populated field. */
export const finDate = (p: FinProject): string | null =>
  p.deliver_date || p.launch_date || p.submitted_date || null

export const isDelivered = (p: FinProject) => p.board_column === 'Delivery'

export interface Spend {
  /** bid x completes — the respondent reward. */
  reward: number
  /** people x cost_per_send, and ZERO on an email blast (migration 112). */
  send: number
  /** cpi x n_collected across supplier rows. */
  panel: number
  /** flat cost lines. */
  other: number
  total: number
  /** Completes we actually paid for, across both routes. The denominator for
   *  every per-complete figure — NOT n_actual, which is post-QA and 12-20%
   *  smaller, and NOT n_collected, which may exceed what we have records for. */
  paidCompletes: number
}

/** One survey's money, recomputed from its own rows rather than read from the
 *  stored column — so this file cannot silently disagree with the trigger, and
 *  a disagreement is visible instead of assumed away. */
export function spendOf(
  p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Spend {
  const b = blasts.filter(x => x.project_id === p.id)
  const s = suppliers.filter(x => x.project_id === p.id)
  const c = costs.filter(x => x.project_id === p.id)
  const reward = b.reduce((t, x) => t + (x.bid ?? 0) * (x.completes ?? 0), 0)
  // Email sends are free — 112. `!== 'email'` rather than `=== 'sms'` so an
  // unrecorded channel keeps paying, which is what the SQL does too.
  const send = b.reduce((t, x) => t + (x.channel !== 'email' ? (x.people ?? 0) * (x.cost_per_send ?? 0) : 0), 0)
  const panel = s.reduce((t, x) => t + (x.cpi ?? 0) * (x.n_collected ?? 0), 0)
  const other = c.reduce((t, x) => t + Number(x.amount ?? 0), 0)
  return {
    reward, send, panel, other,
    total: reward + send + panel + other,
    paidCompletes:
      b.reduce((t, x) => t + (x.completes ?? 0), 0) +
      s.reduce((t, x) => t + (x.n_collected ?? 0), 0),
  }
}

export function routeOf(p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[]): Route {
  const b = blasts.some(x => x.project_id === p.id)
  const s = suppliers.some(x => x.project_id === p.id)
  return b && s ? 'both' : b ? 'blast' : s ? 'panel' : 'none'
}

export function applyFilters(rows: FinProject[], f: Filters, routeFor: (p: FinProject) => Route): FinProject[] {
  return rows.filter(p => {
    const d = finDate(p)
    if (f.from && (!d || d < f.from)) return false
    if (f.to && (!d || d > f.to)) return false
    if (f.type && p.project_type !== f.type) return false
    if (f.client && p.client !== f.client) return false
    if (f.route && routeFor(p) !== f.route) return false
    return true
  })
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
function quantiles(xs: number[]) {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return { p25: q(0.25), median: q(0.5), p75: q(0.75), n: s.length }
}

export interface RouteCost {
  route: 'blast' | 'panel'
  p25: number; median: number; p75: number; n: number
}

/**
 * Cost per complete by route.
 *
 * DERIVED ONLY FROM SURVEYS WHOSE RECORDED COMPLETES COVER THEIR n_collected.
 * A rate taken from an under-recorded survey has too small a denominator and
 * runs high — it was ~40% high the first time this was computed, which is the
 * difference between "blasts cost $50 a complete" and "$80". Single-route only,
 * because a blended survey cannot attribute its own dollars to one side.
 */
export function routeCosts(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): RouteCost[] {
  const buckets: Record<'blast' | 'panel', number[]> = { blast: [], panel: [] }
  for (const p of rows) {
    const route = routeOf(p, blasts, suppliers)
    if (route !== 'blast' && route !== 'panel') continue
    const sp = spendOf(p, blasts, suppliers, costs)
    const got = Number(p.n_collected ?? 0)
    if (sp.total <= 0 || sp.paidCompletes <= 0) continue
    if (!(got > 0 && sp.paidCompletes >= got)) continue
    buckets[route].push(sp.total / sp.paidCompletes)
  }
  const out: RouteCost[] = []
  for (const route of ['blast', 'panel'] as const) {
    const q = quantiles(buckets[route])
    if (q) out.push({ route, ...q })
  }
  return out
}

export interface ClientSpend {
  client: string
  total: number
  surveys: number
  /** How many of those surveys have ANY recorded cost. The rest contribute $0
   *  because nothing was logged, not because nothing was spent. */
  costed: number
  share: number
}

export function spendByClient(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): { clients: ClientSpend[]; total: number; coverage: { costed: number; of: number } } {
  const by = new Map<string, { total: number; surveys: number; costed: number }>()
  let total = 0, costed = 0
  for (const p of rows) {
    const key = p.client ?? '(no account)'
    const sp = spendOf(p, blasts, suppliers, costs)
    const e = by.get(key) ?? { total: 0, surveys: 0, costed: 0 }
    e.total += sp.total
    e.surveys++
    if (sp.total > 0) { e.costed++; costed++ }
    by.set(key, e)
    total += sp.total
  }
  const clients = [...by.entries()]
    .map(([client, v]) => ({ client, ...v, share: total > 0 ? v.total / total : 0 }))
    .sort((a, b) => b.total - a.total)
  return { clients, total, coverage: { costed, of: rows.length } }
}

export interface Unbillable {
  /** Completes collected beyond the promised N. Not chargeable — revenue is
   *  rate x min(delivered, target), so these are pure cost. */
  overTarget: number
  /** Completes that never survived QA into the deliverable. The bigger half:
   *  measured at roughly two-thirds of the waste, so "stop over-delivering"
   *  fixes about a third of it. */
  scrub: number
  /** Priced at each survey's OWN cost per complete, never a route default. */
  overTargetCost: number
  scrubCost: number
  surveys: number
}

export function unbillable(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Unbillable {
  const u: Unbillable = { overTarget: 0, scrub: 0, overTargetCost: 0, scrubCost: 0, surveys: 0 }
  for (const p of rows) {
    if (!isDelivered(p)) continue
    const target = p.n_target ?? 0
    const got = p.n_collected ?? 0
    const actual = p.n_actual
    if (!(target > 0 && got > 0 && actual != null)) continue
    const sp = spendOf(p, blasts, suppliers, costs)
    if (sp.total <= 0 || sp.paidCompletes <= 0) continue
    const rate = sp.total / sp.paidCompletes
    const over = Math.max(0, Math.min(actual, got) - target)
    const scrub = Math.max(0, got - actual)
    if (over === 0 && scrub === 0) continue
    u.overTarget += over; u.scrub += scrub
    u.overTargetCost += over * rate; u.scrubCost += scrub * rate
    u.surveys++
  }
  return u
}

export interface BlastEfficiency {
  sends: number
  completes: number
  /** Completes per send. Quoted as a percentage; it is well under 1%. */
  responseRate: number
  sendSpend: number
  rewardSpend: number
  /** Sends that produced nothing at all, and what they cost. */
  deadSends: number
  deadSpend: number
  blasts: number
}

export function blastEfficiency(rows: FinProject[], blasts: FinBlast[]): BlastEfficiency {
  const ids = new Set(rows.map(p => p.id))
  const mine = blasts.filter(b => ids.has(b.project_id))
  const e: BlastEfficiency = {
    sends: 0, completes: 0, responseRate: 0, sendSpend: 0, rewardSpend: 0,
    deadSends: 0, deadSpend: 0, blasts: mine.length,
  }
  for (const b of mine) {
    const people = b.people ?? 0
    const comp = b.completes ?? 0
    const send = b.channel !== 'email' ? people * (b.cost_per_send ?? 0) : 0
    e.sends += people
    e.completes += comp
    e.sendSpend += send
    e.rewardSpend += (b.bid ?? 0) * comp
    // `completes === 0` only — a NULL means "not recorded yet", and counting
    // that as a dead send would condemn every blast sent in the last week.
    if (b.completes === 0 && people > 0) { e.deadSends += people; e.deadSpend += send }
  }
  e.responseRate = e.sends > 0 ? e.completes / e.sends : 0
  return e
}

export interface Coverage {
  delivered: number
  deliveredCosted: number
  deliveredPct: number
  /** Surveys collecting N whose recorded sources do not account for it. */
  unreconciled: number
  unattributedCompletes: number
}

export function coverage(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Coverage {
  const delivered = rows.filter(isDelivered)
  let deliveredCosted = 0, unreconciled = 0, unattributed = 0
  for (const p of rows) {
    const sp = spendOf(p, blasts, suppliers, costs)
    if (isDelivered(p) && sp.total > 0) deliveredCosted++
    const got = Number(p.n_collected ?? 0)
    if (got > 0 && sp.paidCompletes < got) { unreconciled++; unattributed += got - sp.paidCompletes }
  }
  return {
    delivered: delivered.length,
    deliveredCosted,
    deliveredPct: pct(deliveredCosted, delivered.length),
    unreconciled,
    unattributedCompletes: unattributed,
  }
}
