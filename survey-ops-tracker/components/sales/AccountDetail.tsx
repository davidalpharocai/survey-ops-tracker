'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils/number'
import { bucketOf } from '@/lib/sales/buckets'
import { rollUp, describeConsumption, type Term } from '@/lib/sales/credits'
import {
  DATE_BASES, PRESETS, rangeFor, filterByRange, describeRange,
  type DateBasis, type PresetId, type Range,
} from '@/lib/sales/dateRange'

/**
 * One account: contacts, credit position, and a filterable survey list that can
 * be exported as a PDF.
 *
 * THE FILTER STATE IS THE EXPORT STATE. The date basis, the range and the chosen
 * columns are all passed to the print route as query parameters, so what prints
 * is exactly what is on screen — David asked for "a pdf with desired columns and
 * filtered data and within a date range", and the only way to keep that promise
 * is for one set of state to drive both. A second filter UI on the export dialog
 * would be a second thing to disagree.
 */

export interface AccountProject {
  id: string
  project_code: string | null
  project_name: string
  board_column: string
  status: string
  phase: string
  n_target: number | null
  n_target_max: number | null
  n_collected: number
  n_actual: number | null
  credits: number | null
  submitted_date: string | null
  launch_date: string | null
  deliver_date: string | null
  delivered_at: string | null
  requested_by_name: string | null
  longitudinal: boolean
  rerun_number: number
}

export interface AccountContact {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  title: string | null
  phone: string | null
}

type ColId = 'code' | 'survey' | 'requested' | 'stage' | 'target' | 'collected' | 'credits' | 'submitted' | 'deliver'

export const ACCOUNT_COLS: { id: ColId; label: string; numeric?: boolean }[] = [
  { id: 'code', label: 'Code' },
  { id: 'survey', label: 'Survey' },
  { id: 'requested', label: 'Requested by' },
  { id: 'stage', label: 'Stage' },
  { id: 'target', label: 'Target', numeric: true },
  { id: 'collected', label: 'Collected', numeric: true },
  { id: 'credits', label: 'Credits', numeric: true },
  { id: 'submitted', label: 'Submitted' },
  { id: 'deliver', label: 'Delivered' },
]

const DEFAULT_COLS: ColId[] = ['code', 'survey', 'requested', 'stage', 'collected', 'credits', 'deliver']
const STORE_KEY = 'socc-sales-account-columns'

export function cellFor(p: AccountProject, id: ColId): string {
  const stage = p.status !== 'Open' ? p.status
    : p.board_column === 'Delivery' || p.delivered_at ? 'Delivered'
    : p.board_column
  switch (id) {
    case 'code': return p.project_code ?? '—'
    case 'survey': return p.project_name
    case 'requested': return p.requested_by_name ?? '—'
    case 'stage': return stage
    case 'target':
      return p.n_target == null ? '—'
        : p.n_target_max && p.n_target_max !== p.n_target
          ? `${fmtNum(p.n_target)}–${fmtNum(p.n_target_max)}`
          : fmtNum(p.n_target)
    case 'collected': {
      const v = p.n_actual ?? p.n_collected
      return v == null ? '—' : fmtNum(v)
    }
    // Blank, never 0. A survey with no credit figure is unpriced, and printing
    // "0" on a page the client reads asserts it was free.
    case 'credits': return p.credits == null ? '—' : fmtNum(p.credits)
    case 'submitted': return p.submitted_date ?? '—'
    case 'deliver': return (p.delivered_at ?? '').slice(0, 10) || p.deliver_date || '—'
  }
}

