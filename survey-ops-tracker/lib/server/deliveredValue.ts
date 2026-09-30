import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { revenueOf, deliveredNOf, type RevenueSegment } from '@/lib/finance/revenue'

/**
 * The dollars behind the sales account page's "Value of delivered work".
 *
 * WHY THIS READS AS SERVICE ROLE. `project_financials.price_per_n` is
 * finance-only (082: `my_role() = 'analyst'`), so a sales session cannot read
 * it and never will. David asked for the DOLLARS on the account page, not the
 * rate, so the rate is used here and discarded: the caller gets an amount per
 * project and nothing it could divide back into a price list it did not ask
 * for. The alternative — putting price_per_n on a sales view — would expose
 * the rate itself on every row, permanently, and RLS cannot take a column back
 * once a row is admitted (which is why 100 split dollars_total off
 * client_terms in the first place).
 *
 * WHAT MAKES THAT SAFE. This function trusts its `rows` and nothing else. It
 * never reads survey_projects, never takes an account id, and never sees the
 * URL. The caller passes the rows it already got back from `sales_projects` —
 * a definer view with security_barrier that is self-scoped to the caller's own
 * book — so the set of projects this can speak about is exactly the set the
 * caller was already allowed to see. Pass it anything else and that property
 * is gone, so don't.
 *
 * THE ARITHMETIC IS revenue.ts's. `revenueOf` is the one definition of what a
 * survey was worth; this file computes nothing, it only fetches the two things
 * revenueOf needs that the sales view does not carry (the rate, and the
 * segments for a survey whose own N actual is blank).
 */

export interface ValueSubject {
  id: string
  n_target: number | null
  n_target_max?: number | null
  n_actual: number | null
}

export interface DeliveredValue {
  /** project id -> dollars, or null where there is no figure. */
  byId: Map<string, number | null>
  /** Projects that HAVE a billable post-QA count — the survey's own n_actual,
   *  or every segment counted. Returned because it is the difference between
   *  "nobody has priced this" and "it has not been counted yet", which need
   *  different people to fix them; the caller has the first fact but not the
   *  second, since segments are not on any sales view. */
  withN: Set<string>
  /** A read failed. The caller must say so rather than show 0 — a failed read
   *  is not a free account. */
  blocked: boolean
}

/** PostgREST puts the filter in the URL, so a very long `in` list can exceed
 *  the server's header limit. Accounts run to tens of studies, not thousands,
 *  but the book-wide caller (sales insights) does not. */
const CHUNK = 300

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** The slice of a Supabase client this file uses, structurally — the same
 *  device as lib/finance/load.ts. project_financials and
 *  project_segments.price_per_n arrived in migration 082, which is applied by
 *  hand, so the GENERATED types do not know about them and a typed `.from()`
 *  rejects the call outright. */
interface InQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  in(col: string, vals: string[]): InQuery
}
interface Reader { from(table: string): { select(cols: string): InQuery } }

const num = (v: unknown): number | null =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)

type Row = Record<string, unknown>

export async function deliveredValueByProject(rows: ValueSubject[]): Promise<DeliveredValue> {
  const byId = new Map<string, number | null>()
  const withN = new Set<string>()
  const ids = rows.map(r => r.id)
  if (!ids.length) return { byId, withN, blocked: false }

  const db = createAdminClient() as unknown as Reader
  const rate = new Map<string, number | null>()
  const segs = new Map<string, RevenueSegment[]>()

  for (const part of chunks(ids, CHUNK)) {
    // select('*'), not a column list: PostgREST rejects a WHOLE select that
    // names a column the schema does not have yet, so a named list here would
    // take the account page down the moment a migration lags. Same rule as
    // lib/finance/load.ts.
    const [finRes, segRes] = await Promise.all([
      db.from('project_financials').select('*').in('project_id', part),
      db.from('project_segments').select('*').in('project_id', part),
    ])
    // Either read failing makes every figure wrong in the same direction —
    // silently low — so neither is allowed to degrade into a partial answer.
    if (finRes.error || segRes.error) return { byId, withN, blocked: true }

    for (const r of (finRes.data ?? []) as Row[]) {
      const pid = r.project_id
      if (typeof pid === 'string') rate.set(pid, num(r.price_per_n))
    }
    for (const r of (segRes.data ?? []) as Row[]) {
      const pid = r.project_id
      if (typeof pid !== 'string') continue
      const a = segs.get(pid) ?? []
      a.push({
        n_target: num(r.n_target),
        n_target_max: num(r.n_target_max),
        n_actual: num(r.n_actual),
        price_per_n: num(r.price_per_n),
      })
      segs.set(pid, a)
    }
  }

  for (const r of rows) {
    const subject = {
      n_target: r.n_target,
      n_target_max: r.n_target_max ?? null,
      n_actual: r.n_actual,
      segments: segs.get(r.id) ?? null,
    }
    byId.set(r.id, revenueOf(subject, rate.get(r.id)))
    if (deliveredNOf(subject).n != null) withN.add(r.id)
  }
  return { byId, withN, blocked: false }
}
