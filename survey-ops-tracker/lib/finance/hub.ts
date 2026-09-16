/**
 * The finance hub's arithmetic.
 *
 * ── WHAT THIS CAN AND CANNOT ANSWER ─────────────────────────────────────────
 * It answers "what did our work COST, where did the money go, and — on the part
 * of the book that carries a client rate — what did it earn". Revenue is real
 * but PARTIAL: project_financials.price_per_n exists on 57 of 403 surveys, so
 * every margin figure is a statement about the priced subset and has to name
 * that subset beside itself. It is no longer true that margin is incomputable;
 * it is true that margin is computable on about an eighth of the delivered book.
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
 *
 * ── THE ACCOUNT IS clients.name, NEVER survey_projects.client ───────────────
 * `survey_projects.client` is a stale denormalised string that still carries a
 * contact suffix: the 82 BAM surveys wear NINE different labels there ("BAM",
 * "BAM - James Cook", "BAM - Grey Jones", …), and grouping by it splits one
 * account into nine — reporting 11% of BAM's spend as BAM's. The `clients`
 * table is ALREADY consolidated and every live project carries a client_id, so
 * the account is resolved through the key and the label is used for nothing.
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
  /** Cancellation. Read alongside `status`, because the two agree on all nine
   *  cancelled surveys today and a future path that sets only one must not
   *  drop out of the money. */
  cancelled_at?: string | null
  /** The COST CEILING — the most we intend to spend (David, 2026-08-24). NOT
   *  client revenue, and never to be reconciled against contract value as if
   *  the two should agree. 33 surveys carry one; 24 of those also carry a cost
   *  and are the only ones variance can speak about. */
  budget?: number | null
  /** Who at the account asked for this. The only trustworthy contact link —
   *  the suffix in `client` agrees with it on all 58 surveys that carry both
   *  and contradicts it on none, so the suffix adds nothing the key lacks. */
  requested_by_contact_id?: string | null
}

/** One row of `clients`. `name` is the consolidated account. */
export interface FinAccount {
  id: string
  name: string | null
}

/** One row of `client_contacts`. */
export interface FinContact {
  id: string
  client_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  archived?: boolean | null
}

/** What the client pays per completed interview, from project_financials.
 *  Migration 086 restricts that table at the database layer, so for a reader
 *  without VIEW_FINANCIALS this array simply arrives EMPTY — which reads as
 *  "nothing is priced" and degrades to the cost report, rather than erroring. */
export interface FinRate {
  project_id: string
  price_per_n: number | null
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
  /** The consolidated account, as a clients.id — NOT the stale `client` string. */
  accountId?: string | null
  /** Narrows to one person's surveys within the selected account. The sentinel
   *  `NONE` means "the surveys at this account with no contact recorded", which
   *  is 31 of BAM's 82 and must stay reachable rather than being unfilterable. */
  contactId?: string | null
  route?: Route | null
}

/** Sentinel for "no contact recorded". A real contact id is a uuid, so this
 *  cannot collide with one. */
export const NO_CONTACT = 'NONE'

/** The date a survey belongs to. Same precedence the sales Home uses: the
 *  delivery commitment first, because it is the better-populated field. */
export const finDate = (p: FinProject): string | null =>
  p.deliver_date || p.launch_date || p.submitted_date || null

export const isDelivered = (p: FinProject) => p.board_column === 'Delivery'

/**
 * Cancelled work.
 *
 * David, 2026-09-15: "cancelled surveys should be included in the financials
 * (unless a manual adjustment is instructed)."
 *
 * A cancelled survey is the purest form of money lost — every dollar it spent
 * bought nothing that can ever be billed. Nine surveys are cancelled today and
 * they carry $746, so this is small; the principle is not. The gate that hid
 * them, `isDelivered`, also hides $30,620 of spend on 78 in-flight surveys —
 * 8.9% of everything recorded — which is the bigger version of the same fault.
 *
 * `status` and `cancelled_at` agree on all nine, so either would do; both are
 * checked because a future cancellation path that sets only one should not
 * silently fall out of the numbers.
 *
 * There is no "manual adjustment" mechanism yet. Default is to include.
 */
