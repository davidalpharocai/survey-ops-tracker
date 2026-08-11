'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { Seg } from '@/components/reruns/Seg'
import { formatDate } from '@/lib/utils/date'
import { fmtNum } from '@/lib/utils/number'
import { waveStatus } from '@/lib/reruns/waveStatus'
import {
  cadenceLabel,
  seriesStatusKey,
  seriesPasses,
  wavePasses,
  SERIES_STATUS_META,
  type RerunFilterState,
  type SeriesFilterFields,
  type SeriesSearchFields,
} from '@/lib/reruns/filterViews'
import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'
import type { SeriesWaveRow } from '@/lib/hooks/useRerunWaves'

// The List view: a sortable table with a granularity toggle (Series | Waves).
// Series mode = one row per rerun series (→ the series record); Waves mode = one
// row per wave (→ the project). Both honour the shared filter + deep search
// (lib/reruns/filterViews.ts) and persist their own sort in localStorage.

type Dir = 'asc' | 'desc'
type Granularity = 'series' | 'waves'

const GRAN_KEY = 'sot.rerunListGranularity'
const SERIES_SORT_KEY = 'sot.rerunListSort'
const WAVE_SORT_KEY = 'sot.rerunWaveSort'

type SeriesSortField = 'client' | 'survey' | 'cadence' | 'owner' | 'waves' | 'next' | 'status'
type WaveSortField = 'client' | 'survey' | 'wave' | 'fielded' | 'delivered' | 'n' | 'nActual' | 'status' | 'surveyId'

interface SortState<F extends string> {
  field: F
  dir: Dir
}

// Overdue first, then live, then paused, then ended — the natural "who needs me"
// ordering when sorting the Status column ascending.
const STATUS_RANK: Record<ReturnType<typeof seriesStatusKey>, number> = {
  overdue: 0,
  in_service: 1,
  paused: 2,
  ended: 3,
}

/** Hydrate a persisted {field,dir} from localStorage (client-side only, so SSR
 * always renders the default and there's no hydration mismatch). */
