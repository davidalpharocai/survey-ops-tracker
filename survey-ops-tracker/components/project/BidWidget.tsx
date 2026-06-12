'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { toast } from '@/lib/utils/toast'
import type { Tables, TablesInsert } from '@/lib/supabase/types'

type Bid = Tables<'project_bids'>

const DEFAULT_HISTORY_SHOWN = 3

function useBids(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['bids', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_bids')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Bid[]
    },
    // If the migration hasn't been applied the table doesn't exist —
    // fail once and show the fallback note instead of hammering retries.
    retry: false,
  })
}

function useAddBid(projectId: string) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (bid: Omit<TablesInsert<'project_bids'>, 'project_id'>) => {
      const { error } = await supabase
        .from('project_bids')
        .insert({ ...bid, project_id: projectId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bids', projectId] })
    },
    onError: () => {
      toast("Couldn't save the bid — please try again.")
    },
  })
}

function useUpdateBid(projectId: string) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: { amount: number; blasts: number | null; note: string | null }
    }) => {
      const { error } = await supabase.from('project_bids').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bids', projectId] })
    },
    onError: () => {
      toast("Couldn't update the bid entry — please try again.")
    },
  })
}

function useDeleteBid(projectId: string) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_bids').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bids', projectId] })
    },
    onError: () => {
      toast("Couldn't delete the bid entry — please try again.")
    },
  })
}

