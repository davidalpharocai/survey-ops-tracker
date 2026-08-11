'use client'

// A small segmented control (radio-group of pill buttons). Extracted from the
// /reruns page so the view switcher (Calendar | List | Series), the List
// granularity toggle (Series | Waves), and the legacy radar's work/platform
// toggles all share one accessible implementation.
export function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { v: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            value === o.v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
