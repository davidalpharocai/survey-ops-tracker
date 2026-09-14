import { bucketOf, type BucketInput } from './buckets'
import { isRerunProject } from '@/lib/reruns/isRerun'

/**
 * What a salesperson sees when they open SOCC.
 *
 * ── WHY A WORKLIST AND NOT A DASHBOARD ──────────────────────────────────────
 * Four independent research passes landed in the same place: reps ignore
 * landing-page KPI tiles and ignore chronological activity feeds, but they read
 * a list of their own live work. Alex has 187 surveys and 144 of them are
 * delivered, so landing on the surveys table means scrolling past history every
 * morning. This page shows the live book, ordered so the studies that need a
 * decision sit on top on their own.
 *
 * ── NOTHING HERE READS THE CHANGE LOG ───────────────────────────────────────
 * A "what moved since Friday" feed was the obvious build and is deliberately
 * absent. `project_audit` is on the sales deny list in lib/auth/tierSurface.ts,
 * and 2,463 of its 10,936 rows carry a restricted value as plain text —
 * `actual_spend` alone is 1,908 of them, in the form "null" -> "50001.00". A
 * feed sourced from it would have handed sales the spend that migrations
 * 102/105/107 exist to hide. Every block below is computed from columns the
 * `sales_projects` view already exposes.
 *
 * ── WHY THIS FILE IS PURE ───────────────────────────────────────────────────
 * No Supabase, no React. The page passes rows in and renders what comes out, so
 * the judgement can be tested against fixtures instead of against production.
 */

export interface HomeRow extends BucketInput {
  id: string
  project_code: string | null
  project_name: string | null
  client: string | null
  due_date: string | null
  deliver_date: string | null
  submitted_date: string | null
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
  requested_by_name?: string | null
  /* The three fields isRerunProject() needs. All already on the sales_projects
     allowlist, so hiding reruns cost no migration and exposed nothing new —
     notably NOT the captain, which the view does not carry and should not. */
  series_id?: string | null
  rerun_number?: number | null
  project_type?: string | null
}

/**
 * Reruns are hidden from Home (David, 2026-09-14).
 *
 * WHY THE RULE IS "ALL RERUNS" AND NOT "RERUNS SREE CAPTAINS", which is what was
 * actually asked: sales_projects does not expose captain_id, and adding it would
 * be a disclosure decision taken for one filter. Measured first — of the 13 live
 * reruns in the book, 12 are Sree's; the 13th is PR00442 "Holocene Weekly Tracker
 * - 16th Rerun" under Anne Wei, which is the same standing-tracker shape. So the
 * two rules differ by ONE survey, and the simpler one neither names a person in
 * SQL nor breaks the day Sree hands a tracker over.
 *
 * Uses the app's own isRerunProject rather than a local test. The local test I
 * first wrote keyed on `rerun_number != null` — and rerun_number DEFAULTS TO 1 on
 * every row, so it called all 401 projects reruns. isRerunProject gets it right
 * with `(rerun_number ?? 1) > 1`.
 */
export const isHiddenRerun = (r: HomeRow) => isRerunProject({
  series_id: r.series_id, rerun_number: r.rerun_number, project_type: r.project_type,
})

/** Worst first. Used for both the badge and the sort, so they cannot disagree. */
export type Kind = 'late' | 'due' | 'over' | 'ok'
export const RANK: Record<Kind, number> = { late: 0, due: 1, over: 2, ok: 3 }

export interface Judged {
  row: HomeRow
  kind: Kind
  /** Plain-language reasons, most serious first. Empty when kind is 'ok'. */
  why: string[]
  /** Short of target with the clock nearly out — drives the red progress bar. */
  behind: boolean
  /** Collected as a percentage of the promised N; null when no N was promised. */
  pct: number | null
  /** The date this study is being judged against, so the UI can show it. */
  commitDate: string | null
}

/* Thresholds. Named because each one is a judgement call, not a constant.
   BEHIND is deliberately NOT "short of target" on its own: most studies are
   short most of the time, and a flag that fires mid-field is one the team
   learns to scroll past. */
export const BEHIND_WINDOW_DAYS = 7
export const BEHIND_PCT = 0.6
export const OVER_PCT = 1.1
export const STALE_SCOPING_DAYS = 21
export const SHIPPED_WINDOW_DAYS = 14
export const QUIET_DAYS = 60

