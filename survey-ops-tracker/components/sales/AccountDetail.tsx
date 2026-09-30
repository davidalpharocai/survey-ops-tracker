'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils/number'
import { bucketOf } from '@/lib/sales/buckets'
import { stageOf } from '@/lib/sales/stage'
import { currentTerm, consumptionFor, rollUp, describeConsumption, type Term } from '@/lib/sales/credits'
import {
  DATE_BASES, PRESETS, rangeFor, filterByRange, describeRange, etDate, todayET,
  type DateBasis, type PresetId, type Range,
} from '@/lib/sales/dateRange'
import { drawnFigure, finalText, responseCells, sortForStatement } from '@/lib/sales/statement'

/**
 * One account: contacts, credit position, and a filterable survey list that can
 * be exported as a PDF.
 *
 * THE FILTER STATE IS THE EXPORT STATE. The date basis and the range are passed
 * to the print route as query parameters, so the statement covers exactly the
 * surveys on screen — David asked for "a pdf with desired columns and filtered
 * data and within a date range", and the only way to keep that promise is for
 * one set of state to drive both. A second filter UI on the export dialog would
 * be a second thing to disagree.
 *
 * The COLUMNS are the exception: the PDF chooses its own in its pre-send panel
 * (David, 2026-09-27; lib/sales/printColumns), everything unless turned off.
 * The picker below shapes this table only.
 *
 * THE CELLS ARE THE PDF'S CELLS. Target and Final come from responseCells and
 * the row order from sortForStatement — the functions the statement prints
 * with. This screen used to show `n_actual ?? n_collected` under "Collected",
 * so a count typed in mid-field read 1,171 here and 1,350 on the PDF under the
 * same word (PR00481, 2026-09-27), and the rows came out in a different order
 * from the document the client reads.
 *
 * COLLECTED IS NOT ON THIS SCREEN. David, 2026-09-28: "remove Collected and
 * only keep the Final (ie Delivered) and Target … we show a delivery estimate
 * vs target on the home page too". The pre-QA field count is an operations
 * number, and a salesperson reading it beside Final has two response counts and
 * no rule for which to quote. The STATEMENT no longer offers it either: it was
 * deleted from the print model on 2026-09-29 — David: "i dont want to risk a
 * sales person sending it" — so there is now no surface, screen or document,
 * on which a salesperson meets a pre-QA field count.
 */

