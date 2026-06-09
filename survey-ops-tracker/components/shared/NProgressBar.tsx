interface NProgressBarProps {
  collected: number | null
  target: number | null
  showLabel?: boolean
}

export function NProgressBar({ collected, target, showLabel = true }: NProgressBarProps) {
  const pct =
    collected != null && target != null && target > 0
      ? Math.min((collected / target) * 100, 100)
      : 0
  const met = collected != null && target != null && collected >= target

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400">N Collected</span>
          <span className={met ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
            {collected != null ? collected : '—'} / {target != null ? target : '—'}
            {met && ' ✓'}
          </span>
        </div>
      )}
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${met ? 'bg-emerald-400' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
