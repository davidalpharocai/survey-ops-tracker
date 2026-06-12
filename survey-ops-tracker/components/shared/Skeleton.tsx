// Shimmering placeholder blocks shown while data loads, shaped roughly like
// the real content so the page doesn't jump when it arrives.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`bg-muted animate-pulse rounded ${className}`} />
}

/** A board-card-shaped block: title line, two short lines, footer line. */
export function SkeletonCard() {
  return (
    <div aria-hidden className="bg-background rounded-lg p-2.5 flex flex-col gap-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-full mt-1" />
    </div>
  )
}

/** A table-row-ish line. */
export function SkeletonRow() {
  return (
    <div aria-hidden className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}
