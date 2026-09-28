/**
 * Finance · This week — every figure on the tab, computed here and nowhere else.
 *
 * The tab answers one question for a busy executive: "what do I have to decide
 * this week, and what is each decision worth?" Each row is one decision — what
 * happened, what is at stake, what to do — grouped under a VERB and ranked by
 * the dollars at stake. The React components only render what this file hands
 * them, so every number, sentence and ranking here is unit-tested with fixtures
 * (lib/finance/thisWeek.test.ts).
 *
 * ── THE POPULATION ──────────────────────────────────────────────────────────
 *   · LIVE work is the `active` class only (lib/finance/lifecycle.ts) × account ×
 *     route. The date filter does not apply: an overspending survey matters
 *     whenever it launched (filters.ts TAB_RULES['this-week']).
 *   · HOLD IS ITS OWN BUCKET. David, 2026-09-24: "give it its own bucket and keep
 *     out of live totals. im trying to minimize # of holds." Holds are counted,
 *     their age is shown where the audit log records a real status change, and
 *     each carries a RESUME OR CANCEL row — but no held survey is ever summed
 *     into a live figure. `buildThisWeekModel` re-checks the class of both
 *     inputs, so a caller that mixed them up still could not leak one into the
 *     other.
 *   · UNSOLD SCOPING is counted and never valued. A quote is not a sale, so it
 *     never enters the pipeline figure.
 *   · Three rows reach past live work because the decision is still this
 *     week's: a delivered free trial nobody has followed up (CONVERT THE
 *     TRIAL), a credit contract past its pool (TOP UP THE CONTRACT) and a
 *     recurring series that is due (CHECK THE SERIES).
 *
 * ── MONEY RULES ─────────────────────────────────────────────────────────────
 *   · Contract value = the survey's price per N × the N sold (n_target) — what
 *     it is worth if it lands on target. The same shape as analysis.ts
 *     `backlog`, which is what the "worth at target" drill is checked against.
 *   · The spend goal is half the contract value: (1 − KEEP_GOAL) × price. A
 *     GUIDE, never a rule (David, 2026-09-24) — it decides which rows appear
 *     under FREEZE THE BID and CONFIRM FINAL N and nothing is blocked by it.
 *   · A $0 price is real ("given away") and is never divided by: a survey priced
 *     at $0 is never "past half its price".
 *   · A failed read is not $0. Every verb group names the tables it needs, and
 *     a group whose table did not load says "Blocked: …" instead of "nothing
 *     to do".
 *   · Credits are counts. Any dollar value of credits is DERIVED — from the
 *     contract value on file when one exists (client_term_financials, 100),
 *     else from the rate the contract's own priced surveys imply — and every
 *     sentence that prints one says how it was derived.
 */

import {
  spendOf,
  type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier, type Route, type Spend,
} from './hub'
import { classOf, type FinClass } from './lifecycle'
import { capOf, deliveredNOf, KEEP_GOAL, suggestedBudget } from './revenue'
import { creditValues, impliedCreditRate, type FinTerm } from './credits'
import { populationByRule, type FinanceFilter, type FinItem, type TabRule } from './filters'
import type { FinanceTable } from './load'
import { spendOfIds, type DrillColumn, type DrillRow, type DrillSpec } from './drill'
import { backlog, holds as holdsOf } from './analysis'
// One-way: perRespondent.ts never imports this file.
import { buyMultiples } from './perRespondent'
import { money, pctText } from './format'
import { fmtNum } from '@/lib/utils/number'

/* ── CONSTANTS ──────────────────────────────────────────────────────────── */

/**
 * The buy multiple: completes we expect to BUY per respondent the client
 * receives, because QA removes some. STOP BUYING fires only once a survey has
 * collected MORE than this multiple of the N it sold, so ordinary over-buying
 * for QA loss never trips it.
 *
 * The multiple is MEASURED where it can be: lib/finance/perRespondent.ts
 * `buyMultiples` — 1 ÷ the keep rate a quarter of delivered surveys fell
 * below, per route, the same figure the Per respondent tab prints as "buy N×
 * the target". A route with too few delivered surveys to measure falls back to
 * these, the finance spec's figures: 1.6 for PureSpectrum panel work, 1.4 for
 * B2B blasts. Each row says which one it used.
 */
export const BUY_MULTIPLE: Record<'panel' | 'blast', number> = { panel: 1.6, blast: 1.4 }

/** The multiple per route, and where it came from. */
export interface BuyRule {
  panel: number
  blast: number
  /** Delivered surveys behind a measured multiple; null = the spec's default. */
  panelN: number | null
  blastN: number | null
}

export const DEFAULT_BUY_RULE: BuyRule = { panel: BUY_MULTIPLE.panel, blast: BUY_MULTIPLE.blast, panelN: null, blastN: null }

/** The rule measured on a set of delivered surveys, route by route, with the
 *  spec's figure standing in where a route cannot be measured. */
export function buyRuleOf(
  delivered: FinProject[], raw: Pick<ThisWeekInput, 'blasts' | 'suppliers' | 'costs'>, ix?: FinIndex,
): BuyRule {
  const m = buyMultiples(delivered, raw, ix)
  return {
    panel: m.panel?.multiple ?? BUY_MULTIPLE.panel,
    blast: m.blast?.multiple ?? BUY_MULTIPLE.blast,
    panelN: m.panel ? m.panel.of : null,
    blastN: m.blast ? m.blast.of : null,
  }
}

/** A survey fielded both ways gets the more generous of the two multiples, so
 *  it is never told to stop while one route could still legitimately be short.
 *  A survey with no field rows is not buying anything. */
export function buyMultipleOf(route: Route, rule: BuyRule = DEFAULT_BUY_RULE): number | null {
  if (route === 'panel') return rule.panel
  if (route === 'blast') return rule.blast
  if (route === 'both') return Math.max(rule.panel, rule.blast)
  return null
}

/** "1.6× (measured on 57 delivered panel surveys)" / "1.6× (the default: too
 *  few delivered panel surveys to measure one)". */
function multipleWords(route: 'panel' | 'blast', rule: BuyRule): string {
  const n = route === 'panel' ? rule.panelN : rule.blastN
  const x = times(route === 'panel' ? rule.panel : rule.blast)
  return n != null
    ? `${x} ${route} (measured on ${fmtNum(n)} delivered ${route} surveys)`
    : `${x} ${route} (the default: too few delivered ${route} surveys to measure one)`
}

/** Board columns where buying has stopped and the survey is being checked. The
 *  legacy kanban's Review and Done count as QA too; every other live column
 *  can still be buying respondents. */
export const QA_COLUMNS = new Set(['Data QA', 'Review', 'Done'])

/** A group with more than this many rows collapses behind "Show all N". */
export const COLLAPSE_AFTER = 5

/** A series due within this many days, with nothing buying yet, is this week's
 *  decision — "this week" is the tab's name, so the window is seven days. */
export const SERIES_DUE_WITHIN_DAYS = 7

/** Board columns that mean a wave has started collecting, for a wave with no
 *  field rows recorded yet. */
const COLLECTING_COLUMNS = new Set(['Fielding', 'Data QA', 'Review'])

/* ── VERBS ──────────────────────────────────────────────────────────────── */

export type Verb =
  | 'freeze' | 'confirm' | 'stop' | 'cap' | 'budget' | 'price'
  | 'topup' | 'trial' | 'series' | 'hold'

/** Display order: money still moving first, then records to fix, then the
 *  decisions outside live work. The hold bucket is always its own card. */
export const VERB_ORDER: Verb[] = [
  'freeze', 'confirm', 'stop', 'cap', 'budget', 'price', 'topup', 'trial', 'series', 'hold',
]

export interface VerbMeta {
  label: string
  /** The rule, in one plain sentence — printed under the verb. */
  rule: string
  /** The (i) text: why the rule exists and how "at stake" is measured. */
  help: string
  /** Rows are live or held surveys, so the group draws a bullet per row. */
  bullets: boolean
  /** Where the row sits, for the export. */
  bucket: string
  /** Tables the rule is computed from. */
  needs: FinanceTable[]
}

/** 1.6×, 1.25× — two decimals at most, never float noise. */
const times = (x: number) => `${Math.round(x * 100) / 100}×`
const COST_TABLES: FinanceTable[] = ['project_blasts', 'project_suppliers', 'project_costs']

/**
 * A survey can sell a RANGE: an N target and an N maximum (n_target_max). The
 * two ends mean different things and one card used to print both as "the N
 * sold" without saying they differed — a $4,000 contract on one line and a
 * bill of up to $5,000 on the next.
 *
 * The rule, stated once and repeated in every (i) that depends on it: the
 * contract value and the 50% goal are measured at the BOTTOM of the range (the
 * N we are sure of), and what can be billed runs to the TOP (revenue.ts
 * `capOf`). Wherever a survey carries a range, the card prints both ends.
 */
const RANGE_HELP =
  'Where a survey sold a range (an N target and a maximum), the contract value and the 50% goal are measured at the bottom of the range — the N we are sure of — and the bill can run to the top.'

