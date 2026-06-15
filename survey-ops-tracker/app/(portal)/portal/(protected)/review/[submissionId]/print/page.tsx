import { requirePortalUser } from '@/lib/portal-auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/date'
import { PrintButton } from '@/components/portal/PrintButton'

export const dynamic = 'force-dynamic'

// Local copy — mirrors TYPE_LABEL in QuestionList.tsx (do not import the client component)
const TYPE_LABEL: Record<string, string> = {
  open_text: 'Open-text',
  single_select: 'Single-select',
  multi_select: 'Multi-select',
  scale: 'Scale',
  other: 'Other',
}

export default async function PrintPage({
  params,
}: {
  params: Promise<{ submissionId: string }>
}) {
  const { submissionId } = await params
  const supabase = await requirePortalUser(`/portal/review/${submissionId}/print`)

  const { data: submission } = await supabase
    .from('question_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()
  if (!submission) notFound()

  const [{ data: project }, { data: questions }] = await Promise.all([
    supabase.from('portal_projects').select('project_name').eq('id', submission.project_id).maybeSingle(),
    supabase.from('questions').select('*').eq('submission_id', submissionId).order('order_num'),
  ])

  const qs = questions ?? []
  const openTextCount = qs.filter((q) => q.is_open_text).length
  const isDecided = submission.status === 'approved' || submission.status === 'rejected'

  let lastSection: string | null = null

  return (
    <div className="bg-white text-slate-900 min-h-screen print:p-0">
      {/* Controls — hidden in print output */}
      <div className="print:hidden flex items-center justify-between mb-6">
        <Link
          href={`/portal/review/${submissionId}`}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Back to review
        </Link>
        <PrintButton />
      </div>

      {/* Document */}
      <div className="max-w-3xl mx-auto print:max-w-none">
        {/* Header */}
        <div className="mb-8 border-b border-slate-200 pb-6 print:pb-4">
          <p className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-2">
            AlphaRoc — Survey Compliance
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {project?.project_name ?? 'Survey project'}
          </h1>
          <p className="text-sm text-slate-500">
            Version {submission.version} &middot; submitted {formatDate(submission.submitted_at)} &middot;{' '}
            {qs.length} questions &middot; {openTextCount} open-text
          </p>

          {/* Status line for decided submissions */}
          {isDecided && (
            <div className="mt-3">
              <p
                className={`text-sm font-medium ${
                  submission.status === 'approved' ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {submission.status === 'approved'
                  ? `Approved by compliance on ${formatDate(submission.reviewed_at)}`
                  : `Rejected by compliance on ${formatDate(submission.reviewed_at)}`}
              </p>
              {submission.review_note && (
                <p className="mt-1 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                  {submission.review_note}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Analyst message */}
        {submission.analyst_message && (
          <div className="mb-8 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              Message from AlphaRoc
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-line">{submission.analyst_message}</p>
          </div>
        )}

        {/* Questions */}
        <div className="flex flex-col">
          {qs.map((q) => {
            const showSection = q.section !== null && q.section !== lastSection
            if (q.section !== null) lastSection = q.section
            const answerOptions: string[] = Array.isArray(q.answer_options)
              ? (q.answer_options as string[])
              : []

            return (
              <div key={q.id}>
                {showSection && (
                  <p className="text-xs text-slate-400 uppercase tracking-widest mt-6 mb-2">
                    {q.section}
                  </p>
                )}
                <div className="flex gap-3 py-3 border-b border-slate-100">
                  <span className="text-xs text-slate-400 min-w-8 pt-0.5 shrink-0">
                    Q{q.order_num}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-slate-900">{q.text}</p>
                    {answerOptions.length > 0 && (
                      <ul className="list-disc pl-5 mt-1.5 space-y-0.5">
                        {answerOptions.map((opt, idx) => (
                          <li key={idx} className="text-xs text-slate-600">
                            {opt}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${
                          q.is_open_text
                            ? 'border-violet-300 text-violet-700 bg-violet-50'
                            : 'border-slate-200 text-slate-500 bg-slate-50'
                        }`}
                      >
                        {TYPE_LABEL[q.type] ?? q.type}
                      </span>
                      {q.is_ai_followup && (
                        <span className="text-xs px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 bg-emerald-50">
                          AI follow-up
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <p className="mt-10 text-xs text-slate-400 border-t border-slate-100 pt-4 print:mt-6">
          Generated from the question list submitted to AlphaRoc compliance. This document reflects
          the questions under review for this version.
        </p>
      </div>
    </div>
  )
}
