'use client'
import { useEffect, useRef, useState } from 'react'

// Generic "⚙ Columns" show/hide + reorder popover. Extracted from
// RerunSeriesRecord's WaveColumnsMenu (the waves table's column picker) so
// every configurable-columns table in the app can share one implementation —
// currently the Rerun Series record's Waves table and the Reruns List view
// (both granularities). Purely controlled: the caller owns persistence
// (typically a localStorage-backed key) and passes the current
// visible/ordered keys plus the full column registry and default order.

export interface ColumnMenuItem {
  key: string
  label: string
  /** Shown as the row's title attribute in the popover. */
  tooltip?: string
}

export function ColumnsMenu({
  visibleKeys,
  allColumns,
  defaultKeys,
  onChange,
  buttonTitle = 'Choose which columns you see, and their order — personal to you, remembered in this browser',
}: {
  visibleKeys: string[]
  allColumns: ColumnMenuItem[]
  defaultKeys: string[]
  onChange: (next: string[]) => void
  buttonTitle?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const allKeys = allColumns.map((c) => c.key)
  const hiddenKeys = allKeys.filter((k) => !visibleKeys.includes(k))
  const menuOrder = [...visibleKeys, ...hiddenKeys]

  function toggle(key: string) {
    const isVisible = visibleKeys.includes(key)
    // Never allow zero visible columns — unchecking the last one would render a
    // headerless/blank table (colSpan 0). No-op instead (the checkbox is also
    // disabled below when it's the only one left).
    if (isVisible && visibleKeys.length === 1) return
    onChange(isVisible ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key])
  }
  function move(key: string, dir: -1 | 1) {
    const idx = visibleKeys.indexOf(key)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= visibleKeys.length) return
    const next = [...visibleKeys]
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    onChange(next)
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={buttonTitle}
        className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-ring rounded px-2 py-1 transition-colors"
      >
        ⚙ Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-popover border border-border rounded-lg shadow-xl p-2 flex flex-col gap-0.5 w-64">
          {menuOrder.map((key) => {
            const col = allColumns.find((c) => c.key === key)
            if (!col) return null
            const visible = visibleKeys.includes(key)
            const idx = visibleKeys.indexOf(key)
            // The single remaining visible column is required — disable its
            // checkbox so the table can never be emptied to zero columns.
            const isLastVisible = visible && visibleKeys.length === 1
            return (
              <div
                key={key}
                className="flex items-center gap-1 text-sm text-foreground/90 hover:bg-accent rounded px-1.5 py-1"
                title={isLastVisible ? 'At least one column must stay visible' : col.tooltip}
              >
                <label className={`flex items-center gap-2 flex-1 min-w-0 ${isLastVisible ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={isLastVisible}
                    onChange={() => toggle(key)}
                    className="accent-blue-600 shrink-0 disabled:opacity-50"
                  />
                  <span className="truncate">{col.label}</span>
                </label>
                {visible && (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => move(key, -1)}
                      disabled={idx === 0}
                      title="Move earlier"
                      aria-label={`Move ${col.label} earlier`}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground w-4"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(key, 1)}
                      disabled={idx === visibleKeys.length - 1}
                      title="Move later"
                      aria-label={`Move ${col.label} later`}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground w-4"
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            )
          })}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => onChange(defaultKeys)}
              className="text-[12px] text-muted-foreground hover:text-foreground px-1.5 py-1 w-full text-left"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