export const VERB_META: Record<Verb, VerbMeta> = {
  freeze: {
    label: 'FREEZE THE BID',
    rule: 'Still buying respondents, and has already spent more than half its contract value.',
    help: `Contract value is the price per N × the N sold. Half of it is the spend goal (a starting goal, not a rule). At stake is the spend past that goal: margin already given up. ${RANGE_HELP}`,
    bullets: true, bucket: 'Live', needs: ['project_financials', ...COST_TABLES],
  },
  confirm: {
    label: 'CONFIRM FINAL N',
    rule: 'In QA — buying has stopped — and has spent more than half its contract value.',
    help: `Nothing more is being bought, so the lever left is the bill: it is the price per N × the N actual, up to the top of what was sold. At stake is the spend past the 50% goal. ${RANGE_HELP}`,
    bullets: true, bucket: 'Live', needs: ['project_financials', ...COST_TABLES],
  },
  stop: {
    label: 'STOP BUYING',
    rule: 'Still buying, and has collected more than the route’s buy multiple × the N sold.',
    help: 'The buy multiple is how many completes we buy per respondent the client needs, because QA removes some. Past it, extra completes are very unlikely to be billed. At stake is those extra completes at this survey’s cost per complete. Where a range was sold, the multiple is measured against the TOP of the range, so a survey is never told to stop while it could still legitimately be short.',
    bullets: true, bucket: 'Live', needs: ['project_blasts', 'project_suppliers'],
  },
  cap: {
    label: 'CAP THE WAVE',
    rule: 'A PureSpectrum wave on a survey still buying has collected more than its own wave target.',
    help: 'SOCC’s supplier cap is a record, not a limit: nothing reads it to stop a supplier. Only the survey Goal in PureSpectrum stops a wave. At stake is the completes past the wave target, at that wave’s cost per complete.',
    bullets: true, bucket: 'Live', needs: ['project_suppliers', 'project_launches'],
  },
  budget: {
    label: 'SET A BUDGET',
    rule: 'Live and spending, with no budget set.',
    help: 'A budget is the most we plan to spend — a cost ceiling, never revenue. The suggestion is half of price × target, a starting goal and not a rule. At stake is what has been spent with no ceiling.',
    bullets: true, bucket: 'Live', needs: COST_TABLES,
  },
  price: {
    label: 'PRICE IT',
    rule: 'Live with no client price per N, or no N target.',
    help: 'Without both, the survey has no contract value, so its margin can never be measured. Ranked by what it has spent so far.',
    bullets: true, bucket: 'Live', needs: ['project_financials', ...COST_TABLES],
  },
  topup: {
    label: 'TOP UP THE CONTRACT',
    rule: 'A credit contract has more credits drawn on delivered and live work than its pool.',
    help: 'Credits are counts. Their dollar value is derived: from the contract value on file where there is one, else from the rate the contract’s own priced surveys imply. Credits on held surveys are shown apart and not counted as drawn.',
    bullets: false, bucket: 'Credit contract', needs: ['client_terms'],
  },
  trial: {
    label: 'CONVERT THE TRIAL',
    rule: 'Delivered at a $0 price, and the account has bought nothing priced since.',
    help: 'A $0 price is work given away on purpose, usually to win the account. At stake is our field cost on the free surveys.',
    bullets: false, bucket: 'Delivered (free trial)', needs: ['project_financials', ...COST_TABLES],
  },
  series: {
    label: 'CHECK THE SERIES',
    rule: `A recurring survey is due within ${SERIES_DUE_WITHIN_DAYS} days or overdue with no wave buying yet, or its next wave’s target fell.`,
    help: 'Due is computed from the last DELIVERED wave plus the series cadence (from the latest resume, if it was paused and resumed) — never from a spawned wave nobody launched. At stake is one wave at its price per N.',
    bullets: false, bucket: 'Recurring series', needs: [],
  },
  hold: {
    label: 'RESUME OR CANCEL',
    rule: 'On hold.',
    help: 'Its own bucket, never in a live figure. Days on hold are shown only where the change log records a real status change to Hold; a system sync stamp is not one. At stake is the spend already sunk.',
    bullets: true, bucket: 'On hold', needs: [],
  },
}

/* ── INPUT ──────────────────────────────────────────────────────────────── */

/** An extra read the tab makes for itself, with the three states a card must
 *  tell apart: loaded, still loading, and failed (Blocked — never "none"). */
export type Extra<T> =
  | { state: 'ok'; value: T }
  | { state: 'loading' }
  | { state: 'blocked'; table: string }

/** The survey fields this tab reads that FinProject does not declare. The
 *  loader selects '*', so they arrive; they are optional so a fixture can
 *  leave them out. */
export type WeekProject = FinProject & {
  captain_id?: string | null
  series_id?: string | null
  rerun_number?: number | null
  wave_order?: number | null
  rerun_date?: string | null
}

/** One rerun_series row (073) — the cadence and the pause/service switches.
 *  Read from the TABLE, never from rerun_series_status, whose due date counts
 *  unlaunched shells as waves (finance spec, defect on 074:23-28). */
export interface SeriesRecord {
  id: string
  client_id: string | null
  survey_name: string | null
  cadence_months: number | null
  paused: boolean | null
  in_service: boolean | null
  resume_anchor: string | null
}

