'use client'
import { useMemo, useState } from 'react'

// Keyword project picker: type ANY word(s) from the client / project name / PR code —
// matches substrings ANYWHERE in the label (not just the first word like a native
// <select>), results sorted alphabetically. Picking a project calls onPick(id).
// Shared by the Email Review and Deliverables review queues.
export function ProjectPicker({
  options,
  disabled,
  onPick,
  placeholder = 'Search projects by any word…',
}: {
  options: { id: string; label: string }[]
  disabled?: boolean
  onPick: (projectId: string) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => [...options].sort((a, b) => a.label.localeCompare(b.label)), [options])
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = terms.length
    ? sorted.filter((o) => {
        const l = o.label.toLowerCase()
        return terms.every((t) => l.includes(t))
      })
    : sorted
  const shown = matches.slice(0, 50)

  return (
    <div className="relative flex-1 min-w-48">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background disabled:opacity-40"
      />
      {open && q.trim() && (
        <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-popover border border-border rounded-lg shadow-xl">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matching project</li>
          ) : (
            shown.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(o.id)
                    setQ('')
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-40"
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
          {matches.length > shown.length && (
            <li className="px-3 py-1.5 text-[11px] text-muted-foreground/70">
              +{matches.length - shown.length} more — keep typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
