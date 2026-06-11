import { requirePortalUser } from '@/lib/portal-auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/date'
import { ReviewClient } from '@/components/portal/ReviewClient'
import type { PortalQuestion } from '@/components/portal/QuestionList'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>
}) {
  const { submissionId } = await params
  const supabase = await requirePortalUser(`/portal/review/${submissionId}`)

  const { data: submission } = await supabase
    .from('question_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()
  if (!submission) notFound()

  const [{ data: project }, { data: questions }, { data: fileUrl }] = await Promise.all([
    supabase.from('portal_projects').select('project_name').eq('id', submission.project_id).maybeSingle(),
    supabase.from('questions').select('*').eq('submission_id', submissionId).order('order_num'),
    supabase.storage.from('questionnaires').createSignedUrl(submission.source_file_path, 3600),
  ])

  const portalQuestions: PortalQuestion[] = (questions ?? []).map(q => ({
    id: q.id,
    order_num: q.order_num,
    text: q.text,
    type: q.type,
    is_open_text: q.is_open_text,
    is_ai_followup: q.is_ai_followup,
    section: q.section,
    answer_options: Array.isArray(q.answer_options) ? (q.answer_options as string[]) : [],
  }))
  const openTextCount = portalQuestions.filter(q => q.is_open_text).length

  return (
    <div>
      <div className="mb-6">
        <Link href="/portal" className="text-slate-400 hover:text-slate-200 text-sm transition-colors">
          ← Back to queue
        </Link>
        <div className="flex items-start justify-between mt-3 flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-white">{project?.project_name ?? 'Survey project'}</h1>
            <p className="text-sm text-slate-400 mt-1">
              Version {submission.version}
              {submission.version > 1 && ' — resubmitted after feedback'} · submitted{' '}
              {formatDate(submission.submitted_at)} · {portalQuestions.length} questions
              · {openTextCount} open-text
            </p>
          </div>
          {fileUrl?.signedUrl && (
            <a
              href={fileUrl.signedUrl}
              className="text-xs border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ Source file
            </a>
          )}
        </div>
      </div>
      <ReviewClient
        submissionId={submission.id}
        status={submission.status}
        reviewNote={submission.review_note}
        questions={portalQuestions}
      />
    </div>
  )
}
