'use client'
import { useEffect, useRef, useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

interface SavedView<T> {
  name: string
  config: T
}

/**
 * Named, personal presets for any view (board filters, list columns, …).
 * Generic over the config payload `T`; each caller supplies its current
 * config and an apply handler. Views are saved per-browser (only you see
 * yours) and can be applied, updated in place, renamed, and deleted.
 */
export function SavedViews<T>({
  storageKey,
  current,
  onApply,
  tooltip,
}: {
  storageKey: string
  current: T
  onApply: (config: T) => void
  tooltip?: string
}) {
  const [views, setViews] = useState<SavedView<T>[]>([])
  const [selected, setSelected] = useState('')
  const [mode, setMode] = useState<'idle' | 'new' | 'rename'>('idle')
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      setViews(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
    } catch {
      // corrupted storage — start fresh
    }
  }, [storageKey])

  function persist(next: SavedView<T>[]) {
    setViews(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }

  function saveNew() {
    const name = draft.trim()
    if (!name) return setMode('idle')
    persist([...views.filter(v => v.name !== name), { name, config: current }])
    setSelected(name)
    setMode('idle')
  }

  function rename() {
    const name = draft.trim()
    if (!name || !selected) return setMode('idle')
    persist(views.map(v => (v.name === selected ? { ...v, name } : v)))
    setSelected(name)
    setMode('idle')
  }

  function updateSelected() {
    if (!selected) return
    persist(views.map(v => (v.name === selected ? { ...v, config: current } : v)))
  }

  function remove() {
    if (!selected) return
    persist(views.filter(v => v.name !== selected))
    setSelected('')
  }

  const inputClass =
    'bg-muted border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring'
  const btn =
    'text-xs text-muted-foreground hover:text-foreground border border-border hover:border-ring rounded px-2 py-1.5 transition-colors whitespace-nowrap'

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center">
        Views
        <InfoTooltip
          text={
            tooltip ??
            'Save the current setup under a name and jump back to it in one click. Views are personal — saved in this browser, only you see them. Pick one, then Update / Rename / Delete it.'
          }
        />
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {mode !== 'idle' ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (mode === 'new') saveNew()
                else rename()
              }
              if (e.key === 'Escape') setMode('idle')
            }}
            onBlur={() => (mode === 'new' ? saveNew() : rename())}
            placeholder={mode === 'new' ? 'new view name…' : 'rename to…'}
            className={`${inputClass} w-32`}
          />
        ) : (
          <>
            <select
              value={selected}
              onChange={e => {
                setSelected(e.target.value)
                const v = views.find(x => x.name === e.target.value)
                if (v) onApply(v.config)
              }}
              className={`${inputClass} cursor-pointer max-w-[10rem]`}
              title="Apply a saved view"
            >
              <option value="">{views.length ? 'Pick a view…' : 'No saved views'}</option>
              {views.map(v => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setDraft('')
                setMode('new')
              }}
              title="Save the current setup as a new view"
              className={btn}
            >
              ★ Save
            </button>
            {selected && (
              <>
                <button
                  onClick={updateSelected}
                  title={`Update "${selected}" to match the current setup`}
                  className={btn}
                >
                  ⟳ Update
                </button>
                <button
                  onClick={() => {
                    setDraft(selected)
                    setMode('rename')
                  }}
                  title={`Rename "${selected}"`}
                  className="text-xs text-muted-foreground/70 hover:text-foreground px-1 transition-colors"
                >
                  ✎
                </button>
                <button
                  onClick={remove}
                  title={`Delete "${selected}"`}
                  className="text-xs text-muted-foreground/70 hover:text-red-600 dark:hover:text-red-400 px-1 transition-colors"
                >
                  🗑
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