export interface AccountProject {
  id: string
  project_code: string | null
  project_name: string
  board_column: string
  status: string
  phase: string
  /** Read by stageOf for a Scoping survey. Without it the list falls back to
   *  the bare word "Scoping" while the detail page shows the sub-stage. */
  scoping_stage?: string | null
  n_target: number | null
  n_target_max: number | null
  n_collected: number
  n_actual: number | null
  credits: number | null
  /** Which contract the credits draw from. Read by consumptionFor. */
  term_id?: string | null
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

type ColId = 'code' | 'survey' | 'requested' | 'stage' | 'target' | 'final' | 'credits' | 'submitted' | 'deliver'

/** Columns this table has offered and no longer does. Read by savedCols, which
 *  is the only place a stored id can still name one. */
const RETIRED_COLS = ['collected'] as const

// `hint` is each header's explainer (shown as its tooltip).
export const ACCOUNT_COLS: { id: ColId; label: string; hint: string; numeric?: boolean }[] = [
  { id: 'code', label: 'Code', hint: 'The study’s AlphaROC reference code.' },
  { id: 'survey', label: 'Study', hint: 'The study’s name, and the audience after the dash.' },
  { id: 'requested', label: 'Requested by', hint: 'The person at the client who asked for this study.' },
  { id: 'stage', label: 'Stage', hint: 'Where the study is in the pipeline today.' },
  { id: 'target', label: 'Target', numeric: true, hint: 'Responses agreed with the client. A range sold shows as lowest–highest.' },
  { id: 'final', label: 'Final', numeric: true, hint: 'Responses delivered after quality review, as the PDF prints them. Only a delivered study has a final count; “≈ … est.” is an estimate while a study is in quality review, and a dash means none yet.' },
  { id: 'credits', label: 'Credits', numeric: true, hint: 'Credits the study is priced at. A dash means not priced yet, which is not the same as zero.' },
  { id: 'submitted', label: 'Submitted', hint: 'The day the request came in.' },
  { id: 'deliver', label: 'Delivered', hint: 'The day a delivered study went out, in US Eastern Time. A study not yet delivered shows its due date, marked “due”.' },
]

// Target takes the slot Collected had. David asked for "the Final (ie
// Delivered) and Target", and Final without Target is a count with nothing to
// check it against — the same reason the statement's pre-send panel warns when
// those two ticks disagree (printColumns.choiceNotes).
const DEFAULT_COLS: ColId[] = ['code', 'survey', 'requested', 'stage', 'target', 'final', 'credits', 'deliver']
const STORE_KEY = 'socc-sales-account-columns-v2'
const STORE_KEY_V1 = 'socc-sales-account-columns'

/**
 * A saved column choice, or null.
 *
 * TWO REMOVALS, ONE RULE: a stored id that named Collected is replaced by
 * Final, never just dropped. Dropping it would take the response count off a
 * table its reader had deliberately set up to show one — and under v1
 * "collected" WAS the final figure on a delivered survey, while under v2 a
 * reader could perfectly well tick Collected and untick Final. Final is the
 * count that survives, and the one the client's own statement leads with.
 *
 * Target is NOT forced on by this: it is a different question ("what did they
 * buy"), it was never what Collected meant, and inventing a tick the reader
 * never made is not a migration. It is in DEFAULT_COLS instead, so everybody
 * who has not opened the picker gets it.
 *
 * NO NEW STORAGE KEY for the removal. The retired id is its own version
 * marker — a choice written since the column went cannot contain it — so the
 * substitution is idempotent, fires at most once per stored value, and the
 * first save afterwards writes the id away for good.
 */
function savedCols(): ColId[] | null {
  const migrate = (xs: unknown): ColId[] | null => {
    if (!Array.isArray(xs)) return null
    // Before the ids are checked against ACCOUNT_COLS, not after: `collected`
    // is no longer a known id, so a test made downstream of that filter could
    // never fire.
    const ticked = new Set(xs.filter((c): c is string => typeof c === 'string'))
    if (RETIRED_COLS.some(c => ticked.has(c))) ticked.add('final')
    // In the order the table renders, so two choices meaning the same thing
    // are the same array.
    const v = ACCOUNT_COLS.map(c => c.id).filter(id => ticked.has(id))
    return v.length ? v : null
  }
  const v2 = localStorage.getItem(STORE_KEY)
  if (v2) return migrate(JSON.parse(v2))
  const v1 = localStorage.getItem(STORE_KEY_V1)
  return v1 ? migrate(JSON.parse(v1)) : null
}

/**
 * One cell's text. `neverRecorded` is true when the survey's N collected has
 * never been entered (no row in the freshness view, migration 111).
 *
 * It is still passed although no column on this table reads it today: it was
 * Collected's argument, and responseCells is the STATEMENT's function, shared.
 * Handing it the truthful value keeps this screen's cells identical to the
 * printed ones, so if the never-recorded rule ever reaches Target or Final the
 * table inherits it instead of quietly disagreeing with the PDF again.
 */
export function cellFor(p: AccountProject, id: ColId, neverRecorded = false): string {
  switch (id) {
    case 'code': return p.project_code ?? '—'
    case 'survey': return p.project_name
    case 'requested': return p.requested_by_name ?? '—'
    case 'stage': return stageOf(p)
    case 'target': return responseCells(p, neverRecorded).target ?? '—'
    case 'final': {
      const f = responseCells(p, neverRecorded).final
      return f.kind === 'estimate' ? `${finalText(f)} est.` : finalText(f)
    }
    // Blank, never 0. A survey with no credit figure is unpriced, and printing
    // "0" on a page the client reads asserts it was free.
    case 'credits': return p.credits == null ? '—' : fmtNum(p.credits)
    case 'submitted': return p.submitted_date ?? '—'
    // A delivered survey shows the day it was delivered, in Eastern Time — the
    // same day the PDF prints. Slicing the UTC timestamp put anything delivered
    // after 8pm ET on the next day. One still in flight shows its PROMISED date,
    // marked as such: a bare date under "Delivered" read as work that had gone
    // out when it had not.
    case 'deliver':
      if (bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column }) === 'delivered') {
        return etDate(p.delivered_at) ?? p.deliver_date ?? '—'
      }
      return p.deliver_date ? `due ${p.deliver_date}` : '—'
  }
}

