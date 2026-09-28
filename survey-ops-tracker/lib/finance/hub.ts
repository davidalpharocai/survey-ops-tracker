/**
 * The finance hub's arithmetic.
 *
 * ── WHAT THIS CAN AND CANNOT ANSWER ─────────────────────────────────────────
 * It answers "what did our work COST, where did the money go, and — on the part
 * of the book that carries a client price — what did it earn". Revenue is real
 * but PARTIAL: only a minority of delivered surveys carry a price, so every
 * margin figure is a statement about the priced subset and has to name that
 * subset beside itself. How large the subset is changes as prices are entered
 * (David is backfilling them toward 1 June), which is why it is computed on
 * every load (lib/finance/coverage.ts) and never written into a comment or a
 * sentence. Revenue itself is defined in ONE place, lib/finance/revenue.ts.
 *
 * ── EVERY FIGURE CARRIES ITS COVERAGE ───────────────────────────────────────
 * Not every delivered survey has a recorded cost. A total drawn from the ones
 * that do is a FLOOR, not a total, and the difference is large enough to change
 * decisions — so `coverage` travels with every rollup and the UI is expected to
 * show it. A cost report that quietly reports part of the cost is worse than no
 * cost report, because it will be believed.
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

import {
  nActualIsPartialRollUp, overDeliveredOf, perRespondentNOf, revenueDetail, shortfallOf,
  type RevenueSegment,
} from './revenue'
import { classOf, NO_ROWS, classify } from './lifecycle'

export type Route = 'blast' | 'panel' | 'both' | 'none'

/** One row of `project_segments` (039 / 078 / 082). Attached to its survey by
 *  the loader as `FinProject.segments`. The bill never reads it — it is the
 *  survey's (revenue.ts, David 2026-09-27) — except to roll up a blank survey
 *  N actual from a full set of segment counts; otherwise it feeds the data
 *  notes (segments that do not add up, a segment priced differently). */
export interface FinSegment extends RevenueSegment {
  id: string
  project_id: string
  label?: string | null
  n_collected?: number | null
  sort_order?: number | null
}

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
  /** Cancellation. Read alongside `status`, because a future path that sets
   *  only one of the two must not drop out of the money. */
  cancelled_at?: string | null
  /** The COST CEILING — the most we intend to spend (David, 2026-08-24). NOT
   *  client revenue, and never to be reconciled against contract value as if
   *  the two should agree. Only surveys carrying both a budget and a recorded
   *  cost can say anything about variance; budgetVariance counts them. */
  budget?: number | null
  /** Who at the account asked for this. The only trustworthy contact link —
   *  the suffix in `client` agrees with it on all 58 surveys that carry both
   *  and contradicts it on none, so the suffix adds nothing the key lacks. */
  requested_by_contact_id?: string | null
  /** 117: of n_actual, how many delivered respondents each route produced.
   *  Only meaningful on a MIXED survey — a single-route survey's whole n_actual
   *  belongs to its one route by construction and these stay null. */
  n_actual_panel?: number | null
  n_actual_blast?: number | null
  /** 117: how the split was arrived at. 'estimated' is a judgement and is
   *  REFUSED by every rate in this file; it is stored so the knowledge is not
   *  lost, not so it can be divided by. */
  n_actual_split_method?: string | null
  /** 078: the top of the sold N range — the cap on billed N. Falls back to
   *  n_target when null (lib/finance/revenue.ts). */
  n_target_max?: number | null
  /** A rerun wave the spawner created ahead of time. Only an EMPTY one is
   *  excluded (lib/finance/lifecycle.ts); one that holds data is real work. */
  is_placeholder?: boolean | null
  /** 100: credits drawn and the contract they draw from. Counts, not dollars. */
  credits?: number | null
  term_id?: string | null
  /** The trigger-maintained stored spend, read only to check that this file's
   *  recomputation agrees with it (the load integrity line). */
  actual_spend?: number | null
  delivered_at?: string | null
  /** Attached by the loader from project_segments. Absent = not segmented. */
  segments?: FinSegment[] | null
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
  /** Which panel, and which launch (wave) it was bought in. Optional so the
   *  arithmetic tests can stay small; the loader always supplies them. */
  supplier_id?: string | null
  launch_id?: string | null
  suppliers?: { name: string | null } | null
}
export interface FinCost {
  project_id: string
  /** NEGATIVE is a credit. Today every credit on file is a recovered blast
   *  incentive — a reward that went unclaimed and came back — and they are
   *  reported as their own line, never folded into "other" (David,
   *  2026-09-24: "recoveries as separate line so it's easier to see the
   *  breakout and back into them"). */
  amount: number | null
  /** 117: 'blast' | 'panel', or null for an unattributed line. A flat cost on a
   *  SINGLE-route survey needs no route — there is only one place it can belong
   *  — so this matters only on mixed surveys, where a flat contacts-export line
   *  can be most of the survey's cost and must not be smeared across routes. */
  route?: string | null
  kind?: string | null
  description?: string | null
}

