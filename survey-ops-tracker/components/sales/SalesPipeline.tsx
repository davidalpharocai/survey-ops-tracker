'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils/number'
import { stageLabel } from '@/lib/utils/stage'
import { BUCKETS, bucketOf, countBuckets, type BucketId } from '@/lib/sales/buckets'

/** Exactly the columns the page selects — no cost, no internal target. */
export interface SalesRow {
  id: string
  project_code: string | null
  project_name: string
  client: string | null
  requested_by_name: string | null
  board_column: string
  status: string
  phase: string | null
  n_target: number | null
  n_target_max: number | null
  n_collected: number
  n_actual: number | null
  credits: number | null
  submitted_date: string | null
  deliver_date: string | null
  delivered_at: string | null
}

type ColId =
  | 'client' | 'requested' | 'stage' | 'target' | 'collected'
  | 'credits' | 'submitted' | 'deliver'

interface Col {
  id: ColId
  label: string
  title: string
  numeric?: boolean
  /** Sort value. Null sorts last regardless of direction — an unrecorded figure
   *  should never lead the table just because a direction flipped. */
  sort: (r: SalesRow) => string | number | null
}

const COLS: Col[] = [
  { id: 'client', label: 'Client', title: 'The account this survey belongs to.', sort: r => r.client ?? null },
  { id: 'requested', label: 'Requested by', title: 'The client contact who asked for it.', sort: r => r.requested_by_name ?? null },
  { id: 'stage', label: 'Stage', title: 'Where it is in the pipeline, from Submitted through Delivered.', sort: r => r.board_column },
  { id: 'target', label: 'Target', title: 'The agreed number of responses, as a range where one was agreed. The same N field the product team sees.', numeric: true, sort: r => r.n_target ?? null },
  { id: 'collected', label: 'Collected', title: 'Responses in so far, and how that compares with the target. Once delivered this shows the final cleaned figure.', numeric: true, sort: r => r.n_actual ?? r.n_collected },
  { id: 'credits', label: 'Credits', title: 'What this survey costs the client in credits. Blank means it has not been priced yet — not that it is free.', numeric: true, sort: r => r.credits ?? null },
  { id: 'submitted', label: 'Submitted', title: 'When the request came in.', sort: r => r.submitted_date ?? null },
  { id: 'deliver', label: 'Deliver', title: 'The delivery date — the promised one, or the actual one once delivered.', sort: r => r.deliver_date ?? null },
]

const DEFAULT_COLS: ColId[] = ['client', 'requested', 'stage', 'target', 'collected', 'credits', 'deliver']
const STORE_KEY = 'socc-sales-columns'

