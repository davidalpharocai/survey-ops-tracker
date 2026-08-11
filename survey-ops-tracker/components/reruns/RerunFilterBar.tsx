'use client'
import { useEffect, useRef } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { isTypingTarget } from '@/lib/utils/keyboard'
import { isFilterActive, EMPTY_RERUN_FILTER, type RerunFilterState } from '@/lib/reruns/filterViews'

// A controlled filter + deep-search bar shared by all three /reruns views. The
// state lives in the page (so switching Calendar/List/Series keeps the query);
// this component just renders it and emits changes up. "Deep search" matches a
// series' client / survey / template / owner / base-type label and its waves'
// codes / names / survey IDs (see lib/reruns/filterViews.ts).

const selectCls =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-ring'

export function RerunFilterBar({
  value,
  onChange,
  owners,
}: {
  value: RerunFilterState
  onChange: (next: RerunFilterState) => void
  /** Distinct owner emails across the series, for the Owner select. */
  owners: string[]
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof RerunFilterState>(key: K, v: RerunFilterState[K]) =>
    onChange({ ...value, [key]: v })

  // "/" focuses the search box (unless already typing) — same affordance as the
  // legacy radar's search.
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

  const active = isFilterActive(value)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={searchRef}
          value={value.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search reruns — client, survey, owner, template, project code, survey ID…  ( / )"
          aria-label="Search reruns by client, survey, owner, template, project code or survey ID"
          className="flex-1 min-w-[14rem] max-w-md bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring"
        />
        <InfoTooltip text="Deep search: a case-insensitive substring match across each series' client, survey name, template, owner, base-type label, and every wave's project code, name and survey ID. Every word you type must match somewhere." />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="sr-only" htmlFor="rerun-filter-type">Type</label>
        <select
          id="rerun-filter-type"
          aria-label="Filter by type"
          value={value.type}
          onChange={(e) => set('type', e.target.value as RerunFilterState['type'])}
          className={selectCls}
        >
          <option value="all">All types</option>
          <option value="PS">PS</option>
          <option value="B2B">B2B</option>
          <option value="service">Rerun Service</option>
        </select>

        <label className="sr-only" htmlFor="rerun-filter-status">Status</label>
        <select
          id="rerun-filter-status"
          aria-label="Filter by status"
          value={value.status}
          onChange={(e) => set('status', e.target.value as RerunFilterState['status'])}
          className={selectCls}
        >
          <option value="all">All statuses</option>
          <option value="in_service">In service</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
          <option value="overdue">Overdue</option>
        </select>

        <label className="sr-only" htmlFor="rerun-filter-cadence">Cadence</label>
        <select
          id="rerun-filter-cadence"
          aria-label="Filter by cadence"
          value={value.cadence}
          onChange={(e) => set('cadence', e.target.value as RerunFilterState['cadence'])}
          className={selectCls}
        >
          <option value="all">All cadences</option>
          <option value="1">Monthly</option>
          <option value="3">Quarterly</option>
          <option value="6">Every 6 mo</option>
          <option value="12">Yearly</option>
          <option value="adhoc">Ad-hoc</option>
        </select>

        <label className="sr-only" htmlFor="rerun-filter-owner">Owner</label>
        <select
          id="rerun-filter-owner"
          aria-label="Filter by owner"
          value={value.owner}
          onChange={(e) => set('owner', e.target.value)}
          className={selectCls}
        >
          <option value="all">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_RERUN_FILTER)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
