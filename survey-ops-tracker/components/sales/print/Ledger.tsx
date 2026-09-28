import type { ReactNode } from 'react'
import {
  clientStage, creditCell, drawnFigure, drawnUnpricedPhrase, GROUP_LABEL, ledgerTotals, n0, NBSP, nb,
  NOT_YET_PRICED, responseCells, sortForStatement, splitTitle, statusWhen,
  type LedgerTotals, type StageGroup, type StatementRow,
} from '@/lib/sales/statement'
import { PRINT_COLUMNS, type PrintColumnId } from '@/lib/sales/printColumns'
import { BelowMark, Fn, StatusGlyph } from './StatusGlyph'

/**
 * The survey table, shared by both documents so they cannot drift.
 *
 * THE COLUMNS ARE CHOSEN, not fixed (David, 2026-09-27; lib/sales/printColumns
 * holds the rules). Ref. and "Survey and audience" always print — a row
 * without them matches nothing. Every other column is on unless the
 * salesperson turned it off, and the rest of the table follows:
 *
 *   - Totals follow the columns. No Target subtotal when Target is off, no
 *     credit total when Credits is off, and a subtotal or total row that would
 *     hold no figure at all is left out rather than printed empty.
 *   - The "Responses" spanner covers only the response columns that print, and
 *     disappears — taking the second header row with it — once it has fewer
 *     than two to cover.
 *   - A group heading counts its rows, and spells the live stages out ("2 in
 *     field, 2 in design") only while the Status column prints: those are its
 *     words, and over a one-row group they give that row's stage exactly.
 *   - Widths redistribute: every optional column has a fixed width and the
 *     survey column takes whatever is left, so any subset fills the page width
 *     and none can push past it.
 *
 * Structure: a head with the spanner over Target | Final | Collected; one
 * <tbody> per group (in progress, delivered, paused or stopped); a subtotal per
 * group only when there is more than one; and the grand total INSIDE the last
 * tbody, where `break-before: avoid` can bind it, so it is never stranded alone
 * at the top of a page.
 *
 * No Collected subtotal: collection mixes surveys that are finished with
 * surveys that are not, and a sum of the two is a number about nothing.
 */
const GROUPS: StageGroup[] = ['progress', 'delivered', 'stopped']

/** Every optional column, in print order — the system default. */
const ALL_COLUMNS: PrintColumnId[] = PRINT_COLUMNS.map(c => c.id)

/** Colgroup class and header text per optional column. */
const COL: Record<PrintColumnId, { cls: string; head: string }> = {
  account: { cls: 'c-acct', head: 'Account' },
  requested: { cls: 'c-req', head: 'Requested by' },
  status: { cls: 'c-status', head: 'Status' },
  target: { cls: 'c-tgt', head: 'Target' },
  final: { cls: 'c-fin', head: 'Final' },
  collected: { cls: 'c-coll', head: 'Collected' },
  credits: { cls: 'c-cr', head: 'Credits' },
}
const RESPONSE: PrintColumnId[] = ['target', 'final', 'collected']
const NUMERIC: PrintColumnId[] = ['target', 'final', 'collected', 'credits']

function creditSubnotes(t: LedgerTotals, rows: StatementRow[]): string[] {
  const out: string[] = []
  const is = (k: number) => (k === 1 ? 'is' : 'are')
  if (t.unpricedDrawn) out.push(`${drawnUnpricedPhrase(rows)} ${is(t.unpricedDrawn)} not yet priced`)
  if (t.committed) {
    out.push(`a further ${n0(t.committed)} ${is(t.committed)} committed on ${n0(t.committedCount)} ${
      t.committedCount === 1 ? 'survey' : 'surveys'} not yet in field, and not counted as drawn`)
  }
  if (t.unpricedUndrawn) {
    out.push(`the ${n0(t.unpricedUndrawn)} not yet priced ${is(t.unpricedUndrawn)} not yet in field, so ${
      t.unpricedUndrawn === 1 ? 'it has' : 'they have'} drawn nothing`)
  }
  return out
}

/** Which surveys the Target and Final totals are over, naming only the
 *  columns that print. Null when neither prints. */
function pairedNote(n: number, target: boolean, final: boolean): string | null {
  if (target && final) return `Target and Final: the ${n0(n)} surveys with both.`
  if (target) return `Target: the ${n0(n)} surveys with both a target and a final count.`
  if (final) return `Final: the ${n0(n)} surveys with both a target and a final count.`
  return null
}

/** A subtotal or total of credits drawn, by drawnFigure's one rule: exact,
 *  "at least N", or "Not yet priced" where nothing priced has drawn — never
 *  "at least 0". */
function Drawn({ t, fn }: { t: LedgerTotals; fn: ReactNode }) {
  const f = drawnFigure(t)
  if (f.kind === 'unknown') return <span className={`st-na${fn ? '' : ' st-edge'}`}>{NOT_YET_PRICED}{fn}</span>
  return <>{f.kind === 'floor' && <span className="st-q">at least</span>}{n0(f.value)}</>
}

const Dash = () => <span className="st-dash">—</span>

