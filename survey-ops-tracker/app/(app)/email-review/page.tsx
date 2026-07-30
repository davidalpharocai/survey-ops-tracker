import { redirect } from 'next/navigation'

// Email Review + Deliverables Review were combined into one two-column page.
// Keep this route as a redirect so old links/bookmarks still work.
export default function EmailReviewPage() {
  redirect('/review')
}
