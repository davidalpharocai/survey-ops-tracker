import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LinkOpError, addProjectLink, listProjectLinks, removeProjectLink } from '@/lib/projects/links'

export const dynamic = 'force-dynamic'

// Related surveys (migration 126): a symmetric link between two surveys that is
// NOT a rerun wave. The DB work lives in lib/projects/links.ts so the MCP
// connector runs the same code; this route gates and validates.
//
// Analyst-only, like the table's RLS. A link names a survey at each end, so
// handing this to a sales session would let it learn that a survey outside its
// book exists, and its name, without ever being able to open it.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function GET(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId')?.trim()
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    return NextResponse.json({ links: await listProjectLinks(createAdminClient(), projectId) })
  } catch (e) {
    if (e instanceof LinkOpError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; otherId?: string; note?: string | null; linkId?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    if (body.action === 'remove') {
      const linkId = (body.linkId ?? '').trim()
      return NextResponse.json(await removeProjectLink(admin, linkId))
    }
    const projectId = (body.projectId ?? '').trim()
    const otherId = (body.otherId ?? '').trim()
    // '' means "no note", not "clear the note" — addProjectLink only overwrites
    // an existing note when one is actually supplied.
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
    const res = await addProjectLink(admin, projectId, otherId, note, user.email ?? 'unknown')
    return NextResponse.json(res)
  } catch (e) {
    if (e instanceof LinkOpError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 500 })
  }
}