const STAGE_TONE: Record<string, string> = {
  Submitted: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  'Doc Programming': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'Survey Programming': 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  'EdWin QA': 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  Fielding: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'Data QA': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Delivery: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

/** "100 – 500", "100", or "—". The range is one cell because the two numbers are
 *  one fact; splitting them invites reading the floor as the target. */
function targetText(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—'
  if (min != null && max != null && max !== min) return `${fmtNum(min)} – ${fmtNum(max)}`
  return fmtNum((min ?? max) as number)
}

function pct(collected: number, min: number | null): number | null {
  if (!min || min <= 0) return null
  return Math.round((collected / min) * 100)
}

export function SalesPipeline({ rows }: { rows: SalesRow[] }) {
  const [bucket, setBucket] = useState<BucketId | 'all'>('active')
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<ColId>('deliver')
  const [asc, setAsc] = useState(true)
  const [visible, setVisible] = useState<ColId[]>(DEFAULT_COLS)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Column choice is personal and remembered in this browser — the same
  // convention as the Operations list, so the two behave alike. Wrapped because
  // localStorage throws outright in some contexts (private windows, blocked site
  // data) rather than merely returning null.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ColId[]
      const known = parsed.filter(c => COLS.some(k => k.id === c))
      if (known.length) setVisible(known)
    } catch { /* keep the defaults */ }
  }, [])

  function setCols(next: ColId[]) {
    setVisible(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  const counts = useMemo(() => countBuckets(rows), [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = bucket === 'all' ? rows : rows.filter(r => bucketOf(r) === bucket)
    if (needle) {
      out = out.filter(r =>
        (r.project_name ?? '').toLowerCase().includes(needle) ||
        (r.project_code ?? '').toLowerCase().includes(needle) ||
        (r.client ?? '').toLowerCase().includes(needle) ||
        (r.requested_by_name ?? '').toLowerCase().includes(needle)
      )
    }
    const col = COLS.find(c => c.id === sortBy) ?? COLS[0]
    return [...out].sort((a, b) => {
      const av = col.sort(a); const bv = col.sort(b)
      // Nulls last in BOTH directions, deliberately: an unpriced survey should
      // not jump to the top of the table just because someone reversed the sort.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const c = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return asc ? c : -c
    })
  }, [rows, bucket, q, sortBy, asc])

  const cols = COLS.filter(c => visible.includes(c.id))

  return (
    <div>
      {/* The breakdown David asked for. Clickable, because a number you cannot
          open is a number you have to go and re-find by hand. Every survey lands
          in exactly one group, so these sum to the total. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {BUCKETS.map(b => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(bucket === b.id ? 'all' : b.id)}
            title={b.hint}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              bucket === b.id
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card hover:border-ring'
            }`}
          >
            <span className="block text-lg font-semibold tabular-nums leading-none">{counts[b.id]}</span>
            <span className="mt-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              {b.label}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setBucket('all')}
          title="Every survey on your accounts, whatever its state."
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            bucket === 'all' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-ring'
          }`}
        >
          <span className="block text-lg font-semibold tabular-nums leading-none">{rows.length}</span>
          <span className="mt-1 block text-[11px] uppercase tracking-wide text-muted-foreground">All</span>
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search survey, code, client or contact…"
          className="min-w-[15rem] flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-ring focus:outline-none"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            title="Choose which columns you see — personal to you, remembered in this browser"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-ring hover:text-foreground"
          >
            ⚙ Columns
          </button>
          {pickerOpen && (
            <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-border bg-card p-2 shadow-lg">
              {COLS.map(c => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={visible.includes(c.id)}
                    onChange={e =>
                      setCols(e.target.checked
                        ? [...visible, c.id]
                        : visible.filter(v => v !== c.id))
                    }
                  />
                  <span>
                    <span className="block">{c.label}</span>
                    <span className="block text-[11px] leading-tight text-muted-foreground">{c.title}</span>
                  </span>
                </label>
              ))}
              {/* The columns a sales user cannot see are ABSENT rather than
                  disabled. Showing "Budget (locked)" would advertise a number
                  they are not meant to know exists. */}
              <button
                type="button"
                onClick={() => { setCols(DEFAULT_COLS); setPickerOpen(false) }}
                className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                Reset to default
              </button>
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {q.trim()
            ? `Nothing matches “${q.trim()}” in this group. Try All, or clear the search.`
            : 'Nothing in this group.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2.5 text-[11px] font-normal uppercase tracking-widest text-muted-foreground">
                  Survey
                </th>
                {cols.map(c => (
                  <th
                    key={c.id}
                    title={c.title + ' · click to sort'}
                    onClick={() => { if (sortBy === c.id) setAsc(a => !a); else { setSortBy(c.id); setAsc(true) } }}
                    className={`cursor-pointer select-none px-4 py-2.5 text-[11px] font-normal uppercase tracking-widest text-muted-foreground hover:text-foreground ${c.numeric ? 'text-right' : ''}`}
                  >
                    {c.label}
                    {sortBy === c.id && <span aria-hidden className="ml-1">{asc ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    {/* A real link, so right-click and cmd-click work — the
                        standing rule for every hyperlinked element in this app. */}
                    <Link href={`/projects/${r.id}`} className="block font-medium hover:underline">
                      {r.project_name}
                    </Link>
                    {r.project_code && (
                      <span className="block font-mono text-xs text-muted-foreground">{r.project_code}</span>
                    )}
                  </td>
                  {cols.map(c => (
                    <td key={c.id} className={`px-4 py-3 ${c.numeric ? 'text-right font-mono tabular-nums' : ''}`}>
                      {cell(c.id, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground/70">
        {shown.length} of {rows.length} {rows.length === 1 ? 'survey' : 'surveys'} shown.
      </p>
    </div>
  )
}

function cell(id: ColId, r: SalesRow) {
  switch (id) {
    case 'client':
      return <span className="text-muted-foreground">{r.client ?? '—'}</span>
    case 'requested':
      return <span className="text-muted-foreground">{r.requested_by_name ?? '—'}</span>
    case 'stage':
      return (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STAGE_TONE[r.board_column] ?? 'bg-muted text-muted-foreground'}`}>
          {stageLabel(r.board_column)}
        </span>
      )
    case 'target':
      return targetText(r.n_target, r.n_target_max)
    case 'collected': {
      // n_actual is the delivered figure and supersedes n_collected once it
      // exists — showing the in-field count on a delivered study understates
      // what the client actually received.
      const shownN = r.n_actual ?? r.n_collected
      const p = pct(shownN, r.n_target)
      return (
        <>
          {fmtNum(shownN)}
          {p != null && (
            <span className={`ml-1.5 text-xs ${p >= 100 ? 'text-emerald-600 dark:text-emerald-400' : p >= 60 ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
              {p}%
            </span>
          )}
        </>
      )
    }
    case 'credits':
      // Blank, not zero. Credits have never been recorded on any survey, and "0"
      // would read as free.
      return r.credits == null
        ? <span className="text-muted-foreground/50">—</span>
        : fmtNum(r.credits)
    case 'submitted':
      return <span className="text-muted-foreground">{r.submitted_date ?? '—'}</span>
    case 'deliver':
      return <span className="text-muted-foreground">{r.delivered_at?.slice(0, 10) ?? r.deliver_date ?? '—'}</span>
  }
}
