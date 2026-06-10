import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decisionEmail } from '@/lib/email/templates'
import { sendAndLog } from '@/lib/email/send'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { decision: 'approved' | 'rejected'; note?: string }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })
  }
  if (body.decision === 'rejected' && !body.note?.trim()) {
    return NextResponse.json({ error: 'A note is required when rejecting' }, { status: 400 })
  }

  // User-scoped update: RLS allows this only for compliance users of the
  // project's client while status is pending_review (and reviewed_by = auth.uid()).
  const { data: updated, error } = await supabase
    .from('question_submissions')
    .update({
      status: body.decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: body.note?.trim() || null,
    })
    .eq('id', id)
    .select('id, project_id, version')
    .maybeSingle()

  if (error) {
    console.error('decision update failed:', error)
    return NextResponse.json({ error: 'Could not record your decision — please try again' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'Submission not found, already decided, or not yours to review' },
      { status: 403 }
    )
  }

  // Notify AlphaRoc recipients (service role)
  const admin = createAdminClient()
  const { data: project } = await admin
    .from('survey_projects').select('project_name').eq('id', updated.project_id).single()
  const { data: recipients } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', updated.project_id)
    .eq('role', 'alpharoc')

  const email = decisionEmail({
    projectName: project?.project_name ?? 'Survey project',
    version: updated.version,
    decision: body.decision,
    note: body.note?.trim() || null,
  })
  for (const r of recipients ?? []) {
    await sendAndLog({
      to: r.email, subject: email.subject, html: email.html,
      template: `decision_${body.decision}`, submissionId: id,
    })
  }

  return NextResponse.json({ ok: true })
}
