'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Caret } from '@/components/shared/Caret'
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { formatDate } from '@/lib/utils/date'
import { fmtNum } from '@/lib/utils/number'
import { waveStatus } from '@/lib/reruns/waveStatus'
import {
  cadenceLabel,
  seriesStatusKey,
  seriesPasses,
  SERIES_STATUS_META,
  type RerunFilterState,
} from '@/lib/reruns/filterViews'
import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'
import type { SeriesWaveRow } from '@/lib/hooks/useRerunWaves'

// The Series view: every (filtered) rerun series as a collapsible group. A
// summary line (BaseTypeTag + client — survey · N waves · next {date} · status)
// expands to its waves, each linking to the project. Collapse/expand + keyboard
// modelled on the client-page series grouping (real <button> caret,
// aria-expanded). Honours the shared filter + deep search.

type Dir = 'asc' | 'desc'
type SortField = 'client' | 'next'
const SORT_KEY = 'sot.rerunSeriesSort'

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const waveFielded = (w: SeriesWaveRow): string | null => w.launch_date ?? w.submitted_date

function sortValue(s: SeriesListRow, field: SortField): string {
  if (field === 'next') return s.effective_next ?? '9999-99-99'
  return s.client ?? ''
}

export function RerunSeriesView({
  series,
  wavesBySeries,
  filter,
}: {
  series: SeriesListRow[]
  wavesBySeries: Map<string, SeriesWaveRow[]>
  filter: RerunFilterState
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ field: SortField; dir: Dir }>({ field: 'next', dir: 'asc' })
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_KEY)
      if (!raw) return
      const p = JSON.parse(raw) as { field?: string; dir?: string }
      if (p && (p.field === 'client' || p.field === 'next') && (p.dir === 'asc' || p.dir === 'desc')) {
        setSort({ field: p.field, dir: p.dir })
      }
    } catch {
      /* default is fine */
    }
  }, [])
  const changeSort = (next: { field: SortField; dir: Dir }) => {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const t = today()

  const filtered = useMemo(() => {
    const rows = series.filter((s) => seriesPasses(s, wavesBySeries.get(s.id) ?? [], filter))
    return rows.sort((a, b) => {
      const cmp = sortValue(a, sort.field).localeCompare(sortValue(b, sort.field))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [series, wavesBySeries, filter, sort])

  const allExpanded = filtered.length > 0 && filtered.every((s) => expanded.has(s.id))
  const expandAll = () => setExpanded(new Set(filtered.map((s) => s.id)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="flex flex-col gap-3">
      {/* Sort + expand/collapse controls */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="sr-only" htmlFor="rerun-series-sort">Sort series</label>
        <select
          id="rerun-series-sort"
          aria-label="Sort series"
          value={sort.field}
          onChange={(e) => changeSort({ field: e.target.value as SortField, dir: sort.dir })}
          className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-ring"
        >
          <option value="next">Sort: next due</option>
          <option value="client">Sort: client A–Z</option>
        </select>
        <button
          type="button"
          onClick={() => changeSort({ field: sort.field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          title="Toggle sort direction"
          className="border border-border text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-2 py-1.5 transition-colors"
        >
          {sort.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        <button
          type="button"
          onClick={allExpanded ? collapseAll : expandAll}
          className="sm:ml-auto text-muted-foreground hover:text-foreground underline"
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border shadow-sm rounded-xl p-6 text-sm text-muted-foreground text-center">
          No rerun series match the current search / filters.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((s) => {
            const open = expanded.has(s.id)
            const status = SERIES_STATUS_META[seriesStatusKey(s)]
            const waves = wavesBySeries.get(s.id) ?? []
            return (
              <li key={s.id} className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
                <h3 className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} the ${s.client} — ${s.survey_name} rerun series`}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left rounded hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                  >
                    <Caret open={open} className="text-muted-foreground shrink-0" />
                    <BaseTypeTag baseType={s.base_type} rerunService={s.rerun_service} className="shrink-0" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{s.client}</span>
                      <span className="text-muted-foreground"> — {s.survey_name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground font-normal shrink-0 whitespace-nowrap hidden sm:inline">
                      · {fmtNum(s.wave_count)} wave{s.wave_count === 1 ? '' : 's'}
                      {' · '}
                      {cadenceLabel(s.cadence_months)}
                      {s.effective_next ? ` · next ${formatDate(s.effective_next)}` : ''}
                    </span>
                  </button>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${status.chip}`}>{status.label}</span>
                  <Link
                    href={`/reruns/series/${s.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Open the rerun series record"
                    className="shrink-0 text-xs text-primary hover:underline"
                  >
                    Open ↗
                  </Link>
                </h3>

                {open && (
                  <div className="border-t border-border">
                    {waves.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">No waves recorded yet.</p>
                    ) : (
                      <ul>
                        {[...waves]
                          .sort((a, b) => (a.rerun_number ?? 0) - (b.rerun_number ?? 0))
                          .map((w, i) => {
                            const st = waveStatus(w, t)
                            const fielded = waveFielded(w)
                            return (
                              <li key={w.id} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                                <Link
                                  href={`/projects/${w.id}`}
                                  className="flex items-center gap-2 px-3 py-2 pl-8 border-l-2 border-teal-500/40 hover:bg-accent/50 transition-colors"
                                >
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-12">
                                    Wave {w.rerun_number}
                                  </span>
                                  <span className="text-sm text-foreground truncate min-w-0 flex-1">{w.project_name}</span>
                                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${st.chip}`}>{st.label}</span>
                                  {w.is_placeholder && (
                                    <span
                                      title="Assumed-delivered wave — no real data yet; Sree will backfill"
                                      className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                                    >
                                      Placeholder
                                    </span>
                                  )}
                                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
                                    {fielded ? formatDate(fielded) : '—'} · N {fmtNum(w.n_collected)}
                                  </span>
                                </Link>
                              </li>
                            )
                          })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