function formatAmount(value: number): string {
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatBidDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function BidWidget({ projectId }: { projectId: string }) {
  const { data: bids, isLoading, isError } = useBids(projectId)
  const addBid = useAddBid(projectId)
  const updateBid = useUpdateBid(projectId)
  const deleteBid = useDeleteBid(projectId)
  const [showAll, setShowAll] = useState(false)
  const [amount, setAmount] = useState('')
  const [blasts, setBlasts] = useState('')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editBlasts, setEditBlasts] = useState('')
  const [editNote, setEditNote] = useState('')
  const [lastDeleted, setLastDeleted] = useState<Bid | null>(null)

  function handleDelete(b: Bid) {
    setLastDeleted(b)
    deleteBid.mutate(b.id)
  }

  function undoDelete() {
    if (!lastDeleted) return
    // re-insert with the original id and date so history order is preserved
    addBid.mutate({
      id: lastDeleted.id,
      amount: lastDeleted.amount,
      blasts: lastDeleted.blasts,
      note: lastDeleted.note,
      created_at: lastDeleted.created_at,
    })
    setLastDeleted(null)
  }

  function startEdit(b: Bid) {
    setEditingId(b.id)
    setEditAmount(String(b.amount))
    setEditBlasts(b.blasts != null ? String(b.blasts) : '')
    setEditNote(b.note ?? '')
  }

  function saveEdit() {
    if (!editingId) return
    const parsedAmount = parseFloat(editAmount)
    if (isNaN(parsedAmount)) return
    const parsedBlasts = parseInt(editBlasts, 10)
    updateBid.mutate({
      id: editingId,
      updates: {
        amount: parsedAmount,
        blasts: isNaN(parsedBlasts) ? null : parsedBlasts,
        note: editNote.trim() || null,
      },
    })
    setEditingId(null)
  }

  function save() {
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount)) return
    const parsedBlasts = parseInt(blasts, 10)
    addBid.mutate(
      {
        amount: parsedAmount,
        blasts: isNaN(parsedBlasts) ? null : parsedBlasts,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          setAmount('')
          setBlasts('')
          setNote('')
        },
      }
    )
  }

  function onFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
  }

  const current = bids && bids.length > 0 ? bids[0] : null
  const avg =
    bids && bids.length > 0
      ? bids.reduce((sum, b) => sum + b.amount, 0) / bids.length
      : null
  const allHaveBlasts = !!bids && bids.length > 0 && bids.every(b => b.blasts != null)
  const totalBlasts = allHaveBlasts ? bids!.reduce((sum, b) => sum + b.blasts!, 0) : 0
  const weightedAvg =
    allHaveBlasts && totalBlasts > 0
      ? bids!.reduce((sum, b) => sum + b.amount * b.blasts!, 0) / totalBlasts
      : null
  const visibleBids = showAll ? bids ?? [] : (bids ?? []).slice(0, DEFAULT_HISTORY_SHOWN)

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Bid $
        <InfoTooltip text="What we bid per response. History is kept because bids change over time — add a new entry each time the bid changes." />
      </p>

      {isError ? (
        <p className="text-xs text-muted-foreground/70">
          Bid tracking needs the latest database migration.
        </p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground flex items-center">
              Current bid
              <InfoTooltip text="The most recent bid per response — the rate currently in effect." />
            </span>
            <span className="text-sm font-semibold text-foreground">
              {current ? formatAmount(current.amount) : '—'}
            </span>
          </div>
          {avg != null && bids!.length > 1 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                Average
                <InfoTooltip text="Simple average of all bid entries, unweighted." />
              </span>
              <span className="text-xs text-foreground">{formatAmount(avg)}</span>
            </div>
          )}
          {weightedAvg != null && bids!.length > 1 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                Weighted avg (by blasts)
                <InfoTooltip text="Average bid weighted by blasts — the number of sends at each rate." />
              </span>
              <span className="text-xs text-foreground">{formatAmount(weightedAvg)}</span>
            </div>
          )}

          {bids!.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {visibleBids.map(b =>
                editingId === b.id ? (
                  <div
                    key={b.id}
                    className="flex gap-1.5 items-center"
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  >
                    <input
                      autoFocus
                      type="number"
                      value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      className="w-16 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:border-ring"
                    />
                    <input
                      type="number"
                      value={editBlasts}
                      onChange={e => setEditBlasts(e.target.value)}
                      placeholder="blasts"
                      className="w-14 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                    />
                    <input
                      value={editNote}
                      onChange={e => setEditNote(e.target.value)}
                      placeholder="note"
                      className="w-0 flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                    />
                    <button
                      onClick={saveEdit}
                      className="text-xs bg-muted hover:bg-accent text-foreground px-1.5 py-0.5 rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div key={b.id} className="group flex items-center gap-1">
                    <p className="text-xs text-muted-foreground truncate flex-1" title={b.note ?? undefined}>
                      <span className="text-foreground/80">{formatAmount(b.amount)}</span>
                      {b.blasts != null && <> · {b.blasts} blasts</>}
                      {' · '}
                      {formatBidDate(b.created_at)}
                      {b.note && <> · {b.note}</>}
                    </p>
                    <button
                      onClick={() => startEdit(b)}
                      title="Edit entry"
                      className="text-muted-foreground/50 hover:text-foreground text-xs px-0.5"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(b)}
                      title="Delete entry"
                      className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-xs px-0.5"
                    >
                      ✕
                    </button>
                  </div>
                )
              )}
              {bids!.length > DEFAULT_HISTORY_SHOWN && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  className="text-xs text-muted-foreground hover:text-foreground self-start transition-colors cursor-pointer"
                >
                  {showAll ? 'Show less' : `Show all (${bids!.length})`}
                </button>
              )}
            </div>
          )}

          {lastDeleted && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Deleted {formatAmount(lastDeleted.amount)} entry.</span>
              <button
                onClick={undoDelete}
                title="Restore the deleted bid entry"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                ↺ Undo
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5 mt-1" onKeyDown={onFormKeyDown}>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="$ amount"
                className="w-0 flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
              />
              <input
                type="number"
                value={blasts}
                onChange={e => setBlasts(e.target.value)}
                placeholder="blasts"
                className="w-16 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="note (optional)"
                className="w-0 flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
              />
              <button
                onClick={save}
                disabled={!amount.trim() || addBid.isPending}
                className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground px-2 py-1 rounded transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
