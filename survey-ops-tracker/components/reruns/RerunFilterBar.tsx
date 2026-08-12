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

// Next-due presets — the same set the main board's Due filter uses, applied to
// each series' next-collection date (effective_next). See matchesDuePreset.
const DUE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any next-due' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'tomorrow', label: 'Due tomorrow' },
  { value: 'twodays', label: 'Due in 2 days' },
  { value: 'week', label: 'Due this week' },
  { value: 'month', label: 'Due this month' },
  { value: 'none', label: 'No next date' },
  { value: 'custom', label: 'Custom range…' },
]

export function RerunFilterBar({
  value,
  onChange,
  owners,
  clients,
  salespeople,
}: {
  value: RerunFilterState
  onChange: (next: RerunFilterState) => void
  /** Distinct owner emails across the series, for the Owner select. */
  owners: string[]
  /** Distinct client strings across the series, for the Client select. */
  clients: string[]
  /** Distinct salespeople across the series' waves, for the Salesperson select. */
  salespeople: string[]
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof RerunFilterState>(key: K, v: RerunFilterState[K]) =>
    onChange({ ...value, [key]: v })
  // Changing the Next-due preset away from custom clears any stale range.
  const setDue = (due: string) =>
    onChange({ ...value, due, ...(due === 'custom' ? {} : { dueFrom: '', dueTo: '' }) })

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

        <label className="sr-only" htmlFor="rerun-filter-client">Client</label>
        <select
          id="rerun-filter-client"
          aria-label="Filter by client"
          value={value.client}
          onChange={(e) => set('client', e.target.value)}
          className={selectCls}
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="rerun-filter-salesperson">Salesperson</label>
        <select
          id="rerun-filter-salesperson"
          aria-label="Filter by salesperson"
          value={value.salesperson}
          onChange={(e) => set('salesperson', e.target.value)}
          className={selectCls}
          title="A series matches when any of its waves was sold by this salesperson."
        >
          <option value="all">All salespeople</option>
          {salespeople.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="rerun-filter-due">Next due</label>
        <select
          id="rerun-filter-due"
          aria-label="Filter by next-due date"
          value={value.due}
          onChange={(e) => setDue(e.target.value)}
          className={selectCls}
          title="Filter by the series' next-collection date (effective next-due)."
        >
          {DUE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {value.due === 'custom' && (
          <span className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="rerun-filter-due-from">Next due from</label>
            <input
              id="rerun-filter-due-from"
              type="date"
              aria-label="Next due from"
              value={value.dueFrom}
              onChange={(e) => set('dueFrom', e.target.value)}
              className={selectCls}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <label className="sr-only" htmlFor="rerun-filter-due-to">Next due to</label>
            <input
              id="rerun-filter-due-to"
              type="date"
              aria-label="Next due to"
              value={value.dueTo}
              onChange={(e) => set('dueTo', e.target.value)}
              className={selectCls}
            />
          </span>
        )}

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
