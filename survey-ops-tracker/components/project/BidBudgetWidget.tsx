'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useBidBudget,
  useAddBidBudget,
  useUpdateBidBudget,
  useDeleteBidBudget,
  currentBidBudget,
  type BidBudgetEntry,
} from '@/lib/hooks/useBidBudget'

const DEFAULT_SHOWN = 3
function rate(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function BidBudgetWidget({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: entries, isError } = useBidBudget(projectId)
  const add = useAddBidBudget(projectId)
  const update = useUpdateBidBudget(projectId)
  const del = useDeleteBidBudget(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')

  const list = entries ?? []
  const current = currentBidBudget(entries)
  const visible = showAll ? list : list.slice(0, DEFAULT_SHOWN)

  function save() {
    const a = parseFloat(amount)
    if (isNaN(a)) return
    add.mutate(
      { amount: a, note: note.trim() || null, createdBy: userName },
      { onSuccess: () => { setAmount(''); setNote('') } }
    )
  }
  function startEdit(e: BidBudgetEntry) {
    setEditingId(e.id)
    setEditAmount(String(e.amount))
    setEditNote(e.note ?? '')
  }
  function saveEdit() {
    if (!editingId) return
    const a = parseFloat(editAmount)
    if (isNaN(a)) { setEditingId(null); return }
    update.mutate({ id: editingId, amount: a, note: editNote.trim() || null })
    setEditingId(null)
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Bid Budget
        <InfoTooltip text="The $/bid the PM is greenlit to charge per completed response. Update it when leadership approves an increase — every change is logged with who and when." />
      </p>
      {isError ? (
        <p className="text-xs text-muted-foreground/70">Bid budget needs the latest database migration.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Allowed</span>
            <span className="text-sm font-semibold text-foreground">
              {current != null ? <>{rate(current)} <span className="text-muted-foreground font-normal">/bid</span></> : '—'}
            </span>
          </div>

          {list.length > 0 && (
            <div className="flex flex-col gap-1">
              {visible.map(e =>
                editingId === e.id ? (
                  <div
                    key={e.id}
                    className="flex gap-1.5 items-center"
                    onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(); if (ev.key === 'Escape') setEditingId(null) }}
                  >
                    <input
                      autoFocus
                      type="number"
                      value={editAmount}
                      onChange={ev => setEditAmount(ev.target.value)}
                      className="w-16 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:border-ring"
                    />
                    <input
                      value={editNote}
                      onChange={ev => setEditNote(ev.target.value)}
                      placeholder="note"
                      className="w-0 flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                    />
                    <button onClick={saveEdit} className="text-xs bg-muted hover:bg-accent text-foreground px-1.5 py-0.5 rounded transition-colors">Save</button>
                  </div>
                ) : (
                  <div key={e.id} className="group flex items-center gap-1">
                    <p className="text-xs text-muted-foreground truncate flex-1" title={e.note ?? undefined}>
                      <span className="text-foreground font-medium">{rate(e.amount)}</span>
                      {' /bid · '}{fmtDate(e.created_at)}
                      {e.created_by ? ` · ${e.created_by}` : ''}
                      {e.note ? ` — ${e.note}` : ''}
                    </p>
                    <button onClick={() => startEdit(e)} title="Edit" className="text-muted-foreground/50 hover:text-foreground text-xs px-0.5">✎</button>
                    <button onClick={() => del.mutate(e.id)} title="Delete" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs px-0.5">✕</button>
                  </div>
                )
              )}
              {list.length > DEFAULT_SHOWN && (
                <button onClick={() => setShowAll(s => !s)} className="text-xs text-muted-foreground hover:text-foreground self-start transition-colors">
                  {showAll ? 'Show less' : `Show all (${list.length})`}
                </button>
              )}
            </div>
          )}

          <div className="flex gap-1.5 mt-1" onKeyDown={ev => { if (ev.key === 'Enter') save() }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="$ / bid"
              className="w-20 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="note (e.g. greenlit)"
              className="w-0 flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
            <button onClick={save} disabled={!amount.trim() || add.isPending} className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground px-2 py-1 rounded transition-colors">Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
