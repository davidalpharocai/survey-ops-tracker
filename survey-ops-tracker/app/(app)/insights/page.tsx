'use client'

import { Suspense } from 'react'
import { InsightsDashboard, InsightsSkeleton } from '@/components/insights/InsightsDashboard'

/**
 * /insights — the analyst dashboard. Everything lives in
 * components/insights (rendering) and lib/insights (every figure, as pure,
 * tested functions). The filter is read from the URL, and useSearchParams
 * needs a Suspense boundary in the app router.
 *
 * Counts, days and percentages only — no dollar figure for anyone.
 */
export default function InsightsPage() {
  return (
    <Suspense fallback={<InsightsSkeleton />}>
      <InsightsDashboard />
    </Suspense>
  )
}
