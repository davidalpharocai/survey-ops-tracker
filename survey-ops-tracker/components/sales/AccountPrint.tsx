'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Term } from '@/lib/sales/credits'
import type { DateBasis, Range } from '@/lib/sales/dateRange'
import {
  activityFigures, clientStage, describeRangeForClient, documentTitle, fmtDay, fmtDayLong, footerText, n0, nb,
  noResponseFigureCount, preSendChecks, printedName, statementFigures, timeET, type Glyph,
} from '@/lib/sales/statement'
import { choiceNotes, ledgerColumns, type UrlChoice } from '@/lib/sales/printColumns'
import type { AccountProject } from './AccountDetail'
import { serif, sans } from './print/fonts'
import { statementCss } from './print/statementCss'
import { Masthead, type MetaRow } from './print/Masthead'
import { ContractCluster } from './print/ContractCluster'
import { ActivityCluster } from './print/ActivityCluster'
import { Ledger } from './print/Ledger'
import { Notes, noteNumber, statementNotes, unexplainedMarks } from './print/Notes'
import { PreSendPanel } from './print/PreSendPanel'
import { usePrintWhenReady } from './print/usePrintWhenReady'
import { usePrintChoice } from './print/usePrintChoice'

/**
 * The Survey Activity Statement — the page a salesperson saves as a PDF and
 * sends to a client. Set out like a statement from a prime broker, because
 * that is the kind of document the people reading it already trust.
 *
 * A thin composition. Every figure and phrase comes from lib/sales/statement.ts
 * and every part from components/sales/print/, which the Survey List shares, so
 * the two documents cannot drift apart.
 *
 * TWO SCOPES, each stated where it is used. The contract panel is a fact about
 * the contract in force, over every survey on it (`allRows`). The activity
 * panel and the table follow the reader's date range (`rows`). Mixing them is
 * the bug that turned "35 over" into "46 remaining" on a quarter's export.
 *
 * WHAT PRINTS IS CHOSEN in the pre-send panel (lib/sales/printColumns): every
 * column and section unless turned off, from the link, then the reader's saved
 * default, then everything. Every figure follows ITS OWN column — the ledger,
 * its totals, the activity panel's target and final counts and the notes — so
 * a figure the salesperson turned off is off the whole page, not just the
 * table, and nothing on the page points at something that is not there. The one
 * panel that keeps a figure of its own is the contract summary, which has its
 * own tick and says so in the pre-send panel. The account page's own column
 * picker does not reach the PDF.
 */
