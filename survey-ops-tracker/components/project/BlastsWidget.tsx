'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useProjectBlasts, useAddBlast, useUpdateBlast, useDeleteBlast, type Blast } from '@/lib/hooks/useProjectBlasts'
import { useBidBudget, currentBidBudget } from '@/lib/hooks/useBidBudget'
import { blastTotal, totalBidDollars, totalBlastFees, totalDelivered, weightedAvgBid, avgBid } from '@/lib/utils/blast'

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function rate(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const ROW = 'grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center'

export function BlastsWidget({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(projectId)
  const { data: budgetEntries } = useBidBudget(projectId)
  const add = useAddBlast(projectId)
  const update = useUpdateBlast(projectId)
  const del = useDeleteBlast(projectId)
  const cap = currentBidBudget(budgetEntries)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [delivered, setDelivered] = useState('')
  const [bid, setBid] = useState('')
  const [blastCost, setBlastCost] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [ed, setEd] = useState({ delivered: '', bid: '', blast_cost: '' })

  const list = blasts ?? []
  const total = totalBidDollars(list)
  const overCap = cap != null && list.some(b => b.bid > cap)

  function resetAdd() { setDelivered(''); setBid(''); setBlastCost('') }
  function save() {
    const d = parseInt(delivered, 10)
    const b = bid.trim() === '' ? cap : parseFloat(bid)
    if (isNaN(d) || b == null || isNaN(b)) return
    const bc = parseFloat(blastCost)
    add.mutate({ delivered: d, bid: b, blast_cost: isNaN(bc) ? 0 : bc, created_by: userName }, { onSuccess: resetAdd })
  }
  function startEdit(bl: Blast) {
    setEditingId(bl.id)
    setEd({ delivered: String(bl.delivered), bid: String(bl.bid), blast_cost: String(bl.blast_cost) })
  }
  function saveEdit() {
    if (!editingId) return
    const d = parseInt(ed.delivered, 10), b = parseFloat(ed.bid), bc = parseFloat(ed.blast_cost)
    update.mutate({ id: editingId, updates: { delivered: isNaN(d) ? 0 : d, bid: isNaN(b) ? 0 : b, blast_cost: isNaN(bc) ? 0 : bc } })
    setEditingId(null)
  }

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Blasts</p>
        <p className="text-xs text-muted-foreground/70">Blasts need the latest database migration.</p>
      </div>
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Blasts
        <InfoTooltip text="Each send: # delivered, the $/bid used, and the fixed blast fee. Row total = (# × $/bid) + fee; they sum to Total bid $. $/bid defaults to the current Bid Budget; a bid above it is flagged." />
      </p>

      <div className="flex flex-col gap-1 text-xs">
        <div className={`${ROW} text-[11px] text-muted-foreground`}>
          <span># delivered</span>
          <span className="text-right">$/bid</span>
          <span className="text-right">blast $</span>
          <span className="text-right">total</span>
          <span></span>
        </div>

        {list.map(bl =>
          editingId === bl.id ? (
            <div key={bl.id} className="flex gap-1 items-center" onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}>
              <input autoFocus type="number" value={ed.delivered} onChange={e => setEd({ ...ed, delivered: e.target.value })} className="w-0 flex-1 bg-muted border border-border rounded px-1 py-0.5 text-xs focus:outline-none focus:border-ring" />
              <input type="number" value={ed.bid} onChange={e => setEd({ ...ed, bid: e.target.value })} className="w-12 bg-muted border border-border rounded px-1 py-0.5 text-xs focus:outline-none focus:border-ring" />
              <input type="number" value={ed.blast_cost} onChange={e => setEd({ ...ed, blast_cost: e.target.value })} className="w-12 bg-muted border border-border rounded px-1 py-0.5 text-xs focus:outline-none focus:border-ring" />
              <button onClick={saveEdit} className="text-xs bg-muted hover:bg-accent px-1.5 py-0.5 rounded">Save</button>
            </div>
          ) : (
            <div key={bl.id} className={`group ${ROW}`}>
              <span className="text-foreground">{bl.delivered.toLocaleString()}</span>
              <span
                className={`text-right ${cap != null && bl.bid > cap ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}
                title={cap != null && bl.bid > cap ? `Over the ${rate(cap)} bid budget` : undefined}
              >
                {rate(bl.bid)}{cap != null && bl.bid > cap ? ' ⚠' : ''}
              </span>
              <span className="text-right text-foreground">{money(bl.blast_cost)}</span>
              <span className="text-right text-foreground font-medium">{money(blastTotal(bl))}</span>
              <span className="flex">
                <button onClick={() => startEdit(bl)} title="Edit" className="text-muted-foreground/50 hover:text-foreground px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">✎</button>
                <button onClick={() => del.mutate(bl.id)} title="Delete" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
              </span>
            </div>
          )
        )}

        {list.length > 0 && (
          <>
            <div className={`${ROW} border-t border-border pt-1 mt-0.5 font-medium text-foreground`}>
              <span>{totalDelivered(list).toLocaleString()}</span>
              <span className="text-right text-muted-foreground">—</span>
              <span className="text-right">{money(totalBlastFees(list))}</span>
              <span className="text-right">{money(total)}</span>
              <span></span>
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
              <span>Total bid $ <span className="text-foreground font-medium">{money(total)}</span></span>
              <span>
                wtd {rate(weightedAvgBid(list))} · avg {rate(avgBid(list))}
                {cap != null && (
                  <> · <span className={overCap ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{overCap ? 'over cap' : `within ${rate(cap)} ✓`}</span></>
                )}
              </span>
            </div>
          </>
        )}

        <div className="flex gap-1 mt-1.5" onKeyDown={e => { if (e.key === 'Enter') save() }}>
          <input type="number" value={delivered} onChange={e => setDelivered(e.target.value)} placeholder="# delivered" className="w-0 flex-1 bg-muted border border-border rounded px-1.5 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-ring" />
          <input type="number" value={bid} onChange={e => setBid(e.target.value)} placeholder={cap != null ? rate(cap) : '$/bid'} className="w-14 bg-muted border border-border rounded px-1.5 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-ring" />
          <input type="number" value={blastCost} onChange={e => setBlastCost(e.target.value)} placeholder="blast $" className="w-14 bg-muted border border-border rounded px-1.5 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-ring" />
          <button onClick={save} disabled={!delivered.trim() || (cap == null && !bid.trim()) || add.isPending} className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded">Add</button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          {cap == null ? 'Set a Bid Budget above to auto-fill $/bid, or type one here.' : '$/bid defaults to the current Bid Budget.'}
        </p>
      </div>
    </div>
  )
}
