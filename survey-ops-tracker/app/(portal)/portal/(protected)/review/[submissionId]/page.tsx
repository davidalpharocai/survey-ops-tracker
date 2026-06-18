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
        <Link href="/portal" className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition-colors">
          ← Back to queue
        </Link>
        <div className="flex items-start justify-between mt-3 flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{project?.project_name ?? 'Survey project'}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Version {submission.version}
              {submission.version > 1 && ' — resubmitted after feedback'} · submitted{' '}
              {formatDate(submission.submitted_at)} · {portalQuestions.length} questions
              · {openTextCount} open-text
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Link
              href={`/portal/review/${submissionId}/print`}
              target="_blank"
              rel="noopener"
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Print / Save as PDF
            </Link>
            {fileUrl?.signedUrl && (
              <div className="text-right">
                <a
                  href={fileUrl.signedUrl}
                  className="text-xs border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 px-3 py-1 rounded-lg transition-colors"
                >
                  ↓ Analyst&apos;s original upload
                </a>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  Reference only — the question list above is the approved record.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {submission.analyst_message && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 mb-6 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 mb-1">Message from AlphaRoc</p>
          <p className="whitespace-pre-line">{submission.analyst_message}</p>
        </div>
      )}
      {submission.phase === 'after_fielding' && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-xl px-4 py-3 mb-6 text-sm">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">After-fielding review — questions + results</p>
          <p className="text-slate-700 dark:text-slate-300 mb-2">
            Please review the questions below together with the survey results.
          </p>
          {submission.results_url ? (
            <a
              href={submission.results_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline break-all"
            >
              View results →
            </a>
          ) : (
            <span className="text-slate-500 dark:text-slate-400 text-xs">No results link was provided.</span>
          )}
        </div>
      )}
      <ReviewClient
        submissionId={submission.id}
        status={submission.status}
        reviewNote={submission.review_note}
        questions={portalQuestions}
      />
    </div>
  )
}
