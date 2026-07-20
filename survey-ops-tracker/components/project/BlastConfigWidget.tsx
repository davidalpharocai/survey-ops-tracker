'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useProjectBlasts, useAddBlast, useDeleteBlast, type Blast } from '@/lib/hooks/useProjectBlasts'
import { blastTotal, totalBidDollars, totalPeople, blendedBid } from '@/lib/utils/blast'
import { fmtNum } from '@/lib/utils/number'

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function rate(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  // Backend always stores the full timestamp (year + time). The display shows
  // the year only when the blast isn't in the current year; time is 12-hour
  // AM/PM. (The datetime-local picker itself shows AM/PM on a 12-hour system.)
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}
const inputCls =
  'bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

export function BlastConfigWidget({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(projectId)
  const add = useAddBlast(projectId)
  const del = useDeleteBlast(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  // Create form: $/bid · # of people · date/time · description.
  const [bid, setBid] = useState('')
  const [people, setPeople] = useState('')
  const [when, setWhen] = useState('')
  const [desc, setDesc] = useState('')

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Blast Configuration</p>
        <p className="text-xs text-muted-foreground/70">Blasts need the latest database migration.</p>
      </div>
    )
  }

  const list = blasts ?? []

  function create() {
    const b = parseFloat(bid)
    const p = parseInt(people, 10)
    if (isNaN(b) || isNaN(p)) return
    add.mutate(
      {
        bid: b,
        people: p,
        blast_at: when ? new Date(when).toISOString() : null,
        note: desc.trim() || null,
        created_by: userName,
      },
      { onSuccess: () => { setBid(''); setPeople(''); setWhen(''); setDesc('') } }
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Blast Configuration
        <InfoTooltip text="Log each B2B blast: its $/bid, when it went out, how many people it went to, and an optional description of the audience. A blast's cost ($/bid × # of people) counts toward the project's spend." />
      </p>

      <div className="flex flex-col gap-2 text-xs">
        {/* Create form */}
        <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1.5" onKeyDown={(e) => { if (e.key === 'Enter') create() }}>
          <div className="flex gap-1.5">
            <label className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                $/bid
                <InfoTooltip text="The dollar cost per person contacted in this blast. Combined with the # of people, it sets the blast's cost ($/bid × # of people), which counts toward the project's spend." />
              </span>
              <input type="number" step="0.01" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="0.00" className={inputCls} />
            </label>
            <label className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                # of people
                <InfoTooltip text="How many people this blast went out to (the audience reached). This × $/bid is the blast's cost." />
              </span>
              <input type="number" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="0" className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              Date/time of the blast (ET)
              <InfoTooltip text="When the blast actually went out. Pick the date and time (AM/PM). The full date + time is stored; the list shows the year only when it's not the current year." />
            </span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              Description (optional)
              <InfoTooltip text="Optional note on who this blast targeted — e.g. '3PL companies + retailers'. For your reference; it doesn't affect the cost." />
            </span>
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. 3PL companies + retailers" className={inputCls} />
          </label>
          <button
            onClick={create}
            disabled={!bid.trim() || !people.trim() || add.isPending}
            className="self-start text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg"
          >
            {add.isPending ? 'Adding…' : 'Add blast'}
          </button>
        </div>

        {/* Blast list */}
        {list.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 text-[11px] text-muted-foreground">
              <span>when</span>
              <span># people · description</span>
              <span className="text-right">$/bid</span>
              <span className="text-right">cost</span>
              <span></span>
            </div>
            {list.map((b: Blast) => (
              <div key={b.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 items-center group text-foreground">
                <span className="text-muted-foreground whitespace-nowrap">{fmtWhen(b.blast_at)}</span>
                <span className="truncate">
                  {fmtNum(b.people ?? 0)}
                  {b.note ? ` · ${b.note}` : ''}
                </span>
                <span className="text-right">{rate(b.bid)}</span>
                <span className="text-right font-medium">{money(blastTotal(b))}</span>
                <button onClick={() => del.mutate(b.id)} title="Delete" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5">✕</button>
              </div>
            ))}
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border">
              <span>Total spend <span className="text-foreground font-medium">{money(totalBidDollars(list))}</span></span>
              <span>{fmtNum(totalPeople(list))} people · blended {rate(blendedBid(list))}/bid</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
