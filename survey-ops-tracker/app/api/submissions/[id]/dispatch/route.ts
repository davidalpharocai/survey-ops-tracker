import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submissionCreatedEmail } from '@/lib/email/templates'
import { sendAndLog } from '@/lib/email/send'

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
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: claimed, error: claimError } = await admin
    .from('question_submissions')
    .update({ dispatched_at: new Date().toISOString() })
    .eq('id', id)
    .is('dispatched_at', null)
    .select('id, project_id, version')
    .maybeSingle()

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }
  if (!claimed) {
    // Either nonexistent or already dispatched (or recalled): check which for the response
    const { data: existing } = await admin
      .from('question_submissions').select('id').eq('id', id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    return NextResponse.json({ ok: true, alreadyDispatched: true })
  }

  // Fetch question counts for the email
  const { data: questions } = await admin
    .from('questions')
    .select('is_open_text')
    .eq('submission_id', id)

  const questionCount = questions?.length ?? 0
  const openTextCount = questions?.filter(q => q.is_open_text).length ?? 0

  // Fetch project name
  const { data: project } = await admin
    .from('survey_projects').select('project_name').eq('id', claimed.project_id).single()

  // Fetch compliance recipients for this project
  const { data: recipients } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', claimed.project_id)
    .eq('role', 'compliance')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  const reviewPath = `/portal/review/${id}`

  let emailFailures = 0
  const notified = recipients?.length ?? 0

  for (const r of recipients ?? []) {
    // Personal one-click sign-in link: opening it authenticates the reviewer
    // (single-use, expiring token) and lands them on the review page. Falls
    // back to the plain URL (login-page flow) if link generation fails.
    let reviewUrl = `${appUrl}${reviewPath}`
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: r.email,
    })
    const tokenHash = linkData?.properties?.hashed_token
    if (tokenHash) {
      reviewUrl = `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=${encodeURIComponent(reviewPath)}`
    }

    const email = submissionCreatedEmail({
      projectName: project?.project_name ?? 'Survey project',
      version: claimed.version,
      questionCount,
      openTextCount,
      reviewUrl,
    })
    const ok = await sendAndLog({
      to: r.email, subject: email.subject, html: email.html,
      template: 'submission_created', submissionId: id,
    })
    if (!ok) emailFailures++
  }

  return NextResponse.json({ ok: true, notified: notified - emailFailures, emailFailures })
}
