import { cn } from '@/lib/utils'

// The base-survey-type badge for a rerun series. PS/B2B render the solid colored
// badge used across the reruns surfaces. Some legacy seeded series came in tagged
// only "Rerun Service" with no base type yet (migration 074: base_type nullable +
// rerun_service flag) — those render a neutral "🔁 Rerun Service" outline tag
// instead, to be classified PS/B2B later. Pure + null-safe so every badge site
// can drop the old TYPE_BADGE[base_type] lookup (which assumed non-null).

const TYPE_BADGE: Record<string, string> = {
  PS: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  B2B: 'bg-violet-500/20 text-violet-600 dark:text-violet-400',
}

export function BaseTypeTag({
  baseType,
  rerunService,
  className = '',
}: {
  baseType: string | null
  rerunService?: boolean
  className?: string
}) {
  if (baseType === 'PS' || baseType === 'B2B') {
    return (
      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', TYPE_BADGE[baseType], className)}>
        {baseType}
      </span>
    )
  }
  return (
    <span
      title={
        rerunService
          ? 'Tagged Rerun Service — base survey type not set yet'
          : 'Base survey type not set yet (came in as Rerun Service)'
      }
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium border border-border text-muted-foreground bg-transparent whitespace-nowrap',
        className,
      )}
    >
      🔁 Rerun Service
    </span>
  )
}
