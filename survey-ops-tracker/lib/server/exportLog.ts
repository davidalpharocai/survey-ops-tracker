import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'

// One row in data_exports (migration 081) per pull of project data out of SOCC.
//
// The write goes through the SERVICE-ROLE client, and that is not an
// optimisation — 081 grants `authenticated` SELECT and nothing else, on purpose.
// This table audits the same analysts who can read it, and actor_email is free
// text, so an analyst-writable log could be forged under a colleague's address
// exactly when someone had a reason to falsify it. So: authorize with the
// session, write with the admin client, take actor_email from the session and
// NEVER from the request body. app/api/activity/delete/route.ts is the same
// shape for the same reason.
//
// Best-effort, like logAiUsage in ./observability: a failure here never throws.
// Losing an audit row is bad; failing the user's export because we couldn't
// write one is worse, and the export already happened by then anyway. But it is
// no longer SILENT: the result says whether the row was written and returns its
// id, so the route can answer with a real status and the browser can say
// "Logged as export #…" — or that it was not.

/** The filters object is written by the browser, so it is bounded before it
 *  reaches the table: a patched bundle or a runaway caller must not be able to
 *  park megabytes in the audit log, or smuggle rows of data in as "filters". */
const MAX_FILTER_KEYS = 40
const MAX_FILTER_TEXT = 300
const MAX_FILTER_LIST = 50

/**
 * Keys worth recording — an empty filter bar shouldn't fill the log with nulls.
 *
 * `false` IS kept. "Scoping included: false" and "date applied: false" are what
 * the finance export's audit row exists to say (the row once omitted scoping
 * entirely), and dropping every false made "not included" indistinguishable
 * from "not recorded".
 */
export function compactFilters(filters: unknown): Json | null {
  if (filters == null || typeof filters !== 'object' || Array.isArray(filters)) return null
  const out: Record<string, Json> = {}
  const text = (x: unknown) => String(x).slice(0, MAX_FILTER_TEXT)
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FILTER_KEYS) break
    if (v == null || v === '') continue
    const key = k.slice(0, 80)
    if (typeof v === 'number') out[key] = Number.isFinite(v) ? v : text(v)
    else if (typeof v === 'boolean') out[key] = v
    else if (typeof v === 'string') out[key] = text(v)
    else if (Array.isArray(v)) out[key] = v.slice(0, MAX_FILTER_LIST).map(text)
    else out[key] = text(v)
  }
  return Object.keys(out).length > 0 ? out : null
}

export interface ExportLogEntry {
  /** From the session — supabase.auth.getUser(), never the request body. */
  actorEmail: string | null | undefined
  /** Which export ran: 'list-csv' | 'board-csv' | an API path. */
  route: string
  rowCount: number
  /** The query behind the payload; null when there was nothing to record. */
  filters?: unknown
  /** Did the payload actually carry the finance-restricted columns? */
  includedRestricted: boolean
}

export interface ExportLogWrite {
  ok: boolean
  /** The new data_exports row, when it was written. */
  id: string | null
  error: string | null
}

export async function logDataExport(entry: ExportLogEntry): Promise<ExportLogWrite> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('data_exports').insert({
      // actor_email is NOT NULL. A signed-in user always has one, but dropping
      // the row over a missing address would lose the event we came here to
      // record, so an unattributable export is logged as unattributable.
      actor_email: entry.actorEmail ?? 'unknown',
      route: entry.route.slice(0, 200),
      row_count: Math.max(0, Math.trunc(Number(entry.rowCount) || 0)),
      filters: compactFilters(entry.filters),
      included_restricted: entry.includedRestricted,
    }).select('id').single()
    if (error) {
      console.error('[exportLog] insert failed:', error.message)
      return { ok: false, id: null, error: error.message }
    }
    return { ok: true, id: (data as { id?: string } | null)?.id ?? null, error: null }
  } catch (err) {
    console.error('[exportLog] logDataExport failed:', err)
    return { ok: false, id: null, error: err instanceof Error ? err.message : String(err) }
  }
}
