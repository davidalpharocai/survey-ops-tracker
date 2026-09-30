import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

/**
 * Related surveys — a symmetric, untyped link between two surveys that is NOT a
 * rerun wave (migration 126).
 *
 * The DB operations live here rather than in the route so the MCP connector and
 * the in-app assistant run the exact same logic, the way lib/reruns/seriesOps.ts
 * does for series. That is the standing rule: anything that writes data ships
 * its connector tool in the same change.
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────
 * A pair is stored ONCE, in a canonical order (a_id < b_id), which migration 126
 * enforces with a check constraint rather than trusting callers. So:
 *
 *   · every write goes through orderPair() first;
 *   · every READ has to look at BOTH columns, because "the surveys related to X"
 *     is `a_id = X or b_id = X` and X could be on either side.
 *
 * Getting the second half wrong is the quiet bug here: a lookup on a_id alone
 * returns half the links and looks like it works.
 */

export class LinkOpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'LinkOpError'
    this.status = status
  }
}

/** The pair in the canonical order the table stores. Pure; exported for tests. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x]
}

export interface LinkedSurvey {
  /** project_links.id — what removeProjectLink takes. */
  link_id: string
  note: string | null
  linked_at: string
  linked_by: string | null
  /** The survey at the OTHER end of the link. */
  id: string
  project_code: string | null
  project_name: string
  client: string | null
  status: string | null
  board_column: string | null
  deliver_date: string | null
  rerun_number: number | null
}

const OTHER_END_COLS = 'id, project_code, project_name, client, status, board_column, deliver_date, rerun_number'

/** True when the failure is "project_links is not there yet" rather than a real
 *  error. Migrations are applied by hand here, so the code ships before the
 *  table does and the project page must not break in the gap — but only for
 *  THIS one cause. Any other failure is still an error, because a related-survey
 *  list that quietly reads empty when the read failed is a list that lies. */
function tableMissing(e: { code?: string; message?: string }): boolean {
  // 42P01 is Postgres "relation does not exist"; PGRST205 is PostgREST failing
  // to find it in the schema cache, which is what this actually returns.
  if (e.code === '42P01' || e.code === 'PGRST205') return true
  // Fallback on the message, but only on the phrases that mean ABSENT. Matching
  // the table name alone would also swallow a permission failure (42501), and a
  // list that reads empty because the read was DENIED is a list that lies.
  const m = e.message ?? ''
  return /project_links/.test(m) && /(does not exist|Could not find the table)/i.test(m)
}

/** Every survey linked to this one, newest link first. */
export async function listProjectLinks(admin: Admin, projectId: string): Promise<LinkedSurvey[]> {
  const { data: links, error } = await admin
    .from('project_links')
    .select('id, a_id, b_id, note, created_at, created_by')
    // Both columns — see the note at the top. a_id alone silently halves this.
    .or(`a_id.eq.${projectId},b_id.eq.${projectId}`)
    .order('created_at', { ascending: false })
  if (error && tableMissing(error)) return []
  if (error) throw new Error(error.message)
  const rows = links ?? []
  if (rows.length === 0) return []

  const otherIds = rows.map((l) => (l.a_id === projectId ? l.b_id : l.a_id))
  const { data: others, error: oErr } = await admin
    .from('survey_projects')
    .select(OTHER_END_COLS)
    .in('id', otherIds)
    .is('deleted_at', null)
  if (oErr) throw new Error(oErr.message)
  const byId = new Map((others ?? []).map((p) => [p.id, p]))

  return rows
    .map((l) => {
      const other = byId.get(l.a_id === projectId ? l.b_id : l.a_id)
      // A soft-deleted survey at the other end is dropped rather than rendered
      // as a blank row. The link row itself is left alone: undeleting the survey
      // brings the link back, and a cascade would have thrown it away.
      if (!other) return null
      return {
        link_id: l.id,
        note: l.note,
        linked_at: l.created_at,
        linked_by: l.created_by,
        id: other.id,
        project_code: other.project_code,
        project_name: other.project_name,
        client: other.client,
        status: other.status,
        board_column: other.board_column,
        deliver_date: other.deliver_date,
        rerun_number: other.rerun_number,
      } as LinkedSurvey
    })
    .filter((x): x is LinkedSurvey => x !== null)
}

/** Link two surveys. Idempotent: linking an existing pair updates its note. */
export async function addProjectLink(
  admin: Admin,
  projectId: string,
  otherId: string,
  note: string | null,
  actor: string
): Promise<{ link_id: string; created: boolean }> {
  if (!projectId || !otherId) throw new LinkOpError('Both studies are required.')
  if (projectId === otherId) throw new LinkOpError('A study cannot be linked to itself.')

  const { data: found, error: pErr } = await admin
    .from('survey_projects')
    .select('id, project_code, project_name')
    .in('id', [projectId, otherId])
    .is('deleted_at', null)
  if (pErr) throw new Error(pErr.message)
  if ((found ?? []).length < 2) {
    // Which one is missing matters — "Survey not found" on a two-sided
    // operation sends people looking at the wrong half.
    const have = new Set((found ?? []).map((p) => p.id))
    const missing = [projectId, otherId].filter((id) => !have.has(id))
    throw new LinkOpError(
      missing.length === 2 ? 'Neither study was found.' : 'The study you picked was not found.',
      404
    )
  }

  const [a, b] = orderPair(projectId, otherId)
  const { data: existing, error: eErr } = await admin
    .from('project_links')
    .select('id')
    .eq('a_id', a)
    .eq('b_id', b)
    .maybeSingle()
  if (eErr) throw new Error(eErr.message)

  if (existing) {
    // Already linked. Re-linking with a note is how the note gets corrected, so
    // treat it as an edit rather than refusing — but do not blank an existing
    // note just because this call did not carry one.
    if (note != null) {
      const { error } = await admin.from('project_links').update({ note }).eq('id', existing.id)
      if (error) throw new Error(error.message)
    }
    return { link_id: existing.id, created: false }
  }

  const { data: inserted, error } = await admin
    .from('project_links')
    .insert({ a_id: a, b_id: b, note, created_by: actor })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return { link_id: inserted.id, created: true }
}

/** Remove a link by its id. */
export async function removeProjectLink(admin: Admin, linkId: string): Promise<{ removed: boolean }> {
  if (!linkId) throw new LinkOpError('A link id is required.')
  // Read first so a no-op delete can be reported as one. A missing RLS policy
  // makes a delete return 0 rows with error null, which would otherwise read as
  // success — see the PostgREST write-discipline note.
  const { data: row, error: rErr } = await admin.from('project_links').select('id').eq('id', linkId).maybeSingle()
  if (rErr) throw new Error(rErr.message)
  if (!row) throw new LinkOpError('That link no longer exists.', 404)

  const { error } = await admin.from('project_links').delete().eq('id', linkId)
  if (error) throw new Error(error.message)
  return { removed: true }
}

/** Remove the link between two surveys, whichever order they are given in.
 *  The connector identifies surveys by PR code, not by link id, so it needs
 *  this door as well as the one above. */
export async function removeProjectLinkByPair(
  admin: Admin,
  x: string,
  y: string
): Promise<{ removed: boolean }> {
  const [a, b] = orderPair(x, y)
  const { data: row, error } = await admin
    .from('project_links')
    .select('id')
    .eq('a_id', a)
    .eq('b_id', b)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) throw new LinkOpError('Those two studies are not linked.', 404)
  return removeProjectLink(admin, row.id)
}
