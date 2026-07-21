'use client'
import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useProjectBlasts, useAddBlast, useUpdateBlast, useDeleteBlast, type Blast } from '@/lib/hooks/useProjectBlasts'
import { blastTotal, totalBidDollars, totalPeople, totalCompletes, blendedBid } from '@/lib/utils/blast'
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
/** Stored ISO (UTC) → the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const inputCls =
  'w-full min-w-0 bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

type BlastPatch = { bid?: number; people?: number; completes?: number; blast_at?: string | null; note?: string | null }

/**
 * Expanded edit panel for one blast — the whole line is editable post-save. Each
 * field commits on blur via the update hook (only when it actually changed). The
 * description is a full-width textarea so long notes are fully visible/editable.
 */
function BlastEditPanel({ blast, onSave, onClose }: { blast: Blast; onSave: (u: BlastPatch) => void; onClose: () => void }) {
  return (
    <div className="col-span-full rounded-lg border border-border bg-muted/40 p-2.5 my-1 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Date/time (ET)</span>
          <input
            type="datetime-local"
            defaultValue={toLocalInput(blast.blast_at)}
            onBlur={(e) => { const v = e.target.value ? new Date(e.target.value).toISOString() : null; if (v !== (blast.blast_at ?? null)) onSave({ blast_at: v }) }}
            className={`${inputCls} w-auto`}
          />
        </label>
        <label className="flex flex-col gap-0.5 w-20">
          <span className="text-[10px] text-muted-foreground"># people</span>
          <input
            type="number" min="0" defaultValue={blast.people ?? 0}
            onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0 && v !== (blast.people ?? 0)) onSave({ people: v }) }}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-0.5 w-20">
          <span className="text-[10px] text-muted-foreground"># completes</span>
          <input
            type="number" min="0" defaultValue={blast.completes ?? 0}
            onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0 && v !== (blast.completes ?? 0)) onSave({ completes: v }) }}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-0.5 w-20">
          <span className="text-[10px] text-muted-foreground">$/bid</span>
          <input
            type="number" step="0.01" min="0" defaultValue={blast.bid ?? 0}
            onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v !== (blast.bid ?? 0)) onSave({ bid: v }) }}
            className={inputCls}
          />
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">Description</span>
        <textarea
          defaultValue={blast.note ?? ''}
          rows={2}
          placeholder="e.g. 3PL companies + retailers"
          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (blast.note ?? null)) onSave({ note: v }) }}
          className={`${inputCls} resize-y`}
        />
      </label>
      <button onClick={onClose} className="self-end text-xs bg-muted hover:bg-accent px-2.5 py-1 rounded-lg">Done</button>
    </div>
  )
}

/**
 * The completes count trickles in AFTER a blast is sent, so it's editable in
 * place. Local state commits on blur / Enter, only when it actually changed.
 */
function CompletesCell({ blast, onSave }: { blast: Blast; onSave: (completes: number) => void }) {
  const current = blast.completes ?? 0
  const [val, setVal] = useState(String(current))
  useEffect(() => { setVal(String(current)) }, [current])
  function commit() {
    const n = parseInt(val, 10)
    if (isNaN(n) || n < 0) { setVal(String(current)); return }
    if (n !== current) onSave(n)
  }
  return (
    <input
      type="number"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-12 bg-transparent border border-transparent hover:border-border focus:border-ring rounded px-1 py-0.5 text-right text-foreground focus:outline-none"
      title="How many completed the survey — editable; drives this blast's cost ($/bid × completes)"
      aria-label="Number of completes"
    />
  )
}

