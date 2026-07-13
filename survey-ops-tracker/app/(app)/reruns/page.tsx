'use client'
import { useMemo } from 'react'
import { useReruns, type RerunSnapshot } from '@/lib/hooks/useReruns'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, daysOverdue } from '@/lib/utils/date'

// Read-only "Rerun Radar": a mirror of Sree's manual rerun tab, read as
// overdue / upcoming / done / needs-a-date. Buckets are computed here against
// today so "overdue" ages correctly between syncs (the DB stores next_run_date
// + status_class; the timing decision lives in the UI).

type Bucket = 'overdue' | 'upcoming' | 'done' | 'unsorted'

function bucketOf(r: RerunSnapshot, today: string): Bucket {
  if (r.status_class === 'done' || r.status_class === 'closed') return 'done'
  if (!r.next_run_date) return 'unsorted'
  return r.next_run_date < today ? 'overdue' : 'upcoming'
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'
const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'
const panel = 'bg-card border border-border shadow-sm rounded-xl p-4'

const STRIPE: Record<Bucket, string> = {
  overdue: 'border-l-red-500',
  upcoming: 'border-l-amber-400',
  done: 'border-l-emerald-500',
  unsorted: 'border-l-border',
}

function firstSurveyId(ids: string | null): string | null {
  return (ids ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? null
}

function RerunCard({ r, bucket }: { r: RerunSnapshot; bucket: Bucket }) {
  const title = r.client || r.cadence || '(unlabeled)'
  const study = r.client && r.cadence ? r.cadence : null
  const bits = [r.freq, r.platform, r.n ? `N ${r.n}` : null].filter(Boolean).join(' · ')
  const survey = firstSurveyId(r.survey_ids)
  // Only show the raw "next" text for genuinely upcoming/overdue rows, and never
  // for closed/cancelled/"today" cadence (those would imply a wave that isn't real).
  const showNext =
    bucket !== 'done' && r.next_cadence && !/closed|cancel|^today$/i.test(r.next_cadence) ? r.next_cadence : null

  let statusText: string
  let statusColor: string
  if (bucket === 'overdue') {
    const d = daysOverdue(r.next_run_date)
    statusText = d > 1 ? `⚠ ${d}d overdue` : '⚠ Overdue'
    statusColor = 'text-red-600 dark:text-red-400'
  } else if (bucket === 'upcoming') {
    statusText = `Due ${formatDate(r.next_run_date)}`
    statusColor = 'text-amber-600 dark:text-amber-400'
  } else if (bucket === 'done') {
    statusText = `✓ ${r.status_raw || 'Done'}`
    statusColor = 'text-emerald-600 dark:text-emerald-400'
  } else {
    statusText = 'Needs a date'
    statusColor = 'text-muted-foreground'
  }

  return (
    <li className={`bg-background border border-border border-l-[3px] ${STRIPE[bucket]} rounded-lg p-3`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-foreground truncate min-w-0">{title}</span>
        {study && <span className="text-sm text-muted-foreground truncate min-w-0">· {study}</span>}
        <span
          className={`ml-auto shrink-0 max-w-[55%] truncate text-xs font-medium ${statusColor}`}
          title={statusText}
        >
          {statusText}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {r.work && <span>{r.work}</span>}
        {bits && <span>{bits}</span>}
        {bucket !== 'done' && r.status_raw && <span className="text-muted-foreground/70 break-words">“{r.status_raw}”</span>}
        {showNext && <span className="text-muted-foreground/70 break-words">next: {showNext}</span>}
      </div>
      {survey && <div className="text-[11px] text-muted-foreground/60 font-mono mt-1 truncate">{survey}</div>}
      {r.note && <div className="text-xs text-muted-foreground/70 italic mt-1 break-words">{r.note}</div>}
    </li>
  )
}

function Section({
  title,
  tip,
  items,
  bucket,
}: {
  title: string
  tip: string
  items: RerunSnapshot[]
  bucket: Bucket
}) {
  return (
    <div className={panel}>
      <h3 className={heading}>
        {title}
        <span className="ml-1.5 normal-case tracking-normal tabular-nums text-muted-foreground/70">{items.length}</span>
        <InfoTooltip text={tip} />
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">None right now.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => (
            <RerunCard key={r.id} r={r} bucket={bucket} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RerunsPage() {
  const { data: rows = [], isLoading, error } = useReruns()
  // Local calendar date (matches daysOverdue's local basis) so the bucket
  // boundary and the "N days overdue" label agree with the viewer's clock.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const g = useMemo(() => {
    const groups: Record<Bucket, RerunSnapshot[]> = { overdue: [], upcoming: [], done: [], unsorted: [] }
    for (const r of rows) groups[bucketOf(r, today)].push(r)
    // Most-overdue first; soonest-upcoming first.
    groups.overdue.sort((a, b) => (a.next_run_date ?? '').localeCompare(b.next_run_date ?? ''))
    groups.upcoming.sort((a, b) => (a.next_run_date ?? '').localeCompare(b.next_run_date ?? ''))
    return groups
  }, [rows, today])

  const syncedAt = rows.length ? rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), rows[0].synced_at) : null

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <Skeleton className="h-8 w-52" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={tile}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Rerun Radar</h1>
        <p className="text-sm text-destructive">Couldn’t load reruns: {String((error as Error).message)}</p>
        <p className="text-sm text-muted-foreground mt-2">
          If this is the first run, the mirror may not be synced yet — trigger a sync from the sheet.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Rerun Radar</h1>
        <span className="text-sm text-muted-foreground">
          Sree’s rerun tracker, read as overdue / upcoming / done.
          {syncedAt && (
            <>
              {' '}
              <span className="text-muted-foreground/70">Synced {formatDate(syncedAt.slice(0, 10))}.</span>
            </>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={panel}>
          <p className="text-sm text-muted-foreground">
            No rerun data yet. Once the mirror is synced from Sree’s sheet, reruns show up here bucketed by timing.
          </p>
        </div>
      ) : (
        <>
          {/* KPI tiles — summary before detail */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={tile}>
              <span className="text-xs text-muted-foreground flex items-center">
                Overdue
                <InfoTooltip text="Reruns whose next collection month has already passed and aren't marked done." />
              </span>
              <span
                className={`text-2xl font-semibold leading-tight tabular-nums ${
                  g.overdue.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                }`}
              >
                {g.overdue.length}
              </span>
              <span className="text-xs text-muted-foreground">slipping through the cracks</span>
            </div>
            <div className={tile}>
              <span className="text-xs text-muted-foreground">Upcoming</span>
              <span className="text-2xl font-semibold text-foreground leading-tight tabular-nums">{g.upcoming.length}</span>
              <span className="text-xs text-muted-foreground">cadence + in-flight</span>
            </div>
            <div className={tile}>
              <span className="text-xs text-muted-foreground">Done this cycle</span>
              <span className="text-2xl font-semibold text-foreground leading-tight tabular-nums">{g.done.length}</span>
              <span className="text-xs text-muted-foreground">latest wave collected</span>
            </div>
            <div className={tile}>
              <span className="text-xs text-muted-foreground flex items-center">
                Needs a date
                <InfoTooltip text="Rows with no parseable next-collection date (free text or drifted columns in the sheet). Give them a date to make them track." />
              </span>
              <span className="text-2xl font-semibold text-foreground leading-tight tabular-nums">{g.unsorted.length}</span>
              <span className="text-xs text-muted-foreground">can’t auto-sort yet</span>
            </div>
          </div>

          <Section
            title="Overdue"
            tip="Next collection month already passed — these are the ones to chase first."
            items={g.overdue}
            bucket="overdue"
          />
          <Section
            title="Upcoming & active"
            tip="Reruns due ahead, by next collection date."
            items={g.upcoming}
            bucket="upcoming"
          />
          <Section
            title="Done this cycle"
            tip="Latest wave collected — the healthy recurring studies."
            items={g.done}
            bucket="done"
          />
          {g.unsorted.length > 0 && (
            <Section
              title="Needs a date"
              tip="No parseable collection date. Once the sheet has a real date (or its columns are cleaned up), these move into the timing buckets."
              items={g.unsorted}
              bucket="unsorted"
            />
          )}

          <p className="text-xs text-muted-foreground/60">
            Read-only mirror of the “Manual Rerun” tab. Dates are inferred from the sheet’s free text, so timing is
            directional — the raw status is shown on each card. The full logging tab that replaces the sheet is coming.
          </p>
        </>
      )}
    </div>
  )
}