/** One project_audit row, as the hold-age read selects it. */
export interface AuditStatusRow {
  project_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

/** How long a survey has been on hold, as far as the log can say. */
export interface HoldSince {
  /** ET date of the change to Hold, or null when it cannot be known. */
  since: string | null
  /** Who made it (email prefix), when recorded. */
  by: string | null
  /** recorded = a person changed the status to Hold; sync-only = the only
   *  record is a system stamp (sheet sync or import), not a real decision;
   *  no-record = nothing in the log at all. */
  why: 'recorded' | 'sync-only' | 'no-record'
}

export interface WeekLaunch {
  id: string
  project_id: string
  target: number | null
  label?: string | null
  launch_date?: string | null
}

export type WeekSupplier = FinSupplier & { launch_id?: string | null }

export type WeekTerm = FinTerm & { starts_on?: string | null; renews_on?: string | null }

export interface ThisWeekInput {
  /** props.population — live work × account × route. */
  population: FinItem[]
  /** props.side — Hold × account × route. Its own bucket. */
  side: FinItem[]
  /** Every non-placeholder survey, classified once (props.items). */
  items: FinItem[]
  /** raw.projects — placeholders included. Read ONLY to see a series' next
   *  planned wave (its target and date); a placeholder never enters a figure. */
  projects: FinProject[]
  rates: Map<string, number>
  blasts: FinBlast[]
  suppliers: WeekSupplier[]
  launches: WeekLaunch[]
  costs: FinCost[]
  ix: FinIndex
  terms: WeekTerm[]
  filter: FinanceFilter
  today: string
  accountName: (clientId: string | null | undefined) => string
  /** Tables the shell's load could not read. */
  blocked: FinanceTable[]
  /** load.ts priceBlockText — prices failed or none came back. */
  priceBlocked: string | null
  /** client_term_financials dollars_total by term id (finance-only table). */
  termDollars: Extra<Map<string, number | null>>
  series: Extra<SeriesRecord[]>
  holdSince: Extra<Map<string, HoldSince>>
  /** team_members id → name, for the captain. */
  owners: Extra<Map<string, string>>
}

/* ── OUTPUT ─────────────────────────────────────────────────────────────── */

/** What one bullet bar draws (Chart C3). */
export interface WeekBullet {
  spend: number
  /** Price × N sold. 0 = a $0 price ("given away"); null = cannot be known. */
  contract: number | null
  /** Why `contract` is null. */
  missing: 'no price' | 'no target' | null
  budget: number | null
  /** Half the contract value — the 50% goal tick. */
  goal: number | null
  collected: number | null
  target: number | null
}

export interface WeekRow {
  key: string
  verb: Verb
  /** The survey the row is about: its code links to it, and "Add as next
   *  step" writes to it. */
  id: string
  code: string | null
  accountId: string | null
  account: string
  owner: string
  /** Why the owner reads "—" or "…", for a title=. */
  ownerNote: string | null
  /** Other surveys the row names (more free trials, the last delivered wave). */
  also: { id: string; code: string | null }[]
  happened: string
  /** Dollars at stake, for ranking. null = no dollar figure can be computed. */
  stake: number | null
  stakeText: string
  /** The stake is a derived dollar value of credits. */
  derived: boolean
  action: string
  /** The row as one short imperative clause, for the card's verdict:
   *  "freeze the bid on PR00448 today: it has spent 88% of its price". */
  headline: string
  spend: number
  cls: FinClass
  bullet: WeekBullet | null
}

export interface WeekGroup {
  verb: Verb
  meta: VerbMeta
  rows: WeekRow[]
  /** The first COLLAPSE_AFTER rows when collapsed, else every row. */
  visible: WeekRow[]
  collapsed: boolean
  hiddenCount: number
  /** Σ of the rows' dollar stakes. Each row in a group is a different survey
   *  (or contract), so the sum counts nothing twice WITHIN the group — but a
   *  survey can need more than one decision, so two groups' totals can cover
   *  the same money and must never be added together (`overlapNote`). */
  stakeTotal: number
  /** Rows with no dollar figure, which the total leaves out. */
  stakeUnknown: number
  /** "Blocked: <table> did not load" — when set, rows are empty and the group
   *  must not read as "nothing to do". */
  blocked: string[]
  /** Set while an extra read is still loading. */
  pending: string | null
  note: string | null
}

export interface CreditPool {
  termId: string
  name: string
  accountId: string | null
  account: string
  /** credits_total, or null when never recorded. */
  pool: number | null
  delivered: number
  live: number
  hold: number
  deliveredSurveys: number
  liveSurveys: number
  holdSurveys: number
  /** delivered + live. Held credits are shown apart and not counted. */
  used: number
  /** max(0, used − pool); 0 when the pool is unknown. */
  over: number
  latestId: string | null
  latestCode: string | null
  /** Live priced surveys at the account carrying no credits. */
  queued: { ids: string[]; codes: (string | null)[]; value: number; creditsEquiv: number | null }
  startsOn: string | null
  renewsOn: string | null
  /** Share of the term elapsed (can pass 1 after the renewal date). */
  elapsed: number | null
  perCredit: { value: number; source: 'agreed' | 'implied'; n: number } | null
  /** Why there is no $ per credit, when there is none: nothing on the contract
   *  carries both credits and a price, or the agreed values are not read yet.
   *  Never "$0" — a rate that cannot be derived is not a rate of nothing. */
  perCreditNote: string
  /** over × perCredit — derived, never a stored figure. */
  overDollars: number | null
  sentence: string
}

export interface ThisWeekHeader {
  live: number
  /** Recorded field cost on the live surveys. Meaningless — and never shown —
   *  when `spendBlocked` is set: every cost table failed, so it is 0. */
  spent: number
  /** Set when EVERY cost table failed, so no spend figure may be printed:
   *  the tab shows this reason in place of the dollars (rule 6). */
  spendBlocked: string | null
  liveIds: string[]
  /** Live surveys with a price ($0 included) AND an N target. */
  pricedWithTarget: number
  worthAtTarget: number
  pricedIds: string[]
  noPrice: number
  /** Priced, but with no N target. */
  noTarget: number
  holds: number
  holdSpend: number
  holdIds: string[]
  scoping: number
  priceBlocked: string | null
  sentence: string
}

export interface ThisWeekModel {
  header: ThisWeekHeader
  /** Every verb but hold, in VERB_ORDER, empty groups included. */
  groups: WeekGroup[]
  hold: WeekGroup
  /** Verbs that ran and found nothing (not blocked, not pending). */
  clear: Verb[]
  pools: CreditPool[]
  poolsVerdict: string
  /** Why the agreed dollar value of a contract could not be read, when it
   *  could not. Printed on the pool card, where the derived rate is shown. */
  poolsNote: string | null
  /** Measured: a survey can need more than one decision, so the group totals
   *  overlap and must never be added together. Null when none overlaps. */
  overlapNote: string | null
  verdict: string
  holdVerdict: string
  exportColumns: { key: string; header: string }[]
  exportRows: Record<string, string | number | null>[]
}

/* ── SMALL HELPERS ──────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "23 Jun", or "23 Jun 2025" when the year is not today's. */
export function dayText(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`
}

const utc = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z')

/** Whole days from a to b (b − a), both ISO dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * ISO date + a number of months, clamped to the month's last day (31 Jan + 1
 * month = 28 Feb), which is what Postgres `make_interval(months => …)` does, so
 * the tab agrees with the Reruns page on a whole-month cadence. A fractional
 * cadence is counted in average-length days.
 */
export function addMonths(iso: string, months: number): string {
  if (!Number.isInteger(months)) return addDays(iso, Math.round(months * 30.4375))
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12), nm = total - ny * 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`
}

/** An audit timestamp as the office's calendar date (Eastern). */
const etDate = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** Credits can be fractional (repeat-wave discounts), so one decimal at most.
 *  A count, never dollars. */
export const creditsText = (n: number) => fmtNum(Math.round(n * 10) / 10)
const credits = creditsText

const plural = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`

/** "PR00478 and PR00479", "PR00478, PR00479 and 2 more". */
function codeList(codes: (string | null)[], max = 3): string {
  const c = codes.map(x => x ?? '(no code)')
  if (c.length <= 1) return c.join('')
  const shown = c.slice(0, max)
  const rest = c.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${plural(rest, 'more', 'more')}`
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** AlphaROC's own account — internal research, not a client. The same test the
 *  Improve tab uses (lib/finance/improve.ts). Its surveys still count as live
 *  work and still need budgets, but there is no client to price them for and
 *  no trial to convert. */
const OWN_FIRM = /^alpharoc\b/i
const ownFirm = (input: Pick<ThisWeekInput, 'accountName'>, p: FinProject) =>
  p.project_type === 'Internal' || OWN_FIRM.test(input.accountName(p.client_id).trim())

/** Ranked by dollars at stake; rows with no dollar figure after, by spend. */
function rank(rows: WeekRow[]): WeekRow[] {
  return rows.slice().sort((a, b) => {
    if (a.stake != null && b.stake != null && a.stake !== b.stake) return b.stake - a.stake
    if (a.stake != null && b.stake == null) return -1
    if (a.stake == null && b.stake != null) return 1
    if (a.spend !== b.spend) return b.spend - a.spend
    return (a.code ?? '').localeCompare(b.code ?? '')
  })
}

/* ── HOLD AGE ───────────────────────────────────────────────────────────── */

/**
 * How long each survey has been on hold, from its status history.
 *
 * The most recent change INTO Hold starts the current hold. It counts only
 * when a person made it: the audit trigger stamps service-role writes (the
 * sheet sync, imports, scripts) as 'system', and several held surveys carry
 * only such a stamp — the day the sync ran, not the day anyone decided to
 * pause the work. Those read "since unknown" rather than a confident, wrong
 * number of days.
 */
export function holdSinceOf(rows: AuditStatusRow[], ids: string[]): Map<string, HoldSince> {
  const by = new Map<string, AuditStatusRow[]>()
  for (const r of rows) {
    if (r.field !== 'status') continue
    const a = by.get(r.project_id)
    if (a) a.push(r); else by.set(r.project_id, [r])
  }
  const out = new Map<string, HoldSince>()
  for (const id of ids) {
    const toHold = (by.get(id) ?? [])
      .filter(r => r.new_value === 'Hold')
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
    const last = toHold[toHold.length - 1]
    if (!last) { out.set(id, { since: null, by: null, why: 'no-record' }); continue }
    const who = (last.changed_by ?? '').trim()
    const real = who !== '' && who !== 'system' && last.old_value != null && last.old_value !== 'Hold'
    out.set(id, real
      ? { since: etDate(last.changed_at), by: who.split('@')[0], why: 'recorded' }
      : { since: null, by: null, why: 'sync-only' })
  }
  return out
}

/* ── PER-SURVEY FACTS ───────────────────────────────────────────────────── */

interface Facts {
  it: FinItem
  p: WeekProject
  sp: Spend
  rate: number | null
  target: number | null
  cap: number | null
  contract: number | null
  goal: number | null
  budget: number | null
  collected: number | null
}

function factsOf(it: FinItem, input: ThisWeekInput): Facts {
  const p = it.p as WeekProject
  const sp = spendOf(p, input.blasts, input.suppliers, input.costs, input.ix)
  const r = input.rates.get(p.id)
  const rate = r == null ? null : r
  const t = num(p.n_target)
  const target = t != null && t > 0 ? t : null
  const contract = rate != null && target != null ? rate * target : null
  const b = num(p.budget)
  return {
    it, p, sp, rate, target,
    cap: capOf({ nMin: num(p.n_target), nMax: num(p.n_target_max) }),
    contract,
    goal: contract != null && contract > 0 ? (1 - KEEP_GOAL) * contract : null,
    budget: b != null && b > 0 ? b : null,
    collected: num(p.n_collected),
  }
}

const bulletOf = (f: Facts): WeekBullet => ({
  spend: f.sp.total,
  contract: f.contract,
  missing: f.contract != null ? null : f.rate == null ? 'no price' : 'no target',
  budget: f.budget,
  goal: f.goal,
  collected: f.collected,
  target: f.target,
})

function ownerOf(p: WeekProject, owners: Extra<Map<string, string>>): { owner: string; ownerNote: string | null } {
  if (owners.state === 'loading') return { owner: '…', ownerNote: 'Loading the team list' }
  if (owners.state === 'blocked') return { owner: '—', ownerNote: `${owners.table} did not load` }
  const id = p.captain_id ?? null
  if (!id) return { owner: 'No captain', ownerNote: 'Nobody is set as captain on this survey' }
  return { owner: owners.value.get(id) ?? '(unknown member)', ownerNote: null }
}

function rowBase(
  verb: Verb, p: WeekProject, cls: FinClass, input: ThisWeekInput,
): Pick<WeekRow, 'verb' | 'id' | 'code' | 'accountId' | 'account' | 'owner' | 'ownerNote' | 'cls' | 'key'> {
  return {
    key: `${verb}:${p.id}`,
    verb, id: p.id, code: p.project_code, cls,
    accountId: p.client_id, account: input.accountName(p.client_id),
    ...ownerOf(p, input.owners),
  }
}

/** True when the survey sold a RANGE — an N target and a higher maximum — so
 *  "the N sold" is two numbers and the card has to print both. */
const soldRange = (f: Facts): boolean => f.target != null && f.cap != null && f.cap > f.target

/** "100 sold", or "80–100 sold" where a range was sold. */
function soldText(f: Facts): string {
  return soldRange(f) ? `${fmtNum(f.target)}–${fmtNum(f.cap)} sold` : `${fmtNum(f.cap ?? f.target)} sold`
}

/**
 * "spent 88% of its $5,250 contract ($4,620), past its $3,150 budget", and
 * where a range was sold, both ends of the contract with the end the
 * percentage is measured at named: the card used to print one figure here and
 * a different one in the action line, without saying they were two ends of the
 * same range.
 */
function spentOfContract(f: Facts): string {
  const c = f.contract as number
  const budget = f.budget == null
    ? ', with no budget set'
    : f.sp.total > f.budget ? `, past its ${money(f.budget)} budget` : `, inside its ${money(f.budget)} budget`
  if (!soldRange(f) || f.rate == null) {
    return `spent ${pctText(f.sp.total / c)} of its ${money(c)} contract (${money(f.sp.total)})${budget}`
  }
  const top = money(f.rate * (f.cap as number))
  return `spent ${money(f.sp.total)}, ${pctText(f.sp.total / c)} of the ${money(c)} at the bottom of its ` +
    `${money(c)}–${top} contract (${fmtNum(f.target)}–${fmtNum(f.cap)} N sold)${budget}`
}

/** At stake for the two money verbs: the spend past the 50% goal. */
function pastGoalStake(f: Facts): { stake: number; stakeText: string } {
  const c = f.contract as number, g = f.goal as number
  const past = f.sp.total - g
  const tail = f.sp.total > c
    ? `; ${money(f.sp.total - c)} past the contract value, a loss so far`
    : `; ${money(c - f.sp.total)} left before it loses money`
  return { stake: past, stakeText: `${money(past)} spent past the 50% goal${tail}` }
}

const FREEZE_ACTION: Record<Route, string> = {
  blast: 'Freeze the bid: no higher reward and no new blast without sign-off.',
  panel: 'Freeze the CPI: no higher CPI and no new wave without sign-off.',
  both: 'Freeze the bid and the CPI: no increase and no new blast or wave without sign-off.',
  none: 'Freeze spending: nothing new bought without sign-off.',
}

const STOP_ACTION: Record<Route, string> = {
  blast: 'Stop buying: send no more blasts on this survey.',
  panel: 'Stop buying: set the PureSpectrum Goal to the N already collected and close any open wave.',
  both: 'Stop buying: send no more blasts, and set the PureSpectrum Goal to the N already collected.',
  none: 'Stop buying.',
}

/** Where a row's multiple came from, in words. */
function multSource(route: Route, rule: BuyRule): string {
  const which: 'panel' | 'blast' = route === 'blast' ? 'blast' : route === 'panel' ? 'panel' : rule.panel >= rule.blast ? 'panel' : 'blast'
  const n = which === 'panel' ? rule.panelN : rule.blastN
  return n != null ? `, measured on ${fmtNum(n)} delivered ${which} surveys` : ' (the default: too few delivered surveys to measure one)'
}

const ROUTE_WORD: Record<Route, string> = { blast: 'blast', panel: 'panel', both: 'mixed-route', none: '' }

/* ── THE MODEL ──────────────────────────────────────────────────────────── */

/** Scoping under the tab's account and route filters — counted, never valued. */
const SCOPING_RULE: TabRule = {
  classes: ['scoping'], side: [], date: false, account: true, route: true, word: 'Scoping',
}

/**
 * Why no spend on this tab can be read at all, or null when at least one cost
 * table came back.
 *
 * `spendOf` sums the three cost tables. With one or two missing, a total is
 * still a figure — a FLOOR — and every card carrying one says so (load.ts
 * `costFloorText`). With all three missing it is 0 for every survey, and a $0
 * beside "on hold" reads as "these holds cost us nothing", which is the one
 * thing a failed read must never say. The verb groups that spend money already
 * name the cost tables in `needs` and go Blocked; the hold bucket does not,
 * because a held survey still needs a resume-or-cancel decision whether or not
 * its spend can be read — so its rows stay and its DOLLARS go away.
 */
export function spendBlockedText(blocked: FinanceTable[]): string | null {
  const failed = COST_TABLES.filter(t => blocked.includes(t))
  return failed.length === COST_TABLES.length
    ? `Blocked: ${failed.join(', ')} did not load, so no spend can be read`
    : null
}

/**
 * Why a credit contract's AGREED dollar value is missing, or null when that
 * read is in. A failed read is not "nobody agreed a value": without this, a
 * pool prints the rate its own priced surveys imply exactly as it would print
 * an agreed one.
 */
export function termDollarsNote(termDollars: Extra<unknown>): string | null {
  if (termDollars.state === 'blocked') {
    return `Blocked: ${termDollars.table} did not load, so any dollar value here is implied by the contract’s own priced surveys, not agreed.`
  }
  if (termDollars.state === 'loading') return 'Reading the agreed contract values; any dollar value of credits is held back until they are in.'
  return null
}

function blockedTexts(verb: Verb, input: ThisWeekInput): string[] {
  const out = VERB_META[verb].needs
    .filter(t => input.blocked.includes(t))
    .map(t => `Blocked: ${t} did not load`)
  const pricey = VERB_META[verb].needs.includes('project_financials')
  if (pricey && input.priceBlocked && !out.some(t => t.includes('project_financials'))) out.push(input.priceBlocked)
  return out
}

function group(
  verb: Verb, rows: WeekRow[],
  opts: { blocked?: string[]; pending?: string | null; note?: string | null; keepOrder?: boolean; rule?: string } = {},
): WeekGroup {
  const blocked = opts.blocked ?? []
  const ranked = blocked.length ? [] : opts.keepOrder ? rows.slice() : rank(rows)
  const collapsed = ranked.length > COLLAPSE_AFTER
  return {
    verb, meta: opts.rule ? { ...VERB_META[verb], rule: opts.rule } : VERB_META[verb], rows: ranked,
    visible: collapsed ? ranked.slice(0, COLLAPSE_AFTER) : ranked,
    collapsed, hiddenCount: collapsed ? ranked.length - COLLAPSE_AFTER : 0,
    stakeTotal: ranked.reduce((t, r) => t + (r.stake ?? 0), 0),
    stakeUnknown: ranked.filter(r => r.stake == null).length,
    blocked, pending: blocked.length ? null : (opts.pending ?? null), note: opts.note ?? null,
  }
}

export function buildThisWeekModel(input: ThisWeekInput): ThisWeekModel {
  // Re-checked here so a caller that mixed the buckets still cannot put a held
  // survey into a live figure, or a live one into the hold bucket.
  const live = input.population.filter(it => it.cls === 'active')
  const held = input.side.filter(it => it.cls === 'hold')
  const liveFacts = live.map(it => factsOf(it, input))
  const heldFacts = held.map(it => factsOf(it, input))

  /* Header. */
  const spent = liveFacts.reduce((t, f) => t + f.sp.total, 0)
  const priced = liveFacts.filter(f => f.contract != null)
  const spendBlocked = spendBlockedText(input.blocked)
  const header: ThisWeekHeader = {
    live: live.length,
    spent,
    spendBlocked,
    liveIds: live.map(it => it.p.id),
    pricedWithTarget: input.priceBlocked ? 0 : priced.length,
    worthAtTarget: input.priceBlocked ? 0 : priced.reduce((t, f) => t + (f.contract as number), 0),
    pricedIds: input.priceBlocked ? [] : priced.map(f => f.p.id),
    noPrice: input.priceBlocked ? 0 : liveFacts.filter(f => f.rate == null).length,
    noTarget: input.priceBlocked ? 0 : liveFacts.filter(f => f.rate != null && f.target == null).length,
    holds: held.length,
    holdSpend: heldFacts.reduce((t, f) => t + f.sp.total, 0),
    holdIds: held.map(it => it.p.id),
    scoping: populationByRule(input.items, SCOPING_RULE, input.filter, input.today).length,
    priceBlocked: input.priceBlocked,
    sentence: '',
  }
  header.sentence = headerSentence(header)

  /* Live-work verbs. One "buying" verb per survey — STOP BUYING, then CAP THE
   * WAVE, then FREEZE THE BID (or CONFIRM FINAL N once in QA) — because the
   * stronger instruction makes the weaker one moot; the row still says when the
   * survey is also past half its price. SET A BUDGET and PRICE IT are records to
   * fix, so they stand beside whichever buying verb applies. */
  const byVerb: Record<Verb, WeekRow[]> = {
    freeze: [], confirm: [], stop: [], cap: [], budget: [], price: [],
    topup: [], trial: [], series: [], hold: [],
  }
  const pricesOk = !input.priceBlocked && !input.blocked.includes('project_financials')
  const launchesBy = new Map<string, WeekLaunch[]>()
  for (const l of input.launches) {
    const a = launchesBy.get(l.project_id)
    if (a) a.push(l); else launchesBy.set(l.project_id, [l])
  }
  const byLaunch = new Map<string, WeekSupplier[]>()
  for (const s of input.suppliers) {
    if (!s.launch_id) continue
    const a = byLaunch.get(s.launch_id)
    if (a) a.push(s); else byLaunch.set(s.launch_id, [s])
  }

  let ownFirmUnpriced = 0
  // Measured on every delivered survey in the load, not the filtered view: a
  // multiple is a fact about the route, and one account alone is too few.
  const buyRule = buyRuleOf(input.items.filter(it => it.cls === 'delivered').map(it => it.p), input, input.ix)
  for (const f of liveFacts) {
    const { p, sp, it } = f
    const buying = !QA_COLUMNS.has(p.board_column ?? '')
    const pastHalf = pricesOk && f.contract != null && f.contract > 0 && f.goal != null && sp.total > f.goal
    const alsoHalf = pastHalf ? ` It has also ${spentOfContract(f)}.` : ''
    const base = (v: Verb) => ({ ...rowBase(v, p, it.cls, input), also: [], spend: sp.total, derived: false, bullet: bulletOf(f) })
    const code = p.project_code ?? '(no code)'

    // STOP BUYING — past the route's multiple of the N sold (top of the range).
    const mult = buyMultipleOf(it.route, buyRule)
    const limit = mult != null && f.cap != null && f.cap > 0 ? f.cap * mult : null
    const stopHit = buying && limit != null && f.collected != null && f.collected > limit + 1e-9

    // CAP THE WAVE — a PureSpectrum wave past its own target.
    const overWaves: { label: string; got: number; target: number; over: number; cost: number }[] = []
    if (buying && !stopHit) {
      // In launch order, so an unlabelled "Wave 2" is the second wave launched.
      const ls = (launchesBy.get(p.id) ?? []).slice()
        .sort((a, b) => String(a.launch_date ?? '').localeCompare(String(b.launch_date ?? '')) || a.id.localeCompare(b.id))
      ls.forEach((l, i) => {
        const t = num(l.target)
        if (t == null || !(t > 0)) return
        const rows = byLaunch.get(l.id) ?? []
        const got = rows.reduce((s, r) => s + Number(r.n_collected ?? 0), 0)
        if (!(got > t)) return
        const cost = rows.reduce((s, r) => s + Number(r.cpi ?? 0) * Number(r.n_collected ?? 0), 0)
        overWaves.push({ label: l.label?.trim() || `Wave ${i + 1}`, got, target: t, over: got - t, cost: (got - t) * (cost / got) })
      })
    }

    if (stopHit) {
      const over = Math.ceil((f.collected as number) - (limit as number))
      const cpc = sp.paidCompletes > 0 ? sp.total / sp.paidCompletes : null
      byVerb.stop.push({
        ...base('stop'),
        // The multiple is measured against the TOP of a sold range, so the
        // words say which end they mean rather than calling one figure "sold".
        happened: `Still buying, and has collected ${fmtNum(f.collected)} against ${soldText(f)} — past ${times(mult as number)}${soldRange(f) ? ' the top of that' : ''} (${fmtNum(Math.round(limit as number))}), the ${ROUTE_WORD[it.route]} buy multiple${multSource(it.route, buyRule)}.${alsoHalf}`,
        stake: cpc != null ? over * cpc : null,
        stakeText: cpc != null
          ? `${plural(over, 'complete')} past the multiple ≈ ${money(over * cpc)} at ${money(cpc)} each`
          : `${plural(over, 'complete')} past the multiple (no cost per complete recorded)`,
        action: STOP_ACTION[it.route],
        headline: `stop buying on ${code}: ${plural(over, 'complete')} past its buy multiple`,
      })
    } else if (overWaves.length) {
      const shown = overWaves.slice(0, 3)
        .map(w => `${w.label} collected ${fmtNum(w.got)} against a wave target of ${fmtNum(w.target)} (+${fmtNum(w.over)})`)
      const more = overWaves.length > 3 ? `; and ${plural(overWaves.length - 3, 'more wave')}` : ''
      const overN = overWaves.reduce((t, w) => t + w.over, 0)
      const cost = overWaves.reduce((t, w) => t + w.cost, 0)
      byVerb.cap.push({
        ...base('cap'),
        happened: `${shown.join('; ')}${more}.${alsoHalf}`,
        stake: cost,
        stakeText: `${plural(overN, 'complete')} past the wave target${overWaves.length === 1 ? '' : 's'} ≈ ${money(cost)}`,
        action: 'Set the supplier Goal in PureSpectrum; SOCC’s cap is a record, not a limit.',
        headline: `set the PureSpectrum Goal on ${code}: ${plural(overN, 'complete')} past ${overWaves.length === 1 ? 'its wave target' : 'its wave targets'}`,
      })
    } else if (pastHalf) {
      const s = pastGoalStake(f)
      if (buying) {
        byVerb.freeze.push({
          ...base('freeze'),
          happened: `Still buying, and has ${spentOfContract(f)}.`,
          ...s,
          action: FREEZE_ACTION[it.route],
          headline: `freeze the bid on ${code} today: it has spent ${pctText(sp.total / (f.contract as number))} of its price`,
        })
      } else {
        byVerb.confirm.push({
          ...base('confirm'),
          happened: `In ${p.board_column}: buying has stopped, and it has ${spentOfContract(f)}.`,
          ...s,
          action: `Confirm the final N actual with QA and record it: the bill is ${money(f.rate as number)} per N × the N actual, up to ${fmtNum(f.cap)}${soldRange(f) ? `, the top of the ${fmtNum(f.target)}–${fmtNum(f.cap)} sold` : ''}.`,
          headline: `confirm the final N on ${code}: it has spent ${pctText(sp.total / (f.contract as number))} of its price`,
        })
      }
    }

    // SET A BUDGET — spending with no ceiling.
    if (sp.total > 0 && f.budget == null) {
      const sugg = pricesOk ? suggestedBudget(f.rate, f.target) : null
      const action = sugg != null
        ? `Set a budget. Suggested: ${money(sugg)}, half of ${money(f.rate as number)} per N × ${fmtNum(f.target)} (a starting goal, not a rule).`
        : !pricesOk
          ? 'Set a budget. Prices did not load, so there is no suggested figure.'
          : f.rate === 0
            ? 'Set a budget. It is priced at $0, so there is no suggested figure.'
            : 'Set a budget. Give it a price per N and an N target first to get a suggested figure.'
      byVerb.budget.push({
        ...base('budget'),
        happened: `Has spent ${money(sp.total)} with no budget set.`,
        stake: sp.total,
        stakeText: `${money(sp.total)} spent with no ceiling`,
        action,
        headline: `set a budget on ${code} first (${money(sp.total)} spent with no ceiling)`,
      })
    }

    // PRICE IT — no price, or no target. AlphaROC's own surveys are left out:
    // there is no client to price them for.
    if (pricesOk && (f.rate == null || f.target == null) && ownFirm(input, p)) ownFirmUnpriced++
    else if (pricesOk && (f.rate == null || f.target == null)) {
      const cr = num(p.credits)
      const creditNote = f.rate == null && cr != null && cr > 0 ? ` It carries ${credits(cr)} credits, but no price per N.` : ''
      const happened = f.rate == null
        ? `No client price${f.target == null ? ' and no N target' : ''} recorded; ${money(sp.total)} spent so far.${creditNote}`
        : `Priced at ${money(f.rate)} per N but has no N target, so it has no contract value; ${money(sp.total)} spent so far.`
      byVerb.price.push({
        ...base('price'),
        happened,
        stake: sp.total,
        stakeText: sp.total > 0 ? `${money(sp.total)} spent that cannot reach a margin yet` : 'Nothing spent yet: price it before it starts',
        action: f.rate == null && f.target == null
          ? 'Enter the price per N and the N target on the project page.'
          : f.rate == null ? 'Enter the client’s price per N on the project page.' : 'Enter the N target on the project page.',
        headline: sp.total > 0 ? `price ${code} first (${money(sp.total)} spent)` : `price ${code} before it starts spending`,
      })
    }
  }

  /* Credit pools and TOP UP THE CONTRACT. */
  const pools = input.blocked.includes('client_terms') ? [] : creditPools(input)
  for (const pool of pools) {
    if (pool.pool == null || !(pool.over > 0) || !pool.latestId) continue
    const latest = input.items.find(it => it.p.id === pool.latestId)
    if (!latest) continue
    const p = latest.p as WeekProject
    const term = pool.startsOn && pool.renewsOn ? ` (${dayText(pool.startsOn, input.today)} → ${dayText(pool.renewsOn, input.today)})` : ''
    const gone = pool.elapsed != null ? `, with ${pctText(Math.min(1, pool.elapsed))} of the term gone${term}` : ', with no term dates recorded'
    const queued = pool.queued.ids.length
      ? ` ${codeList(pool.queued.codes)} (${money(pool.queued.value)} at target) ${pool.queued.ids.length === 1 ? 'is' : 'are'} queued with no credits.`
      : ''
    const heldNote = pool.hold > 0 ? ` Another ${credits(pool.hold)} sit on held surveys.` : ''
    const left = pool.elapsed != null && pool.elapsed < 1 ? ` with ${pctText(1 - pool.elapsed)} of the term left` : ''
    byVerb.topup.push({
      ...rowBase('topup', p, latest.cls, input),
      key: `topup:${pool.termId}`,
      also: [],
      happened: `“${pool.name}”: ${credits(pool.used)} of ${credits(pool.pool)} credits drawn on ${plural(pool.deliveredSurveys + pool.liveSurveys, 'survey')} — ${credits(pool.over)} over the pool${gone}.${queued}${heldNote}`,
      stake: pool.overDollars,
      stakeText: pool.perCredit && pool.overDollars != null
        ? `≈${money(pool.overDollars)} derived: ${credits(pool.over)} credits × ${money(pool.perCredit.value)} per credit ${pool.perCredit.source === 'agreed' ? 'from the contract value on file' : `implied by ${plural(pool.perCredit.n, 'priced survey')} on this contract`}`
        : `${credits(pool.over)} credits over (${pool.perCreditNote})`,
      derived: pool.overDollars != null,
      action: `Open the renewal with ${pool.account}: the pool is ${credits(pool.over)} credits short${left}.` +
        (pool.queued.ids.length ? ` Put credits on ${codeList(pool.queued.codes)} before ${pool.queued.ids.length === 1 ? 'it delivers' : 'they deliver'}.` : ''),
      headline: `open the renewal with ${pool.account}: ${credits(pool.over)} credits over its pool${left}`,
      spend: 0,
      bullet: null,
    })
  }

  /* CONVERT THE TRIAL. */
  const trials = pricesOk ? trialRows(input) : null
  if (trials) byVerb.trial.push(...trials.rows)

  /* CHECK THE SERIES. */
  const seriesOut = input.series.state === 'ok' ? seriesRows(input, input.series.value) : null
  if (seriesOut) byVerb.series.push(...seriesOut.rows)

  /* RESUME OR CANCEL — the hold bucket. Ranked by the spend sunk, and at equal
   * dollars the longer RECORDED hold first; an unknown age sorts last. */
  const holdEntries: { row: WeekRow; days: number }[] = []
  for (const f of heldFacts) {
    const { p, sp } = f
    const hs = input.holdSince
    let age: string
    let days = -1
    if (hs.state === 'loading') age = 'On hold; checking the change log for how long.'
    else if (hs.state === 'blocked') age = `On hold; since unknown (${hs.table} did not load).`
    else {
      const h = hs.value.get(p.id)
      if (h?.why === 'recorded' && h.since) {
        days = Math.max(0, daysBetween(h.since, input.today))
        age = `On hold ${plural(days, 'day')} — since ${dayText(h.since, input.today)}, set by ${h.by}.`
      } else if (h?.why === 'sync-only') {
        age = 'On hold; since unknown — the only record is a system sync stamp, not a real status change.'
      } else {
        age = 'On hold; since unknown — no status change is recorded.'
      }
    }
    const worth = pricesOk && f.contract != null && f.contract > 0 ? `; worth ${money(f.contract)} at target if it resumes` : ''
    const collectedText = f.target != null ? ` Collected ${fmtNum(f.collected ?? 0)} of ${fmtNum(f.target)}.` : ''
    // With every cost table missing, spendOf answers 0 for every survey. The
    // hold is still a decision, so the row stays — but it says the spend could
    // not be read instead of ranking the survey at $0 (rule 6). The bullet goes
    // too: an empty bar is the same false claim drawn.
    holdEntries.push({
      days,
      row: {
        ...rowBase('hold', p, f.it.cls, input),
        also: [],
        happened: `${age}${collectedText}`,
        stake: spendBlocked ? null : sp.total,
        stakeText: spendBlocked
          ? `${spendBlocked}, so what is sunk in this one cannot be shown${worth}`
          : `${money(sp.total)} spent and not moving${worth}`,
        derived: false,
        action: `Resume ${p.project_code ?? 'it'} or cancel it — a hold keeps its spend out of every live figure.`,
        headline: `resume or cancel ${p.project_code ?? 'the first'}`,
        spend: sp.total,
        bullet: spendBlocked ? null : bulletOf(pricesOk ? f : { ...f, rate: null, contract: null, goal: null }),
      },
    })
  }
  holdEntries.sort((a, b) => (b.row.spend - a.row.spend) || (b.days - a.days) ||
    (a.row.code ?? '').localeCompare(b.row.code ?? ''))
  byVerb.hold.push(...holdEntries.map(e => e.row))

  /* Groups. */
  const poolsNote = termDollarsNote(input.termDollars)
  /**
   * What a group has to say beside its rows, in words, when the rule could not
   * see all of its population or does not obey one of the page's filters.
   *
   * TOP UP THE CONTRACT is the one group that ignores the route filter — a
   * credit pool is the whole contract, and "credits drawn on blast work only"
   * is not a number anybody agreed (see `creditPools`). The card it sits on
   * cannot carry that in its ignored-filter chips, because every other group
   * on it does apply the route, so the group says it itself.
   */
  const noteFor = (v: Verb): string | null => {
    if (v === 'cap') return capNote(liveFacts, launchesBy)
    if (v === 'price') {
      return ownFirmUnpriced
        ? `${plural(ownFirmUnpriced, 'live AlphaROC survey')} ${ownFirmUnpriced === 1 ? 'is' : 'are'} left out: our own work has no client to price.`
        : null
    }
    if (v === 'trial') return trials?.note ?? null
    if (v === 'topup' && byVerb.topup.length) {
      return [
        input.filter.route !== 'all' ? 'A credit pool counts every route, so the route filter does not apply to these rows.' : null,
        poolsNote,
      ].filter(Boolean).join(' ') || null
    }
    return null
  }
  const groups = VERB_ORDER.filter(v => v !== 'hold').map(v => {
    if (v === 'series') {
      if (input.series.state === 'blocked') return group(v, [], { blocked: [`Blocked: ${input.series.table} did not load`] })
      if (input.series.state === 'loading') return group(v, [], { pending: 'Loading the series cadence…' })
      // Already ranked: dollars at stake, then the most overdue first.
      return group(v, byVerb.series, { note: seriesOut?.note ?? null, keepOrder: true })
    }
    if (v === 'stop') {
      return group(v, byVerb[v], {
        blocked: blockedTexts(v, input),
        rule: `Still buying, and has collected more than the buy multiple × the N sold: ${multipleWords('panel', buyRule)}; ${multipleWords('blast', buyRule)}.`,
      })
    }
    return group(v, byVerb[v], { blocked: blockedTexts(v, input), note: noteFor(v) })
  })
  const hold = group('hold', byVerb.hold, {
    keepOrder: true,
    note: spendBlocked ? `${spendBlocked}. Every survey below is still a decision; only the dollars are missing.` : null,
  })
  // A check that found nothing but could not see part of its population (CAP
  // THE WAVE on waves with no target) keeps its note on screen and is not
  // called clear.
  const clear = groups.filter(g => !g.rows.length && !g.blocked.length && !g.pending && !g.note).map(g => g.verb)

  const model: ThisWeekModel = {
    header,
    groups,
    hold,
    clear,
    pools,
    poolsVerdict: poolsVerdict(pools, input),
    poolsNote,
    overlapNote: overlapNoteOf(groups),
    verdict: verdictOf(groups, pools),
    holdVerdict: holdVerdictOf(hold, header, input),
    exportColumns: EXPORT_COLUMNS,
    exportRows: [...groups.flatMap(g => g.rows), ...hold.rows].map(exportRow),
  }
  return model
}

/**
 * How many surveys carry more than one decision — measured, not assumed.
 *
 * Each group's "at stake" total is honest about its own rows (one row per
 * survey or contract), but the same survey can sit under STOP BUYING, SET A
 * BUDGET and PRICE IT at once, so adding the group headers together double
 * counts it. The card says so in one line rather than leaving a reader to add
 * them up — and the export's stake column carries the same warning.
 */
function overlapNoteOf(groups: WeekGroup[]): string | null {
  const seen = new Map<string, number>()
  for (const g of groups) for (const r of g.rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
  const n = [...seen.values()].filter(c => c > 1).length
  if (!n) return null
  return `${plural(n, 'survey')} ${n === 1 ? 'needs' : 'need'} more than one decision, so the “at stake” totals above cover some of the same money twice. Read each group on its own; do not add them together.`
}

/** How many live waves the CAP THE WAVE rule cannot judge (no wave target). */
function capNote(facts: Facts[], launchesBy: Map<string, WeekLaunch[]>): string | null {
  let blind = 0, all = 0
  for (const f of facts) {
    if (QA_COLUMNS.has(f.p.board_column ?? '')) continue
    for (const l of launchesBy.get(f.p.id) ?? []) {
      all++
      const t = num(l.target)
      if (t == null || !(t > 0)) blind++
    }
  }
  if (!blind) return null
  return `${fmtNum(blind)} of ${plural(all, 'wave')} on surveys still buying ${blind === 1 ? 'has' : 'have'} no wave target, so ${blind === 1 ? 'it' : 'they'} cannot be checked. Record a target on every wave.`
}

/* ── HEADER SENTENCE ───────────────────────────────────────────────────── */

function headerSentence(h: ThisWeekHeader): string {
  const parts = [`${plural(h.live, 'live survey')}`, h.spendBlocked ?? `${money(h.spent)} spent so far`]
  if (h.priceBlocked) {
    parts.push(`${h.priceBlocked}, so what they are worth is not shown`)
  } else {
    parts.push(`${fmtNum(h.pricedWithTarget)} ${h.pricedWithTarget === 1 ? 'has' : 'have'} a price and a target, worth ${money(h.worthAtTarget)} if each lands on target`)
    const rest = h.live - h.pricedWithTarget
    if (rest > 0) parts.push(`the other ${fmtNum(rest)} ${rest === 1 ? 'has' : 'have'} no price or no target`)
  }
  parts.push(`${fmtNum(h.holds)} on hold, counted on their own`)
  return `${parts.join(' · ')}. Unsold scoping: ${plural(h.scoping, 'survey')}, not counted.`
}

/* ── CREDIT POOLS ───────────────────────────────────────────────────────── */

/**
 * One pool per client_terms row, under the account filter. The route filter
 * does not apply: a pool is the whole contract, and a pool drawn "on blast work
 * only" is not a number anybody agreed.
 */
export function creditPools(input: Pick<ThisWeekInput,
  'terms' | 'items' | 'rates' | 'filter' | 'today' | 'accountName' | 'termDollars' | 'priceBlocked' | 'blocked'>): CreditPool[] {
  const pricesOk = !input.priceBlocked && !input.blocked.includes('project_financials')
  const terms = input.terms.filter(t => !input.filter.account || t.client_id === input.filter.account)
  // The agreed contract values (client_term_financials). While that read is
  // still in flight, NO dollar value is derived: an implied rate shown now and
  // replaced by an agreed one a second later is a figure that moved under the
  // reader. A failed read still falls back to the implied rate, and the card
  // says the value is implied rather than agreed (`termDollarsNote`).
  const agreedIn = input.termDollars.state !== 'loading'
  const dollars = input.termDollars.state === 'ok' ? input.termDollars.value : new Map<string, number | null>()
  const agreed = pricesOk && agreedIn ? creditValues(terms, dollars) : new Map<string, number>()
  // Queued work is assigned to ONE contract per account, so a survey is never
  // listed as "queued" under two at once: the contract in force today, else the
  // one that started last; a contract with no dates only when it is the only one.
  const newest = new Map<string, string>()
  const inForce = (t: WeekTerm) => !!t.starts_on && t.starts_on <= input.today && (!t.renews_on || input.today < t.renews_on)
  const rankTerm = (t: WeekTerm) => `${inForce(t) ? 2 : t.starts_on ? 1 : 0}|${t.starts_on ?? ''}`
  for (const t of terms.slice().sort((a, b) => rankTerm(a).localeCompare(rankTerm(b)))) {
    if (t.client_id) newest.set(t.client_id, t.id)
  }
  return terms.map(t => {
    const on = input.items.filter(it => it.p.term_id === t.id && (num(it.p.credits) ?? 0) > 0)
    const sum = (cls: FinClass) => on.filter(it => it.cls === cls).reduce((s, it) => s + (num(it.p.credits) ?? 0), 0)
    const count = (cls: FinClass) => on.filter(it => it.cls === cls).length
    const delivered = sum('delivered'), live = sum('active'), hold = sum('hold')
    const used = delivered + live
    const pool = num(t.credits_total)
    const over = pool != null ? Math.max(0, used - pool) : 0
    const drawing = on.filter(it => it.cls === 'delivered' || it.cls === 'active')
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || (b.p.project_code ?? '').localeCompare(a.p.project_code ?? ''))
    let perCredit: CreditPool['perCredit'] = null
    const a = agreed.get(t.id)
    if (a != null) perCredit = { value: a, source: 'agreed', n: 0 }
    else if (pricesOk && agreedIn) {
      const imp = impliedCreditRate(on.map(it => it.p), input.rates)
      if (imp) perCredit = { value: imp.median, source: 'implied', n: imp.n }
    }
    const queuedItems = t.client_id && newest.get(t.client_id) === t.id && pricesOk
      ? input.items.filter(it => it.cls === 'active' && it.p.client_id === t.client_id &&
        (input.rates.get(it.p.id) ?? 0) > 0 && (num(it.p.n_target) ?? 0) > 0 && !((num(it.p.credits) ?? 0) > 0))
      : []
    const queuedValue = queuedItems.reduce((s, it) => s + (input.rates.get(it.p.id) as number) * (num(it.p.n_target) as number), 0)
    const startsOn = t.starts_on ?? null, renewsOn = t.renews_on ?? null
    const span = startsOn && renewsOn ? daysBetween(startsOn, renewsOn) : null
    const elapsed = span != null && span > 0 ? daysBetween(startsOn as string, input.today) / span : null
    const pc: CreditPool = {
      termId: t.id, name: t.name ?? '(unnamed contract)',
      accountId: t.client_id, account: input.accountName(t.client_id),
      pool, delivered, live, hold,
      deliveredSurveys: count('delivered'), liveSurveys: count('active'), holdSurveys: count('hold'),
      used, over,
      latestId: drawing[0]?.p.id ?? null, latestCode: drawing[0]?.p.project_code ?? null,
      queued: {
        ids: queuedItems.map(it => it.p.id), codes: queuedItems.map(it => it.p.project_code),
        value: queuedValue, creditsEquiv: perCredit ? queuedValue / perCredit.value : null,
      },
      startsOn, renewsOn, elapsed,
      perCredit,
      perCreditNote: !agreedIn
        ? 'no dollar value yet: the agreed contract values are still loading'
        : !pricesOk
          ? 'no dollar value: prices did not load'
          : 'no dollar value: nothing on this contract carries both credits and a price',
      overDollars: perCredit && over > 0 ? over * perCredit.value : null,
      sentence: '',
    }
    pc.sentence = poolSentence(pc, input.today)
    return pc
  }).sort((a, b) => (b.over - a.over) || ((b.pool ? b.used / b.pool : 0) - (a.pool ? a.used / a.pool : 0)))
}

function poolSentence(p: CreditPool, today: string): string {
  const gone = p.elapsed == null
    ? 'no term dates recorded'
    : p.elapsed >= 1 ? `past its renewal date (${dayText(p.renewsOn as string, today)})` : `${pctText(Math.max(0, p.elapsed))} of the term gone`
  if (p.pool == null) return `${credits(p.used)} credits drawn; no pool is recorded, so it cannot run over. ${gone[0].toUpperCase()}${gone.slice(1)}.`
  const drawn = `${credits(p.used)} of ${credits(p.pool)} credits drawn`
  if (p.over > 0) return `${drawn} — ${credits(p.over)} over the pool, with ${gone}.`
  const share = p.pool > 0 ? p.used / p.pool : 0
  const pace = p.elapsed != null && p.elapsed < 1 && share > p.elapsed + 0.1 ? ' It is drawing faster than the calendar.' : ''
  return `${drawn} (${pctText(share)}), with ${gone}.${pace}`
}

function poolsVerdict(pools: CreditPool[], input: Pick<ThisWeekInput, 'blocked'>): string {
  if (input.blocked.includes('client_terms')) return ''
  if (!pools.length) return 'No contract in view carries a credit pool, so there is nothing to top up.'
  const over = pools.filter(p => p.over > 0)
  if (over.length) {
    const top = over[0]
    const left = top.elapsed != null && top.elapsed < 1 ? ` with ${pctText(1 - top.elapsed)} of the term left` : ''
    return `Open the renewal with ${top.account}: “${top.name}” is ${credits(top.over)} credits over its pool${left}.` +
      (over.length > 1 ? ` ${plural(over.length - 1, 'other contract')} ${over.length === 2 ? 'is' : 'are'} over too.` : '')
  }
  const withPool = pools.filter(p => p.pool != null && p.pool > 0)
  if (!withPool.length) return 'Record a credit pool on each contract: none in view has one, so none can be checked.'
  const fullest = withPool.slice().sort((a, b) => b.used / (b.pool as number) - a.used / (a.pool as number))[0]
  return `Every pool has room. Watch ${fullest.account}’s “${fullest.name}”, the fullest at ${pctText(fullest.used / (fullest.pool as number))} drawn.`
}

/* ── CONVERT THE TRIAL ──────────────────────────────────────────────────── */

/**
 * Delivered surveys priced at exactly $0, per account, that the account has not
 * followed with any priced work. "Priced" means a price per N above $0 or a
 * credit count. Live or held priced work counts as "since" whatever its date —
 * it is happening now. A trial placed before the account's last paid delivery
 * converted and is left out. AlphaROC's own $0 work is internal, not a trial.
 */
export function trialRows(input: ThisWeekInput): { rows: WeekRow[]; note: string | null } {
  const passes = (it: FinItem) =>
    (!input.filter.account || it.p.client_id === input.filter.account) &&
    (input.filter.route === 'all' || it.route === input.filter.route)
  const isTrial = (it: FinItem) => it.cls === 'delivered' && input.rates.get(it.p.id) === 0
  const byAccount = new Map<string, FinItem[]>()
  let own = 0
  for (const it of input.items) {
    if (!isTrial(it) || !passes(it)) continue
    if (ownFirm(input, it.p)) { own++; continue }
    const k = it.p.client_id ?? '(none)'
    const a = byAccount.get(k)
    if (a) a.push(it); else byAccount.set(k, [it])
  }
  const out: WeekRow[] = []
  for (const [k, trials] of byAccount) {
    const acct = k === '(none)' ? null : k
    const paid = input.items.filter(it =>
      it.p.client_id === acct && !isTrial(it) &&
      (it.cls === 'delivered' || it.cls === 'active' || it.cls === 'hold') &&
      ((input.rates.get(it.p.id) ?? 0) > 0 || (num(it.p.credits) ?? 0) > 0))
    if (paid.some(it => it.cls !== 'delivered')) continue
    const lastPaid = paid.map(it => it.date).filter((d): d is string => !!d).sort().pop() ?? null
    const open = trials.filter(it => it.date ? (lastPaid == null || it.date > lastPaid) : paid.length === 0)
    if (!open.length) continue
    open.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    const head = open[0]
    const p = head.p as WeekProject
    const cost = open.reduce((t, it) => t + spendOf(it.p, input.blasts, input.suppliers, input.costs, input.ix).total, 0)
    const ns = open.map(it => deliveredNOf(it.p).n)
    const freeN = ns.reduce<number>((t, n) => t + (n ?? 0), 0)
    const unknownN = ns.filter(n => n == null).length
    const account = input.accountName(acct)
    const when = head.date ? ` (latest ${dayText(head.date, input.today)})` : ''
    const nText = unknownN ? `${fmtNum(freeN)} respondents (${plural(unknownN, 'survey')} with no N actual yet)` : `${fmtNum(freeN)} respondents`
    const since = lastPaid ? ` Its last paid survey was delivered ${dayText(lastPaid, input.today)}.` : ' It has never bought a priced survey.'
    out.push({
      ...rowBase('trial', p, head.cls, input),
      key: `trial:${k}`,
      also: open.slice(1).map(it => ({ id: it.p.id, code: it.p.project_code })),
      happened: `${account} got ${nText} free on ${plural(open.length, 'survey')} at a $0 price${when}, and has bought nothing priced since.${since}`,
      stake: cost,
      stakeText: `${money(cost)} of our field cost given away`,
      derived: false,
      action: `Send ${account} a priced proposal for the next survey — the free work cost us ${money(cost)}.`,
      headline: `send ${account} a priced proposal: ${nText} went free`,
      spend: cost,
      bullet: null,
    })
  }
  return {
    rows: out,
    note: own ? `${plural(own, 'AlphaROC survey')} delivered at $0 ${own === 1 ? 'is' : 'are'} left out: our own work is not a trial.` : null,
  }
}

/* ── CHECK THE SERIES ───────────────────────────────────────────────────── */

const waveOrder = (a: WeekProject, b: WeekProject) =>
  (Number(a.rerun_number ?? 0) - Number(b.rerun_number ?? 0)) ||
  (Number(a.wave_order ?? 0) - Number(b.wave_order ?? 0)) ||
  String(a.deliver_date ?? a.launch_date ?? '').localeCompare(String(b.deliver_date ?? b.launch_date ?? ''))

/** A series more than this many cadences overdue has probably stopped, so its
 *  row also offers pausing it. */
const LAPSED_CADENCES = 2

/**
 * Due = the last DELIVERED wave's date (deliver, else launch, else submitted),
 * or the latest resume if later, plus the cadence. A wave the spawner created
 * ahead of time and nobody launched is NOT a wave for this purpose — counting
 * one is exactly how rerun_series_status pushed a lapsed series' due date a
 * whole cadence late, so it never read overdue.
 *
 * A wave is valued at the series' price per N: the next wave's own, else the
 * last delivered wave's, else the newest wave in the series that carries one
 * (and the row says which wave the price came from).
 */
export function seriesRows(input: ThisWeekInput, series: SeriesRecord[]): { rows: WeekRow[]; note: string | null } {
  const itemBy = new Map(input.items.map(it => [it.p.id, it]))
  const wavesBy = new Map<string, WeekProject[]>()
  for (const p of input.projects as WeekProject[]) {
    if (!p.series_id) continue
    const a = wavesBy.get(p.series_id)
    if (a) a.push(p); else wavesBy.set(p.series_id, [p])
  }
  const pricesOk = !input.priceBlocked && !input.blocked.includes('project_financials')
  const rateOf = (id: string | undefined) => (pricesOk && id ? input.rates.get(id) ?? null : null)
  const ranked: { row: WeekRow; toDue: number }[] = []
  let noCadence = 0, noDelivered = 0
  for (const s of series) {
    if (s.paused === true || s.in_service === false) continue
    const waves = (wavesBy.get(s.id) ?? []).slice().sort(waveOrder)
    if (!waves.length) continue
    const clsOf = (p: WeekProject): FinClass => itemBy.get(p.id)?.cls ?? classOf(p, input.ix)
    const delivered = waves.filter(p => clsOf(p) === 'delivered' && itemBy.get(p.id)?.date)
    const last = delivered.slice().sort((a, b) =>
      String(itemBy.get(a.id)?.date).localeCompare(String(itemBy.get(b.id)?.date)) || waveOrder(a, b)).pop()
    // The filters, applied BEFORE the "cannot be checked" counters: a note
    // that counted series from outside the account or route in view described
    // a population the card does not show, and read the same under every
    // filter. The series is scoped by its last delivered wave where there is
    // one — exactly what the rest of this loop uses — else by its newest wave,
    // so a series with nothing delivered is still placed somewhere.
    const scope = last ?? waves[waves.length - 1]
    const acct = s.client_id ?? scope.client_id
    if (input.filter.account && acct !== input.filter.account) continue
    if (input.filter.route !== 'all' && itemBy.get(scope.id)?.route !== input.filter.route) continue

    const cadence = num(s.cadence_months)
    if (!last) { noDelivered++; continue }
    if (cadence == null || !(cadence > 0)) { noCadence++; continue }
    const lastItem = itemBy.get(last.id) as FinItem
    const lastDate = lastItem.date as string
    const anchor = s.resume_anchor && s.resume_anchor > lastDate ? s.resume_anchor : lastDate
    const due = addMonths(anchor, cadence)
    const toDue = daysBetween(input.today, due)
    const next = waves.filter(p => waveOrder(p, last) > 0 && !['delivered', 'cancelled', 'archived'].includes(clsOf(p)))[0]
    const nextCls = next ? clsOf(next) : null
    const collecting = !!next && nextCls === 'active' && (
      (input.ix.blasts.get(next.id)?.length ?? 0) > 0 || (input.ix.suppliers.get(next.id)?.length ?? 0) > 0 ||
      COLLECTING_COLUMNS.has(next.board_column ?? ''))
    const late = toDue <= SERIES_DUE_WITHIN_DAYS && !collecting
    const lastT = num(last.n_target), nextT = next ? num(next.n_target) : null
    const fell = !!next && lastT != null && lastT > 0 && nextT != null && nextT < lastT
    if (!late && !fell) continue

    const pricedWave = [next, last, ...waves.slice().reverse()].find(w => w && (rateOf(w.id) ?? 0) > 0)
    const rate = pricedWave ? rateOf(pricedWave.id) : null
    const rateFrom = pricedWave && pricedWave !== next && pricedWave !== last ? `, the price on ${pricedWave.project_code ?? 'an earlier wave'}` : ''
    const wave = (t: number | null) => (rate != null && rate > 0 && t != null && t > 0 ? rate * t : null)
    const name = s.survey_name?.trim() || last.project_name || 'This series'
    const every = `every ${cadence === 1 ? 'month' : `${fmtNum(cadence)} months`}`
    const when = toDue < 0 ? `, ${plural(-toDue, 'day')} ago` : toDue === 0 ? ', today' : `, in ${plural(toDue, 'day')}`
    const nextText = !next
      ? ' No next wave exists yet.'
      : ` The next wave, ${next.project_code ?? '(no code)'}, ${next.launch_date
        ? `is scheduled for ${dayText(next.launch_date, input.today)}`
        : next.rerun_date ? `is planned for ${dayText(next.rerun_date, input.today)}` : 'has no launch date'}${nextCls === 'hold' ? ' and is on hold' : ''} and is not buying yet.`
    const fellText = fell
      ? ` Its target fell from ${fmtNum(lastT)} to ${fmtNum(nextT)}${wave(lastT) != null ? ` (about ${money(wave(lastT) as number)} → ${money(wave(nextT) ?? 0)} a wave)` : ''}.`
      : ''
    const happened = `${name}: last delivered ${dayText(lastDate, input.today)} (${last.project_code ?? '(no code)'}), ${every}` +
      (late ? `, so due ${dayText(due, input.today)}${when}.${nextText}` : '.') + fellText
    const stake = late ? wave(lastT) : rate != null && rate > 0 && lastT != null && nextT != null ? rate * (lastT - nextT) : null
    const noPrice = 'No dollar figure: no wave in the series carries a price per N'
    const stakeText = late
      ? (stake != null ? `${money(stake)} a wave (${money(rate as number)} per N × ${fmtNum(lastT)}${rateFrom})` : noPrice)
      : (stake != null ? `${money(stake)} less a wave${rateFrom ? ` (at${rateFrom.slice(1)})` : ''}` : noPrice)
    const lapsed = late && -toDue > cadence * 30.4375 * LAPSED_CADENCES
    const action = [
      late
        ? next
          ? `Launch ${next.project_code ?? 'the next wave'}, or tell the client the date has moved.`
          : lapsed
            ? 'It is several waves overdue: create the next wave and launch it, or, if the client has stopped, pause or end the series on the Reruns page so it stops coming up.'
            : 'Create the next wave and launch it, or confirm with the client that the series has paused.'
        : null,
      fell ? `Confirm the smaller target with the client before ${next?.project_code ?? 'the next wave'} launches.` : null,
    ].filter(Boolean).join(' ')
    const subject = next ?? last
    ranked.push({
      toDue,
      row: {
        ...rowBase('series', subject, next ? (nextCls as FinClass) : lastItem.cls, input),
        key: `series:${s.id}`,
        also: next ? [{ id: last.id, code: last.project_code }] : [],
        happened, stake, stakeText, derived: false, action,
        headline: late
          ? `${name} was due ${dayText(due, input.today)}: ${next ? `launch ${next.project_code ?? 'the next wave'} or tell the client` : 'create the next wave or pause the series'}`
          : `confirm ${name}’s smaller next wave with the client (target ${fmtNum(lastT)} → ${fmtNum(nextT)})`,
        spend: 0,
        bullet: null,
      },
    })
  }
  // Dollars first; with no dollar figure, the most overdue first.
  ranked.sort((a, b) => {
    const x = a.row.stake, y = b.row.stake
    if (x != null && y != null && x !== y) return y - x
    if (x != null && y == null) return -1
    if (x == null && y != null) return 1
    return a.toDue - b.toDue || (a.row.code ?? '').localeCompare(b.row.code ?? '')
  })
  // "in view": both counters now describe the same surveys the card does.
  const notes = [
    noCadence ? `${plural(noCadence, 'series', 'series')} in service in view ${noCadence === 1 ? 'has' : 'have'} no cadence, so ${noCadence === 1 ? 'it' : 'they'} cannot be checked.` : null,
    noDelivered ? `${plural(noDelivered, 'series', 'series')} in service in view ${noDelivered === 1 ? 'has' : 'have'} no dated delivered wave yet, so ${noDelivered === 1 ? 'it' : 'they'} cannot be checked.` : null,
  ].filter(Boolean)
  return { rows: ranked.map(r => r.row), note: notes.length ? notes.join(' ') : null }
}

/* ── VERDICTS ───────────────────────────────────────────────────────────── */

/** Which groups the verdict speaks about first: money still moving, then the
 *  contract and the sales, then the records to fix. */
const VERDICT_ORDER: Verb[] = ['freeze', 'stop', 'cap', 'confirm', 'topup', 'trial', 'series', 'budget', 'price']

const cap1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

/** The card's closing sentences: the top row of the first three groups that
 *  have one, in VERDICT_ORDER, each an instruction. */
function verdictOf(groups: WeekGroup[], pools: CreditPool[]): string {
  const say: string[] = []
  for (const v of VERDICT_ORDER) {
    const g = groups.find(x => x.verb === v)
    if (!g || !g.rows.length) continue
    const n = g.rows.length
    const more = n > 1 ? ` (${plural(n - 1, 'more', 'more')} under ${g.meta.label.toLowerCase()})` : ''
    if (v === 'freeze') {
      say.push(`${plural(n, 'live survey')} still buying ${n === 1 ? 'has' : 'have'} spent more than half ${n === 1 ? 'its' : 'their'} price. ${cap1(g.rows[0].headline)}.`)
    } else if (v === 'topup') {
      const over = pools.filter(p => p.over > 0).length
      say.push(`${cap1(g.rows[0].headline)}${over > 1 ? ` (${plural(over - 1, 'other contract')} over too)` : ''}.`)
    } else {
      say.push(`${cap1(g.rows[0].headline)}${more}.`)
    }
    if (say.length === 3) break
  }
  const blocked = groups.filter(g => g.blocked.length).length
  if (blocked) say.push(`${plural(blocked, 'check')} could not run because a table did not load.`)
  if (!say.length) return 'No live survey needs a decision this week. Keep pricing new work as it is sold.'
  return say.join(' ')
}

function holdVerdictOf(hold: WeekGroup, h: ThisWeekHeader, input: ThisWeekInput): string {
  if (!hold.rows.length) return 'No survey is on hold. Keep it that way: decide to resume or cancel as soon as work pauses.'
  const top = hold.rows[0]
  const known = input.holdSince.state === 'ok'
    ? hold.rows.filter(r => input.holdSince.state === 'ok' && input.holdSince.value.get(r.id)?.why === 'recorded').length
    : 0
  const age = input.holdSince.state === 'ok'
    ? ` ${fmtNum(known)} of ${fmtNum(hold.rows.length)} ${hold.rows.length === 1 ? 'has' : 'have'} a recorded start date.`
    : ''
  // With every cost table missing the sunk spend is not $0, it is unknown, and
  // the verdict says which (rule 6).
  const money_ = h.spendBlocked
    ? `${plural(h.holds, 'survey')} on hold, none of them in the live figures. ${h.spendBlocked}, so what is sunk in them cannot be shown.`
    : `${plural(h.holds, 'survey')} on hold with ${money(h.holdSpend)} spent, none of it in the live figures.`
  return `${money_}${age} ${cap1(top.headline)} first.`
}

/* ── EXPORT ─────────────────────────────────────────────────────────────── */

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'decision', header: 'Decision' },
  { key: 'bucket', header: 'Bucket' },
  { key: 'survey', header: 'Survey' },
  { key: 'also', header: 'Also named' },
  { key: 'account', header: 'Account' },
  { key: 'owner', header: 'Owner (captain)' },
  { key: 'happened', header: 'What happened' },
  // The warning lives in the header because the file is opened in a
  // spreadsheet, where a column of dollars invites a SUM: one survey can carry
  // two or three decisions, so the column does not add up to anything real.
  { key: 'stake', header: 'At stake ($) — one survey can need several decisions; do not sum this column' },
  { key: 'stakeText', header: 'At stake' },
  { key: 'derived', header: 'Dollars derived from credits' },
  { key: 'action', header: 'What to do' },
]

