import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuestions, type DraftQuestion } from '@/lib/parsing/validate'
import { submissionCreatedEmail } from '@/lib/email/templates'
import { sendAndLog } from '@/lib/email/send'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'analyst') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    projectId: string
    sourceFileName: string
    sourceFilePath: string
    questions: DraftQuestion[]
  }
  if (!body.projectId || !body.sourceFileName || !body.sourceFilePath) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const result = normalizeQuestions(body.questions)
  if (!result.ok) {
    return NextResponse.json({ error: result.errors.join('; ') }, { status: 400 })
  }

  const admin = createAdminClient()

  // Next version number
  const { data: latest } = await admin
    .from('question_submissions')
    .select('version')
    .eq('project_id', body.projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (latest?.version ?? 0) + 1

  const { data: submission, error: subError } = await admin
    .from('question_submissions')
    .insert({
      project_id: body.projectId,
      version,
      source_file_name: body.sourceFileName,
      source_file_path: body.sourceFilePath,
      submitted_by: user.id,
    })
    .select()
    .single()
  if (subError || !submission) {
    if (subError?.code === '23505') {
      return NextResponse.json(
        { error: 'Another submission was just created for this project — please retry' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: subError?.message ?? 'Insert failed' }, { status: 500 })
  }

  const { error: qError } = await admin.from('questions').insert(
    result.questions.map(q => ({
      submission_id: submission.id,
      order_num: q.order_num,
      text: q.text,
      type: q.type,
      is_open_text: q.is_open_text,
      is_ai_followup: q.is_ai_followup,
      section: q.section,
      answer_options: q.answer_options,
    }))
  )
  if (qError) {
    await admin.from('question_submissions').delete().eq('id', submission.id)
    return NextResponse.json({ error: qError.message }, { status: 500 })
  }

  // Notify compliance recipients
  const { data: project } = await admin
    .from('survey_projects').select('project_name').eq('id', body.projectId).single()
  const { data: recipients } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', body.projectId)
    .eq('role', 'compliance')

  const openTextCount = result.questions.filter(q => q.is_open_text).length
  const email = submissionCreatedEmail({
    projectName: project?.project_name ?? 'Survey project',
    version,
    questionCount: result.questions.length,
    openTextCount,
    reviewUrl: `${process.env.NEXT_PUBLIC_APP_URL}/portal/review/${submission.id}`,
  })

  let emailFailures = 0
  for (const r of recipients ?? []) {
    const ok = await sendAndLog({
      to: r.email, subject: email.subject, html: email.html,
      template: 'submission_created', submissionId: submission.id,
    })
    if (!ok) emailFailures++
  }

  return NextResponse.json({
    submissionId: submission.id,
    version,
    notified: (recipients?.length ?? 0) - emailFailures,
    emailFailures,
  })
}
