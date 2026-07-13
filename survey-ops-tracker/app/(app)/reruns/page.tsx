'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useReruns, type RerunSnapshot } from '@/lib/hooks/useReruns'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate, daysOverdue } from '@/lib/utils/date'
import { isTypingTarget } from '@/lib/utils/keyboard'
import { toast } from '@/lib/utils/toast'

// Read-only "Rerun Radar": a mirror of Sree's manual rerun tab, read as
// overdue / needs-a-date / upcoming / done. Buckets computed at read time so
// "overdue" ages between syncs. Wave 2: multi-keyword search, work/platform/
// client filters, sort, deep-link to the filtered list, per-wave survey IDs,
// KPI-tiles-as-jump-nav.

type Bucket = 'overdue' | 'upcoming' | 'done' | 'unsorted'
type SortKey = 'smart' | 'client' | 'n'
const SORT_KEY = 'sot.rerunsSort'

function bucketOf(r: RerunSnapshot, today: string): Bucket {
  if (r.status_class === 'done' || r.status_class === 'closed') return 'done'
  if (!r.next_run_date) return 'unsorted'
  return r.next_run_date < today ? 'overdue' : 'upcoming'
}

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

const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1 text-left'
const panel = 'bg-card border border-border shadow-sm rounded-xl p-4'
const groupLabel = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1'
const headCls = 'flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-muted-foreground'
const selectCls =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-ring'

const firmOf = (r: RerunSnapshot) => (r.client ?? '').split(' - ')[0].trim()
const waveIds = (ids: string | null) => (ids ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
const parseN = (r: RerunSnapshot) => {
  const m = (r.n ?? '').match(/\d[\d,]*/)
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : -1
}

function relAge(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast('Copied ✓', 'success'),
    () => toast('Copy failed')
  )
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
  const [showWaves, setShowWaves] = useState(false)
  const title = r.client || r.cadence || '(unlabeled)'
  const study = r.client && r.cadence ? r.cadence : null
  const bits = [r.work, r.freq, r.platform, r.n ? `N ${r.n}` : null].filter(Boolean).join(' · ')
  const waves = bucket !== 'done' ? waveIds(r.survey_ids) : []
  const showNext =
    bucket !== 'done' && r.next_cadence && !/closed|cancel|^today$/i.test(r.next_cadence) ? r.next_cadence : null
  const { icon, label } = cardStatus(r, bucket)
  // Deep-link to the List, pre-filtered to this firm (the List reads ?search).
  const findHref = `/list?search=${encodeURIComponent(firmOf(r) || r.cadence || '')}`

  return (
    <li className={`bg-background border border-border border-l-4 ${cfg.stripe} rounded-lg p-3`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
          <Link
            href={findHref}
            title={`Find ${firmOf(r) || title} in the project list`}
            className="font-medium text-foreground hover:text-primary hover:underline truncate min-w-0"
          >
            {title}
          </Link>
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

      {waves.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => copy(waves[0])}
            title="Click to copy this survey ID"
            className="font-mono text-muted-foreground hover:text-foreground truncate max-w-full"
          >
            {waves[0]}
          </button>
          {waves.length > 1 && (
            <button
              type="button"
              onClick={() => setShowWaves((v) => !v)}
              aria-expanded={showWaves}
              className="text-primary hover:underline shrink-0"
            >
              {showWaves ? 'hide waves' : `＋${waves.length - 1} more`}
            </button>
          )}
        </div>
      )}
      {showWaves && waves.length > 1 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {waves.map((w, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => copy(w)}
                title="Click to copy"
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground text-left truncate max-w-full"
              >
                {w}
              </button>
            </li>
          ))}
        </ul>
      )}

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

function Section({ bucket, items }: { bucket: Bucket; items: RerunSnapshot[] }) {
  return (
    <section id={`sec-${bucket}`} className={panel}>
      <h3 className={headCls}>
        <HeadInner bucket={bucket} count={items.length} />
        {TIPS[bucket] && <InfoTooltip text={TIPS[bucket]!} />}
      </h3>
      <CardList items={items} bucket={bucket} />
    </section>
  )
}

