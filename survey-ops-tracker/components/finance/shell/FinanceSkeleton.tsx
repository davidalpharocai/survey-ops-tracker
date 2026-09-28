import { Skeleton } from '@/components/shared/Skeleton'

/**
 * The page's shape while the book loads — header, tabs, filter bar, banner and
 * two cards — so nothing jumps when the numbers arrive. Screen readers get one
 * sentence instead of a stack of empty boxes.
 */
export function FinanceSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-3 py-2" aria-busy="true">
      <p role="status" className="sr-only">Loading the finance data…</p>
      <div className="flex flex-wrap items-baseline gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="ml-auto h-4 w-28" />
      </div>
      <div className="flex gap-2 border-b border-border pb-2">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-7 w-24" />)}
      </div>
      <div className="flex flex-wrap gap-3 rounded-lg border border-border px-4 py-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="ml-auto h-8 w-40" />
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
