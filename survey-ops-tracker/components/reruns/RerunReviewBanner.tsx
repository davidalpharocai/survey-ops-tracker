'use client'
import { useLastRerunReview, useMarkRerunReviewed } from '@/lib/hooks/useReruns'
import { RERUN_REVIEW_FACILITATOR, isReviewedThisWeek } from '@/lib/reruns/review'
import { formatDate } from '@/lib/utils/date'
import { toast } from '@/lib/utils/toast'

// The weekly rerun-review ritual surface. Armed each Monday (facilitator: Sree)
// and disarmed once someone records a review that week. It's the human backstop
// that clears the Overdue + "needs a date" queues on a cadence — independent of
// whether the per-owner email nudges are switched on.
export function RerunReviewBanner({
  overdue,
  needsDate,
  dueSoon,
  onJump,
}: {
  overdue: number
  needsDate: number
  dueSoon: number
  onJump?: () => void
}) {
  const { data: last, isLoading } = useLastRerunReview()
  const mark = useMarkRerunReviewed()

  // Don't flash the "review due" state before we know if it was already done.
  if (isLoading) return null

  const reviewed = isReviewedThisWeek(last?.created_at, new Date())
  const needsAttention = overdue + needsDate > 0

  function markReviewed() {
    mark.mutate(
      { overdue_count: overdue, undefined_count: needsDate, due_soon_count: dueSoon },
      {
        onSuccess: () => toast('Weekly review recorded ✓', 'success'),
        onError: (e) => toast(String((e as Error).message)),
      }
    )
  }

  // Already reviewed this week → quiet confirmation line.
  if (reviewed) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-xl px-4 py-2">
        <span aria-hidden="true">✅</span>
        <span>
          Weekly rerun review done{last?.created_at ? ` ${formatDate(last.created_at.slice(0, 10))}` : ''}
          {last?.reviewed_by ? ` by ${last.reviewed_by}` : ''}. Facilitator: {RERUN_REVIEW_FACILITATOR}.
        </span>
      </div>
    )
  }

  const tone = needsAttention
    ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-emerald-500/40 bg-emerald-500/5'

  return (
    <div className={`rounded-xl border ${tone} px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
      <div className="flex items-start gap-2 text-sm">
        <span aria-hidden="true" className="mt-0.5">🗓</span>
        <div>
          <p className="font-medium text-foreground">
            Weekly rerun review{needsAttention ? ' due' : ' — all clear'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {needsAttention ? (
              <>
                {overdue > 0 && (
                  <span className="text-red-600 dark:text-red-400 font-medium">{overdue} overdue</span>
                )}
                {overdue > 0 && needsDate > 0 && ' · '}
                {needsDate > 0 && <span>{needsDate} need a date</span>}
                {dueSoon > 0 && <> · {dueSoon} due this week</>}
                {' · '}Facilitator: {RERUN_REVIEW_FACILITATOR}
              </>
            ) : (
              <>Nothing overdue or undefined{dueSoon > 0 ? ` · ${dueSoon} due this week` : ''}. Facilitator: {RERUN_REVIEW_FACILITATOR}.</>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {needsAttention && onJump && (
          <button type="button" onClick={onJump} className="text-xs text-primary hover:underline">
            Work the list
          </button>
        )}
        <button
          type="button"
          onClick={markReviewed}
          disabled={mark.isPending}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {mark.isPending ? 'Saving…' : 'Mark reviewed'}
        </button>
      </div>
    </div>
  )
}
