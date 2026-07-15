'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useProjectBlasts,
  useAddBlast,
  useUpdateBlast,
  useDeleteBlast,
  useMarkBlastSent,
  type Blast,
} from '@/lib/hooks/useProjectBlasts'
import { blastTotal, totalBidDollars, totalBlastFees, totalDelivered, totalIncentives, weightedAvgBid, avgBid } from '@/lib/utils/blast'
import { fmtNum } from '@/lib/utils/number'

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function rate(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const inputCls =
  'bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

const CHIP: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  scheduled: 'bg-primary/15 text-primary',
  sent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

export function BlastConfigWidget({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(projectId)
  const add = useAddBlast(projectId)
  const update = useUpdateBlast(projectId)
  const del = useDeleteBlast(projectId)
  const markSent = useMarkBlastSent(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  // Create form
  const [reward, setReward] = useState('')
  const [bid, setBid] = useState('')
  const [when, setWhen] = useState('')
  // Mark-sent inline
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sd, setSd] = useState({ delivered: '', blast_cost: '' })

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Blast Configuration</p>
        <p className="text-xs text-muted-foreground/70">Blasts need the latest database migration.</p>
      </div>
    )
  }

  const list = blasts ?? []
  const pending = list.filter((b) => b.status !== 'sent')
  const sent = list.filter((b) => b.status === 'sent')

  function create() {
    const b = parseFloat(bid)
    if (isNaN(b)) return
    const r = parseFloat(reward)
    add.mutate(
      {
        bid: b,
        reward: isNaN(r) ? 0 : r,
        scheduled_at: when ? new Date(when).toISOString() : null,
        status: when ? 'scheduled' : 'queued',
        delivered: 0,
        blast_cost: 0,
        created_by: userName,
      },
      { onSuccess: () => { setReward(''); setBid(''); setWhen('') } }
    )
  }
  function confirmSend(b: Blast) {
    const d = parseInt(sd.delivered, 10)
    const bc = parseFloat(sd.blast_cost)
    if (isNaN(d)) return
    markSent.mutate(
      { id: b.id, delivered: d, blast_cost: isNaN(bc) ? 0 : bc },
      { onSuccess: () => { setSendingId(null); setSd({ delivered: '', blast_cost: '' }) } }
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Blast Configuration
        <InfoTooltip text="Create a B2B blast with its $/bid + per-respondent reward and an optional schedule (empty = queued for manual send). Mark it sent once delivered; a sent blast's cost (delivered×$/bid + fee + delivered×reward) counts toward spend." />
      </p>

      <div className="flex flex-col gap-2 text-xs">
        {/* Create form */}
        <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1.5" onKeyDown={(e) => { if (e.key === 'Enter') create() }}>
          <div className="flex gap-1.5">
            <label className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">$/bid</span>
              <input type="number" step="0.01" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="$/bid" className={inputCls} />
            </label>
            <label className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Reward $ (per respondent)</span>
              <input type="number" step="0.01" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="optional" className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Schedule time (ET) — empty = queued</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
          </label>
          <button
            onClick={create}
            disabled={!bid.trim() || add.isPending}
            className="self-start text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg"
          >
            {add.isPending ? 'Creating…' : 'Create blast'}
          </button>
        </div>

        {/* Pending (queued / scheduled) */}
        {pending.map((b) => (
          <div key={b.id} className="rounded-lg border border-border p-2 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CHIP[b.status] ?? ''}`}>{b.status}</span>
              <span className="text-muted-foreground">{rate(b.bid)}/bid{b.reward ? ` · reward ${rate(b.reward)}` : ''}{b.scheduled_at ? ` · ${fmtWhen(b.scheduled_at)}` : ''}</span>
              <span className="ml-auto flex gap-1">
                {sendingId !== b.id && (
                  <button onClick={() => { setSendingId(b.id); setSd({ delivered: '', blast_cost: '' }) }} className="text-primary hover:underline">Mark sent</button>
                )}
                <button onClick={() => del.mutate(b.id)} title="Delete" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5">✕</button>
              </span>
            </div>
            {sendingId === b.id && (
              <div className="flex gap-1 items-center" onKeyDown={(e) => { if (e.key === 'Enter') confirmSend(b); if (e.key === 'Escape') setSendingId(null) }}>
                <input autoFocus type="number" value={sd.delivered} onChange={(e) => setSd({ ...sd, delivered: e.target.value })} placeholder="# delivered" className={`${inputCls} w-0 flex-1`} />
                <input type="number" value={sd.blast_cost} onChange={(e) => setSd({ ...sd, blast_cost: e.target.value })} placeholder="blast $" className={`${inputCls} w-16`} />
                <button onClick={() => confirmSend(b)} className="text-xs bg-muted hover:bg-accent px-1.5 py-1 rounded">Save</button>
              </div>
            )}
          </div>
        ))}

        {/* Sent */}
        {sent.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[11px] text-muted-foreground">
              <span># delivered</span>
              <span className="text-right">$/bid</span>
              <span className="text-right">total</span>
              <span></span>
            </div>
            {sent.map((b) => (
              <div key={b.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center group">
                <span className="text-foreground">{fmtNum(b.delivered)}{b.reward ? ` · rwd ${rate(b.reward)}` : ''}</span>
                <span className="text-right text-foreground">{rate(b.bid)}</span>
                <span className="text-right text-foreground font-medium">{money(blastTotal(b))}</span>
                <button onClick={() => del.mutate(b.id)} title="Delete" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5">✕</button>
              </div>
            ))}
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border">
              <span>Total spend <span className="text-foreground font-medium">{money(totalBidDollars(list))}</span></span>
              <span>
                {fmtNum(totalDelivered(list))} sent · incent {money(totalIncentives(list))} · fees {money(totalBlastFees(list))} · wtd {rate(weightedAvgBid(list))} / avg {rate(avgBid(list))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
