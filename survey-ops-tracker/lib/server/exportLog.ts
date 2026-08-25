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
// Best-effort, like logAiUsage in ./observability: a failure here is logged and
// swallowed. Losing an audit row is bad; failing the user's export because we
// couldn't write one is worse, and the export already happened by then anyway.

/** Keys worth recording — an empty filter bar shouldn't fill the log with nulls. */
function compactFilters(filters: unknown): Json | null {
  if (filters == null || typeof filters !== 'object' || Array.isArray(filters)) return null
  const out: Record<string, Json> = {}
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (v == null || v === '' || v === false) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.map((x) => String(x))
    else out[k] = String(v)
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

export async function logDataExport(entry: ExportLogEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('data_exports').insert({
      // actor_email is NOT NULL. A signed-in user always has one, but dropping
      // the row over a missing address would lose the event we came here to
      // record, so an unattributable export is logged as unattributable.
      actor_email: entry.actorEmail ?? 'unknown',
      route: entry.route.slice(0, 200),
      row_count: Math.max(0, Math.trunc(Number(entry.rowCount) || 0)),
      filters: compactFilters(entry.filters),
      included_restricted: entry.includedRestricted,
    })
    if (error) console.error('[exportLog] insert failed:', error.message)
  } catch (err) {
    console.error('[exportLog] logDataExport failed:', err)
  }
}
