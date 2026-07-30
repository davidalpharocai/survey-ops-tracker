import { redirect } from 'next/navigation'

// Deliverables Review + Email Review were combined into one two-column page.
// Keep this route as a redirect so old links/bookmarks still work.
export default function DeliverablesPage() {
  redirect('/review')
}