function exportRow(r: WeekRow): Record<string, string | number | null> {
  return {
    decision: VERB_META[r.verb].label,
    bucket: VERB_META[r.verb].bucket,
    survey: r.code,
    also: r.also.map(a => a.code ?? '(no code)').join(', ') || null,
    account: r.account,
    owner: r.owner,
    happened: r.happened,
    stake: r.stake == null ? null : Math.round(r.stake * 100) / 100,
    stakeText: r.stakeText,
    derived: r.derived ? 'yes' : null,
    action: r.action,
  }
}

/* ── DRILLS ─────────────────────────────────────────────────────────────── */

export interface PoolDrillRow extends DrillRow {
  account: string
  stage: string | null
  bucket: string
}

/**
 * The surveys drawing on one credit pool, delivered and live (held work is
 * listed apart on the pool and never counted as drawn). The rows come from the
 * classified items; the check re-reads the RAW survey list and classifies it
 * again, so a survey the items dropped or double-counted turns the strip red.
 */
export function creditPoolDrill(
  input: Pick<ThisWeekInput, 'items' | 'projects' | 'ix' | 'accountName'>, pool: CreditPool,
): DrillSpec {
  const rows: PoolDrillRow[] = input.items
    .filter(it => it.p.term_id === pool.termId && (it.cls === 'delivered' || it.cls === 'active') && (num(it.p.credits) ?? 0) > 0)
    .map(it => ({
      id: it.p.id, code: it.p.project_code, contribution: num(it.p.credits) as number,
      account: input.accountName(it.p.client_id), stage: it.p.board_column,
      bucket: it.cls === 'delivered' ? 'Delivered' : 'Live',
    }))
    .sort((a, b) => b.contribution - a.contribution)
  const check = input.projects.filter(p => {
    if (p.term_id !== pool.termId || !((num(p.credits) ?? 0) > 0)) return false
    const c = classOf(p, input.ix)
    return c === 'delivered' || c === 'active'
  })
  return {
    key: `this-week-pool-${pool.termId}`,
    title: `Credits drawn on “${pool.name}”`,
    population: `${pool.account} · delivered and live work on this contract · held surveys not counted · every route`,
    columns: [
      { key: 'bucket', header: 'Where it is', value: r => (r as PoolDrillRow).bucket, tip: 'Delivered work has drawn its credits; live work is drawing them now.' },
      { key: 'stage', header: 'Stage', value: r => (r as PoolDrillRow).stage, tip: 'The board column the survey is in now.' },
      { key: 'contribution', header: 'Credits', value: r => r.contribution, tip: 'The credits this survey draws from the pool. A count, not dollars.', num: true },
    ],
    rows,
    expectedTotal: check.reduce((t, p) => t + (num(p.credits) as number), 0),
    expectedIds: check.map(p => p.id),
    totalLabel: 'Credits drawn',
    format: 'number',
  }
}