export function AccountPrint({
  client, displayName, contact, preparedBy, rows, allRows, undated, notDelivered, basis, range, terms, today,
  generatedAt, neverRecordedIds, printChoice,
}: {
  client: { id: string; name: string; code: string | null }
  /** clients.display_name (migration 122), when saved. */
  displayName: string | null
  /** The account's salesperson, from the salespeople table. */
  contact: { name: string; email: string | null } | null
  /** Who is printing it, by canonical name — never a raw email. */
  preparedBy: string | null
  /** The rows in the selected range — what the table prints. */
  rows: AccountProject[]
  /** Every survey on the account — what the contract position is computed from. */
  allRows: AccountProject[]
  undated: number
  notDelivered: number
  basis: DateBasis
  range: Range
  terms: Term[]
  /** Today in Eastern Time, resolved once on the server. */
  today: string
  /** When the page was drawn, ISO. Printed as "2:43 pm ET". */
  generatedAt: string
  /** Surveys whose n_collected was never recorded (no freshness row). */
  neverRecordedIds: string[]
  /** The link's `cols` and `sections`, parsed (printColumns.parseUrlChoice). */
  printChoice?: UrlChoice
}) {
  const [typed, setTyped] = useState(displayName ?? client.name)
  const { name, set: nameSet } = printedName(typed, displayName, client.name)
  const time = timeET(new Date(generatedAt))
  const ranged = range.from != null || range.to != null
  const never = useMemo(() => new Set(neverRecordedIds), [neverRecordedIds])

  const F = useMemo(() => statementFigures({ rows: allRows, terms, today }), [allRows, terms, today])
  const A = useMemo(() => activityFigures(rows, ranged ? range : null), [rows, ranged, range])
  const termId = F.term?.id ?? null
  const { prints, controls } = usePrintChoice('statement', printChoice ?? {})
  const allNotes = statementNotes({ rows, F, neverRecorded: never, currentTermId: termId, time, today, prints })
  const notes = prints.notes ? allNotes : []
  // A footnote mark only where its note prints: with the notes off, a "1"
  // would point at nothing.
  const fn = {
    unpriced: noteNumber(notes, 'unpriced'),
    final: noteNumber(notes, 'final'),
    offTerm: noteNumber(notes, 'drawn') != null ? '†' : null,
  }
  // Every mark the page would print with nothing left to explain it — the
  // credit figures AND the Final column's estimate and "not recorded", which
  // only the notes account for.
  const cNotes = choiceNotes(prints, {
    unexplained: unexplainedMarks({ rows, neverRecorded: never, prints, notes: allNotes }),
    noResponseFigure: noResponseFigureCount(rows, never),
  })

  const checks = preSendChecks({
    rows: allRows, printed: rows, terms, term: F.term, today, nameSet, internalName: client.name,
    doc: 'statement', mode: 'client', neverRecorded: never, prints,
  })
  const print = usePrintWhenReady(checks.length === 0)

  // Chrome names the saved PDF after the document title.
  const title = documentTitle({ doc: 'statement', mode: 'client', name, today })
  useEffect(() => { document.title = title }, [title])

  const foot = footerText({ doc: 'statement', mode: 'client', name, accounts: 1, today })
  const glyphs = new Set<Glyph>(rows.map(p => clientStage(p).glyph))
  const rangeText = ranged ? nb(describeRangeForClient(basis, range)) : null

  const meta: MetaRow[] = [
    { label: 'Statement date', value: `${fmtDayLong(today)}, ${time}`, strong: true },
    { label: 'Period', value: rangeText ?? 'All studies to date' },
    {
      label: 'Contract in force',
      value: F.term ? `${F.term.name}${F.term.starts_on ? `, from ${fmtDay(F.term.starts_on)}` : ''}` : 'None recorded',
    },
  ]
  if (contact) {
    meta.push({ label: 'Your AlphaROC contact', value: contact.email ? `${contact.name} · ${contact.email}` : contact.name })
  }

  // What the range left out, said out loud: a short table must explain itself.
  let aside = 'In progress by due date, then delivered, most recent first'
  if (ranged) {
    const out: string[] = []
    if (notDelivered > 0) out.push(`${n0(notDelivered)} not yet delivered`)
    if (undated > 0) {
      out.push(basis === 'delivered'
        ? `${n0(undated)} delivered with no delivery date on record`
        : `${n0(undated)} with no ${basis === 'submitted' ? 'submission' : 'launch'} date`)
    }
    aside = `${n0(rows.length)} in the period.${out.length ? ` Not listed: ${out.join(', ')}.` : ''}`
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: statementCss({ footerLeft: foot.left, footerRight: foot.right, footerFont: sans.style.fontFamily }),
      }} />

      <PreSendPanel
        heading={<>Check before sending to {name}</>}
        checks={checks}
        name={{ value: typed, onChange: setTyped, internalName: client.name, saved: displayName }}
        onPrint={print}
        choice={controls}
        choiceNotes={cNotes}
      />

      <article className={`st st-sheet ${serif.variable} ${sans.variable}`} aria-label="Study Activity Statement">
        <Masthead docTitle="Study Activity Statement" preparedFor={name} internalAccounts={null} meta={meta} />

        {(prints.contract || prints.activity) && (
          <section className={`st-summary${prints.contract && prints.activity ? '' : ' st-summary-one'}`} aria-label="Summary">
            {prints.contract && <ContractCluster F={F} fnUnpriced={fn.unpriced} />}
            {prints.activity && (
              <ActivityCluster
                A={A}
                scope={`${rangeText ?? 'All time'} · ${n0(rows.length)} ${rows.length === 1 ? 'study' : 'studies'}`}
                ranged={ranged}
                fnFinal={fn.final}
                glyphs={glyphs}
                status={prints.status}
                target={prints.target}
                final={prints.final}
                credits={prints.credits}
              />
            )}
          </section>
        )}

        <section aria-label="Studies">
          <div className="st-sec">
            <h2>Studies</h2><span className="st-sec-rule" />
            <span className={`st-sec-aside${ranged ? ' st-wrap' : ''}`}>{aside}</span>
          </div>
          <Ledger
            rows={rows}
            grouped
            today={today}
            currentTermId={termId}
            neverRecorded={never}
            totalLabel={(n, credits) =>
              `Total${credits ? ' credits drawn' : ''} · ${ranged ? '' : 'all '}${n0(n)} ${n === 1 ? 'study' : 'studies'} listed`}
            fn={fn}
            columns={ledgerColumns(prints)}
          />
        </section>

        <Notes
          notes={notes}
          sign={{
            left: contact
              ? `Prepared by AlphaROC for ${name}. Questions about this statement or your allowance: ${contact.name}${contact.email ? `, ${contact.email}` : ''}.`
              : `Prepared by AlphaROC for ${name}. Questions about this statement or your allowance: your AlphaROC contact.`,
            right: `Generated ${fmtDay(today)}, ${time}${preparedBy ? ` by ${preparedBy}` : ''}`,
          }}
        />
      </article>
    </>
  )
}
