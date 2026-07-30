import { ReviewQueue } from '@/components/deliverables/ReviewQueue'
import { EmailReviewQueue } from '@/components/email-review/EmailReviewQueue'

export const dynamic = 'force-dynamic'

// Combined review surface — Deliverables Review + Email Review were each only
// half-page wide, so they live side-by-side here (two columns on wide screens,
// stacked on narrow). Each column keeps its own queue component + behavior.
export default function ReviewPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-lg font-semibold">Review</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Two queues to clear: emailed deliverables we couldn&apos;t auto-file, and client emails we couldn&apos;t
        tie to a single project. File each to the right project (or dismiss it).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
        <section>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span aria-hidden="true">📦</span> Deliverables
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Emailed deliverables we couldn&apos;t auto-file to a single client + project. Most auto-file straight to
            the client&apos;s Shared Drive folder; you can also attach one directly from any project page.
          </p>
          <ReviewQueue />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span aria-hidden="true">✉️</span> Email
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Client emails we couldn&apos;t confidently tie to a single project. Confident matches (a project code,
            survey ID, or a known contact naming the project) log straight to the project&apos;s activity timeline.
          </p>
          <EmailReviewQueue />
        </section>
      </div>
    </div>
  )
}
