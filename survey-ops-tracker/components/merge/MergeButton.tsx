'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MergeModal } from './MergeModal'

type Row = { id: string } & Record<string, unknown>

export function MergeButton({
  kind,
  record,
  label = 'Merge…',
  className = 'text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors',
  onOpen,
  open,
  onClose,
}: {
  kind: 'project' | 'client'
  record: Row
  /** Trigger content — a plain string for the standalone button, JSX for a menu item. */
  label?: ReactNode
  /** Override the trigger styling (e.g. to render as a dropdown menu item). */
  className?: string
  /** Called when the picker opens — lets a parent menu close itself. */
  onOpen?: () => void
  /**
   * Controlled mode. When `open` is provided, this component renders NO trigger
   * button — the parent owns the trigger and this just shows the picker/modal
   * driven by `open`. Use this when the trigger lives inside something that
   * unmounts (e.g. an auto-closing dropdown menu): render the trigger in the
   * menu and this controlled MergeButton at a stable top level, so closing the
   * menu can't tear down the in-progress merge UI.
   */
  open?: boolean
  onClose?: () => void
}) {
  const supabase = createClient()
  const controlled = open !== undefined
  const [searchingUncontrolled, setSearchingUncontrolled] = useState(false)
  const searching = controlled ? !!open : searchingUncontrolled
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [other, setOther] = useState<Row | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const table = kind === 'project' ? 'survey_projects' : 'clients'
  const nameKey = kind === 'project' ? 'project_name' : 'name'
  const codeKey = kind === 'project' ? 'project_code' : 'code'

  useEffect(() => {
    if (!searching || q.trim().length < 2) { setResults([]); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { data } = await supabase
        .from(table)
        .select('*')
        .is('deleted_at', null)
        .neq('id', record.id)
        .ilike(nameKey, `%${q.trim()}%`)
        .limit(8)
      setResults((data as Row[]) ?? [])
    }, 200)
  }, [q, searching, table, nameKey, record.id, supabase])

  // Close the whole flow (search + modal) and reset transient state.
  function close() {
    setQ('')
    setResults([])
    setOther(null)
    if (controlled) onClose?.()
    else setSearchingUncontrolled(false)
  }

  return (
    <>
      {!controlled && (
        <button
          onClick={() => { setSearchingUncontrolled(true); onOpen?.() }}
          className={className}
          title={`Merge this ${kind} with a duplicate`}
        >
          {label}
        </button>
      )}

      {searching && !other && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-24" onClick={close}>
          <div className="w-full max-w-md bg-card border border-border rounded-xl p-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-foreground mb-2">Find the duplicate {kind} to merge with</p>
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder={`Search ${kind} by name…`}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
            />
            <div className="mt-2 flex flex-col gap-1 max-h-[16rem] overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setOther(r); setQ('') }}
                  className="text-left rounded px-2 py-1.5 hover:bg-accent transition-colors"
                >
                  <span className="block text-sm text-foreground truncate">{String(r[nameKey] ?? '')}</span>
                  <span className="block text-xs text-muted-foreground">{String(r[codeKey] ?? '')}</span>
                </button>
              ))}
              {q.trim().length >= 2 && results.length === 0 && (
                <p className="text-xs text-muted-foreground/60 px-2 py-2">No matches.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {other && <MergeModal kind={kind} a={record} b={other} open onClose={close} />}
    </>
  )
}
