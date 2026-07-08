import { EmailReviewQueue } from '@/components/email-review/EmailReviewQueue'

export const dynamic = 'force-dynamic'

export default function EmailReviewPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold">Email Review</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Client emails we couldn&apos;t confidently tie to a single project land here — file each to the right
        project, or ignore it. Confident matches (a project code, a survey ID, or a known contact naming the
        project) log straight to the project&apos;s activity timeline without review.
      </p>
      <EmailReviewQueue />
    </div>
  )
}
