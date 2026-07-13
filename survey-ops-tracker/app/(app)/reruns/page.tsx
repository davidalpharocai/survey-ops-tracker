'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useReruns, type RerunSnapshot } from '@/lib/hooks/useReruns'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, daysOverdue } from '@/lib/utils/date'
import { isTypingTarget } from '@/lib/utils/keyboard'

// Read-only "Rerun Radar": a mirror of Sree's manual rerun tab, read as
// overdue / needs-a-date / upcoming / done. Buckets are computed here against
// today so "overdue" ages correctly between syncs (the DB stores next_run_date
// + status_class; the timing decision lives in the UI). Reordered so the two
// attention buckets (overdue + needs-a-date) lead and Done collapses away.

type Bucket = 'overdue' | 'upcoming' | 'done' | 'unsorted'

function bucketOf(r: RerunSnapshot, today: string): Bucket {
  if (r.status_class === 'done' || r.status_class === 'closed') return 'done'
  if (!r.next_run_date) return 'unsorted'
  return r.next_run_date < today ? 'overdue' : 'upcoming'
}

// One config per bucket drives the dot, count tint, status chip, card stripe,
// KPI top-border and proportion-bar segment — so a bucket's color is consistent
// everywhere. Teal (--primary) owns "Upcoming"; red/amber/emerald stay semantic.
const BUCKETS: Record<
  Bucket,
  { label: string; dot: string; count: string; chip: string; stripe: string; top: string; seg: string; sub: string }
> = {
  overdue: {
    label: 'Overdue', dot: 'bg-red-500', count: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-500/15 text-red-700 dark:text-red-300', stripe: 'border-l-red-500',
    top: 'border-t-red-500', seg: 'bg-red-500', sub: 'slipping through the cracks',
  },
  unsorted: {
    label: 'Needs a date', dot: 'bg-amber-500', count: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', stripe: 'border-l-amber-400',
    top: 'border-t-amber-500', seg: 'bg-amber-500', sub: 'can’t auto-sort yet',
  },
  upcoming: {
    label: 'Upcoming', dot: 'bg-primary', count: 'text-primary',
    chip: 'bg-primary/15 text-primary', stripe: 'border-l-primary',
    top: 'border-t-primary', seg: 'bg-primary', sub: 'cadence + in-flight',
  },
  done: {
    label: 'Done', dot: 'bg-emerald-500', count: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', stripe: 'border-l-emerald-500',
    top: 'border-t-emerald-500', seg: 'bg-emerald-500', sub: 'latest wave collected',
  },
}

const TIPS: Partial<Record<Bucket, string>> = {
  overdue: 'Next-collection month already passed and the study isn’t marked done — chase these first.',
  unsorted: 'No parseable next-collection date (free text / drifted sheet cells). Add a real date and it starts tracking.',
  upcoming: 'Reruns due ahead, ordered by next collection date.',
  done: 'Latest wave collected — the healthy recurring studies.',
}

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'
const panel = 'bg-card border border-border shadow-sm rounded-xl p-4'
const groupLabel = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1'

function firstSurveyId(ids: string | null): string | null {
  return (ids ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean)[0] ?? null
}

