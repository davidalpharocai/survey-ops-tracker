'use client'
import { useEffect, useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

export interface BoardView {
  name: string
  captain: string | null
  type: string | null
  due: string | null
  stage: string | null
}

const KEY = 'sot.savedViews'

/**
 * Named filter combinations, saved per browser (only you see yours).
 * Picking one applies its captain/type/due/stage filters in one click.
 */
export function SavedViews({
  current,
  onApply,
}: {
  current: Omit<BoardView, 'name'>
  onApply: (v: BoardView) => void
}) {
  const [views, setViews] = useState<BoardView[]>([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    try {
      setViews(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
    } catch {
      // corrupted storage — start fresh
    }
  }, [])

  function persist(next: BoardView[]) {
    setViews(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    persist([...views.filter(v => v.name !== trimmed), { name: trimmed, ...current }])
    setSelected(trimmed)
    setName('')
    setSaving(false)
  }

  function remove() {
    if (!selected) return
    persist(views.filter(v => v.name !== selected))
    setSelected('')
  }

  const inputClass =
    'bg-muted border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring'

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center">
        Views
        <InfoTooltip text="Save the current filter combination under a name and jump back to it in one click. Views are personal — saved in this browser, only you see them." />
      </span>
      <div className="flex items-center gap-1.5">
        <select
          value={selected}
          onChange={e => {
            setSelected(e.target.value)
            const v = views.find(x => x.name === e.target.value)
            if (v) onApply(v)
          }}
          className={`${inputClass} cursor-pointer`}
          title="Apply a saved view"
        >
          <option value="">—</option>
          {views.map(v => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
        {saving ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setSaving(false)
            }}
            onBlur={() => (name.trim() ? save() : setSaving(false))}
            placeholder="view name…"
            className={`${inputClass} w-28`}
          />
        ) : (
          <button
            onClick={() => setSaving(true)}
            title="Save the current filters as a named view"
            className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-ring rounded px-2 py-1.5 transition-colors"
          >
            ★ Save
          </button>
        )}
        {selected && (
          <button
            onClick={remove}
            title={`Delete the "${selected}" view`}
            className="text-xs text-muted-foreground/60 hover:text-red-600 dark:hover:text-red-400 px-1 transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
