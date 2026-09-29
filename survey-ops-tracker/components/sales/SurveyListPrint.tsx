'use client'

import { useEffect, useMemo, useState } from 'react'
import { currentTerm, type Term } from '@/lib/sales/credits'
import type { DateBasis, Range } from '@/lib/sales/dateRange'
import {
  activityFigures, clientStage, describeRangeForClient, documentTitle, fmtDayLong, fmtDay, footerText, listNames,
  estimatedCount, n0, nb, noResponseFigureCount, preSendChecks, printedName, showingLabel, timeET, type StatementRow,
} from '@/lib/sales/statement'
import { serif, sans } from './print/fonts'
import { statementCss } from './print/statementCss'
import { Masthead, type MetaRow } from './print/Masthead'
import { ListStrip } from './print/ListStrip'
import { Ledger } from './print/Ledger'
import { Notes, noteNumber, listNotes, unexplainedMarks } from './print/Notes'
import { PreSendPanel } from './print/PreSendPanel'
import { usePrintWhenReady } from './print/usePrintWhenReady'
import { usePrintChoice } from './print/usePrintChoice'
import { choiceNotes, ledgerColumns, type UrlChoice } from '@/lib/sales/printColumns'

/**
 * The printed survey list — the same parts as the Survey Activity Statement,
 * so the two documents look and count alike.
 *
 * CLIENT OR INTERNAL, decided by the selection, not by a checkbox. Exactly one
 * account selected: a client document, "Prepared for" that account. None, or
 * more than one: it covers several clients' work, so it prints marked Internal
 * — in the letterhead, in a band above it and in every page footer — gains an
 * Account column, and never says "Prepared for". Account names come from
 * sales_clients by client_id; for an account the reader works on without
 * owning, which sales_clients does not return, from the shortest of that
 * account's survey labels (accountNameOf), exactly as the screen names it.
 *
 * STATES ITS OWN FILTER: the group, the dates, any stage chips and the search,
 * each printed only when set. "Everything delivered last quarter" and
 * "everything ACTIVE delivered last quarter" are different documents that look
 * identical once printed.
 *
 * WHAT PRINTS IS CHOSEN, as on the statement (lib/sales/printColumns), with its
 * own saved default: a list and a statement are different documents, and a
 * salesperson who drops Requested by from lists may still want it on statements.
 * Every figure follows its own column, the summary strip included, so a column
 * turned off is off the whole page.
 */
export type ListRow = StatementRow & { client_id: string | null }

const BASIS_WORD: Record<DateBasis, string> = { delivered: 'delivery', submitted: 'submission', launched: 'launch' }