export function AccountDetail({
  client, projects, contacts, terms,
}: {
  client: { id: string; name: string; code: string | null; salesperson: string | null; created_at: string }
  projects: AccountProject[]
  contacts: AccountContact[]
  terms: Term[]
}) {
  const [basis, setBasis] = useState<DateBasis>('delivered')
  const [preset, setPreset] = useState<PresetId>('all')
  const [custom, setCustom] = useState<Range>({ from: null, to: null })
  const [showCols, setShowCols] = useState(false)
  const [cols, setCols] = useState<ColId[]>(() => {
    // localStorage throws outright in some contexts (private windows, blocked
    // site data), so every read and write is guarded.
    try {
      const raw = localStorage.getItem(STORE_KEY)
      const parsed = raw ? (JSON.parse(raw) as ColId[]) : null
      const valid = parsed?.filter(c => ACCOUNT_COLS.some(x => x.id === c))
      return valid?.length ? valid : DEFAULT_COLS
    } catch { return DEFAULT_COLS }
  })

  function toggleCol(id: ColId) {
    const next = cols.includes(id) ? cols.filter(c => c !== id) : [...ACCOUNT_COLS.map(c => c.id).filter(c => cols.includes(c) || c === id)]
    if (next.length === 0) return  // never let the table become columnless
    setCols(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  // Today, resolved once per render rather than inside rangeFor, so the filter
  // and the export header cannot straddle midnight differently.
  const today = new Date().toLocaleDateString('en-CA')
  const range = useMemo(() => rangeFor(preset, today, custom), [preset, today, custom])
  const { rows, undated } = useMemo(() => filterByRange(projects, basis, range), [projects, basis, range])

  const buckets = useMemo(() => {
    const b: Record<string, number> = {}
    for (const p of rows) {
      const k = bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column })
      b[k] = (b[k] ?? 0) + 1
    }
    return b
  }, [rows])

  // Credits over the FILTERED set, against the term allowance, so the headline
  // answers "in this period" rather than quietly mixing a period's usage with a
  // lifetime allowance.
  const allowance = terms.reduce<number | null>(
    (t, x) => (x.credits_total == null ? t : (t ?? 0) + Number(x.credits_total)), null)
  const credits = useMemo(() => rollUp(rows, allowance), [rows, allowance])

  const exportUrl = `/sales/accounts/${client.id}/print?basis=${basis}&preset=${preset}` +
    (preset === 'custom' ? `&from=${custom.from ?? ''}&to=${custom.to ?? ''}` : '') +
    `&cols=${cols.join(',')}`

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-semibold">{client.name}</h1>
        {client.code && <span className="text-sm text-muted-foreground">{client.code}</span>}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {fmtNum(projects.length)} survey{projects.length === 1 ? '' : 's'} all time
        {contacts.length > 0 && ` · ${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
      </p>

      {/* ---- Credits ---- */}
      <section className="mb-5 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 flex items-baseline justify-between text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <span>Credits</span>
          {terms.length > 0 && <span className="normal-case tracking-normal">{terms.map(t => t.name).join(', ')}</span>}
        </h2>
        {credits.pct != null && (
          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={credits.pct > 100 ? 'h-full bg-red-500' : 'h-full bg-primary'}
              style={{ width: `${Math.min(credits.pct, 100)}%` }}
            />
          </div>
        )}
        <p className="text-sm text-foreground">{describeConsumption(credits)}</p>
      </section>

      {/* ---- Filter ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={basis}
          onChange={e => setBasis(e.target.value as DateBasis)}
          title={DATE_BASES.find(b => b.id === basis)?.hint}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          {DATE_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>

        <select
          value={preset}
          onChange={e => setPreset(e.target.value as PresetId)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        {preset === 'custom' && (
          <>
            <input
              type="date" value={custom.from ?? ''} aria-label="From"
              onChange={e => setCustom(c => ({ ...c, from: e.target.value || null }))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date" value={custom.to ?? ''} aria-label="To"
              onChange={e => setCustom(c => ({ ...c, to: e.target.value || null }))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </>
        )}

        <div className="relative">
          <button
            onClick={() => setShowCols(s => !s)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm hover:bg-muted"
          >
            Columns
          </button>
          {showCols && (
            <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-card p-2 shadow-lg">
              {ACCOUNT_COLS.map(c => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <input type="checkbox" checked={cols.includes(c.id)} onChange={() => toggleCol(c.id)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <a
          href={exportUrl}
          target="_blank"
          rel="noopener"
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Export PDF
        </a>
      </div>

      {/* The filter, stated. A table whose row count moved without saying why is
          how somebody reports a quiet shortfall as a real one. */}
      <p className="mb-3 text-xs text-muted-foreground">
        {describeRange(basis, range)} · {fmtNum(rows.length)} of {fmtNum(projects.length)} surveys
        {undated > 0 && (
          <span title={`These have no ${basis} date, so they cannot fall inside a date range.`}>
            {' '}· {undated} excluded for having no {basis} date
          </span>
        )}
        {Object.keys(buckets).length > 0 && (
          <>
            {' · '}
            {[['active', 'active'], ['scoping', 'scoping'], ['completed', 'delivered'], ['hold', 'on hold']]
              .filter(([k]) => buckets[k])
              .map(([k, label]) => `${buckets[k]} ${label}`)
              .join(', ')}
          </>
        )}
      </p>

      {/* ---- Surveys ---- */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No surveys match this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                {ACCOUNT_COLS.filter(c => cols.includes(c.id)).map(c => (
                  <th key={c.id} className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  {ACCOUNT_COLS.filter(c => cols.includes(c.id)).map(c => (
                    <td key={c.id} className={`px-3 py-2 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                      {c.id === 'survey' ? (
                        <Link href={`/sales/surveys/${p.id}`} className="font-medium hover:underline">
                          {cellFor(p, c.id)}
                        </Link>
                      ) : (
                        cellFor(p, c.id)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Contacts ---- */}
      {contacts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Contacts</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {contacts.map(c => (
              <div key={c.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-sm font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</p>
                {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    {c.email}
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
