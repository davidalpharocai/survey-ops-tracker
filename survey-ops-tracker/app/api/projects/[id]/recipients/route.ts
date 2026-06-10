import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  if (!(await requireAnalyst())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { email: string; name?: string; role: 'alpharoc' | 'compliance' }
  const email = body.email?.trim().toLowerCase()
  if (!email || !['alpharoc', 'compliance'].includes(body.role)) {
    return NextResponse.json({ error: 'email and valid role required' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (body.role === 'compliance') {
    // Provision portal access: auth user + compliance profile scoped to the project's client
    const { data: project } = await admin
      .from('survey_projects').select('client_id').eq('id', projectId).single()
    if (!project?.client_id) {
      return NextResponse.json(
        { error: 'Project has no client assigned — set the client first' },
        { status: 400 }
      )
    }

    const { data: existingProfile } = await admin
      .from('profiles').select('id, role, client_id').eq('email', email).maybeSingle()

    if (existingProfile) {
      if (existingProfile.role !== 'compliance') {
        return NextResponse.json(
          { error: 'That email belongs to an internal analyst account' }, { status: 400 })
      }
      if (existingProfile.client_id !== project.client_id) {
        return NextResponse.json(
          { error: 'That compliance user belongs to a different client' }, { status: 400 })
      }
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true,
      })
      if (createError || !created.user) {
        return NextResponse.json(
          { error: createError?.message ?? 'Could not create portal user' }, { status: 500 })
      }
      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id, email, full_name: body.name ?? null,
        role: 'compliance', client_id: project.client_id,
      })
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 })
      }
    }
  }

  const { data: recipient, error } = await admin
    .from('project_recipients')
    .insert({ project_id: projectId, email, name: body.name ?? null, role: body.role })
    .select()
    .single()
  if (error) {
    const friendly = error.code === '23505' ? 'Already a recipient on this project' : error.message
    return NextResponse.json({ error: friendly }, { status: 400 })
  }
  return NextResponse.json({ recipient })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  if (!(await requireAnalyst())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { recipientId } = await request.json() as { recipientId: string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('project_recipients')
    .delete()
    .eq('id', recipientId)
    .eq('project_id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
