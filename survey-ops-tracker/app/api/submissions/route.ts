import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuestions, type DraftQuestion } from '@/lib/parsing/validate'

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
    message?: string
  }
  if (!body.projectId || !body.sourceFileName || !body.sourceFilePath) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (body.message && body.message.length > 2000) {
    return NextResponse.json({ error: 'Message is too long (2000 character max)' }, { status: 400 })
  }

  const result = normalizeQuestions(body.questions)
  if (!result.ok) {
    return NextResponse.json({ error: result.errors.join('; ') }, { status: 400 })
  }

  const admin = createAdminClient()

  // A submission with nobody to review it is a dead letter — require at
  // least one client compliance contact on the project before accepting.
  const { data: complianceContacts } = await admin
    .from('project_recipients')
    .select('id')
    .eq('project_id', body.projectId)
    .eq('role', 'compliance')
    .limit(1)
  if (!complianceContacts?.length) {
    return NextResponse.json(
      { error: 'Add at least one client compliance contact to this project before submitting for review' },
      { status: 400 }
    )
  }

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
      analyst_message: body.message?.trim() || null,
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

  return NextResponse.json({ submissionId: submission.id, version })
}
