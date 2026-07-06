import { fmtNum } from '@/lib/utils/number'

interface NProgressBarProps {
  collected: number | null
  target: number | null
  showLabel?: boolean
}

export function NProgressBar({ collected, target, showLabel = true }: NProgressBarProps) {
  // No goal set yet: don't draw an empty grey track (which reads as "failing to
  // collect" and clutters a board of brand-new cards). Show a single muted line
  // when labeled, nothing when the bar is used bare (e.g. the detail hero).
  if (target == null || target <= 0) {
    if (!showLabel) return null
    return (
      <div className="text-xs text-muted-foreground/70">
        {collected != null && collected > 0 ? `${fmtNum(collected)} collected · no target` : 'No target set'}
      </div>
    )
  }

  const pct =
    collected != null && target != null && target > 0
      ? Math.min((collected / target) * 100, 100)
      : 0
  const met = collected != null && target != null && collected >= target

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">N Collected</span>
          <span className={met ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-foreground/80'}>
            {fmtNum(collected)} / {fmtNum(target)}
            {met && ' ✓'}
          </span>
        </div>
      )}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${met ? 'bg-emerald-400' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