const DAY = 86_400_000
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`

/**
 * The date a study is judged against.
 *
 * `deliver_date` FIRST, and that is a correction rather than a preference.
 * lib/utils/risk.ts keys off `due_date` alone, and on 2026-09-14 only 15 of 30
 * live surveys had one — while 22 had a deliver_date. Seven live surveys carried
 * a deliver_date and no due_date, and SIX of those were already past it (two by
 * 18 days), invisible to the risk flag the whole time.
 *
 * This is not a second definition of "late": where both dates exist they are
 * identical on 14 of the 15 rows that have them. It is the same definition
 * applied to the rows the sparser field could not reach.
 */
export function commitmentDate(r: Pick<HomeRow, 'deliver_date' | 'due_date'>): string | null {
  return r.deliver_date || r.due_date || null
}

/** Collected against the N we PROMISED the client — never against the internal
 *  target, which sales is not cleared to see (David, 2026-09-09). */
export function pctOfTarget(r: Pick<HomeRow, 'n_target' | 'n_collected'>): number | null {
  if (!r.n_target) return null
  return Math.round(((r.n_collected ?? 0) / r.n_target) * 100)
}

/**
 * Judge one live study. Ordering only — this decides where a row sorts and what
 * colour its bar is, which is why there is no separate exception list on the
 * page. An earlier draft had one, and the same survey appeared twice under two
 * headings; David's read was that the extra block was not earning its space.
 */
export function judgeLive(row: HomeRow, today: string): Judged {
  const commitDate = commitmentDate(row)
  const d = commitDate ? daysBetween(commitDate, today) : null
  const why: string[] = []
  let kind: Kind = 'ok'
  const atLeast = (k: Kind) => { if (RANK[k] < RANK[kind]) kind = k }

  if (d !== null && d < 0) {
    atLeast('late')
    why.push(`${plural(-d, 'day')} past delivery`)
  } else if (d !== null && d <= 3) {
    atLeast('due')
    why.push(d === 0 ? 'due today' : `due in ${plural(d, 'day')}`)
  }

  const behind =
    !!row.n_target && d !== null && d <= BEHIND_WINDOW_DAYS &&
    (row.n_collected ?? 0) < row.n_target * BEHIND_PCT
  if (behind) {
    atLeast(d !== null && d < 0 ? 'late' : 'due')
    why.push('behind pace')
  }

  /* Over-delivery is stated as a client fact — "you got more than we promised"
     is worth raising on a call. What the excess COST is finance's business and
     is deliberately not on this page. */
  const delivered = row.n_actual ?? row.n_collected
  if (row.n_target && delivered != null && delivered > row.n_target * OVER_PCT) {
    atLeast('over')
    why.push('over the promised N')
  }

  return { row, kind, why, behind, pct: pctOfTarget(row), commitDate }
}

export interface QuietAccount {
  client: string
  /** How many surveys we have delivered for them, ever. */
  delivered: number
  /** ISO date of the most recent delivery. */
  last: string
  daysSince: number
}

export interface SalesHome {
  inField: Judged[]
  shipped: HomeRow[]
  stalled: HomeRow[]
  quiet: QuietAccount[]
  counts: { inField: number; scoping: number; delivered: number; needing: number }
  /** Rows the page cannot speak for, stated rather than hidden. */
  blind: { noDate: number; total: number }
}

/**
 * Build every block from one pass of the rows.
 *
 * A survey appears in AT MOST ONE block. An earlier version put anything with a
 * recent delivery date into Shipped regardless of stage, which listed two
 * still-fielding studies as both "in field" and "shipped" on the same screen.
 * Shipped now means the bucket says delivered.
 */
export function salesHome(rows: HomeRow[], today: string): SalesHome {
  const inField: Judged[] = []
  const shipped: HomeRow[] = []
  const stalled: HomeRow[] = []
  let delivered = 0
  let scoping = 0

  for (const r of rows) {
    // Hidden from every LIST, and from the counts that describe those lists.
    // Deliberately NOT hidden from quietAccounts below: an account with a rerun
    // in flight is not a quiet account, and saying it is would invent a lapsed
    // relationship out of work that is actively running.
    if (isHiddenRerun(r)) continue
    const bucket = bucketOf(r)
    if (bucket === 'active') {
      inField.push(judgeLive(r, today))
    } else if (bucket === 'completed') {
      delivered++
      const d = r.deliver_date ? daysBetween(today, r.deliver_date) : null
      if (d !== null && d >= 0 && d <= SHIPPED_WINDOW_DAYS) shipped.push(r)
    } else if (bucket === 'scoping') {
      scoping++
      if (r.submitted_date && daysBetween(today, r.submitted_date) > STALE_SCOPING_DAYS) stalled.push(r)
    }
    // 'hold' and 'closed' are silent on purpose: paused work is paused
    // deliberately and closed work cannot be rescued. Flagging either teaches
    // people to ignore the page.
  }

  inField.sort((a, b) =>
    RANK[a.kind] - RANK[b.kind] ||
    (a.commitDate ?? '9999-99-99').localeCompare(b.commitDate ?? '9999-99-99') ||
    (a.row.project_code ?? '').localeCompare(b.row.project_code ?? ''))
  shipped.sort((a, b) => (b.deliver_date ?? '').localeCompare(a.deliver_date ?? ''))
  stalled.sort((a, b) => (a.submitted_date ?? '').localeCompare(b.submitted_date ?? ''))

  return {
    inField,
    shipped,
    stalled,
    quiet: quietAccounts(rows, today),
    counts: {
      inField: inField.length,
      scoping,
      delivered,
      needing: inField.filter(j => j.kind === 'late' || j.kind === 'due').length,
    },
    blind: { noDate: inField.filter(j => !j.commitDate).length, total: rows.length },
  }
}

/**
 * Accounts with nothing in flight and no delivery for a while.
 *
 * The only block here that is about absence rather than activity, and the only
 * one a salesperson could not get from a list they already have — a quiet
 * account produces no rows anywhere, which is exactly why it gets forgotten.
 */
export function quietAccounts(rows: HomeRow[], today: string): QuietAccount[] {
  const by = new Map<string, HomeRow[]>()
  for (const r of rows) {
    if (!r.client) continue
    const list = by.get(r.client) ?? []
    list.push(r)
    by.set(r.client, list)
  }

  const out: QuietAccount[] = []
  for (const [client, rs] of by) {
    // Anything not yet delivered counts as in flight — including Hold, because
    // a paused study is a live conversation, not a dormant account.
    const stillOpen = rs.some(r => {
      const b = bucketOf(r)
      return b === 'active' || b === 'scoping' || b === 'hold'
    })
    if (stillOpen) continue

    const last = rs
      .filter(r => bucketOf(r) === 'completed' && r.deliver_date)
      .map(r => r.deliver_date as string)
      .sort()
      .pop()
    if (!last) continue

    const daysSince = daysBetween(today, last)
    if (daysSince <= QUIET_DAYS) continue
    out.push({ client, delivered: rs.filter(r => bucketOf(r) === 'completed').length, last, daysSince })
  }
  return out.sort((a, b) => b.daysSince - a.daysSince)
}
