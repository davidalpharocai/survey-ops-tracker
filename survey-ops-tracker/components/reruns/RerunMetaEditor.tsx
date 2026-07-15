'use client'
import { useState } from 'react'
import { useSetRerunMeta, type RerunRow } from '@/lib/hooks/useReruns'
import { toast } from '@/lib/utils/toast'

// The "Cadence Layer" editor: define a study's cadence + owner (so the app can
// compute the next expected wave and flag misses), and log each collected wave
// (which re-arms the next one — replaces the manual "June Done → July Pending").
const CADENCE_OPTS = [
  { v: '', label: 'Ad-hoc / one-off' },
  { v: '1', label: 'Monthly' },
  { v: '3', label: 'Quarterly' },
  { v: '6', label: 'Every 6 months' },
  { v: '12', label: 'Yearly' },
]
const inputCls =
  'bg-muted border border-border text-foreground text-[11px] rounded-md px-1.5 py-1 focus:outline-none focus:border-ring'

export function RerunMetaEditor({ r }: { r: RerunRow }) {
  const [open, setOpen] = useState(false)
  const save = useSetRerunMeta()
  const [cadence, setCadence] = useState(r.cadence_months != null ? String(r.cadence_months) : '')
  const [lastWave, setLastWave] = useState(r.last_wave_on ?? '')
  const [nextOn, setNextOn] = useState(r.expected_next_on ?? '')
  const [owner, setOwner] = useState(r.owner_email ?? '')
  const [backup, setBackup] = useState(r.backup_owner_email ?? '')
  const [leadDays, setLeadDays] = useState(r.lead_days != null ? String(r.lead_days) : '')
  const [paused, setPaused] = useState(!!r.is_paused)

  // No stable key yet (pre-migration or pre-resync) — nothing to attach meta to.
  if (!r.rerun_key) return null
  const key = r.rerun_key
  const today = new Date().toISOString().slice(0, 10)

  function save_(overrides: Record<string, unknown>) {
    save.mutate(
      {
        rerun_key: key,
        cadence_months: cadence ? Number(cadence) : null,
        last_wave_on: lastWave || null,
        expected_next_on: nextOn || null,
        owner_email: owner || null,
        backup_owner_email: backup || null,
        lead_days: leadDays ? Number(leadDays) : null,
        paused,
        ...overrides,
      },
      {
        onSuccess: () => {
          toast('Saved ✓', 'success')
          setOpen(false)
        },
        onError: (e) => toast(String((e as Error).message)),
      }
    )
  }

  if (!open) {
    return (
      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
        <button type="button" onClick={() => setOpen(true)} className="text-primary hover:underline">
          {r.is_defined ? '✎ Edit cadence / owner' : '＋ Define cadence'}
        </button>
        {r.cadence_months != null && r.last_wave_on && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save_({ last_wave_on: today })}
            title="Record that a wave was collected today — re-arms the next one"
            className="text-primary hover:underline disabled:opacity-40"
          >
            ✓ Log wave collected today
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1.5 rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-center text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1">
          Cadence
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
            {CADENCE_OPTS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Last collected
          <input type="date" value={lastWave} onChange={(e) => setLastWave(e.target.value)} className={inputCls} />
        </label>
        {!cadence && (
          <label className="flex items-center gap-1">
            Next date
            <input type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} className={inputCls} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-center text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1">
          Owner
          <input
            type="text"
            inputMode="email"
            placeholder="name@alpharoc.ai"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={`${inputCls} w-40`}
          />
        </label>
        <label className="flex items-center gap-1">
          Backup
          <input
            type="text"
            inputMode="email"
            placeholder="optional"
            value={backup}
            onChange={(e) => setBackup(e.target.value)}
            className={`${inputCls} w-36`}
          />
        </label>
        <label className="flex items-center gap-1" title="Days before the due date to nudge the owner (default 7)">
          Prep lead
          <input
            type="number"
            min={1}
            max={90}
            placeholder="7"
            value={leadDays}
            onChange={(e) => setLeadDays(e.target.value)}
            className={`${inputCls} w-14`}
          />
          d
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Paused
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        {cadence
          ? 'Next wave is computed as last-collected + cadence; log each wave to keep it current.'
          : 'Ad-hoc: set an explicit next date. Leave the date blank + check Paused to retire it from tracking.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save_({})}
          className="text-[11px] px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  )
}