/** A cost line that gives money back. */
export const isCredit = (c: FinCost) => Number(c.amount ?? 0) < 0

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
 * bought nothing that can ever be billed. The sums involved are small; the
 * principle is not. The gate that hid them, `isDelivered`, also hid the spend
 * on every in-flight survey, which is the bigger version of the same fault.
 *
 * `status` and `cancelled_at` agreed on every cancelled survey when this was
 * written, so either would do; both are checked because a future cancellation
 * path that sets only one should not silently fall out of the numbers.
 *
 * There is no "manual adjustment" mechanism yet. Default is to include.
 */
export const isCancelled = (p: FinProject) =>
  p.status === 'Cancelled' || p.cancelled_at != null

// "Is this survey live / scoping / on hold?" is NOT answered here any more —
// lib/finance/lifecycle.ts `classify` is the one classifier, in one order.

export interface Spend {
  /** bid x completes — the respondent reward, GROSS of anything recovered. */
  reward: number
  /** people x cost_per_send, and ZERO on an email blast (migration 112). */
  send: number
  /** cpi x n_collected across supplier rows. */
  panel: number
  /** Flat cost lines that cost money (amount ≥ 0). Credits are NOT in here. */
  other: number
  /** Flat cost lines that GIVE money back (amount < 0), so ≤ 0. Every one on
   *  file today is a recovered blast incentive. Its own line so a month that has
   *  had its recoveries booked is never silently compared with one that has not. */
  recovered: number
  /** reward + send + panel + other + recovered — the net, which is what the
   *  database's actual_spend trigger stores. */
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
  const other = c.reduce((t, x) => t + (isCredit(x) ? 0 : Number(x.amount ?? 0)), 0)
  const recovered = c.reduce((t, x) => t + (isCredit(x) ? Number(x.amount) : 0), 0)
  return {
    reward, send, panel, other, recovered,
    total: reward + send + panel + other + recovered,
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

/** One route's share of a survey: what it cost, what it bought, what survived. */
export interface Leg {
  route: 'blast' | 'panel'
  /** Spend attributable to this route — its own field rows, plus the flat cost
   *  lines routed to it. NET of recovered rewards. */
  spend: number
  /** The credits (recovered rewards) inside `spend`, ≤ 0, so a caller can show
   *  the rate gross as well as net: spend − recovered is the gross figure. */
  recovered: number
  /** Completes we PAID for on this route. */
  paid: number
  /**
   * Delivered (post-QA) respondents attributed to this route, or NULL when that
   * is not established.
   *
   * NULLABLE on purpose, and it is the difference between the two rates this
   * file feeds. Cost per COMPLETE needs only spend and paid, both of which a
   * mixed survey already carries in its own rows — so routeCosts can price a
   * mixed survey with no new data at all. CPQR divides by what survived QA into
   * the deliverable, which no row records per route, so it refuses a null.
   *
   * May legitimately be 0: a route we spent on that produced nothing usable.
   */
  delivered: number | null
  /** The N this route is said to have COLLECTED, for the coverage guard. On a
   *  mixed survey that is `paid` by construction (the field rows ARE the
   *  collection record); on a single-route survey it is the project's own
   *  n_collected, which is what the guard has always used. */
  collected: number
}

/** Why a survey produced no legs — the coverage line needs to say which. */
export type LegBlock =
  | 'ok'
  | 'none'            // no field rows at all
  | 'no-split'        // mixed, and nobody has recorded which route delivered what
  | 'split-mismatch'  // a split that does not sum to n_actual — stale or half-entered
  | 'estimated'       // a split that is a judgement, not a measurement
  | 'unrouted-cost'   // mixed, with flat cost lines that name no route
  | 'no-n-actual'     // nothing delivered to attribute
  | 'partial-n-actual' // the survey's N actual sums only the segments that have a count
  | 'under-recorded'  // the field rows do not cover the N the survey claims

export interface Legs {
  legs: Leg[]
  /** Flat cost naming no route. Non-zero only on a MIXED survey — and because
   *  an unattributed cost blocks the legs (see reason 'unrouted-cost'), it
   *  travels with an EMPTY `legs` today. It is carried rather than discarded so
   *  the finance page can name the money it is not pricing instead of quietly
   *  dropping a survey; routing the line is what turns it into two legs. */
  unrouted: number
  /** Why `legs` is empty. 'ok' when it is not. */
  reason: LegBlock
  /** Why the legs carry a null `delivered`, when they do. Separate from `reason`
   *  because the two failures are fixed by different people: a blocked SPEND
   *  partition needs a cost line routed, a blocked DELIVERED split needs the
   *  client deliverable joined to the QA file. 'ok' when delivered is set. */
  splitReason: LegBlock
}

/**
 * Partition one survey's money and respondents into 0, 1 or 2 route legs.
 *
 * ── WHY THIS EXISTS AS A FUNCTION RATHER THAN A WIDER FILTER ────────────────
 * Every per-route rate in this codebase used to begin `if (route !== 'blast' &&
 * route !== 'panel') continue`, which drops mixed surveys — 7 of them, $32,878
 * and 2,554 delivered respondents. The obvious fix is to relax that test to let
 * `'both'` through, and it is a trap: every call site then has to REMEMBER not
 * to reach for `spendOf().total`, because on a mixed survey the whole total
 * belongs to neither route. Get it wrong in one of the four places and the same
 * $13,513 lands on the panel card AND the blast card.
 *
 * Enumerating legs makes that double-count representationally impossible. There
 * is exactly one place a survey's money is partitioned, it carries the invariant
 *
 *     Σ legs.spend + unrouted === spendOf().total
 *     Σ legs.paid              === spendOf().paidCompletes
 *
 * and a caller that adds up legs cannot reach past them.
 *
 * ── A SINGLE-ROUTE SURVEY YIELDS EXACTLY ONE LEG CARRYING EVERYTHING ────────
 * Including its flat cost lines, routed or not: on a survey with one route
 * there is only one place a cost can belong, so an unrouted line needs no
 * attribution. That makes this a provable no-op on 126 of the 133 costed
 * surveys — if anything in cpqr.test.ts goes red, this function is wrong, not
 * the test.
 *
 * ── WHAT A MIXED SURVEY MUST PROVE BEFORE IT IS PRICED ──────────────────────
 * All four, or it produces no legs and falls back to today's behaviour:
 *
 *   1. Both sides of the delivered split are recorded.
 *   2. They sum to n_actual EXACTLY. A split is a statement about a number that
 *      moves; when it stops agreeing, it is stale, and stale is worse than
 *      absent because it looks answered.
 *   3. The method is not 'estimated'. An estimate is stored so the knowledge
 *      survives, and refused here so it cannot become a printed rate.
 *   4. Every flat cost line names a route. This is the one that bites: a mixed
 *      survey's contacts export can be most of its entire cost (it was on
 *      PR00425 when this was written), and admitting the survey while leaving
 *      that unplaced prices its blast leg several times too cheap, pooled into a
 *      median beside single-route surveys that DO carry their flat costs. An
 *      unattributed cost is not a small cost.
 *
 * Deliberately NOT pro rata. Splitting a list purchase by delivered N puts most
 * of it on the panel side, which bought none of it. The remainder is shown, not
 * smeared.
 *
 * The delivered N is the SURVEY's (revenue.ts perRespondentNOf): the figure
 * the bill uses, with one exception. A segmented survey whose segment counts do
 * not add up still divides by its own N actual — David, 2026-09-27: "when we
 * bill its just the n actual" — and carries the segmentsDisagree note. But when
 * that N actual is only the 078 roll-up of the segments that HAVE a count
 * (PR00231), it covers part of the survey while the spend covers all of it, so
 * `delivered` is null with the reason 'partial-n-actual' and CPQR leaves the
 * survey out and lists it. Cost per complete is untouched: it never reads
 * `delivered`.
 */
export function legsOf(
  p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix?: FinIndex,
): Legs {
  const route = routeOf(p, blasts, suppliers, ix)
  if (route === 'none') return { legs: [], unrouted: 0, reason: 'none', splitReason: 'none' }

  const sp = spendOf(p, blasts, suppliers, costs, ix)
  // The survey's delivered N — its own n_actual, or the segments' sum only when
  // that is blank and every segment has one — unless it is a partial roll-up,
  // which no per-respondent rate may divide by.
  const nActual = perRespondentNOf(p)
  const nReason: LegBlock = nActualIsPartialRollUp(p) ? 'partial-n-actual' : 'no-n-actual'

  // ── single route: one leg, everything on it ───────────────────────────────
  //
  // `delivered` is the project's own n_actual, null and all — a single-route
  // survey with no delivered figure still has a real cost per complete, and
  // routeCosts has always priced it. CPQR is the caller that refuses a null.
  if (route === 'blast' || route === 'panel') {
    return {
      legs: [{
        route,
        spend: sp.total,
        recovered: sp.recovered,
        paid: sp.paidCompletes,
        delivered: nActual,
        collected: Number(p.n_collected ?? 0),
      }],
      unrouted: 0,
      reason: 'ok',
      splitReason: nActual == null ? nReason : 'ok',
    }
  }

  // ── mixed ─────────────────────────────────────────────────────────────────
  //
  // Two independent questions, answered separately because they are blocked by
  // different missing facts and fixed by different people.
  const c = ix ? (ix.costs.get(p.id) ?? []) : costs.filter(x => x.project_id === p.id)
  const b = ix ? (ix.blasts.get(p.id) ?? []) : blasts.filter(x => x.project_id === p.id)
  const s = ix ? (ix.suppliers.get(p.id) ?? []) : suppliers.filter(x => x.project_id === p.id)
  const blastPaid = b.reduce((t, x) => t + (x.completes ?? 0), 0)
  const panelPaid = s.reduce((t, x) => t + (x.n_collected ?? 0), 0)

  // 1. CAN THE MONEY BE PARTITIONED? Only the flat cost lines are in doubt; the
  //    field rows carry their own route. An unattributed line blocks BOTH legs
  //    rather than being smeared across them: a list purchase can be most of a
  //    mixed survey's cost, and pro-rata by delivered N would put most of it on
  //    the panel side, which bought none of it. A credit that names no route
  //    blocks too — it would otherwise drop out of both legs unseen.
  const flat = (r: 'blast' | 'panel') =>
    c.reduce((t, x) => t + (x.route === r ? Number(x.amount ?? 0) : 0), 0)
  const credit = (r: 'blast' | 'panel') =>
    c.reduce((t, x) => t + (x.route === r && isCredit(x) ? Number(x.amount) : 0), 0)
  const unrouted = c.reduce((t, x) => t + (x.route == null ? Number(x.amount ?? 0) : 0), 0)
  if (c.some(x => x.route == null && Number(x.amount ?? 0) !== 0)) {
    return { legs: [], unrouted, reason: 'unrouted-cost', splitReason: 'unrouted-cost' }
  }

  // 2. IS THE DELIVERED SPLIT TRUSTWORTHY? All three, or `delivered` stays null
  //    and only the cost-per-complete rate can use these legs.
  let delivered: { panel: number; blast: number } | null = null
  let splitReason: LegBlock = 'ok'
  const panelN = p.n_actual_panel
  const blastN = p.n_actual_blast
  if (nActual == null) splitReason = nReason
  else if (panelN == null || blastN == null) splitReason = 'no-split'
  // A split is a statement about a number that moves. Once it stops agreeing it
  // is stale, and stale is worse than absent because it looks answered.
  else if (Number(panelN) + Number(blastN) !== nActual) splitReason = 'split-mismatch'
  // An estimate is stored so the knowledge survives, and refused here so it
  // cannot quietly become a printed rate.
  else if (p.n_actual_split_method === 'estimated') splitReason = 'estimated'
  else delivered = { panel: Number(panelN), blast: Number(blastN) }

  return {
    legs: [
      {
        route: 'panel',
        spend: sp.panel + flat('panel'),
        recovered: credit('panel'),
        paid: panelPaid,
        delivered: delivered ? delivered.panel : null,
        collected: panelPaid,
      },
      {
        route: 'blast',
        spend: sp.reward + sp.send + flat('blast'),
        recovered: credit('blast'),
        paid: blastPaid,
        delivered: delivered ? delivered.blast : null,
        collected: blastPaid,
      },
    ],
    unrouted: 0,
    reason: 'ok',
    splitReason,
  }
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
 * difference between "blasts cost $50 a complete" and "$80".
 *
 * MIXED SURVEYS NOW CONTRIBUTE, and they cost nothing to admit. This rate
 * divides spend by completes we PAID FOR, and both of those already split
 * themselves: a blast row carries its own completes and its own bid, a supplier
 * row its own collected and its own CPI. The only thing a mixed survey could not
 * place was a flat cost line, and legsOf refuses to produce legs until every one
 * of them names a route — so a mixed survey either partitions exactly or stays
 * out, exactly as before. It needs no delivered split at all; that is CPQR's
 * problem, not this one.
 */
export function routeCosts(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): RouteCost[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const buckets: Record<'blast' | 'panel', number[]> = { blast: [], panel: [] }
  for (const p of rows) {
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0 || sp.paidCompletes <= 0) continue
    const { legs } = legsOf(p, blasts, suppliers, costs, ix)
    if (!legs.length) continue
    // All-or-nothing, so one under-recorded leg cannot leave its partner's
    // dollars in the rate with no completes to divide by.
    if (!legs.every(l => l.collected > 0 && l.paid >= l.collected && l.paid > 0)) continue
    for (const l of legs) buckets[l.route].push(l.spend / l.paid)
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
  let delivered = 0, deliveredCosted = 0, unreconciled = 0, unattributed = 0
  for (const p of rows) {
    const cls = classOf(p, ix)
    // An empty rerun shell is not a delivered survey with no cost — it is not a
    // survey at all, and counting it dragged July's cost coverage from 85% to
    // 73%.
    if (cls === 'placeholder') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (cls === 'delivered') {
      delivered++
      if (sp.total > 0) deliveredCosted++
    }
    const got = Number(p.n_collected ?? 0)
    if (got > 0 && sp.paidCompletes < got) { unreconciled++; unattributed += got - sp.paidCompletes }
  }
  return {
    delivered,
    deliveredCosted,
    deliveredPct: pct(deliveredCosted, delivered),
    unreconciled,
    unattributedCompletes: unattributed,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * WHERE THE MONEY WENT
 *
 * Recovered rewards are their own line, never netted into "Other" (David,
 * 2026-09-24). Folded in, 43 credits turned "Other cost lines" into a negative
 * figure drawn as a positive bar, and made the months that had their recoveries
 * booked look cheaper than the ones still waiting for theirs.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CostBreakdown {
  panel: number
  /** bid × completes, before anything came back. */
  rewardsGross: number
  /** Credits, ≤ 0. */
  recovered: number
  /** rewardsGross + recovered. */
  rewardsNet: number
  sends: number
  /** Flat cost lines that cost money. */
  other: number
  /** panel + rewardsGross + recovered + sends + other. */
  total: number
  /** Surveys carrying at least one credit, and the credit lines themselves. */
  recoveredSurveys: number
  recoveredLines: number
}

/** The breakdown's lines, in display order, with the words to show. One copy so
 *  every tile, drill and export labels the same money the same way. */
export const COST_LINES: { key: keyof CostBreakdown; label: string; help: string }[] = [
  { key: 'panel', label: 'Panel (PureSpectrum)', help: 'What we paid panels: each panel’s price per complete × the completes we bought from it.' },
  { key: 'rewardsGross', label: 'Blast rewards (gross)', help: 'Incentives issued to blast respondents: the bid × completes, before any unclaimed reward came back.' },
  { key: 'recovered', label: 'Rewards recovered', help: 'Incentives that went unclaimed and came back to us, shown as a negative. Booked in batches, so a recent month may still be waiting for its recoveries.' },
  { key: 'sends', label: 'SMS sends', help: 'The per-message cost of text blasts, at the rate recorded on each blast. Email sends are free.' },
  { key: 'other', label: 'Other costs', help: 'Flat vendor lines, such as contact-list exports.' },
  { key: 'total', label: 'Total field cost', help: 'Everything above, net of recovered rewards. No salaries or overhead.' },
]

export function costBreakdown(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix: FinIndex = buildIndex(blasts, suppliers, costs),
): CostBreakdown {
  const out: CostBreakdown = {
    panel: 0, rewardsGross: 0, recovered: 0, rewardsNet: 0, sends: 0, other: 0, total: 0,
    recoveredSurveys: 0, recoveredLines: 0,
  }
  for (const p of rows) {
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    out.panel += sp.panel
    out.rewardsGross += sp.reward
    out.recovered += sp.recovered
    out.sends += sp.send
    out.other += sp.other
    const credits = (ix.costs.get(p.id) ?? []).filter(isCredit).length
    if (credits > 0) { out.recoveredSurveys++; out.recoveredLines += credits }
  }
  out.rewardsNet = out.rewardsGross + out.recovered
  out.total = out.panel + out.rewardsGross + out.recovered + out.sends + out.other
  return out
}

/* ────────────────────────────────────────────────────────────────────────────
 * REVENUE
 *
 * Revenue is computed in ONE place — lib/finance/revenue.ts — and everything
 * here reads it from there:
 *
 *     revenue = price per N × min(n_actual, n_target_max ?? n_target)
 *
 * Two halves of that deserve to be said out loud because both are
 * counter-intuitive:
 *
 *   · Delivering ABOVE the sold range earns nothing. Over-delivery is a
 *     courtesy and is never billed afterwards.
 *   · QA scrub does not reduce the bill at all unless it drags n_actual BELOW
 *     the cap. A survey that buys 1,300, scrubs 200 and still hands over 1,100
 *     against a 1,000 target bills the full 1,000. The scrub cost real money
 *     and cost zero revenue — which is why scrub is priced at COST below, and
 *     never at the client price.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MarginPart {
  surveys: number
  revenue: number
  cost: number
  margin: number
  /** margin ÷ revenue, or null when there is no revenue to divide by. */
  pct: number | null
}

export interface Margin {
  revenue: number
  cost: number
  margin: number
  /** As a fraction of revenue. null — not 0 — when nothing is priced. */
  pct: number | null
  /** Surveys contributing to ALL THREE figures above: the MARGIN SET —
   *  delivered, priced (a real $0 included), delivered N and a cap present,
   *  and spend above $0. Every margin figure on the page is drawn from it. */
  surveys: number
  ids: string[]
  /** The margin set without the surveys given away at $0 — "we keep X% on
   *  paid work". A $0 price never enters a ratio, so this is the ratio to quote
   *  beside the book figure, which does include the free work's cost. */
  paid: MarginPart
  /** Surveys in the margin set priced at exactly $0: their cost is in `cost`
   *  above and their revenue is $0. */
  free: { surveys: number; cost: number; ids: string[] }
  /** Delivered + priced but carrying no recorded cost. Their revenue is
   *  EXCLUDED above, because counting revenue whose cost was never logged
   *  reports a margin of 100% on that survey and lifts the whole ratio. */
  pricedNoCost: number
  pricedNoCostRevenue: number
  pricedNoCostIds: string[]
  /** Delivered and priced, but the revenue cannot be computed yet: no delivered
   *  N or no N target on the survey. Each is one field away from the margin
   *  set, so they are listed, never lost. (A segment never blocks it: the bill
   *  is the survey's.) */
  pricedBlocked: number
  pricedBlockedIds: string[]
  /** Delivered surveys with no price at all. */
  unpriced: number
  /** Delivered surveys carrying a price, $0 included. What "how much of the book
   *  is priced" means. */
  rated: number
  delivered: number
  /** Recorded spend on every delivered survey in `rows`, priced or not — the
   *  denominator of "these surveys hold X% of the spend". */
  spend: number
  /** Spend on delivered surveys with no price, and how many carry it. */
  spendNoPrice: number
  surveysNoPrice: number
  /** Cost of work that was called off. David, 2026-09-15: cancelled surveys
   *  count. Held apart from `cost` so the delivered book's own performance
   *  stays readable, and folded into the two figures below. */
  cancelledCost: number
  cancelledSurveys: number
  marginAfterCancelled: number
  pctAfterCancelled: number | null
}

const part = (): MarginPart => ({ surveys: 0, revenue: 0, cost: 0, margin: 0, pct: null })

/**
 * Margin on the part of the book that carries BOTH a price and a recorded cost.
 *
 * The exclusion in `pricedNoCost` is the whole point of this function. Including
 * those surveys lifts the measured margin, not because the work got more
 * profitable but because some surveys contributed revenue and no cost. That
 * higher number is what this function exists to stop anyone printing.
 */
export function marginOf(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Margin {
  const ix = buildIndex(blasts, suppliers, costs)
  const m: Margin = {
    revenue: 0, cost: 0, margin: 0, pct: null, surveys: 0, ids: [],
    paid: part(), free: { surveys: 0, cost: 0, ids: [] },
    pricedNoCost: 0, pricedNoCostRevenue: 0, pricedNoCostIds: [],
    pricedBlocked: 0, pricedBlockedIds: [],
    unpriced: 0, rated: 0, delivered: 0,
    spend: 0, spendNoPrice: 0, surveysNoPrice: 0,
    cancelledCost: 0, cancelledSurveys: 0, marginAfterCancelled: 0, pctAfterCancelled: null,
  }
  for (const p of rows) {
    const cls = classOf(p, ix)
    // Cancelled work is cost with no revenue, and it belongs in the margin a
    // finance reader sees — but reported separately, because burying it inside
    // `cost` would make the delivered book look worse than it performed while
    // hiding the reason.
    if (cls === 'cancelled') {
      const sp = spendOf(p, blasts, suppliers, costs, ix)
      if (sp.total > 0) { m.cancelledCost += sp.total; m.cancelledSurveys++ }
      continue
    }
    if (cls !== 'delivered') continue
    m.delivered++
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    m.spend += sp.total
    const rv = revenueDetail(p, rates.get(p.id))
    if (!rv.priced) {
      m.unpriced++
      if (sp.total > 0) { m.spendNoPrice += sp.total; m.surveysNoPrice++ }
      continue
    }
    m.rated++
    if (rv.revenue == null) { m.pricedBlocked++; m.pricedBlockedIds.push(p.id); continue }
    if (sp.total <= 0) {
      m.pricedNoCost++; m.pricedNoCostRevenue += rv.revenue; m.pricedNoCostIds.push(p.id)
      continue
    }
    m.revenue += rv.revenue; m.cost += sp.total; m.surveys++; m.ids.push(p.id)
    if (rv.free) { m.free.surveys++; m.free.cost += sp.total; m.free.ids.push(p.id) }
    else if (rv.ratioEligible) { m.paid.surveys++; m.paid.revenue += rv.revenue; m.paid.cost += sp.total }
  }
  m.margin = m.revenue - m.cost
  m.pct = m.revenue > 0 ? m.margin / m.revenue : null
  m.paid.margin = m.paid.revenue - m.paid.cost
  m.paid.pct = m.paid.revenue > 0 ? m.paid.margin / m.paid.revenue : null
  m.marginAfterCancelled = m.margin - m.cancelledCost
  m.pctAfterCancelled = m.revenue > 0 ? m.marginAfterCancelled / m.revenue : null
  return m
}

export interface Foregone {
  /** Delivered surveys that finished short of the N they sold. */
  surveys: number
  n: number
  /** n x the CLIENT price — revenue we could have billed and did not. */
  dollars: number
  ids: string[]
  /** Short of target but carrying no price, so unpriceable. Reported because
   *  far more short N sits here than in the priced figure, and a reader who does
   *  not see it will read the priced number as the whole. */
  unpricedSurveys: number
  unpricedN: number
}

/**
 * REVENUE FOREGONE — David, 2026-09-14: "N we can't bill (N we didn't deliver
 * x $/ N)".
 *
 * Measured against the CLIENT price, because the thing lost is revenue, and
 * against the N SOLD (n_target): delivering inside a sold range is not short.
 * On the SURVEY as a whole (revenue.ts shortfallOf), like the bill: a segment
 * that fell short while another made up for it is not short, because the
 * invoice never saw the segments. A $0 price is a price, so a free trial that
 * came up short is priced at $0 of foregone revenue rather than counted as
 * unpriced.
 *
 * It is NOT cash that left the building, and it must never be added to
 * `moneyLost` below: one is an invoice that was never raised and the other is an
 * invoice we paid.
 */
export function foregone(rows: FinProject[], rates: Map<string, number>): Foregone {
  const f: Foregone = { surveys: 0, n: 0, dollars: 0, ids: [], unpricedSurveys: 0, unpricedN: 0 }
  for (const p of rows) {
    // No child rows here, and none are needed: Delivered is decided by the
    // board column before any row-dependent test.
    if (classify(p, NO_ROWS) !== 'delivered') continue
    const s = shortfallOf(p, rates.get(p.id))
    if (!s || s.n <= 0) continue
    if (s.dollars != null) { f.surveys++; f.n += s.n; f.dollars += s.dollars; f.ids.push(p.id) }
    else { f.unpricedSurveys++; f.unpricedN += s.n }
  }
  return f
}

export interface LostBucket {
  surveys: number
  n: number
  dollars: number
  /** The surveys counted, so a drill can check its rows against the figure's
   *  own ids instead of against themselves. */
  ids: string[]
}

/**
 * Delivered surveys a PER-RESPONDENT figure had to leave out because the
 * survey's N actual is only the partial roll-up of its segments (revenue.ts
 * perRespondentNOf) — PR00231 on live data. Their bill is unaffected; what
 * cannot be measured is anything that sets the survey's whole cost or its
 * whole bought N against that part-count. Listed, never dropped, so the card
 * that leaves them out can say how much it left out and why.
 */
export interface PartialRollUpNote {
  surveys: number
  /** Recorded spend on them — the money the figure is not describing. */
  spend: number
  /** N bought on them (n_collected), none of which the figure can call
   *  scrubbed or delivered. */
  collected: number
  ids: string[]
}

export const emptyPartialRollUp = (): PartialRollUpNote => ({ surveys: 0, spend: 0, collected: 0, ids: [] })

export interface MoneyLost {
  /** N delivered past the top of the survey's sold range, priced at the
   *  survey's own cost per complete. The bill is capped with min(), so these
   *  earn nothing. */
  overTarget: LostBucket
  /** Completes bought that never survived QA into the deliverable. */
  scrub: LostBucket
  /** Delivered surveys whose N actual counts only the segments that have one:
   *  neither their scrub nor their over-delivery can be measured, so both
   *  buckets above leave them out and they are listed here instead. */
  partialRollUp: PartialRollUpNote
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
  /** Spend on LIVE surveys. NOT a loss — it is work in progress, and it is
   *  carried here only so that it stops being invisible. Never add it to the
   *  loss total. */
  inFlight: LostBucket
  /** Spend on surveys ON HOLD — its own bucket, never inside the live figure. */
  hold: LostBucket
  /** Spend on surveys closed without delivery (Archived). */
  archived: LostBucket
  /** Spend on surveys still in scoping (cost lines only — a survey buying
   *  respondents is not scoping). Normally $0. */
  scoping: LostBucket
}

/**
 * MONEY LOST — David, 2026-09-14: "money lost (cost to field that N)".
 *
 * Cash that left for interviews we cannot bill, priced at each survey's OWN
 * measured cost per complete. Never at a route default (that mispriced one
 * survey 24x) and never at the client price, which would answer a different and
 * far larger question.
 *
 * A delivered survey whose N actual is a partial segment roll-up is in neither
 * scrub nor over-delivery: it goes to `partialRollUp` (see PartialRollUpNote).
 */
export function moneyLost(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): MoneyLost {
  const ix = buildIndex(blasts, suppliers, costs)
  const z = (): LostBucket => ({ surveys: 0, n: 0, dollars: 0, ids: [] })
  const m: MoneyLost = {
    overTarget: z(), scrub: z(), partialRollUp: emptyPartialRollUp(),
    uncostedSurveys: 0, uncostedN: 0, scrubStillHitTarget: 0,
    cancelled: z(), inFlight: z(), hold: z(), archived: z(), scoping: z(),
  }
  for (const p of rows) {
    const cls = classOf(p, ix)
    if (cls === 'placeholder') continue
    // Work that was not delivered is measured on its WHOLE spend rather than a
    // slice — a cancelled survey did not lose part of its money, it lost all of
    // it — and each class keeps its own bucket, so hold never reads as live.
    if (cls !== 'delivered') {
      const sp = spendOf(p, blasts, suppliers, costs, ix)
      if (sp.total > 0) {
        const b = cls === 'cancelled' ? m.cancelled
          : cls === 'active' ? m.inFlight
            : cls === 'hold' ? m.hold
              : cls === 'archived' ? m.archived : m.scoping
        b.surveys++
        b.n += Number(p.n_collected ?? 0)
        b.dollars += sp.total
        b.ids.push(p.id)
      }
      continue
    }
    const g = Number(p.n_collected ?? 0)
    // A survey N actual that is only the roll-up of the segments that have a
    // count (PR00231) would call every uncounted segment's interviews scrubbed.
    // Its bill stands; its scrub and over-delivery are unknown, so it is listed
    // rather than measured.
    if (nActualIsPartialRollUp(p)) {
      const sp = spendOf(p, blasts, suppliers, costs, ix)
      const n = m.partialRollUp
      n.surveys++; n.spend += sp.total; n.collected += g; n.ids.push(p.id)
      continue
    }
    // The survey's delivered N — the figure the bill uses (revenue.ts). Not a
    // partial roll-up: that was listed above.
    const A = perRespondentNOf(p)
    const t = Number(p.n_target ?? 0)
    // Over-delivery by the same rule that caps the bill (revenue.ts
    // overDeliveredOf): on the SURVEY, above the top of its sold range. A
    // segment past its own target while another fell short is not over — the
    // invoice never saw the segments (David, 2026-09-27) — so billed + over =
    // delivered on every survey, and the project page states the same N.
    const over = overDeliveredOf(p) ?? 0
    // Scrub needs both counts: bought (collected) less what survived QA.
    const scrub = A != null && g > 0 ? Math.max(0, g - A) : 0
    if (over === 0 && scrub === 0) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0 || sp.paidCompletes <= 0) {
      m.uncostedSurveys++; m.uncostedN += over + scrub; continue
    }
    const rate = sp.total / sp.paidCompletes
    if (over > 0) {
      m.overTarget.surveys++; m.overTarget.n += over; m.overTarget.dollars += over * rate
      m.overTarget.ids.push(p.id)
    }
    if (scrub > 0) {
      m.scrub.surveys++; m.scrub.n += scrub; m.scrub.dollars += scrub * rate
      m.scrub.ids.push(p.id)
      if (t > 0 && A != null && A >= t) m.scrubStillHitTarget++
    }
  }
  return m
}