export const isCancelled = (p: FinProject) =>
  p.status === 'Cancelled' || p.cancelled_at != null

/** Work that is neither finished nor cancelled: it is still running, and the
 *  money it has already spent is real. Kept distinct from both so a reader can
 *  see committed-but-unfinished cost instead of it vanishing. */
export const isInFlight = (p: FinProject) => !isDelivered(p) && !isCancelled(p)

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

/**
 * Child rows bucketed by project_id.
 *
 * Without this, spendOf scans all 906 blasts and 1,592 supplier rows for every
 * one of 403 projects, and the page calls it about seven times per row across
 * its cards: 246 ms of synchronous work inside render, on every filter change,
 * rising to 657 ms at twice the data. Indexed, the same work is 6 ms — 41x —
 * and it is the floor everything else on this page is built on.
 */
export interface FinIndex {
  blasts: Map<string, FinBlast[]>
  suppliers: Map<string, FinSupplier[]>
  costs: Map<string, FinCost[]>
}

const bucket = <T extends { project_id: string }>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const a = m.get(r.project_id)
    if (a) a.push(r); else m.set(r.project_id, [r])
  }
  return m
}

export const buildIndex = (
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): FinIndex => ({
  blasts: bucket(blasts), suppliers: bucket(suppliers), costs: bucket(costs),
})

/** One survey's money, recomputed from its own rows rather than read from the
 *  stored column — so this file cannot silently disagree with the trigger, and
 *  a disagreement is visible instead of assumed away.
 *
 *  `ix` is optional so every existing call site and test keeps working; when it
 *  is supplied the row lookup is a Map hit instead of three array scans. Every
 *  looping function in this file builds one index up front and threads it
 *  through, which is where the 41x comes from. */