export function Ledger({
  rows, grouped, accountCol = false, accountNameById, today, currentTermId, neverRecorded, totalLabel, fn,
  columns = ALL_COLUMNS,
}: {
  rows: StatementRow[]
  /** Group into in progress / delivered / stopped. The list prints ungrouped. */
  grouped: boolean
  /** Internal mode: the document HAS an Account column, named from
   *  sales_clients by client_id. Whether it prints is `columns`' call. */
  accountCol?: boolean
  accountNameById?: Record<string, string>
  today: string
  currentTermId: string | null
  /** Rows whose n_collected was never recorded (no freshness row). */
  neverRecorded: Set<string>
  /** The total row's label. `credits` is whether the credit total prints
   *  beside it, so the label never promises a figure that is not there. */
  totalLabel: (n: number, credits: boolean) => string
  /** Footnote marks, each null when the note it points to does not print. */
  fn: { unpriced: number | null; final: number | null; offTerm?: string | null }
  /** The optional columns to print (printColumns.ledgerColumns). Everything by
   *  default. */
  columns?: PrintColumnId[]
}) {
  if (rows.length === 0) {
    return <p className="st-empty">No surveys match this selection.</p>
  }

  const shown = ALL_COLUMNS.filter(id => columns.includes(id) && (id !== 'account' || accountCol))
  const has = (id: PrintColumnId) => shown.includes(id)
  const responses = shown.filter(id => RESPONSE.includes(id))
  const numeric = shown.filter(id => NUMERIC.includes(id))
  // The spanner groups columns, so it needs two to group. Over a single one it
  // is also wider than the column it labels — "Responses" measures 54px at this
  // size and the response columns are 45–51px — and a header that does not fit
  // its column pushes the table past the edge of the paper. The column's own
  // header says the same thing in the space there is.
  const spanner = responses.length > 1
  const headRows = spanner ? 2 : 1
  const cols = 2 + shown.length
  // The label cell of a subtotal or total spans everything left of the first
  // figure column (numeric columns always print last, in NUMERIC order).
  const labelSpan = cols - numeric.length

  const sorted = sortForStatement(rows)
  const groups = (grouped ? GROUPS : [null])
    .map(k => ({ k, rows: k ? sorted.filter(p => clientStage(p).group === k) : sorted }))
    .filter(g => g.rows.length > 0)
  const all = ledgerTotals(sorted)
  const unpricedFn = fn.unpriced != null ? <Fn n={fn.unpriced} /> : null
  const offTermMark = fn.offTerm === undefined ? '†' : fn.offTerm

  // A subtotal carries Target, Final and credits; Collected never has one. A
  // row with none of those printing would be a label over nothing.
  const subtotals = grouped && groups.length > 1 && (has('target') || has('final') || has('credits'))
  // The total carries credits, and Target and Final only when there is one
  // group (with several, the subtotals hold them). Left out when it would hold
  // no figure: the section heading already counts the surveys.
  const pairedInTotal = groups.length === 1 && all.pairedN > 0 && (has('target') || has('final'))
  const showTotal = has('credits') || pairedInTotal

  function row(p: StatementRow) {
    const st = clientStage(p)
    const [title, aud] = splitTitle(p.project_name)
    const when = statusWhen(p, today)
    const r = responseCells(p, neverRecorded.has(p.id))
    const cr = creditCell(p, currentTermId)
    return (
      <tr key={p.id}>
        <td className="st-ref">{p.project_code ?? <Dash />}</td>
        <td>
          <span className="st-title">{title}</span>
          {aud && <span className="st-aud">{aud}</span>}
        </td>
        {has('account') && (
          <td className="st-acct">{(p.client_id && accountNameById?.[p.client_id]) || <Dash />}</td>
        )}
        {has('requested') && <td>{p.requested_by_name ? p.requested_by_name : <Dash />}</td>}
        {has('status') && (
          <td>
            <div className="st-st">
              <StatusGlyph kind={st.glyph} />
              {st.label}
              {when && <span className="st-when">{nb(when)}</span>}
            </div>
          </td>
        )}
        {has('target') && <td className="r">{r.target ?? <Dash />}</td>}
        {has('final') && (
          <td className="r">
            {r.final.kind === 'final' && (
              <span className="st-final">{r.final.below && <BelowMark />}{n0(r.final.value)}</span>
            )}
            {r.final.kind === 'not-recorded' && (
              <span className={`st-na${fn.final != null ? '' : ' st-edge'}`}>not recorded{fn.final != null && <Fn n={fn.final} />}</span>
            )}
            {r.final.kind === 'estimate' && (
              <span className="st-est">≈{NBSP}{n0(r.final.value)}<span className="st-est-tag">est.</span></span>
            )}
            {r.final.kind === 'none' && <Dash />}
          </td>
        )}
        {has('collected') && (
          <td className="r">{r.collected == null ? <Dash /> : <span className="st-coll">{n0(r.collected)}</span>}</td>
        )}
        {has('credits') && (
          <td className="r">
            {cr.kind === 'unpriced' && <span className={`st-na${unpricedFn ? '' : ' st-edge'}`}>Not yet priced{unpricedFn}</span>}
            {cr.kind === 'committed' && <span className="st-committed st-edge">{n0(cr.credits)} committed</span>}
            {cr.kind === 'drawn' && <>{n0(cr.credits)}{cr.offTerm && offTermMark && <Fn n={offTermMark} />}</>}
          </td>
        )}
      </tr>
    )
  }

  /** One figure cell per numeric column that prints, in order. */
  function figures(cells: Partial<Record<PrintColumnId, ReactNode>>) {
    return numeric.map(id => <td key={id} className={id === 'collected' ? undefined : 'r'}>{cells[id] ?? null}</td>)
  }

  return (
    <div className="st-scroll">
      <table className={`st-ledger${has('account') ? ' has-acct' : ''}`}>
        <colgroup>
          <col className="c-ref" />
          <col />
          {shown.map(id => <col key={id} className={COL[id].cls} />)}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={headRows} scope="col">Ref.</th>
            <th rowSpan={headRows} scope="col">Survey and audience</th>
            {shown.filter(id => !RESPONSE.includes(id) && id !== 'credits').map(id => (
              <th key={id} rowSpan={headRows} scope="col">{COL[id].head}</th>
            ))}
            {spanner
              ? <th colSpan={responses.length} scope="colgroup" className="st-span">Responses</th>
              : responses.map(id => <th key={id} scope="col" className="r">{COL[id].head}</th>)}
            {has('credits') && <th rowSpan={headRows} scope="col" className="r">Credits</th>}
          </tr>
          {spanner && (
            <tr>
              {responses.map(id => <th key={id} scope="col" className="r">{COL[id].head}</th>)}
            </tr>
          )}
        </thead>
        {groups.map((g, gi) => {
          const t = ledgerTotals(g.rows)
          const isLast = gi === groups.length - 1
          const label = g.k ? GROUP_LABEL[g.k] : ''

          // "4 surveys · 2 in field, 2 in design" — the live stages spelled out,
          // because "in progress" alone hides whether anything is collecting.
          // Only while the Status column prints: these are its words, and over a
          // one-row group they name that row's stage exactly.
          let detail = ''
          if (g.k === 'progress' && has('status')) {
            const byLabel = new Map<string, number>()
            for (const p of g.rows) {
              const l = clientStage(p).label
              byLabel.set(l, (byLabel.get(l) ?? 0) + 1)
            }
            detail = ' · ' + [...byLabel].map(([l, n]) => `${n0(n)} ${l.toLowerCase()}`).join(', ')
          }

          const subNotes: string[] = []
          if (g.k === 'delivered' && t.pairedN) {
            const note = pairedNote(t.pairedN, has('target'), has('final'))
            if (note) subNotes.push(note)
          }
          if (has('credits')) subNotes.push(...creditSubnotes(t, g.rows).map(s => `Credits: ${s}.`))

          const totNotes: string[] = []
          if (pairedInTotal) {
            const note = pairedNote(all.pairedN, has('target'), has('final'))
            if (note) totNotes.push(note)
          }
          if (has('credits') && all.unpricedDrawn) {
            const one = all.unpricedDrawn === 1
            totNotes.push(drawnFigure(all).kind === 'unknown'
              ? `Not known yet: ${drawnUnpricedPhrase(sorted)} ${one ? 'has' : 'have'} drawn credits and ${one ? 'is' : 'are'} not yet priced.`
              : `At least, because ${drawnUnpricedPhrase(sorted)} ${one ? 'is' : 'are'} not yet priced.`)
          }
          if (has('credits') && all.committed) {
            totNotes.push(`A further ${n0(all.committed)} ${all.committed === 1 ? 'credit is' : 'credits are'} committed and not counted as drawn.`)
          }

          return (
            <tbody key={g.k ?? 'all'}>
              {grouped && g.k && (
                <tr className="st-grp">
                  <td colSpan={cols}>
                    <b>{label}</b>
                    <span>{n0(g.rows.length)} {g.rows.length === 1 ? 'survey' : 'surveys'}{detail}</span>
                  </td>
                </tr>
              )}
              {g.rows.map(row)}
              {subtotals && (
                <tr className="st-sub">
                  <td colSpan={labelSpan}>
                    Total {label.toLowerCase()}
                    {subNotes.length > 0 && <span className="st-subnote">{subNotes.join(' ')}</span>}
                  </td>
                  {figures({
                    target: g.k === 'delivered' ? n0(t.target) : t.targetAll ? n0(t.targetAll) : '',
                    final: g.k === 'delivered' ? n0(t.final) : <Dash />,
                    credits: <Drawn t={t} fn={unpricedFn} />,
                  })}
                </tr>
              )}
              {isLast && showTotal && (
                <tr className="st-total">
                  <td colSpan={labelSpan}>
                    {totalLabel(sorted.length, has('credits'))}
                    {totNotes.length > 0 && <span className="st-subnote">{totNotes.join(' ')}</span>}
                  </td>
                  {figures({
                    target: pairedInTotal ? n0(all.target) : '',
                    final: pairedInTotal ? n0(all.final) : '',
                    credits: <Drawn t={all} fn={unpricedFn} />,
                  })}
                </tr>
              )}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