// A real <h3> + toggle button (not native <details>) so the header stays a
// heading and the InfoTooltip button isn't nested in a <summary>.
function CollapsibleSection({ bucket, items }: { bucket: Bucket; items: RerunSnapshot[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section id={`sec-${bucket}`} className={panel}>
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

function Seg<T extends string>({
  label, options, value, onChange,
}: {
  label: string
  options: { v: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            value === o.v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function RerunsPage() {
  const { data: rows = [], isLoading, error } = useReruns()
  const [q, setQ] = useState('')
  const [work, setWork] = useState<'all' | 'Cadence' | 'Ad-Hoc'>('all')
  const [platform, setPlatform] = useState<'all' | 'PS' | 'B2B'>('all')
  const [client, setClient] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('smart')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const s = localStorage.getItem(SORT_KEY)
      if (s === 'smart' || s === 'client' || s === 'n') setSort(s)
    } catch {
      /* defaults are fine */
    }
  }, [])
  function changeSort(s: SortKey) {
    setSort(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      /* ignore */
    }
  }

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

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const clients = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      const f = firmOf(r)
      if (f) set.add(f)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => {
      if (work !== 'all' && r.work !== work) return false
      if (platform !== 'all' && r.platform !== platform) return false
      if (client !== 'all' && firmOf(r) !== client) return false
      if (tokens.length) {
        const hay = [r.client, r.cadence, r.note, r.status_raw, r.survey_ids, r.template, r.work, r.platform, r.freq]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!tokens.every((t) => hay.includes(t))) return false
      }
      return true
    })
  }, [rows, q, work, platform, client])

  const g = useMemo(() => {
    const groups: Record<Bucket, RerunSnapshot[]> = { overdue: [], upcoming: [], done: [], unsorted: [] }
    for (const r of filtered) groups[bucketOf(r, today)].push(r)
    const byDate = (a: RerunSnapshot, b: RerunSnapshot) => (a.next_run_date ?? '').localeCompare(b.next_run_date ?? '')
    const byClient = (a: RerunSnapshot, b: RerunSnapshot) =>
      (a.client ?? a.cadence ?? '').localeCompare(b.client ?? b.cadence ?? '')
    const byN = (a: RerunSnapshot, b: RerunSnapshot) => parseN(b) - parseN(a)
    const cmp =
      sort === 'client' ? byClient : sort === 'n' ? byN : null
    for (const b of Object.keys(groups) as Bucket[]) {
      if (cmp) groups[b].sort(cmp)
      else groups[b].sort(b === 'overdue' || b === 'upcoming' ? byDate : byClient) // smart
    }
    return groups
  }, [filtered, today, sort])

  const syncedAt = rows.length ? rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), rows[0].synced_at) : null
  const stale = syncedAt ? Date.now() - new Date(syncedAt).getTime() > 36 * 3_600_000 : false
  const filterActive = work !== 'all' || platform !== 'all' || client !== 'all' || q.trim() !== ''

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
  const jumpTo = (b: Bucket) => {
    const el = document.getElementById(`sec-${b}`)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

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
              placeholder="Search reruns — any words…  ( / )"
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

          {/* Filters + sort */}
          <div className="flex items-center gap-2 flex-wrap">
            <Seg
              label="Work type"
              value={work}
              onChange={setWork}
              options={[
                { v: 'all', label: 'All' },
                { v: 'Cadence', label: 'Cadence' },
                { v: 'Ad-Hoc', label: 'Ad-Hoc' },
              ]}
            />
            <Seg
              label="Platform"
              value={platform}
              onChange={setPlatform}
              options={[
                { v: 'all', label: 'All' },
                { v: 'PS', label: 'PS' },
                { v: 'B2B', label: 'B2B' },
              ]}
            />
            <select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className={selectCls}>
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select aria-label="Sort" value={sort} onChange={(e) => changeSort(e.target.value as SortKey)} className={`${selectCls} sm:ml-auto`}>
              <option value="smart">Sort: smart (by date)</option>
              <option value="client">Sort: client A–Z</option>
              <option value="n">Sort: N (high→low)</option>
            </select>
            {filterActive && (
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  setWork('all')
                  setPlatform('all')
                  setClient('all')
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* KPI tiles — click to jump to the section */}
          <section aria-label="Rerun summary counts" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiOrder.map((b) => {
              const cfg = BUCKETS[b]
              const n = g[b].length
              // Only the buckets that render a section (id target) are clickable;
              // 'unsorted' hides at 0, so its tile is a plain group then.
              const clickable = b !== 'unsorted' || n > 0
              const body = (
                <>
                  <span className="text-xs text-muted-foreground">{cfg.label}</span>
                  <span className={`text-2xl font-semibold leading-tight tabular-nums ${n > 0 ? cfg.count : 'text-foreground'}`}>
                    {n}
                  </span>
                  <span className="text-xs text-muted-foreground">{cfg.sub}</span>
                </>
              )
              return clickable ? (
                <button
                  key={b}
                  type="button"
                  onClick={() => jumpTo(b)}
                  aria-label={`${cfg.label}: ${n}. Jump to section.`}
                  className={`${tile} border-t-2 ${cfg.top} hover:border-ring transition-colors`}
                >
                  {body}
                </button>
              ) : (
                <div key={b} role="group" aria-label={`${cfg.label}: ${n}`} className={`${tile} border-t-2 ${cfg.top}`}>
                  {body}
                </div>
              )
            })}
          </section>

          {/* Proportion bar */}
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
              <p className="text-sm text-muted-foreground">No reruns match the current search / filters.</p>
            </div>
          ) : (
            <>
              <h2 className={groupLabel}>Needs attention</h2>
              {g.overdue.length > 0 ? (
                <Section bucket="overdue" items={g.overdue} />
              ) : (
                <div
                  id="sec-overdue"
                  className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-card border border-border shadow-sm rounded-xl px-4 py-2.5"
                >
                  <span aria-hidden="true">✓</span> Nothing overdue.
                </div>
              )}
              {g.unsorted.length > 0 && <Section bucket="unsorted" items={g.unsorted} />}

              <h2 className={groupLabel}>On track</h2>
              <Section bucket="upcoming" items={g.upcoming} />
              <CollapsibleSection bucket="done" items={g.done} />

              <p className="text-xs text-muted-foreground">
                Read-only mirror of the “Manual Rerun” tab. Dates are inferred from the sheet’s free text, so timing is
                directional — the raw status is shown on each card. Titles link to the project list; the full logging tab
                that replaces the sheet is coming.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