function useStoredSort<F extends string>(
  key: string,
  initial: SortState<F>,
  isField: (f: string) => f is F,
): readonly [SortState<F>, (field: F) => void] {
  const [sort, setSort] = useState<SortState<F>>(initial)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw) as { field?: string; dir?: string }
      if (parsed && typeof parsed.field === 'string' && isField(parsed.field) && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
        setSort({ field: parsed.field, dir: parsed.dir })
      }
    } catch {
      /* default is fine */
    }
  }, [key, isField])
  const change = (field: F) =>
    setSort((cur) => {
      const next: SortState<F> = cur.field === field ? { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  return [sort, change] as const
}

const isSeriesField = (f: string): f is SeriesSortField =>
  ['client', 'survey', 'cadence', 'owner', 'waves', 'next', 'status'].includes(f)
const isWaveField = (f: string): f is WaveSortField =>
  ['client', 'survey', 'wave', 'fielded', 'delivered', 'n', 'nActual', 'status', 'surveyId'].includes(f)

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const waveFielded = (w: SeriesWaveRow): string | null => w.launch_date ?? w.submitted_date
const waveDelivered = (w: SeriesWaveRow): string | null => w.delivered_at ?? w.deliver_date

function seriesSortValue(s: SeriesListRow, field: SeriesSortField): string | number {
  switch (field) {
    case 'client':
      return s.client ?? ''
    case 'survey':
      return s.survey_name ?? ''
    case 'cadence':
      return s.cadence_months ?? Number.POSITIVE_INFINITY // ad-hoc sinks to the bottom ascending
    case 'owner':
      return s.owner_email ?? ''
    case 'waves':
      return s.wave_count ?? 0
    case 'next':
      return s.effective_next ?? '9999-99-99' // no-date rows last ascending
    case 'status':
      return STATUS_RANK[seriesStatusKey(s)]
  }
}

function waveSortValue(
  w: SeriesWaveRow,
  seriesMap: Map<string, SeriesListRow>,
  t: string,
  field: WaveSortField,
): string | number {
  switch (field) {
    case 'client':
      return w.client ?? ''
    case 'survey':
      return seriesMap.get(w.series_id)?.survey_name ?? w.project_name ?? ''
    case 'wave':
      return w.rerun_number ?? 0
    case 'fielded':
      return waveFielded(w) ?? '9999-99-99'
    case 'delivered':
      return waveDelivered(w) ?? '9999-99-99'
    case 'n':
      return w.n_collected ?? 0
    case 'nActual':
      return w.n_actual == null ? Number.NEGATIVE_INFINITY : w.n_actual
    case 'status':
      return waveStatus(w, t).label
    case 'surveyId':
      return w.survey_tool_id ?? ''
  }
}

function compare(av: string | number, bv: string | number, dir: Dir): number {
  const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
  return dir === 'asc' ? cmp : -cmp
}

const th =
  'sticky top-0 bg-background px-3 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium border-b border-border'
const td = 'px-3 py-2.5 text-sm'

function SortIcon({ active, dir }: { active: boolean; dir: Dir }) {
  if (!active) return <span className="text-muted-foreground ml-1">↕</span>
  return <span className="text-foreground/80 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

export function RerunListView({
  series,
  waves,
  filter,
}: {
  series: SeriesListRow[]
  waves: SeriesWaveRow[]
  filter: RerunFilterState
}) {
  const router = useRouter()
  const [granularity, setGranularity] = useState<Granularity>('series')
  useEffect(() => {
    try {
      const g = localStorage.getItem(GRAN_KEY)
      if (g === 'series' || g === 'waves') setGranularity(g)
    } catch {
      /* default is fine */
    }
  }, [])
  const changeGranularity = (g: Granularity) => {
    setGranularity(g)
    try {
      localStorage.setItem(GRAN_KEY, g)
    } catch {
      /* ignore */
    }
  }

  const [seriesSort, changeSeriesSort] = useStoredSort<SeriesSortField>(
    SERIES_SORT_KEY,
    { field: 'next', dir: 'asc' },
    isSeriesField,
  )
  const [waveSort, changeWaveSort] = useStoredSort<WaveSortField>(
    WAVE_SORT_KEY,
    { field: 'fielded', dir: 'desc' },
    isWaveField,
  )

  const seriesMap = useMemo(() => new Map(series.map((s) => [s.id, s])), [series])

  // series_id -> waves[] (for the series-mode search, which also matches wave fields).
  const wavesForSeries = useMemo(() => {
    const m = new Map<string, SeriesWaveRow[]>()
    for (const w of waves) {
      const list = m.get(w.series_id)
      if (list) list.push(w)
      else m.set(w.series_id, [w])
    }
    return m
  }, [waves])

  const t = today()

  const filteredSeries = useMemo(() => {
    const rows = series.filter((s) => seriesPasses(s, wavesForSeries.get(s.id) ?? [], filter))
    return rows.sort((a, b) => compare(seriesSortValue(a, seriesSort.field), seriesSortValue(b, seriesSort.field), seriesSort.dir))
  }, [series, wavesForSeries, filter, seriesSort])

  const filteredWaves = useMemo(() => {
    // A minimal parent for a wave whose series row is missing from the view
    // (should not happen — both read the same model — but keeps filtering
    // predictable). Defined inside the memo so it's not an extra hook dep.
    const parentOf = (w: SeriesWaveRow): SeriesFilterFields & SeriesSearchFields =>
      seriesMap.get(w.series_id) ?? {
        client: w.client ?? '',
        survey_name: w.project_name ?? '',
        template_id: null,
        owner_email: null,
        base_type: null,
        cadence_months: null,
        in_service: true,
        paused: false,
        is_overdue: false,
      }
    const rows = waves.filter((w) => wavePasses(w, parentOf(w), filter))
    return rows.sort((a, b) => compare(waveSortValue(a, seriesMap, t, waveSort.field), waveSortValue(b, seriesMap, t, waveSort.field), waveSort.dir))
  }, [waves, seriesMap, filter, waveSort, t])

  const count = granularity === 'series' ? filteredSeries.length : filteredWaves.length

  const seriesHeaders: { field: SeriesSortField; label: string; title: string }[] = [
    { field: 'client', label: 'Client', title: 'The client this rerun series is for.' },
    { field: 'survey', label: 'Survey', title: 'Survey name, with its base type (PS / B2B / Rerun Service).' },
    { field: 'cadence', label: 'Cadence', title: 'How often the next wave is scheduled.' },
    { field: 'owner', label: 'Owner', title: 'Who owns keeping this series on cadence.' },
    { field: 'waves', label: '# Waves', title: 'How many waves this series has so far.' },
    { field: 'next', label: 'Next due', title: 'Computed next-wave collection date.' },
    { field: 'status', label: 'Status', title: 'Overdue / in service / paused / ended.' },
  ]
  const waveHeaders: { field: WaveSortField; label: string; title: string }[] = [
    { field: 'client', label: 'Client', title: 'The client this wave is for.' },
    { field: 'survey', label: 'Series / Survey', title: 'The series this wave belongs to.' },
    { field: 'wave', label: 'Wave #', title: 'Position of this wave within the series.' },
    { field: 'fielded', label: 'Fielded / rerun date', title: 'When the wave fielded (launch, else submitted).' },
    { field: 'delivered', label: 'Delivered', title: 'When the wave was delivered.' },
    { field: 'n', label: 'N collected', title: 'Responses collected.' },
    { field: 'nActual', label: 'N actual', title: 'Usable responses after cleaning.' },
    { field: 'status', label: 'Status', title: 'Delivered / in field / upcoming (+ placeholder).' },
    { field: 'surveyId', label: 'Survey ID', title: 'The survey tool ID for this wave.' },
  ]

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border flex-wrap">
        <span className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{fmtNum(count)}</span>{' '}
          {granularity === 'series' ? 'series' : `wave${count === 1 ? '' : 's'}`}
        </span>
        <Seg
          label="List granularity"
          value={granularity}
          onChange={changeGranularity}
          options={[
            { v: 'series', label: 'Series' },
            { v: 'waves', label: 'Waves' },
          ]}
        />
      </div>

      <div className="overflow-auto thin-scroll max-h-[calc(100vh-20rem)]">
        {granularity === 'series' ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {seriesHeaders.map((h) => (
                  <th
                    key={h.field}
                    title={`${h.title} Click to sort.`}
                    onClick={() => changeSeriesSort(h.field)}
                    className={`${th} cursor-pointer hover:text-foreground`}
                  >
                    {h.label}
                    <SortIcon active={seriesSort.field === h.field} dir={seriesSort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSeries.length === 0 && (
                <tr>
                  <td colSpan={seriesHeaders.length} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No rerun series match the current search / filters.
                  </td>
                </tr>
              )}
              {filteredSeries.map((s, i) => {
                const status = SERIES_STATUS_META[seriesStatusKey(s)]
                return (
                  <tr
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open the ${s.client} — ${s.survey_name} rerun series`}
                    onClick={() => router.push(`/reruns/series/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        router.push(`/reruns/series/${s.id}`)
                      }
                    }}
                    className={`border-t border-border cursor-pointer hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring transition-colors ${
                      i % 2 === 1 ? 'bg-muted/40' : ''
                    }`}
                  >
                    <td className={`${td} text-foreground font-medium`}>{s.client}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5">
                        <BaseTypeTag baseType={s.base_type} rerunService={s.rerun_service} />
                        <span className="text-foreground">{s.survey_name}</span>
                      </span>
                    </td>
                    <td className={`${td} text-muted-foreground`}>{cadenceLabel(s.cadence_months)}</td>
                    <td className={`${td} text-muted-foreground`}>{s.owner_email ?? <span className="text-muted-foreground/50">—</span>}</td>
                    <td className={`${td} text-muted-foreground tabular-nums`}>{fmtNum(s.wave_count)}</td>
                    <td className={`${td} text-muted-foreground whitespace-nowrap`}>
                      {s.effective_next ? formatDate(s.effective_next) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className={td}>
                      <span className={`text-xs px-2 py-0.5 rounded ${status.chip}`}>{status.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {waveHeaders.map((h) => (
                  <th
                    key={h.field}
                    title={`${h.title} Click to sort.`}
                    onClick={() => changeWaveSort(h.field)}
                    className={`${th} cursor-pointer hover:text-foreground`}
                  >
                    {h.label}
                    <SortIcon active={waveSort.field === h.field} dir={waveSort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredWaves.length === 0 && (
                <tr>
                  <td colSpan={waveHeaders.length} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No waves match the current search / filters.
                  </td>
                </tr>
              )}
              {filteredWaves.map((w, i) => {
                const st = waveStatus(w, t)
                const parentName = seriesMap.get(w.series_id)?.survey_name ?? w.project_name
                const parentBase = seriesMap.get(w.series_id)?.base_type ?? null
                const parentRerunService = seriesMap.get(w.series_id)?.rerun_service ?? false
                return (
                  <tr
                    key={w.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${w.project_name}`}
                    onClick={() => router.push(`/projects/${w.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        router.push(`/projects/${w.id}`)
                      }
                    }}
                    className={`border-t border-border cursor-pointer hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring transition-colors ${
                      i % 2 === 1 ? 'bg-muted/40' : ''
                    }`}
                  >
                    <td className={`${td} text-muted-foreground`}>{w.client ?? '—'}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5">
                        <BaseTypeTag baseType={parentBase} rerunService={parentRerunService} />
                        <span className="text-foreground">{parentName}</span>
                      </span>
                    </td>
                    <td className={`${td} text-muted-foreground tabular-nums`}>{w.rerun_number}</td>
                    <td className={`${td} text-muted-foreground whitespace-nowrap`}>
                      {waveFielded(w) ? formatDate(waveFielded(w)) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className={`${td} text-muted-foreground whitespace-nowrap`}>
                      {waveDelivered(w) ? formatDate(waveDelivered(w)) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className={`${td} text-muted-foreground tabular-nums`}>{fmtNum(w.n_collected)}</td>
                    <td className={`${td} text-muted-foreground tabular-nums`}>{fmtNum(w.n_actual)}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded ${st.chip}`}>{st.label}</span>
                        {w.is_placeholder && (
                          <span
                            title="Assumed-delivered wave — no real data yet; Sree will backfill"
                            className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            Placeholder
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${td} font-mono text-xs text-muted-foreground`}>
                      {w.survey_tool_id ?? <span className="text-muted-foreground/50">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
