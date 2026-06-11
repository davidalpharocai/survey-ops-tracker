import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DraftQuestion } from '@/lib/parsing/validate'

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: submission, error: fetchError } = await admin
    .from('question_submissions')
    .select('id, project_id, version, dispatched_at, source_file_name, source_file_path')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }

  // Cannot recall once dispatched to compliance
  if (submission.dispatched_at !== null) {
    return NextResponse.json(
      { error: 'Already sent to compliance — it can no longer be recalled' },
      { status: 409 }
    )
  }

  // Fetch questions before deleting
  const { data: rows, error: qError } = await admin
    .from('questions')
    .select('order_num, text, section, type, is_open_text, is_ai_followup, answer_options')
    .eq('submission_id', id)
    .order('order_num', { ascending: true })

  if (qError) {
    return NextResponse.json({ error: qError.message }, { status: 500 })
  }

  const questions: DraftQuestion[] = (rows ?? []).map(q => ({
    order_num: q.order_num,
    text: q.text,
    section: q.section,
    type: q.type,
    is_open_text: q.is_open_text,
    is_ai_followup: q.is_ai_followup,
    answer_options: (q.answer_options as string[]) ?? [],
  }))

  // Delete submission (questions cascade)
  const { error: deleteError } = await admin
    .from('question_submissions')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    questions,
    sourceFileName: submission.source_file_name,
    sourceFilePath: submission.source_file_path,
  })
}