function relAge(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function cardStatus(r: RerunSnapshot, bucket: Bucket): { icon: string; label: string } {
  if (bucket === 'overdue') {
    const d = daysOverdue(r.next_run_date)
    return { icon: '⚠', label: d > 1 ? `${d}d overdue` : 'Overdue' }
  }
  if (bucket === 'upcoming') return { icon: '', label: `Due ${formatDate(r.next_run_date)}` }
  if (bucket === 'done') return { icon: '✓', label: r.status_raw || 'Done' }
  return { icon: '', label: 'Needs a date' }
}

function RerunCard({ r, bucket }: { r: RerunSnapshot; bucket: Bucket }) {
  const cfg = BUCKETS[bucket]
  const title = r.client || r.cadence || '(unlabeled)'
  const study = r.client && r.cadence ? r.cadence : null
  const bits = [r.work, r.freq, r.platform, r.n ? `N ${r.n}` : null].filter(Boolean).join(' · ')
  const survey = bucket !== 'done' ? firstSurveyId(r.survey_ids) : null
  const showNext =
    bucket !== 'done' && r.next_cadence && !/closed|cancel|^today$/i.test(r.next_cadence) ? r.next_cadence : null
  const { icon, label } = cardStatus(r, bucket)

  return (
    <li className={`bg-background border border-border border-l-4 ${cfg.stripe} rounded-lg p-3`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-foreground truncate min-w-0">{title}</span>
          {study && <span className="text-sm text-muted-foreground truncate min-w-0">· {study}</span>}
        </div>
        <span
          className={`shrink-0 self-start inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium max-w-full sm:ml-auto sm:max-w-[55%] ${cfg.chip}`}
          title={`${icon} ${label}`.trim()}
        >
          {icon && <span aria-hidden="true">{icon}</span>}
          <span className="truncate min-w-0">{label}</span>
        </span>
      </div>
      {(bits || (bucket !== 'done' && r.status_raw) || showNext) && (
        <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
          {bits && <span>{bits}</span>}
          {bucket !== 'done' && r.status_raw && <span className="break-words">“{r.status_raw}”</span>}
          {showNext && <span className="break-words">next: {showNext}</span>}
        </div>
      )}
      {survey && <div className="text-[11px] text-muted-foreground font-mono mt-1 truncate">{survey}</div>}
      {bucket !== 'done' && r.note && <div className="text-xs text-muted-foreground italic mt-1 break-words">{r.note}</div>}
    </li>
  )
}

function HeadInner({ bucket, count }: { bucket: Bucket; count: number }) {
  const cfg = BUCKETS[bucket]
  const label = bucket === 'upcoming' ? 'Upcoming & active' : cfg.label
  return (
    <>
      <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} aria-hidden="true" />
      <span>{label}</span>
      <span className={`ml-1 normal-case tracking-normal font-semibold tabular-nums ${cfg.count}`}>{count}</span>
    </>
  )
}

function CardList({ items, bucket }: { items: RerunSnapshot[]; bucket: Bucket }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground mt-2">None right now.</p>
  return (
    <ul className="space-y-2.5 mt-3">
      {items.map((r) => (
        <RerunCard key={r.id} r={r} bucket={bucket} />
      ))}
    </ul>
  )
}

const headCls = 'flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-muted-foreground'

function Section({ bucket, items }: { bucket: Bucket; items: RerunSnapshot[] }) {
  return (
    <section className={panel}>
      <h3 className={headCls}>
        <HeadInner bucket={bucket} count={items.length} />
        {TIPS[bucket] && <InfoTooltip text={TIPS[bucket]!} />}
      </h3>
      <CardList items={items} bucket={bucket} />
    </section>
  )
}

// Native <details> would nest the InfoTooltip button inside <summary> (clicking
// it would toggle the section, and it's a touch-unreachable / invalid nesting).
// A real <h3> + toggle button keeps the header a heading and the tip separate.
function CollapsibleSection({ bucket, items }: { bucket: Bucket; items: RerunSnapshot[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={panel}>
      <h3 className={headCls}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 hover:text-foreground transition-colors"
        >
          <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
          <HeadInner bucket={bucket} count={items.length} />
        </button>
        {TIPS[bucket] && <InfoTooltip text={TIPS[bucket]!} />}
      </h3>
      {open && <CardList items={items} bucket={bucket} />}
    </section>
  )
}

export default function RerunsPage() {
  const { data: rows = [], isLoading, error } = useReruns()
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" focuses search (unless already typing) — matches the List page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Local calendar date (matches daysOverdue's local basis) so the bucket
  // boundary and the "N days overdue" label agree with the viewer's clock.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) =>
      [r.client, r.cadence, r.note, r.status_raw, r.survey_ids, r.template, r.work, r.platform].some((v) =>
        (v ?? '').toLowerCase().includes(s)
      )
    )
  }, [rows, q])

  const g = useMemo(() => {
    const groups: Record<Bucket, RerunSnapshot[]> = { overdue: [], upcoming: [], done: [], unsorted: [] }
    for (const r of filtered) groups[bucketOf(r, today)].push(r)
    const byDate = (a: RerunSnapshot, b: RerunSnapshot) => (a.next_run_date ?? '').localeCompare(b.next_run_date ?? '')
    const byClient = (a: RerunSnapshot, b: RerunSnapshot) =>
      (a.client ?? a.cadence ?? '').localeCompare(b.client ?? b.cadence ?? '')
    groups.overdue.sort(byDate)
    groups.upcoming.sort(byDate)
    groups.done.sort(byClient) // deterministic so rows don't reshuffle between syncs
    groups.unsorted.sort(byClient)
    return groups
  }, [filtered, today])

  const syncedAt = rows.length ? rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), rows[0].synced_at) : null
  const stale = syncedAt ? Date.now() - new Date(syncedAt).getTime() > 36 * 3_600_000 : false

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
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={panel}>
            <Skeleton className="h-3 w-32 mb-3" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ))}
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

  const total = rows.length
  const shown = filtered.length
  const kpiOrder: Bucket[] = ['overdue', 'unsorted', 'upcoming', 'done']
  const segOrder: Bucket[] = ['overdue', 'upcoming', 'done', 'unsorted']

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Rerun Radar</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total === 0 ? (
            'Sree’s rerun tracker, read as overdue / upcoming / done.'
          ) : (
            <>
              <span className={g.overdue.length > 0 ? 'text-red-600 dark:text-red-400 font-medium' : undefined}>
                {g.overdue.length} overdue
              </span>
              {' · '}
              {g.unsorted.length} need a date
              {' · '}
              {shown} of {total} studies
            </>
          )}
        </p>
      </div>

      {total === 0 ? (
        <div className={panel}>
          <p className="text-sm text-muted-foreground">
            No rerun data yet. Once the mirror is synced from Sree’s sheet, reruns show up here bucketed by timing.
          </p>
        </div>
      ) : (
        <>
          {/* Search + sync freshness */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reruns…  ( / )"
              aria-label="Search reruns by client, study, status, survey ID or note"
              className="flex-1 min-w-[12rem] max-w-sm bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring"
            />
            {syncedAt && (
              <span
                className={`text-xs ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                title={`Last synced from the sheet: ${new Date(syncedAt).toLocaleString()}`}
              >
                Synced {relAge(syncedAt)}
                {stale ? ' · may be stale' : ''}
              </span>
            )}
          </div>

          {/* KPI tiles — one per bucket, section-colored */}
          <section aria-label="Rerun summary counts" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiOrder.map((b) => {
              const cfg = BUCKETS[b]
              const n = g[b].length
              return (
                <div key={b} role="group" aria-label={`${cfg.label}: ${n}`} className={`${tile} border-t-2 ${cfg.top}`}>
                  <span className="text-xs text-muted-foreground flex items-center">
                    {cfg.label}
                    {TIPS[b] && <InfoTooltip text={TIPS[b]!} />}
                  </span>
                  <span className={`text-2xl font-semibold leading-tight tabular-nums ${n > 0 ? cfg.count : 'text-foreground'}`}>
                    {n}
                  </span>
                  <span className="text-xs text-muted-foreground">{cfg.sub}</span>
                </div>
              )
            })}
          </section>

          {/* Proportion bar — the "radar" mix at a glance */}
          {shown > 0 && (
            <div
              className="flex h-2 rounded-full overflow-hidden bg-muted"
              role="img"
              aria-label={`Mix of ${shown}: ${g.overdue.length} overdue, ${g.upcoming.length} upcoming, ${g.done.length} done, ${g.unsorted.length} need a date`}
            >
              {segOrder.map((b) =>
                g[b].length > 0 ? (
                  <div key={b} className={BUCKETS[b].seg} style={{ width: `${(g[b].length / shown) * 100}%` }} title={`${BUCKETS[b].label}: ${g[b].length}`} />
                ) : null
              )}
            </div>
          )}

          {shown === 0 ? (
            <div className={panel}>
              <p className="text-sm text-muted-foreground">No reruns match “{q}”.</p>
            </div>
          ) : (
            <>
              <h2 className={groupLabel}>Needs attention</h2>
              {g.overdue.length > 0 ? (
                <Section bucket="overdue" items={g.overdue} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-card border border-border shadow-sm rounded-xl px-4 py-2.5">
                  <span aria-hidden="true">✓</span> Nothing overdue.
                </div>
              )}
              {g.unsorted.length > 0 && <Section bucket="unsorted" items={g.unsorted} />}

              <h2 className={groupLabel}>On track</h2>
              <Section bucket="upcoming" items={g.upcoming} />
              <CollapsibleSection bucket="done" items={g.done} />

              <p className="text-xs text-muted-foreground">
                Read-only mirror of the “Manual Rerun” tab. Dates are inferred from the sheet’s free text, so timing is
                directional — the raw status is shown on each card. The full logging tab that replaces the sheet is coming.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
