'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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

/**
 * Progress against the target — and it must not contradict the Target cell two
 * columns to its left.
 *
 * It used to divide by the range FLOOR always, so a row reading
 * "Target 100 – 150, Collected 114" also read 114%: the same row disagreeing
 * with itself, because the reader sees 150 and computes 76%. A single
 * percentage cannot describe progress against a range, so where a range exists
 * this returns a STATE instead — below the floor, inside the range, or past the
 * ceiling — and keeps the percentage for the single-number case where it is
 * unambiguous.
 */
type Progress =
  | { kind: 'pct'; pct: number }
  | { kind: 'range'; label: string; tone: 'low' | 'ok' | 'over' }
  | null

function progressOf(collected: number, min: number | null, max: number | null): Progress {
  const hasRange = min != null && max != null && max !== min
  if (hasRange) {
    if (collected < (min as number)) {
      return { kind: 'range', label: `${Math.round((collected / (min as number)) * 100)}% to floor`, tone: 'low' }
    }
    if (collected > (max as number)) return { kind: 'range', label: 'over range', tone: 'over' }
    return { kind: 'range', label: 'in range', tone: 'ok' }
  }
  const t = min ?? max
  if (!t || t <= 0) return null
  return { kind: 'pct', pct: Math.round((collected / t) * 100) }
}

/** A facet is only worth showing when there is a choice to make. One value
 *  filters nothing and just takes up room. */
function facetValues(rows: SalesRow[], of: (r: SalesRow) => string | null): string[] {
  const seen = new Map<string, number>()
  for (const r of rows) { const v = of(r); if (v) seen.set(v, (seen.get(v) ?? 0) + 1) }
  return seen.size >= 2 ? [...seen.keys()].sort((a, b) => a.localeCompare(b)) : []
}

const VIEWS_KEY = 'socc-sales-views'
interface SavedView { name: string; bucket: string; q: string; sortBy: string; asc: boolean; clients: string[]; stages: string[] }

