'use client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { Seg } from '@/components/reruns/Seg'
import { ColumnsMenu } from '@/components/shared/ColumnsMenu'
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
//
// Columns are user-configurable per granularity (show/hide + reorder) via the
// shared "⚙ Columns" popover (components/shared/ColumnsMenu.tsx — the same
// control the Rerun Series record's Waves table uses), persisted separately
// per granularity so a user's List-view column choices don't collide with
// their Series-record column choices.

type Dir = 'asc' | 'desc'
type Granularity = 'series' | 'waves'

const GRAN_KEY = 'sot.rerunListGranularity'
const SERIES_SORT_KEY = 'sot.rerunListSort'
const WAVE_SORT_KEY = 'sot.rerunWaveSort'
const SERIES_COLUMNS_KEY = 'sot.rerunListSeriesColumns'
const WAVE_COLUMNS_KEY = 'sot.rerunListWaveColumns'

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

/** If the active sort field's column has been hidden, fall back to the
 * canonical default sort (or, failing that — the default field is ALSO
 * hidden — the first still-visible column in registry order) so there's
 * always a sensible, visibly-active sort rather than one silently applied to
 * data the user can't see. Pure/derived — doesn't touch persisted state, so
 * re-showing the original column seamlessly restores the user's real choice. */
function withFallbackSort<F extends string>(
  sort: SortState<F>,
  visible: F[],
  columnsInOrder: { key: F }[],
  defaultSort: SortState<F>,
): SortState<F> {
  if (visible.includes(sort.field)) return sort
  if (visible.includes(defaultSort.field)) return defaultSort
  const firstVisible = columnsInOrder.find((c) => visible.includes(c.key))?.key
  return firstVisible ? { field: firstVisible, dir: 'asc' } : sort
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

// ---------------------------------------------------------------------------
// Column registries — one per granularity. Each covers exactly the columns
// the view renders today; the default order below matches the pre-existing
// fixed layout. Configurability (show/hide + reorder) is layered on top via
// visibleSeriesColumns / visibleWaveColumns state, persisted separately from
// the registries themselves.
// ---------------------------------------------------------------------------

interface SeriesColumnDef {
  key: SeriesSortField
  label: string
  tooltip: string
  cellClassName?: string
  render: (s: SeriesListRow) => ReactNode
}

const SERIES_COLUMNS: SeriesColumnDef[] = [
  {
    key: 'client',
    label: 'Client',
    tooltip: 'The client this rerun series is for.',
    cellClassName: 'text-foreground font-medium',
    render: (s) => s.client,
  },
  {
    key: 'survey',
    label: 'Survey',
    tooltip: 'Survey name, with its base type (PS / B2B / Rerun Service).',
    render: (s) => (
      <span className="inline-flex items-center gap-1.5">
        <BaseTypeTag baseType={s.base_type} rerunService={s.rerun_service} />
        <span className="text-foreground">{s.survey_name}</span>
      </span>
    ),
  },
  {
    key: 'cadence',
    label: 'Cadence',
    tooltip: 'How often the next wave is scheduled.',
    cellClassName: 'text-muted-foreground',
    render: (s) => cadenceLabel(s.cadence_months),
  },
  {
    key: 'owner',
    label: 'Owner',
    tooltip: 'Who owns keeping this series on cadence.',
    cellClassName: 'text-muted-foreground',
    render: (s) => s.owner_email ?? <span className="text-muted-foreground/50">—</span>,
  },
  {
    key: 'waves',
    label: '# Waves',
    tooltip: 'How many waves this series has so far.',
    cellClassName: 'text-muted-foreground tabular-nums',
    render: (s) => fmtNum(s.wave_count),
  },
  {
    key: 'next',
    label: 'Next due',
    tooltip: 'Computed next-wave collection date.',
    cellClassName: 'text-muted-foreground whitespace-nowrap',
    render: (s) => (s.effective_next ? formatDate(s.effective_next) : <span className="text-muted-foreground/50">—</span>),
  },
  {
    key: 'status',
    label: 'Status',
    tooltip: 'Overdue / in service / paused / ended.',
    render: (s) => {
      const status = SERIES_STATUS_META[seriesStatusKey(s)]
      return <span className={`text-xs px-2 py-0.5 rounded ${status.chip}`}>{status.label}</span>
    },
  },
]

const SERIES_COLUMN_KEYS: SeriesSortField[] = SERIES_COLUMNS.map((c) => c.key)
const DEFAULT_SERIES_COLUMNS: SeriesSortField[] = ['client', 'survey', 'cadence', 'owner', 'waves', 'next', 'status']
const DEFAULT_SERIES_SORT: SortState<SeriesSortField> = { field: 'next', dir: 'asc' }

interface WaveColumnCtx {
  seriesMap: Map<string, SeriesListRow>
  t: string
}

interface WaveColumnDef {
  key: WaveSortField
  label: string
  tooltip: string
  cellClassName?: string
  render: (w: SeriesWaveRow, ctx: WaveColumnCtx) => ReactNode
}

const WAVE_COLUMNS: WaveColumnDef[] = [
  {
    key: 'client',
    label: 'Client',
    tooltip: 'The client this wave is for.',
    cellClassName: 'text-muted-foreground',
    render: (w) => w.client ?? '—',
  },
  {
    key: 'survey',
    label: 'Series / Survey',
    tooltip: 'The series this wave belongs to.',
    render: (w, { seriesMap }) => {
      const parent = seriesMap.get(w.series_id)
      return (
        <span className="inline-flex items-center gap-1.5">
          <BaseTypeTag baseType={parent?.base_type ?? null} rerunService={parent?.rerun_service ?? false} />
          <span className="text-foreground">{parent?.survey_name ?? w.project_name}</span>
        </span>
      )
    },
  },
  {
    key: 'wave',
    label: 'Wave #',
    tooltip: 'Position of this wave within the series.',
    cellClassName: 'text-muted-foreground tabular-nums',
    render: (w) => w.rerun_number,
  },
  {
    key: 'fielded',
    label: 'Fielded / rerun date',
    tooltip: 'When the wave fielded (launch, else submitted).',
    cellClassName: 'text-muted-foreground whitespace-nowrap',
    render: (w) => (waveFielded(w) ? formatDate(waveFielded(w)) : <span className="text-muted-foreground/50">—</span>),
  },
  {
    key: 'delivered',
    label: 'Delivered',
    tooltip: 'When the wave was delivered.',
    cellClassName: 'text-muted-foreground whitespace-nowrap',
    render: (w) => (waveDelivered(w) ? formatDate(waveDelivered(w)) : <span className="text-muted-foreground/50">—</span>),
  },
  {
    key: 'n',
    label: 'N collected',
    tooltip: 'Responses collected.',
    cellClassName: 'text-muted-foreground tabular-nums',
    render: (w) => fmtNum(w.n_collected),
  },
  {
    key: 'nActual',
    label: 'N actual',
    tooltip: 'Usable responses after cleaning.',
    cellClassName: 'text-muted-foreground tabular-nums',
    render: (w) => fmtNum(w.n_actual),
  },
  {
    key: 'status',
    label: 'Status',
    tooltip: 'Delivered / in field / upcoming (+ placeholder).',
    render: (w, { t }) => {
      const st = waveStatus(w, t)
      return (
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
      )
    },
  },
  {
    key: 'surveyId',
    label: 'Survey ID',
    tooltip: 'The survey tool ID for this wave.',
    cellClassName: 'font-mono text-xs text-muted-foreground',
    render: (w) => w.survey_tool_id ?? <span className="text-muted-foreground/50">—</span>,
  },
]

const WAVE_COLUMN_KEYS: WaveSortField[] = WAVE_COLUMNS.map((c) => c.key)
const DEFAULT_WAVE_COLUMNS: WaveSortField[] = [
  'client',
  'survey',
  'wave',
  'fielded',
  'delivered',
  'n',
  'nActual',
  'status',
  'surveyId',
]
const DEFAULT_WAVE_SORT: SortState<WaveSortField> = { field: 'fielded', dir: 'desc' }

/** Personal-to-browser column prefs, like RerunSeriesRecord's wave-columns
 * localStorage pattern. Guards against unknown/stale keys (e.g. a prior
 * registry shape) by filtering to keys that still exist, falling back to
 * null (→ caller uses its default) if nothing valid survives. */
function loadStoredColumnKeys<K extends string>(storageKey: string, validKeys: readonly K[]): K[] | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter((k): k is K => validKeys.includes(k as K))
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

function saveStoredColumnKeys(storageKey: string, keys: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // storage unavailable/full — the in-memory choice still works this visit
  }
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

  const [seriesSort, changeSeriesSort] = useStoredSort<SeriesSortField>(SERIES_SORT_KEY, DEFAULT_SERIES_SORT, isSeriesField)
  const [waveSort, changeWaveSort] = useStoredSort<WaveSortField>(WAVE_SORT_KEY, DEFAULT_WAVE_SORT, isWaveField)

  const [visibleSeriesColumns, setVisibleSeriesColumnsState] = useState<SeriesSortField[]>(DEFAULT_SERIES_COLUMNS)
  const [visibleWaveColumns, setVisibleWaveColumnsState] = useState<WaveSortField[]>(DEFAULT_WAVE_COLUMNS)

  // Hydrate column prefs from localStorage on mount (client-only — avoids an
  // SSR/client mismatch, same convention as the granularity/sort hydration above).
  useEffect(() => {
    const stored = loadStoredColumnKeys(SERIES_COLUMNS_KEY, SERIES_COLUMN_KEYS)
    if (stored) setVisibleSeriesColumnsState(stored)
  }, [])
  useEffect(() => {
    const stored = loadStoredColumnKeys(WAVE_COLUMNS_KEY, WAVE_COLUMN_KEYS)
    if (stored) setVisibleWaveColumnsState(stored)
  }, [])

  function setVisibleSeriesColumns(next: string[]) {
    const filtered = next.filter((k): k is SeriesSortField => SERIES_COLUMN_KEYS.includes(k as SeriesSortField))
    setVisibleSeriesColumnsState(filtered)
    saveStoredColumnKeys(SERIES_COLUMNS_KEY, filtered)
  }
  function setVisibleWaveColumns(next: string[]) {
    const filtered = next.filter((k): k is WaveSortField => WAVE_COLUMN_KEYS.includes(k as WaveSortField))
    setVisibleWaveColumnsState(filtered)
    saveStoredColumnKeys(WAVE_COLUMNS_KEY, filtered)
  }

  // The sort actually used for ordering + the header's active-arrow — falls
  // back off a hidden column without mutating the user's persisted sort
  // preference (see withFallbackSort above).
  const effectiveSeriesSort = useMemo(
    () => withFallbackSort(seriesSort, visibleSeriesColumns, SERIES_COLUMNS, DEFAULT_SERIES_SORT),
    [seriesSort, visibleSeriesColumns],
  )
  const effectiveWaveSort = useMemo(
    () => withFallbackSort(waveSort, visibleWaveColumns, WAVE_COLUMNS, DEFAULT_WAVE_SORT),
    [waveSort, visibleWaveColumns],
  )

  const visibleSeriesCols = useMemo(
    () => visibleSeriesColumns.map((k) => SERIES_COLUMNS.find((c) => c.key === k)).filter((c): c is SeriesColumnDef => !!c),
    [visibleSeriesColumns],
  )
  const visibleWaveCols = useMemo(
    () => visibleWaveColumns.map((k) => WAVE_COLUMNS.find((c) => c.key === k)).filter((c): c is WaveColumnDef => !!c),
    [visibleWaveColumns],
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
    return rows.sort((a, b) =>
      compare(seriesSortValue(a, effectiveSeriesSort.field), seriesSortValue(b, effectiveSeriesSort.field), effectiveSeriesSort.dir),
    )
  }, [series, wavesForSeries, filter, effectiveSeriesSort])

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
    return rows.sort((a, b) =>
      compare(
        waveSortValue(a, seriesMap, t, effectiveWaveSort.field),
        waveSortValue(b, seriesMap, t, effectiveWaveSort.field),
        effectiveWaveSort.dir,
      ),
    )
  }, [waves, seriesMap, filter, effectiveWaveSort, t])

  const count = granularity === 'series' ? filteredSeries.length : filteredWaves.length

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border flex-wrap">
        <span className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{fmtNum(count)}</span>{' '}
          {granularity === 'series' ? 'series' : `wave${count === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          <Seg
            label="List granularity"
            value={granularity}
            onChange={changeGranularity}
            options={[
              { v: 'series', label: 'Series' },
              { v: 'waves', label: 'Waves' },
            ]}
          />
          {granularity === 'series' ? (
            <ColumnsMenu
              visibleKeys={visibleSeriesColumns}
              allColumns={SERIES_COLUMNS}
              defaultKeys={DEFAULT_SERIES_COLUMNS}
              onChange={setVisibleSeriesColumns}
              buttonTitle="Choose which series columns you see, and their order — personal to you, remembered in this browser"
            />
          ) : (
            <ColumnsMenu
              visibleKeys={visibleWaveColumns}
              allColumns={WAVE_COLUMNS}
              defaultKeys={DEFAULT_WAVE_COLUMNS}
              onChange={setVisibleWaveColumns}
              buttonTitle="Choose which wave columns you see, and their order — personal to you, remembered in this browser"
            />
          )}
        </div>
      </div>

      <div className="overflow-auto thin-scroll max-h-[calc(100vh-20rem)]">
        {granularity === 'series' ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {visibleSeriesCols.map((c) => (
                  <th
                    key={c.key}
                    title={`${c.tooltip} Click to sort.`}
                    onClick={() => changeSeriesSort(c.key)}
                    className={`${th} cursor-pointer hover:text-foreground`}
                  >
                    {c.label}
                    <SortIcon active={effectiveSeriesSort.field === c.key} dir={effectiveSeriesSort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSeries.length === 0 && (
                <tr>
                  <td colSpan={visibleSeriesCols.length} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No rerun series match the current search / filters.
                  </td>
                </tr>
              )}
              {filteredSeries.map((s, i) => (
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
                  {visibleSeriesCols.map((c) => (
                    <td key={c.key} className={`${td} ${c.cellClassName ?? ''}`}>
                      {c.render(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {visibleWaveCols.map((c) => (
                  <th
                    key={c.key}
                    title={`${c.tooltip} Click to sort.`}
                    onClick={() => changeWaveSort(c.key)}
                    className={`${th} cursor-pointer hover:text-foreground`}
                  >
                    {c.label}
                    <SortIcon active={effectiveWaveSort.field === c.key} dir={effectiveWaveSort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredWaves.length === 0 && (
                <tr>
                  <td colSpan={visibleWaveCols.length} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No waves match the current search / filters.
                  </td>
                </tr>
              )}
              {filteredWaves.map((w, i) => (
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
                  {visibleWaveCols.map((c) => (
                    <td key={c.key} className={`${td} ${c.cellClassName ?? ''}`}>
                      {c.render(w, { seriesMap, t })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