export function BlastConfigWidget({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(projectId)
  const add = useAddBlast(projectId)
  const upd = useUpdateBlast(projectId)
  const del = useDeleteBlast(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'
  const [editingId, setEditingId] = useState<string | null>(null)

  // Create form: $/bid · # of people · # of completes · date/time · description.
  const [bid, setBid] = useState('')
  const [people, setPeople] = useState('')
  const [completes, setCompletes] = useState('')
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
    if (isNaN(b) || isNaN(p) || b < 0 || p < 0) return
    const c = parseInt(completes, 10)
    add.mutate(
      {
        bid: b,
        people: p,
        completes: isNaN(c) || c < 0 ? 0 : c,
        blast_at: when ? new Date(when).toISOString() : null,
        note: desc.trim() || null,
        created_by: userName,
      },
      { onSuccess: () => { setBid(''); setPeople(''); setCompletes(''); setWhen(''); setDesc('') } }
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Blast Configuration
        <InfoTooltip text="Log each B2B blast: its $/bid (the per-completion reward), when it went out, how many people it reached, and how many completed the survey. A blast's cost ($/bid × # of completes) counts toward the project's spend — we only pay for completes, not everyone reached." />
      </p>

      <div className="flex flex-col gap-2 text-xs">
        {/* Create form */}
        <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1.5" onKeyDown={(e) => { if (e.key === 'Enter') create() }}>
          <div className="flex gap-1.5">
            <label className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                $/bid
                <InfoTooltip text="The per-completion reward — the dollars paid for each completed response. Combined with the # of completes, it sets the blast's cost ($/bid × # of completes), which counts toward the project's spend." />
              </span>
              <input type="number" step="0.01" min="0" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="0.00" className={inputCls} />
            </label>
            <label className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                # of people
                <InfoTooltip text="How many people this blast went out to (the audience reached). Informational — it does not drive the cost." />
              </span>
              <input type="number" min="0" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="0" className={inputCls} />
            </label>
            <label className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                # of completes
                <InfoTooltip text="How many of those people completed the survey. This × $/bid is the blast's cost — we don't pay people who didn't take the survey or terminated. Can be 0 now and filled in later (it's editable in the list)." />
              </span>
              <input type="number" min="0" value={completes} onChange={(e) => setCompletes(e.target.value)} placeholder="0" className={inputCls} />
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

        {/* Blast list — header + all rows share ONE grid so columns line up.
            Each row is a Fragment (display: contents) contributing 6 grid cells. */}
        {list.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 items-center">
              {/* Header */}
              <span className="text-[11px] text-muted-foreground">when</span>
              <span className="text-[11px] text-muted-foreground"># people · description</span>
              <span className="text-[11px] text-muted-foreground text-right flex items-center gap-1 justify-end whitespace-nowrap">
                completes
                <InfoTooltip text="Number who completed the survey. Editable — click to update as completes come in. Cost = $/bid × completes." />
              </span>
              <span className="text-[11px] text-muted-foreground text-right">$/bid</span>
              <span className="text-[11px] text-muted-foreground text-right">cost</span>
              <span></span>
              {/* Rows */}
              {list.map((b: Blast) => (
                <Fragment key={b.id}>
                  <span className="text-muted-foreground whitespace-nowrap">{fmtWhen(b.blast_at)}</span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                    title={b.note ? `${b.note} — click to edit` : 'Click to edit this blast'}
                    className="truncate min-w-0 text-left text-foreground hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                  >
                    {fmtNum(b.people ?? 0)}
                    {b.note ? ` · ${b.note}` : ''}
                  </button>
                  <span className="text-right">
                    <CompletesCell blast={b} onSave={(c) => upd.mutate({ id: b.id, updates: { completes: c } })} />
                  </span>
                  <span className="text-right text-foreground tabular-nums">{rate(b.bid)}</span>
                  <span className="text-right font-medium text-foreground tabular-nums">{money(blastTotal(b))}</span>
                  <button onClick={() => del.mutate(b.id)} title="Delete" className="justify-self-end text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5">✕</button>
                  {editingId === b.id && (
                    <BlastEditPanel blast={b} onSave={(u) => upd.mutate({ id: b.id, updates: u })} onClose={() => setEditingId(null)} />
                  )}
                </Fragment>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border">
              <span>Total spend <span className="text-foreground font-medium">{money(totalBidDollars(list))}</span></span>
              <span>{fmtNum(totalCompletes(list))} completes · {fmtNum(totalPeople(list))} people · blended {rate(blendedBid(list))}/bid</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
