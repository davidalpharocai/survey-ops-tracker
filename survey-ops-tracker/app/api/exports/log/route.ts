import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canViewFinancials } from '@/lib/auth/capabilities'
import { logDataExport } from '@/lib/server/exportLog'

export const dynamic = 'force-dynamic'

// POST { route, rowCount, filters?, includedRestricted } — record one CSV pull.
//
// This endpoint exists because the CSV export is a pure browser download: the
// rows are already in the React Query cache, the file is built with a Blob, and
// nothing ever reaches the server. Migration 081 says the honest thing about
// that — "the log is only ever as complete as the code that writes it" — and
// prefers logging inside the request that builds the payload. There is no such
// request here, so this is the next best thing: the client reports the export it
// just performed, and the server decides everything that matters about the row.
//
// What the browser is NOT trusted with:
//  • actor_email — taken from the session, so an export can't be filed under a
//    colleague's name. The body's opinion on who ran it is ignored entirely.
//  • included_restricted downwards — see below.
//
// What remains true, and must not be dressed up: an analyst who never calls this
// route leaves no row, and nothing in the schema can detect that absence. The
// finance gate is SOFT (every analyst still has SELECT on the columns), so this
// is an audit trail for ordinary use, not an enforcement point.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Signed-in callers only — otherwise anyone could stuff the trail with noise.
  // Deliberately NOT analyst-only, unlike the mutation routes: refusing to log
  // an export we had no way of preventing would be the wrong failure.
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const route = typeof body.route === 'string' && body.route ? body.route : 'unknown-csv'
  const rowCount = Number(body.rowCount)

  // The claim can only be revised UPWARDS. A capability holder's CSV always
  // carries the money columns, so `false` from their browser is either a bug or
  // a patched bundle; either way the row should say the columns went out. A
  // non-holder claiming `true` is recorded as `true` for the same reason — the
  // interesting direction is "restricted data left the building", and neither
  // side of the wire gets to talk that down.
  const claimed = body.includedRestricted === true
  const includedRestricted = claimed || (await canViewFinancials(user.id))

  await logDataExport({
    actorEmail: user.email,
    route,
    rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    filters: body.filters,
    includedRestricted,
  })

  return NextResponse.json({ ok: true })
}