export function AccountDetail({
  client, projects, contacts, terms, neverRecordedIds,
}: {
  client: { id: string; name: string; code: string | null; salesperson: string | null; created_at: string }
  projects: AccountProject[]
  contacts: AccountContact[]
  terms: Term[]
  /** Surveys whose N collected was never recorded (no freshness row). Empty
   *  when freshness could not be read — a failed read marks nothing. */
  neverRecordedIds: string[]
}) {
  const [basis, setBasis] = useState<DateBasis>('delivered')
  const [preset, setPreset] = useState<PresetId>('all')
  const [custom, setCustom] = useState<Range>({ from: null, to: null })
  const [showCols, setShowCols] = useState(false)
  const [cols, setCols] = useState<ColId[]>(() => {
    // localStorage throws outright in some contexts (private windows, blocked
    // site data), so every read and write is guarded.
    try { return savedCols() ?? DEFAULT_COLS } catch { return DEFAULT_COLS }
  })
  const never = useMemo(() => new Set(neverRecordedIds), [neverRecordedIds])

  function toggleCol(id: ColId) {
    const next = cols.includes(id) ? cols.filter(c => c !== id) : [...ACCOUNT_COLS.map(c => c.id).filter(c => cols.includes(c) || c === id)]
    if (next.length === 0) return  // never let the table become columnless
    setCols(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  // Today, resolved once per render rather than inside rangeFor, so the filter
  // and the export header cannot straddle midnight differently. In EASTERN
  // time, as the PDF is: the browser's own zone put a Pacific reader and a
  // London reader on different quarters on the evening of 30 September.
  const today = todayET()
  const range = useMemo(() => rangeFor(preset, today, custom), [preset, today, custom])
  // In the statement's order, so the rows a salesperson looks at and the rows
  // the client reads come out the same way round.
  const { rows, undated, notDelivered } = useMemo(() => {
    const r = filterByRange(projects, basis, range)
    return { ...r, rows: sortForStatement(r.rows) }
  }, [projects, basis, range])

  const buckets = useMemo(() => {
    const b: Record<string, number> = {}
    for (const p of rows) {
      const k = bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column })
      b[k] = (b[k] ?? 0) + 1
    }
    return b
  }, [rows])

  // The position against the IN-FORCE term, over every survey attached to it —
  // the same arithmetic the accounts list uses, so two sales screens cannot
  // disagree about one account. The previous version summed credits_total
  // across every term the account ever had and divided the DATE-FILTERED
  // surveys by it: period numerator, lifetime denominator. Measured live on
  // DE Shaw, 2026-09-23: "35 OVER the allowance" at All time became "46
  // remaining" at This quarter, bar blue instead of red, with nothing changed
  // but the range. AccountPrint ran the identical two lines, so that sentence
  // was going out as a PDF. The comment that stood here said the opposite of
  // what the code did, which is how it survived review.
  //
  // With no in-force term there is no allowance to divide by, and rollUp with
  // a null total says so rather than inventing one.
  const term = useMemo(() => currentTerm(terms, today), [terms, today])
  const credits = useMemo(
    () => (term ? consumptionFor(term, projects) : rollUp(projects, null)),
    [term, projects])
  // What the selected range actually drew — its own line, no denominator, so a
  // period's usage is never presented as a share of a lifetime allowance. It
  // carries "At least" on the same rule as the PDF's period line: only when an
  // unpriced survey in the range has drawn.
  const inRange = useMemo(() => rollUp(rows, null), [rows])

  // No `cols`: the PDF has its own choice of what prints, starting from the
  // reader's saved default (lib/sales/printColumns), so the picker shapes this
  // table only.
  const exportUrl = `/sales/accounts/${client.id}/print?basis=${basis}&preset=${preset}` +
    (preset === 'custom' ? `&from=${custom.from ?? ''}&to=${custom.to ?? ''}` : '')

  // Why the table is shorter than the account, in two parts on the delivered
  // basis: work not yet delivered is not a missing record, and a delivered
  // survey with no date is. They need different fixes, so they are counted
  // apart.
  const excluded: { text: string; title: string }[] = []
  if (basis === 'delivered') {
    if (notDelivered > 0) excluded.push({
      text: `${notDelivered} not yet delivered`,
      title: 'Still in progress, on hold or stopped, so not part of what was delivered in this range.',
    })
    if (undated > 0) excluded.push({
      text: `${undated} with no delivered date`,
      title: 'Delivered, but the record carries no delivery date, so it cannot fall inside a date range.',
    })
  } else if (undated > 0) {
    excluded.push({
      text: `${undated} excluded for having no ${basis} date`,
      title: `These have no ${basis} date, so they cannot fall inside a date range.`,
    })
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-semibold">{client.name}</h1>
        {client.code && <span className="text-sm text-muted-foreground">{client.code}</span>}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {fmtNum(projects.length)} {projects.length === 1 ? 'study' : 'studies'} all time
        {contacts.length > 0 && ` · ${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
      </p>

      {/* ---- Credits ---- */}
      <section className="mb-5 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 flex items-baseline justify-between text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <span>Credits</span>
          {terms.length > 0 && (
            <span className="normal-case tracking-normal">
              {term ? `${term.name} (current)` : terms.map(t => t.name).join(', ')}
            </span>
          )}
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
        {preset !== 'all' && (
          <p className="mt-1 text-xs text-muted-foreground">
            {drawnFigure(inRange).kind === 'unknown'
              // Nothing priced has drawn in the range: "At least 0" would read
              // as "nothing used". The PDF says "Not yet priced" here too.
              ? `Credits drawn by the studies in this range are not known yet — ${inRange.unpricedDrawn} of them ${
                  inRange.unpricedDrawn === 1 ? 'has' : 'have'} drawn credits and ${inRange.unpricedDrawn === 1 ? 'is' : 'are'} not yet priced.`
              : <>
                  {inRange.isFloor ? 'At least ' : ''}{fmtNum(inRange.used)} credit{inRange.used === 1 ? '' : 's'} drawn by the studies in this range
                  {inRange.unpricedDrawn > 0 && ` — ${inRange.unpricedDrawn} of them not yet priced`}.
                </>}
          </p>
        )}
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
          title="Opens the Study Activity Statement for this account and date range, ready to save as a PDF. It prints every column unless you, or your saved default, turn one off in its own “What prints” box. The columns chosen here do not carry over."
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Export PDF
        </a>
      </div>

      {/* The filter, stated. A table whose row count moved without saying why is
          how somebody reports a quiet shortfall as a real one. */}
      <p className="mb-3 text-xs text-muted-foreground">
        {describeRange(basis, range)} · {fmtNum(rows.length)} of {fmtNum(projects.length)} studies
        {excluded.map(x => (
          <span key={x.text} title={x.title}>{' '}· {x.text}</span>
        ))}
        {Object.keys(buckets).length > 0 && (
          <>
            {' · '}
            {/* All SIX, not four. Cancelled and archived rows are in the count
                printed just above, so leaving them out of the breakdown makes
                the parts fail to sum to the whole — which is the one property
                that makes a breakdown worth reading. */}
            {([['active', 'active'], ['scoping', 'scoping'], ['delivered', 'delivered'],
               ['hold', 'on hold'], ['cancelled', 'cancelled'], ['archived', 'archived']] as const)
              .filter(([k]) => buckets[k])
              .map(([k, label]) => `${buckets[k]} ${label}`)
              .join(', ')}
          </>
        )}
      </p>

      {/* ---- Surveys ---- */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No studies match this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                {ACCOUNT_COLS.filter(c => cols.includes(c.id)).map(c => (
                  <th key={c.id} title={c.hint} className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}>{c.label}</th>
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
                        cellFor(p, c.id, never.has(p.id))
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