export function SurveyListPrint({
  rows, totalBeforeDates, undated, notDelivered, basis, range, bucket, stages, search, mode, account, selectedCount,
  selectedNames, accountNameById, bookOwner, contact, terms, preparedBy, today, generatedAt, neverRecordedIds,
  printChoice,
}: {
  rows: ListRow[]
  totalBeforeDates: number
  undated: number
  notDelivered: number
  basis: DateBasis
  range: Range
  bucket: string
  /** Stage chips, already in client words. */
  stages: string[]
  search: string
  mode: 'client' | 'internal'
  /** Client mode: the one account, with its saved display name when 122 is
   *  applied. `own` is false for an account the reader works on without owning
   *  it (named as salesperson on its surveys): it is not in sales_clients, so
   *  its name comes from the survey records and it has no saved name. */
  account: { id: string; name: string; displayName: string | null; own: boolean } | null
  /** How many accounts the URL selected (0 = the whole book). */
  selectedCount: number
  /** Internal mode: the selected accounts' names. */
  selectedNames: string[]
  accountNameById: Record<string, string>
  /** Whose book this is, for "Alex Pinsky's book, all accounts". */
  bookOwner: string | null
  contact: { name: string; email: string | null } | null
  /** Client mode: the account's contracts, for the before-the-contract check. */
  terms: Term[]
  preparedBy: string | null
  today: string
  generatedAt: string
  neverRecordedIds: string[]
  /** The link's `cols` and `sections`, parsed (printColumns.parseUrlChoice). */
  printChoice?: UrlChoice
}) {
  const internalName = account?.name ?? ''
  const [typed, setTyped] = useState(account?.displayName ?? internalName)
  const { name, set: nameSet } = printedName(typed, account?.displayName, internalName)
  const time = timeET(new Date(generatedAt))
  const ranged = range.from != null || range.to != null
  const never = useMemo(() => new Set(neverRecordedIds), [neverRecordedIds])
  const accounts = useMemo(() => new Set(rows.map(r => r.client_id ?? '(none)')).size, [rows])
  const internal = mode === 'internal'

  const A = useMemo(() => activityFigures(rows, ranged ? range : null), [rows, ranged, range])
  const { prints, controls } = usePrintChoice('list', printChoice ?? {}, { internal })
  const allNotes = listNotes({ rows, neverRecorded: never, internalAccounts: internal ? accounts : null, time, today, prints })
  const notes = prints.notes ? allNotes : []
  // A footnote mark only where its note prints.
  const fn = { unpriced: noteNumber(notes, 'unpriced'), final: noteNumber(notes, 'final') }
  // Every mark the page would print with nothing left to explain it — the
  // credit figures AND the Final column's estimate and "not recorded", which
  // only the notes account for.
  const cNotes = choiceNotes(prints, {
    unexplained: unexplainedMarks({ rows, neverRecorded: never, prints, notes: allNotes }),
    noResponseFigure: noResponseFigureCount(rows, never, { estimate: prints.estimate }),
    estimated: estimatedCount(rows, never),
  })

  const term = internal ? null : currentTerm(terms, today)
  const checks = preSendChecks({
    rows, terms: internal ? [] : terms, term, today, nameSet, internalName, doc: 'list', mode, accounts,
    neverRecorded: never, prints,
  })
  const print = usePrintWhenReady(checks.length === 0)

  const title = documentTitle({ doc: 'list', mode, name, today })
  useEffect(() => { document.title = title }, [title])

  const foot = footerText({ doc: 'list', mode, name, accounts, today })
  const rangeText = ranged ? nb(describeRangeForClient(basis, range)) : null
  const allDelivered = rows.length > 0 && rows.every(p => clientStage(p).group === 'delivered')

  const meta: MetaRow[] = [
    { label: 'List date', value: `${fmtDayLong(today)}, ${time}`, strong: true },
    { label: 'Showing', value: showingLabel(bucket) },
  ]
  if (internal) {
    meta.push({
      label: 'Accounts',
      value: selectedNames.length ? listNames(selectedNames)
        : bookOwner ? `${bookOwner}’s book, all accounts` : 'All accounts',
    })
    meta.push({ label: 'Dates', value: rangeText ?? 'All' })
  } else if (rangeText) {
    meta.push({ label: 'Dates', value: rangeText })
  }
  if (stages.length) meta.push({ label: 'Stages', value: listNames(stages) })
  if (search) meta.push({ label: 'Search', value: `“${search}”` })
  if (!internal && contact) {
    meta.push({ label: 'Your AlphaROC contact', value: contact.email ? `${contact.name} · ${contact.email}` : contact.name })
  }

  const modeLine = internal
    ? <><b className="text-foreground">Prints marked Internal</b> because {selectedCount === 0
        ? 'no single account is selected'
        : `${n0(selectedCount)} accounts are selected`}. Filter the list to exactly one account to print it as a client document.</>
    : <><b className="text-foreground">Prints as a client document</b> because exactly one account is selected ({internalName}).
        {account && !account.own && <> It is not one of your own accounts, so the list covers only the studies on it that you can
          see, and the name comes from those study records.</>}
        {' '}With no account, or more than one, it prints marked Internal with an Account column.</>

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: statementCss({ footerLeft: foot.left, footerRight: foot.right, footerFont: sans.style.fontFamily }),
      }} />

      <PreSendPanel
        heading={internal ? 'Check before printing this list' : 'Check before sending this list'}
        modeLine={modeLine}
        checks={checks}
        name={internal ? undefined : { value: typed, onChange: setTyped, internalName, saved: account?.displayName ?? null }}
        onPrint={print}
        choice={controls}
        choiceNotes={cNotes}
      />

      <article className={`st st-sheet ${serif.variable} ${sans.variable}`} aria-label="Study List">
        <Masthead docTitle="Study List" preparedFor={name} internalAccounts={internal ? accounts : null} meta={meta} />

        {prints.activity && <ListStrip
          A={A}
          delivered={bucket === 'delivered'}
          ranged={ranged}
          groupTotal={totalBeforeDates}
          groupNoun={bucket === 'all' ? 'studies' : showingLabel(bucket).toLowerCase()}
          undated={undated}
          notDelivered={notDelivered}
          basisWord={BASIS_WORD[basis]}
          fnUnpriced={fn.unpriced}
          fnFinal={fn.final}
          status={prints.status}
          target={prints.target}
          final={prints.final}
          credits={prints.credits}
        />}

        <section aria-label="Studies">
          <div className="st-sec">
            <h2>Studies</h2><span className="st-sec-rule" />
            <span className="st-sec-aside">
              {allDelivered ? 'Most recent delivery first' : 'In progress by due date, then delivered, most recent first'}
            </span>
          </div>
          <Ledger
            rows={rows}
            grouped={false}
            accountCol={internal}
            accountNameById={accountNameById}
            today={today}
            currentTermId={null}
            neverRecorded={never}
            totalLabel={n => `Total · ${n0(n)} ${n === 1 ? 'study' : 'studies'} listed`}
            fn={fn}
            columns={ledgerColumns(prints)}
            estimate={prints.estimate}
          />
        </section>

        <Notes
          notes={notes}
          sign={{
            left: internal
              ? 'Prepared by AlphaROC for internal use. Not for sending to a client.'
              : contact
                ? `Prepared by AlphaROC for ${name}. Questions about this list or your allowance: ${contact.name}${contact.email ? `, ${contact.email}` : ''}.`
                : `Prepared by AlphaROC for ${name}. Questions about this list or your allowance: your AlphaROC contact.`,
            right: `Generated ${fmtDay(today)}, ${time}${preparedBy ? ` by ${preparedBy}` : ''}`,
          }}
        />
      </article>
    </>
  )
}
