const URGENCY_ITEMS = [
  { classes: 'border-2 border-red-500', label: 'Due today / overdue' },
  { classes: 'border-2 border-orange-500', label: 'Due tomorrow' },
  { classes: 'border-2 border-amber-300 dark:border-amber-400/70', label: 'Due in 2 days' },
]

const TYPE_ITEMS = [
  { classes: 'bg-blue-500/20 text-blue-600 dark:text-blue-400', label: 'PS' },
  { classes: 'bg-violet-500/20 text-violet-600 dark:text-violet-400', label: 'B2B' },
  { classes: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400', label: 'Rerun' },
]

export function ColorKey() {
  return (
    <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs text-muted-foreground bg-card border border-border/70 rounded-lg px-3 py-2">
      <span className="font-medium uppercase tracking-wider text-[11px]">Key</span>
      {URGENCY_ITEMS.map(item => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`inline-block w-3.5 h-3.5 rounded bg-background ${item.classes}`} />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3.5 h-3.5 rounded bg-background border-2 border-muted-foreground/40 opacity-60" />
        On hold
      </span>
      <span className="text-border">|</span>
      {TYPE_ITEMS.map(item => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${item.classes}`}>{item.label}</span>
          type
        </span>
      ))}
      <span className="text-border">|</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">⚑</span>
        High
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">‼</span>
        Urgent
      </span>
    </div>
  )
}
