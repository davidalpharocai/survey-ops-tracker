import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cloneProject, type CloneCarry } from '@/lib/server/clone'

export const dynamic = 'force-dynamic'

async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { sourceId?: string; newName?: string; carry?: CloneCarry }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const sourceId = (body.sourceId ?? '').trim()
  const newName = (body.newName ?? '').trim()
  if (!sourceId) return NextResponse.json({ error: 'sourceId is required.' }, { status: 400 })
  if (!newName) return NextResponse.json({ error: 'A name for the clone is required.' }, { status: 400 })

  try {
    const project = await cloneProject({
      sourceId,
      newName,
      carry: body.carry ?? {},
      actor: `${user.email} via clone`,
    })
    return NextResponse.json({ project })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not clone the project.' }, { status: 500 })
  }
}
