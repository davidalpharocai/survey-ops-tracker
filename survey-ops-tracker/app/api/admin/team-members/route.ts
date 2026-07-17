import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Analyst-only roster management. team_members has no client insert/update RLS
// policy (the roster is read-only from the browser), so adds/edits go through
// the service-role client here, gated on an authenticated analyst.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// Initials feed the sheet write-back captain cell + card avatars — keep them
// A–Z only, capped at 4 chars (matches the existing roster convention: "DS").
const cleanInitials = (s: string) => s.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { name?: string; email?: string; initials?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const initials = cleanInitials(body.initials ?? '')
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (!/^[^@\s]+@alpharoc\.ai$/.test(email))
    return NextResponse.json({ error: 'Email must be a valid @alpharoc.ai address.' }, { status: 400 })
  if (!initials) return NextResponse.json({ error: 'Initials are required.' }, { status: 400 })

  const admin = createAdminClient()
  // Roster is keyed on the person's address — block a second row for one email.
  const { data: existing } = await admin.from('team_members').select('id, name').ilike('email', email).maybeSingle()
  if (existing)
    return NextResponse.json({ error: `${existing.name} is already on the roster with that email.` }, { status: 409 })

  const { data, error } = await admin.from('team_members').insert({ name, email, initials }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}

export async function PATCH(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string; name?: string; initials?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const id = (body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: { name?: string; initials?: string } = {}
  if (body.name != null) {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'Name cannot be blank.' }, { status: 400 })
    patch.name = n
  }
  if (body.initials != null) {
    const i = cleanInitials(body.initials)
    if (!i) return NextResponse.json({ error: 'Initials cannot be blank.' }, { status: 400 })
    patch.initials = i
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('team_members').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}