export function spendOf(
  p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix?: FinIndex,
): Spend {
  const b = ix ? (ix.blasts.get(p.id) ?? []) : blasts.filter(x => x.project_id === p.id)
  const s = ix ? (ix.suppliers.get(p.id) ?? []) : suppliers.filter(x => x.project_id === p.id)
  const c = ix ? (ix.costs.get(p.id) ?? []) : costs.filter(x => x.project_id === p.id)
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

export function routeOf(
  p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[], ix?: FinIndex,
): Route {
  const b = ix ? (ix.blasts.get(p.id)?.length ?? 0) > 0 : blasts.some(x => x.project_id === p.id)
  const s = ix ? (ix.suppliers.get(p.id)?.length ?? 0) > 0 : suppliers.some(x => x.project_id === p.id)
  return b && s ? 'both' : b ? 'blast' : s ? 'panel' : 'none'
}

export function applyFilters(rows: FinProject[], f: Filters, routeFor: (p: FinProject) => Route): FinProject[] {
  return rows.filter(p => {
    const d = finDate(p)
    if (f.from && (!d || d < f.from)) return false
    if (f.to && (!d || d > f.to)) return false
    if (f.type && p.project_type !== f.type) return false
    if (f.accountId && p.client_id !== f.accountId) return false
    if (f.contactId) {
      const c = p.requested_by_contact_id ?? null
      if (f.contactId === NO_CONTACT ? c !== null : c !== f.contactId) return false
    }
    if (f.route && routeFor(p) !== f.route) return false
    return true
  })
}

/** Account name for one survey, resolved through the key. Falls back to the
 *  stale label only when there is no client_id at all — which is true of no
 *  live project today, but the column is nullable and a wrong name beats a
 *  silently dropped row. */
export function accountOf(p: FinProject, accounts: Map<string, string>): string {
  if (p.client_id) return accounts.get(p.client_id) ?? p.client ?? '(no account)'
  return p.client ?? '(no account)'
}

export const contactName = (c: FinContact): string =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || '(unnamed)'

export interface AccountOption { id: string; name: string; surveys: number }

/** The account dropdown: every account with at least one survey in the working
 *  set. Accounts with no surveys are not offered — picking one would empty the
 *  page with no way to tell why.
 *
 *  ALPHABETICAL, not by size. This is a picker, and a picker's job is to let
 *  you find the one you already have in mind; the "Spend by account" card is
 *  where accounts get ranked. Scanning 70 entries for "Wellington" in size
 *  order is a worse job than scanning them in name order, and the survey count
 *  rides along on each row so nothing is lost by not sorting on it. */
export function accountOptions(rows: FinProject[], accounts: FinAccount[]): AccountOption[] {
  const name = new Map(accounts.map(a => [a.id, a.name ?? '(unnamed)']))
  const n = new Map<string, number>()
  for (const p of rows) if (p.client_id) n.set(p.client_id, (n.get(p.client_id) ?? 0) + 1)
  return [...n.entries()]
    .map(([id, surveys]) => ({ id, name: name.get(id) ?? '(unknown account)', surveys }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface ContactOption { id: string; name: string; surveys: number }

/**
 * The contact dropdown, scoped to one account: every contact who is `requested_by`
 * on at least one survey there.
 *
 * Deliberately built from the SURVEYS, not from the contact roster. BAM has 16
 * contacts on file and 10 who have ever asked for a survey; offering all 16
 * would put six dead ends in the list. The "no contact recorded" entry is
 * included when such surveys exist, because 31 of BAM's 82 are in that state and
 * a dropdown that cannot reach them hides a third of the account.
 *
 * Alphabetical by name, per David 2026-09-15 — the same order he asked for on
 * the client page and in the Requested-by picker, so a name is looked up the
 * same way wherever it appears. "No contact recorded" sorts last regardless: it
 * is a bucket, not a person, and alphabetising it among the names would bury it.
 */
export function contactOptions(
  rows: FinProject[], contacts: FinContact[], accountId: string | null,
): ContactOption[] {
  if (!accountId) return []
  const mine = rows.filter(p => p.client_id === accountId)
  const by = new Map(contacts.map(c => [c.id, c]))
  const n = new Map<string, number>()
  let none = 0
  for (const p of mine) {
    const id = p.requested_by_contact_id
    if (id && by.has(id)) n.set(id, (n.get(id) ?? 0) + 1)
    else none++
  }
  const out = [...n.entries()]
    .map(([id, surveys]) => ({ id, name: contactName(by.get(id)!), surveys }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (none > 0) out.push({ id: NO_CONTACT, name: 'No contact recorded', surveys: none })
  return out
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
  const ix = buildIndex(blasts, suppliers, costs)
  const buckets: Record<'blast' | 'panel', number[]> = { blast: [], panel: [] }
  for (const p of rows) {
    const route = routeOf(p, blasts, suppliers, ix)
    if (route !== 'blast' && route !== 'panel') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
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

/**
 * Recorded spend per ACCOUNT.
 *
 * Grouped through client_id, never the `client` string. Grouping by the string
 * split BAM across nine labels and reported $39,390 / 11% where the account had
 * actually absorbed $99,634 / 29% — an error that made the largest account look
 * like the fifth largest.
 */
export function spendByClient(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string> = new Map(),
): { clients: ClientSpend[]; total: number; coverage: { costed: number; of: number } } {
  const ix = buildIndex(blasts, suppliers, costs)
  const by = new Map<string, { total: number; surveys: number; costed: number }>()
  let total = 0, costed = 0
  for (const p of rows) {
    const key = accountOf(p, accounts)
    const sp = spendOf(p, blasts, suppliers, costs, ix)
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
  const ix = buildIndex(blasts, suppliers, costs)
  const u: Unbillable = { overTarget: 0, scrub: 0, overTargetCost: 0, scrubCost: 0, surveys: 0 }
  for (const p of rows) {
    if (!isDelivered(p)) continue
    const target = p.n_target ?? 0
    const got = p.n_collected ?? 0
    const actual = p.n_actual
    if (!(target > 0 && got > 0 && actual != null)) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
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
  const ix = buildIndex(blasts, suppliers, costs)
  const delivered = rows.filter(isDelivered)
  let deliveredCosted = 0, unreconciled = 0, unattributed = 0
  for (const p of rows) {
    const sp = spendOf(p, blasts, suppliers, costs, ix)
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

/* ────────────────────────────────────────────────────────────────────────────
 * REVENUE
 *
 * The billing rule is  revenue = rate x min(n_actual, n_target).  Two halves of
 * that deserve to be said out loud because both are counter-intuitive:
 *
 *   · Delivering ABOVE target earns nothing. The cap is min(), not max().
 *   · QA scrub does not reduce the bill at all unless it drags n_actual BELOW
 *     target. A survey that buys 1,300, scrubs 200 and still hands over 1,100
 *     against a 1,000 target bills the full 1,000. The scrub cost real money
 *     and cost zero revenue — which is why scrub is priced at COST below, and
 *     never at the client rate.
 * ──────────────────────────────────────────────────────────────────────────── */

/** rate x min(n_actual, n_target), or null when either input is missing.
 *  NEVER 0 for "unknown" — an unpriced survey has unknown revenue, and folding
 *  it in as zero would drag every margin percentage toward a number about
 *  bookkeeping rather than about the business. */
export function revenueOf(p: FinProject, rate: number | null | undefined): number | null {
  if (rate == null || !(rate > 0)) return null
  const t = p.n_target, a = p.n_actual
  if (t == null || a == null) return null
  return rate * Math.min(Number(a), Number(t))
}

export interface Margin {
  revenue: number
  cost: number
  margin: number
  /** As a fraction of revenue. */
  pct: number
  /** Surveys contributing to ALL THREE figures above. */
  surveys: number
  /** Delivered + priced but carrying no recorded cost. Their revenue is
   *  EXCLUDED above, because counting revenue whose cost was never logged
   *  reports a margin of 100% on that survey and lifts the whole ratio. */
  pricedNoCost: number
  pricedNoCostRevenue: number
  /** Delivered surveys this card cannot turn into revenue — no rate, OR a rate
   *  of 0, OR a missing n_target/n_actual. NOT the same as "has no rate": 44
   *  delivered surveys carry a rate and only 38 of them yield a revenue figure,
   *  and a banner that called this "no client rate" was undercounting the rate
   *  card by six. Kept separate from `rated` below for exactly that reason. */
  unpriced: number
  /** Delivered surveys carrying ANY rate row, including the ones above that
   *  cannot be turned into revenue. This is what "how much of the book is
   *  priced" means, and it is the number the banner quotes. */
  rated: number
  delivered: number
  /** Cost of work that was called off. David, 2026-09-15: cancelled surveys
   *  count. Held apart from `cost` so the delivered book's own performance
   *  stays readable, and folded into the two figures below. */
  cancelledCost: number
  cancelledSurveys: number
  marginAfterCancelled: number
  pctAfterCancelled: number
}

/**
 * Margin on the part of the book that carries BOTH a rate and a recorded cost.
 *
 * The exclusion in `pricedNoCost` is the whole point of this function. Including
 * those surveys takes the measured margin from 39.8% to 47.8%, not because the
 * work got more profitable but because five surveys contributed revenue and no
 * cost. That higher number is what this function exists to stop anyone printing.
 * (These figures move whenever a rate is corrected — they were 46%/58% before
 * seven DE Shaw rates were restored on 2026-09-15. The RATIO between them is
 * the durable point, not either number.)
 */
export function marginOf(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Margin {
  const ix = buildIndex(blasts, suppliers, costs)
  let revenue = 0, cost = 0, surveys = 0
  let pricedNoCost = 0, pricedNoCostRevenue = 0, unpriced = 0, rated = 0, delivered = 0
  let cancelledCost = 0, cancelledSurveys = 0
  for (const p of rows) {
    // Cancelled work is cost with no revenue, and it belongs in the margin a
    // finance reader sees — but reported separately, because burying it inside
    // `cost` would make the delivered book look worse than it performed while
    // hiding the reason. The page shows margin both ways.
    if (isCancelled(p)) {
      const sp = spendOf(p, blasts, suppliers, costs, ix)
      if (sp.total > 0) { cancelledCost += sp.total; cancelledSurveys++ }
      continue
    }
    if (!isDelivered(p)) continue
    delivered++
    if (rates.has(p.id)) rated++
    const rev = revenueOf(p, rates.get(p.id))
    if (rev == null) { unpriced++; continue }
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0) { pricedNoCost++; pricedNoCostRevenue += rev; continue }
    revenue += rev; cost += sp.total; surveys++
  }
  return {
    revenue, cost, margin: revenue - cost,
    pct: revenue > 0 ? (revenue - cost) / revenue : 0,
    surveys, pricedNoCost, pricedNoCostRevenue, unpriced, rated, delivered,
    cancelledCost, cancelledSurveys,
    marginAfterCancelled: revenue - cost - cancelledCost,
    pctAfterCancelled: revenue > 0 ? (revenue - cost - cancelledCost) / revenue : 0,
  }
}

export interface Foregone {
  /** Delivered surveys that finished short of the N they promised. */
  surveys: number
  n: number
  /** n x the CLIENT rate — revenue we could have billed and did not. */
  dollars: number
  /** Short of target but carrying no rate, so unpriceable. Reported because
   *  19x as much short N sits here as in the priced figure (8,298 against 443),
   *  and a reader who does not see it will read the priced number as the whole. */
  unpricedSurveys: number
  unpricedN: number
}

/**
 * REVENUE FOREGONE — David, 2026-09-14: "N we can't bill (N we didn't deliver
 * x $/ N)".
 *
 * This is the half measured against the CLIENT rate, because the thing lost is
 * revenue. It is NOT cash that left the building, and it must never be added to
 * `moneyLost` below: one is an invoice that was never raised and the other is an
 * invoice we paid. Adding them produces a "total waste" figure that double-counts
 * nothing but means nothing either.
 */
export function foregone(rows: FinProject[], rates: Map<string, number>): Foregone {
  const f: Foregone = { surveys: 0, n: 0, dollars: 0, unpricedSurveys: 0, unpricedN: 0 }
  for (const p of rows) {
    if (!isDelivered(p)) continue
    const t = p.n_target, a = p.n_actual
    if (t == null || a == null || !(Number(t) > 0)) continue
    const short = Math.max(0, Number(t) - Number(a))
    if (short <= 0) continue
    const r = rates.get(p.id)
    if (r != null && r > 0) { f.surveys++; f.n += short; f.dollars += short * r }
    else { f.unpricedSurveys++; f.unpricedN += short }
  }
  return f
}

export interface LostBucket { surveys: number; n: number; dollars: number }
export interface MoneyLost {
  /** Completes bought past the promised N. The cap is min(), so these bill zero. */
  overTarget: LostBucket
  /** Completes bought that never survived QA into the deliverable. */
  scrub: LostBucket
  /** Surveys in one of those states whose cost was never recorded, so the
   *  dollars could not be computed. The N is still real. */
  uncostedSurveys: number
  uncostedN: number
  /** Of the scrubbed surveys, how many still cleared their target — i.e. how
   *  much of the scrub cost us cash and cost us NO revenue. */
  scrubStillHitTarget: number
  /** Cancelled work: every dollar spent on a survey that was called off. Not a
   *  partial loss like scrub or over-delivery — the whole spend bought nothing
   *  billable, so the bucket is the survey's total cost, not a slice of it. */
  cancelled: LostBucket
  /** Spend on surveys still running. NOT a loss — it is work in progress, and
   *  it is carried here only so that it stops being invisible. Never add it to
   *  the loss total. */
  inFlight: LostBucket
}

/**
 * MONEY LOST — David, 2026-09-14: "money lost (cost to field that N)".
 *
 * Cash that left for interviews we cannot bill, priced at each survey's OWN
 * measured cost per complete. Never at a route default (that mispriced one
 * survey 24x) and never at the client rate, which would answer a different and
 * far larger question — the same scrub comes to $52,612 at cost across 14,148 N,
 * and $146,076 at the client rate across the 2,345 N that carry one.
 */
export function moneyLost(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): MoneyLost {
  const ix = buildIndex(blasts, suppliers, costs)
  const z = (): LostBucket => ({ surveys: 0, n: 0, dollars: 0 })
  const m: MoneyLost = {
    overTarget: z(), scrub: z(), uncostedSurveys: 0, uncostedN: 0, scrubStillHitTarget: 0,
    cancelled: z(), inFlight: z(),
  }
  for (const p of rows) {
    // Cancelled and in-flight work is measured FIRST, and on its whole spend
    // rather than a slice — a cancelled survey did not lose part of its money,
    // it lost all of it. Both were invisible while this function looked only at
    // `isDelivered`, which is what David caught on 2026-09-15.
    if (isCancelled(p) || isInFlight(p)) {
      const sp = spendOf(p, blasts, suppliers, costs, ix)
      if (sp.total > 0) {
        const b = isCancelled(p) ? m.cancelled : m.inFlight
        b.surveys++
        b.n += Number(p.n_collected ?? 0)
        b.dollars += sp.total
      }
      continue
    }
    if (!isDelivered(p)) continue
    const t = Number(p.n_target ?? 0), g = Number(p.n_collected ?? 0), a = p.n_actual
    if (a == null || !(g > 0)) continue
    const A = Number(a)
    const over = t > 0 ? Math.max(0, Math.min(A, g) - t) : 0
    const scrub = Math.max(0, g - A)
    if (over === 0 && scrub === 0) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0 || sp.paidCompletes <= 0) {
      m.uncostedSurveys++; m.uncostedN += over + scrub; continue
    }
    const rate = sp.total / sp.paidCompletes
    if (over > 0) { m.overTarget.surveys++; m.overTarget.n += over; m.overTarget.dollars += over * rate }
    if (scrub > 0) {
      m.scrub.surveys++; m.scrub.n += scrub; m.scrub.dollars += scrub * rate
      if (t > 0 && A >= t) m.scrubStillHitTarget++
    }
  }
  return m
}

export interface RateBand { rate: number; surveys: number; accounts: string[] }

/**
 * The rate card as it actually stands, so the page can show its own provenance.
 *
 * A backfill can put one number on a third of the book in a single sitting, and
 * on a dashboard that is indistinguishable from a third of the book having
 * negotiated the same price. It happened here: 53 surveys were written at
 * $200.00/N, which implied $3.1M of contract value until David caught that the
 * rate belongs to B2B expert work and not to PureSpectrum panel studies, where
 * he has "never seen it be more than $7-15". 36 were cleared; 16 remain, all
 * B2B. This function exists so the UI can show that concentration rather than
 * hide it, because the same mistake will be made again.
 */
export function rateBands(
  rows: FinProject[], rates: Map<string, number>, accounts: Map<string, string>,
): RateBand[] {
  const by = new Map<number, Set<string>>()
  const n = new Map<number, number>()
  for (const p of rows) {
    const r = rates.get(p.id)
    if (r == null) continue
    n.set(r, (n.get(r) ?? 0) + 1)
    if (!by.has(r)) by.set(r, new Set())
    by.get(r)!.add(accountOf(p, accounts))
  }
  return [...n.entries()]
    .map(([rate, surveys]) => ({ rate, surveys, accounts: [...(by.get(rate) ?? [])].sort() }))
    .sort((a, b) => b.surveys - a.surveys || b.rate - a.rate)
}

/** Rates recorded as exactly 0. Almost certainly "nobody entered one" rather
 *  than "we did this for free" — and a 0 rate silently prices a survey's whole
 *  delivery at nothing, so it is surfaced rather than averaged in. */
export function zeroRates(rows: FinProject[], rates: Map<string, number>): FinProject[] {
  return rows.filter(p => rates.get(p.id) === 0)
}