export function SalesPipeline({ rows }: { rows: SalesRow[] }) {
  const router = useRouter()
  const params = useSearchParams()

  /* THE URL IS THE STATE. A salesperson could not send anyone "the view I am
     looking at", and a reload lost it — while the analyst list has read seven
     URL params since long before this page existed. Reading from the URL on
     every render rather than mirroring it into useState keeps one source of
     truth; the browser Back button then works on filter changes, which is what
     people expect of a list. */
  const bucket = (params.get('g') ?? 'active') as BucketId | 'all'
  const q = params.get('q') ?? ''
  const sortBy = (params.get('s') ?? 'deliver') as ColId
  const asc = params.get('d') !== 'desc'
  const clients = params.getAll('c')
  const stages = params.getAll('st')

  const setParams = useCallback((mut: (sp: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString())
    mut(next)
    // replace, not push: a filter tweak is not a place in history worth a Back
    // press each. The bucket and search still feel instant.
    router.replace(next.toString() ? `?${next.toString()}` : '?', { scroll: false })
  }, [params, router])

  const setOne = (k: string, v: string | null) =>
    setParams((p: URLSearchParams) => { if (v) p.set(k, v); else p.delete(k) })
  const toggleMulti = (k: string, v: string) => setParams((p: URLSearchParams) => {
    const have = p.getAll(k)
    p.delete(k)
    for (const x of have.includes(v) ? have.filter((h: string) => h !== v) : [...have, v]) p.append(k, x)
  })

  const [visible, setVisible] = useState<ColId[]>(DEFAULT_COLS)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dense, setDense] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])

  // Column choice is personal and remembered in this browser — the same
  // convention as the Operations list, so the two behave alike. Wrapped because
  // localStorage throws outright in some contexts (private windows, blocked site
  // data) rather than merely returning null.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        const known = (JSON.parse(raw) as ColId[]).filter(c => COLS.some(k => k.id === c))
        if (known.length) setVisible(known)
      }
      setDense(localStorage.getItem('socc-sales-dense') === '1')
      const v = localStorage.getItem(VIEWS_KEY)
      if (v) setViews(JSON.parse(v) as SavedView[])
    } catch { /* keep the defaults */ }
  }, [])

  /* Saved views are personal and live in this browser, like the column choice.
     Deliberately NOT a database table: they are one person's habits, nobody
     else reads them, and a table would need a migration, a policy and a view
     for the sales tier to reach it. */
  function saveViews(next: SavedView[]) {
    setViews(next)
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }
  function captureView() {
    const name = window.prompt('Name this view', clients.length === 1 ? clients[0] : 'My view')
    if (!name?.trim()) return
    saveViews([...views.filter(v => v.name !== name.trim()),
      { name: name.trim(), bucket, q, sortBy, asc, clients, stages }])
  }
  function applyView(v: SavedView) {
    setParams((p: URLSearchParams) => {
      p.delete('c'); p.delete('st')
      if (v.bucket === 'active') p.delete('g'); else p.set('g', v.bucket)
      if (v.q) p.set('q', v.q); else p.delete('q')
      if (v.sortBy === 'deliver') p.delete('s'); else p.set('s', v.sortBy)
      if (v.asc) p.delete('d'); else p.set('d', 'desc')
      for (const c of v.clients) p.append('c', c)
      for (const st of v.stages) p.append('st', st)
    })
  }

  function setCols(next: ColId[]) {
    setVisible(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  const counts = useMemo(() => countBuckets(rows), [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = bucket === 'all' ? rows : rows.filter(r => bucketOf(r) === bucket)
    if (clients.length) out = out.filter(r => clients.includes(r.client ?? ''))
    if (stages.length) out = out.filter(r => stages.includes(stageLabel(r.board_column)))
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
  }, [rows, bucket, q, sortBy, asc, clients, stages])

  const cols = COLS.filter(c => visible.includes(c.id))
  // Facets come from the rows in the CURRENT GROUP, not the whole book, so
  // the chips describe what is actually in front of you.
  const inBucket = useMemo(() => bucket === 'all' ? rows : rows.filter(r => bucketOf(r) === bucket), [rows, bucket])
  const facetClients = useMemo(() => facetValues(inBucket, r => r.client ?? null), [inBucket])
  const facetStages = useMemo(() => facetValues(inBucket, r => stageLabel(r.board_column)), [inBucket])
  const hasFilters = clients.length > 0 || stages.length > 0 || q.trim().length > 0

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
            onClick={() => setOne('g', bucket === b.id ? 'all' : b.id)}
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
          onClick={() => setOne('g', 'all')}
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
          onChange={e => setOne('q', e.target.value || null)}
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
        <button
          type="button"
          onClick={() => { const n = !dense; setDense(n); try { localStorage.setItem('socc-sales-dense', n ? '1' : '0') } catch { /* not fatal */ } }}
          title="Tighter rows — more on screen at once"
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-ring hover:text-foreground"
        >
          {dense ? '↕ Comfortable' : '↕ Compact'}
        </button>
        <a
          href={`/sales/surveys/print?${params.toString()}`}
          target="_blank"
          rel="noopener"
          title="Print exactly what is on screen — same group, filters, search and columns"
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-ring hover:text-foreground"
        >
          ⎙ Export
        </a>
        <button
          type="button"
          onClick={captureView}
          title="Save the current group, filters, search and sort under a name"
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-ring hover:text-foreground"
        >
          ☆ Save view
        </button>
      </div>

      {/* FACETS, built from the rows actually loaded and shown only where there
          is a choice to make — a filter listing one value filters nothing. */}
      {(facetClients.length > 0 || facetStages.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {facetClients.map(c => (
            <button key={'c' + c} type="button" onClick={() => toggleMulti('c', c)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                clients.includes(c) ? 'border-primary bg-primary/10 text-foreground'
                                    : 'border-border bg-card text-muted-foreground hover:border-ring'}`}>
              {c}
            </button>
          ))}
          {facetStages.map(st => (
            <button key={'s' + st} type="button" onClick={() => toggleMulti('st', st)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                stages.includes(st) ? 'border-primary bg-primary/10 text-foreground'
                                    : 'border-border bg-card text-muted-foreground hover:border-ring'}`}>
              {st}
            </button>
          ))}
          {(clients.length > 0 || stages.length > 0) && (
            <button type="button" onClick={() => setParams((p: URLSearchParams) => { p.delete('c'); p.delete('st') })}
              className="px-2 py-1 text-xs text-muted-foreground underline hover:text-foreground">
              Clear filters
            </button>
          )}
        </div>
      )}

      {views.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Views</span>
          {views.map(v => (
            <span key={v.name} className="inline-flex items-center overflow-hidden rounded-full border border-border bg-card">
              <button type="button" onClick={() => applyView(v)}
                className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">{v.name}</button>
              <button type="button" aria-label={`Delete view ${v.name}`}
                onClick={() => saveViews(views.filter(x => x.name !== v.name))}
                className="border-l border-border px-1.5 py-1 text-xs text-muted-foreground/60 hover:text-destructive">✕</button>
            </span>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        /* THREE DIFFERENT SITUATIONS, and one message used to cover all of them.
           "You own nothing yet", "this group is empty" and "your filters
           excluded everything" need different words and different ways out — a
           salesperson who cannot tell them apart concludes the tool is broken,
           and on the evidence of a blank list, fairly. */
        <div className="rounded-lg border border-border bg-card px-4 py-4 text-sm">
          {rows.length === 0 ? (
            <>
              <p className="font-medium text-foreground">No surveys on your accounts yet.</p>
              <p className="mt-1 text-muted-foreground">
                Either nothing has been run for them, or your accounts have not been assigned to
                you. Ask David to check — this page shows every survey on the clients you own.
              </p>
            </>
          ) : hasFilters ? (
            <>
              <p className="font-medium text-foreground">Nothing matches these filters.</p>
              <p className="mt-1 text-muted-foreground">
                {fmtNum(rows.length)} surveys are on your accounts;{' '}
                {bucket !== 'all' && <>the <strong>{BUCKETS.find(b => b.id === bucket)?.label ?? bucket}</strong> group, </>}
                {clients.length > 0 && <>{clients.length} account filter{clients.length === 1 ? '' : 's'}, </>}
                {stages.length > 0 && <>{stages.length} stage filter{stages.length === 1 ? '' : 's'}, </>}
                {q.trim() && <>and the search &ldquo;{q.trim()}&rdquo; </>}
                left none.
              </p>
              <button
                type="button"
                onClick={() => setParams((sp: URLSearchParams) => { sp.delete('c'); sp.delete('st'); sp.delete('q'); sp.set('g', 'all') })}
                className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:border-ring"
              >
                Clear everything and show all {fmtNum(rows.length)}
              </button>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">
                Nothing is {(BUCKETS.find(b => b.id === bucket)?.label ?? bucket).toLowerCase()} right now.
              </p>
              <p className="mt-1 text-muted-foreground">
                You have {fmtNum(rows.length)} surveys in other groups — pick another tile above, or All.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {/* Sticky in BOTH axes: the header stays put down 246 rows, and
                    the Survey name stays put across nine columns. Without the pin
                    you scroll right and lose which row you are reading. */}
                <th className="sticky left-0 top-0 z-20 border-b border-border bg-card px-4 py-2.5 text-[11px] font-normal uppercase tracking-widest text-muted-foreground">
                  Survey
                </th>
                {cols.map(c => (
                  <th
                    key={c.id}
                    title={c.title + ' · click to sort'}
                    onClick={() => setParams((p: URLSearchParams) => {
                      // Same column: flip the direction. Different column: sort
                      // by it ascending, because a fresh sort should start at a
                      // predictable end rather than inherit the last one.
                      if (sortBy !== c.id) { p.set('s', c.id); p.delete('d'); return }
                      if (asc) p.set('d', 'desc'); else p.delete('d')
                    })}
                    className={`sticky top-0 z-10 cursor-pointer select-none border-b border-border bg-card px-4 py-2.5 text-[11px] font-normal uppercase tracking-widest text-muted-foreground hover:text-foreground ${c.numeric ? 'text-right' : ''}`}
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
                  <td className={`sticky left-0 z-10 bg-card px-4 ${dense ? 'py-1.5' : 'py-3'}`}>
                    {/* A real link, so right-click and cmd-click work — the
                        standing rule for every hyperlinked element in this app. */}
                    {/* /sales/surveys/, NOT /projects/. app/(app)/layout.tsx redirects
                        role==='sales' to /sales before rendering, so the (app) link
                        bounced the user back to this very list — the one interaction
                        the page offered was a loop. */}
                    <Link href={`/sales/surveys/${r.id}`} className="block font-medium hover:underline">
                      {r.project_name}
                    </Link>
                    {r.project_code && (
                      <span className="block font-mono text-xs text-muted-foreground">{r.project_code}</span>
                    )}
                  </td>
                  {cols.map(c => (
                    <td key={c.id} className={`px-4 ${dense ? 'py-1.5' : 'py-3'} ${c.numeric ? 'text-right font-mono tabular-nums' : ''}`}>
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
      const prog = progressOf(shownN, r.n_target, r.n_target_max)
      const tone =
        prog == null ? ''
        : prog.kind === 'pct'
          ? (prog.pct >= 100 ? 'text-emerald-600 dark:text-emerald-400'
            : prog.pct >= 60 ? 'text-muted-foreground'
            : 'text-amber-600 dark:text-amber-400')
          : (prog.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
            : prog.tone === 'over' ? 'text-sky-600 dark:text-sky-400'
            : 'text-amber-600 dark:text-amber-400')
      return (
        <>
          {fmtNum(shownN)}
          {prog != null && (
            <span className={`ml-1.5 whitespace-nowrap text-xs ${tone}`}>
              {prog.kind === 'pct' ? `${prog.pct}%` : prog.label}
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