interface WeekDrillRow extends DrillRow {
  account: string
  stage: string | null
  spend: number
  rate: number | null
  target: number | null
}

/** A column over this file's row shape, typed as the shared DrillColumn so the
 *  spec can go straight to the shell's `openDrill` (which takes DrillRow). */
const col = (key: string, header: string, value: (r: WeekDrillRow) => string | number | null, tip?: string, isNum = false): DrillColumn =>
  ({ key, header, value: r => value(r as WeekDrillRow), tip, num: isNum })

/**
 * The three header figures' drills. Each is checked against a figure computed
 * by a DIFFERENT function from the one that built its rows (finance spec rule
 * 5): spend against `spendOfIds`, which sums the raw child rows by id; worth
 * against analysis.ts `backlog`; hold spend against analysis.ts `holds`.
 */
export function thisWeekDrills(input: ThisWeekInput, model: ThisWeekModel, population: string): {
  spent: DrillSpec
  worth: DrillSpec | null
  hold: DrillSpec
} {
  const live = input.population.filter(it => it.cls === 'active')
  const held = input.side.filter(it => it.cls === 'hold')
  const rowOf = (it: FinItem, contribution: (f: Facts) => number): WeekDrillRow => {
    const f = factsOf(it, input)
    return {
      id: it.p.id, code: it.p.project_code, contribution: contribution(f),
      account: input.accountName(it.p.client_id), stage: it.p.board_column,
      spend: f.sp.total, rate: f.rate, target: f.target,
    }
  }
  const base = [
    col('account', 'Account', r => r.account),
    col('stage', 'Stage', r => r.stage, 'The board column the survey is in now.'),
  ]
  const spendCol = col('spend', 'Spent so far', r => r.spend, 'Recorded field cost: blast rewards and sends, panel CPI × completes, vendor lines, less rewards recovered.', true)
  const spentRows = live.map(it => rowOf(it, f => f.sp.total)).sort((a, b) => b.contribution - a.contribution)
  const heldRows = held.map(it => rowOf(it, f => f.sp.total)).sort((a, b) => b.contribution - a.contribution)
  const heldCheck = holdsOf(held.map(it => it.p), input.blasts, input.suppliers, input.costs)
  let worth: DrillSpec | null = null
  if (!model.header.priceBlocked) {
    const priced = new Set(model.header.pricedIds)
    const back = backlog(live.map(it => it.p), input.rates, input.blasts, input.suppliers, input.costs)
    worth = {
      key: 'this-week-worth',
      title: 'Live surveys with a price and a target, at target',
      population,
      columns: [
        ...base,
        col('rate', 'Price per N', r => r.rate, 'The client’s price per respondent.', true),
        col('target', 'N sold', r => r.target, 'The N target: what the client bought. Where a range was sold, this is the bottom of it — the N we are sure of; the bill can run to the maximum.', true),
        col('contribution', 'Worth at target', r => r.contribution, 'Price per N × N sold. An upper bound: surveys often land short. Measured at the bottom of a sold range.', true),
        spendCol,
      ],
      rows: live.filter(it => priced.has(it.p.id)).map(it => rowOf(it, f => f.contract as number))
        .sort((a, b) => b.contribution - a.contribution),
      expectedTotal: back.revenueAtTarget,
      expectedIds: back.ids,
      totalLabel: 'Worth at target',
      format: 'money',
    }
  }
  return {
    spent: {
      key: 'this-week-spent',
      title: 'Spent so far on live surveys',
      population,
      columns: [...base, col('contribution', 'Spent so far', r => r.contribution, spendCol.tip, true)],
      rows: spentRows,
      expectedTotal: spendOfIds(live.map(it => it.p.id), input.blasts, input.suppliers, input.costs),
      expectedIds: model.header.liveIds,
      totalLabel: 'Spent so far',
      format: 'money',
    },
    worth,
    hold: {
      key: 'this-week-hold',
      title: 'Surveys on hold — their own bucket',
      population: `On hold · all dates · never in a live figure · ${plural(held.length, 'survey')}`,
      columns: [...base, col('contribution', 'Spent so far', r => r.contribution, spendCol.tip, true)],
      rows: heldRows,
      expectedTotal: heldCheck.spend,
      expectedIds: heldCheck.ids,
      totalLabel: 'Spent on held surveys',
      format: 'money',
    },
  }
}
