import type { ReactNode } from 'react'
import { hasDrawn, rollUp } from '@/lib/sales/credits'
import {
  clientStage, commonTitle, creditCell, drawnFigure, ESTIMATE_BANDS, fmtDayLong, listNames, n0, NBSP, responseCells,
  splitTitle, type StatementFigures, type StatementRow,
} from '@/lib/sales/statement'
import { PRINTS_ALL, type Prints, type UnexplainedMark } from '@/lib/sales/printColumns'
import { BelowMark } from './StatusGlyph'

export interface Note { key: 'unpriced' | 'final' | 'drawn' | 'dates' | 'list'; title: string; body: ReactNode }

/**
 * The numbered notes and the sign-off.
 *
 * Numbered and set in two columns like a fund report's footnotes, and each one
 * answers a question a portfolio manager asks of a statement: why is this
 * figure "at least", what the final count counts, when is a credit drawn,
 * whose clock are the dates on. Notes may break between items, never inside
 * one, so a long table does not push the whole block onto a near-empty page.
 *
 * ACROSS, THEN DOWN: 1 | 2 on the first row, 3 | 4 on the next. The first
 * version read down the left column first, and a page break (which falls
 * between grid ROWS) then put notes 1 and 3 on one page and 2 and 4 on the
 * next, so a reader went from note 1 to note 3.
 *
 * THE LAST ROW TRAVELS WITH THE SIGN-OFF, in one block that does not break
 * inside. `break-before: avoid` on the sign-off alone does not hold against a
 * grid in Chrome: when the notes just filled a page, "Prepared by AlphaROC for
 * …" printed alone on an otherwise blank last page of a client document.
 *
 * Every name and number in a note is computed from the rows. None is typed.
 *
 * THE NOTES FOLLOW WHAT PRINTS (printColumns). A note is kept while something
 * on the page still needs it — "Not yet priced" while the Credits column or the
 * contract summary prints, the final count while a response column prints —
 * so the numbering never points at a figure that is not there. Each
 * summary figure follows its own column, so a note that explains a column
 * covers the summary with it. With the Notes section turned off, `notes` is
 * empty and only the sign-off prints: it is who to call, not a note.
 */
export function Notes({ notes, sign }: { notes: Note[]; sign: { left: ReactNode; right: ReactNode } }) {
  if (notes.length === 0) {
    return (
      <section className="st-notes" aria-label="Sign-off">
        <div className="st-sign st-sign-only"><span>{sign.left}</span><span>{sign.right}</span></div>
      </section>
    )
  }
  // The start of the last row: the last two notes, or the last one when the
  // count is odd (it then sits alone on its row, on the left).
  const cut = Math.max(0, notes.length - (notes.length % 2 === 0 ? 2 : 1))
  const item = (n: Note, i: number) => <li key={n.key}><i>{i + 1}</i><b>{n.title}</b> {n.body}</li>
  return (
    <section className="st-notes" aria-label="Notes">
      <div className="st-sec"><h2>Notes</h2><span className="st-sec-rule" /></div>
      {cut > 0 && <ol>{notes.slice(0, cut).map((n, i) => item(n, i))}</ol>}
      <div className="st-notes-end">
        <ol start={cut + 1}>{notes.slice(cut).map((n, i) => item(n, cut + i))}</ol>
        <div className="st-sign"><span>{sign.left}</span><span>{sign.right}</span></div>
      </div>
    </section>
  )
}

/** The note number for a key, or null when that note is not printed. */
export const noteNumber = (notes: Note[], key: Note['key']): number | null => {
  const i = notes.findIndex(n => n.key === key)
  return i < 0 ? null : i + 1
}

/**
 * What the page would print with nothing to explain it, if the notes were
 * turned off — for the pre-send panel's warning (printColumns.choiceNotes).
 *
 * Every mark whose ONLY explanation is a note counts, not just the credit
 * figures: the "≈ N est." in the Final column is a projection from past
 * surveys, and "not recorded" is the absence of a final count. A page with an
 * estimate on it and no notes tells the client nothing about where the number
 * came from, and until 2026-09-28 the warning stayed silent unless the account
 * also had an unpriced survey.
 */
export function unexplainedMarks({ rows, neverRecorded, prints, notes }: {
  rows: StatementRow[]
  neverRecorded: Set<string>
  prints: Prints
  /** The notes the page WOULD print, whether or not the section is on. */
  notes: Note[]
}): UnexplainedMark[] {
  const out: UnexplainedMark[] = []
  // "at least" and "Not yet priced" print wherever this note would be needed.
  if (notes.some(n => n.key === 'unpriced')) out.push('floor')
  if (prints.final) {
    const finals = rows.map(p => responseCells(p, neverRecorded.has(p.id), { estimate: prints.estimate }).final)
    if (finals.some(f => f.kind === 'estimate')) out.push('estimate')
    if (finals.some(f => f.kind === 'not-recorded')) out.push('not-recorded')
    // The ▼. Its caption-level legend was removed on 2026-09-29 with the
    // met/short tally, leaving finalNote below as its only explanation — so
    // turning the notes off now strands it, which is precisely what this
    // function exists to report.
    if (finals.some(f => f.kind === 'final' && f.below)) out.push('below')
  }
  return out
}

const title = (p: StatementRow) => splitTitle(p.project_name)[0]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const is = (xs: unknown[]) => (xs.length === 1 ? 'is' : 'are')

/** "They are in design and draw nothing until they go into field." */
function idleSentence(u: StatementRow[], also: boolean): string {
  const labels = [...new Set(u.map(p => clientStage(p).label.toLowerCase()))]
  const where = labels.length === 1 ? labels[0] : 'not yet in field'
  const one = u.length === 1
  return `${cap(commonTitle(u))} ${one ? 'is' : 'are'} ${also ? 'also ' : ''}not yet priced; ${one ? 'it is' : 'they are'} ${where} and draw${
    one ? 's' : ''} nothing until ${one ? 'it goes' : 'they go'} into field.`
}

/**
 * Note: the final count — shared by both documents.
 *
 * This used to branch on the Collected column in four places, choosing between
 * a version that defined two counts and one that defined one. The column was
 * removed on 2026-09-29, so there is one version and no branch: a note headed
 * “Final and collected” that then defines a column the reader cannot find is
 * worse than no note, because it sends a client looking for a number that is
 * not on the page.
 *
 * What the note keeps is the ≈ and the ▼. Those are printed in the Final
 * column and explained nowhere else, so they are the reason it exists.
 */
function finalNote(rows: StatementRow[], neverRecorded: Set<string>, prints: Prints): Note {
  const anyLive = rows.some(p => clientStage(p).group !== 'delivered')
  const cells = rows.map(p => responseCells(p, neverRecorded.has(p.id), { estimate: prints.estimate }))
  const anyBelow = cells.some(c => c.final.kind === 'final' && c.final.below)
  const estimates = cells.map(c => c.final).filter(f => f.kind === 'estimate')
  const noFinal = rows.filter(p => clientStage(p).group === 'delivered' && p.n_actual == null)
  const over = ESTIMATE_BANDS.overTargetRatio, under = ESTIMATE_BANDS.underTargetRatio
  return {
    key: 'final',
    title: 'The final count.',
    body: (
      <>
        The final count is the number of responses delivered after quality review.
        {/* A dash the client cannot account for is what makes a document look
            incomplete rather than current, so the blank is named. */}
        {anyLive && ' A study still in progress has no final count yet, and its response figures are left blank until it is delivered.'}
        {/* The ▼ and the ≈ are printed only in the Final column. */}
        {anyBelow && prints.final && <> <BelowMark inline />{NBSP}marks a final count below target.</>}
        {prints.final && estimates.some(e => e.kind === 'estimate' && e.basis === 'at-or-over-target') && (
          <> ≈ marks an estimate for a study still in quality review: across {n0(over.n)} past studies that collected at
            or above target, the final count came in at a median {over.median.toFixed(2)}× target
            ({over.p25.toFixed(2)}–{over.p75.toFixed(2)}×).</>
        )}
        {prints.final && estimates.some(e => e.kind === 'estimate' && e.basis === 'short-of-target') && (
          <> ≈ on a study that finished short of target is an estimate: across {n0(under.n)} past studies where review
            removed responses, the final count came in at a median {under.median.toFixed(2)}× what was collected.</>
        )}
        {noFinal.length > 0 && (
          <> {listNames(noFinal.map(title))} {noFinal.length === 1 ? 'was' : 'were'} delivered without a final count on
            record, so {noFinal.length === 1 ? 'it is' : 'they are'} left out of the response totals.</>
        )}
      </>
    ),
  }
}

/** The four statement notes. `rows` are the ledger's rows; `F` the contract
 *  position; `prints` what the page prints (everything by default). */
export function statementNotes({ rows, F, neverRecorded, currentTermId, time, today, prints = PRINTS_ALL }: {
  rows: StatementRow[]
  F: StatementFigures
  neverRecorded: Set<string>
  currentTermId: string | null
  time: string
  today: string
  prints?: Prints
}): Note[] {
  const notes: Note[] = []
  const { term, c } = F
  const drawnU = F.unpricedDrawnRows
  const idleU = rows.filter(p => p.credits == null && !hasDrawn(p))
  const anyUnpriced = rows.some(p => p.credits == null) || c.isFloor
  // Where credits print on a statement: the Credits column and the contract panel.
  const creditsShown = prints.credits || prints.contract

  if (anyUnpriced && creditsShown) {
    const allDelivered = drawnU.every(p => clientStage(p).group === 'delivered')
    // "at least 0 credits have been drawn" when nothing priced has drawn: true,
    // and useless to a client. drawnFigure decides, as it does on the figure.
    let consequence = drawnFigure(c).kind === 'unknown'
      ? 'the credits drawn are not known yet'
      : `at least ${n0(c.used)} credits have been drawn`
    // The balance and the allowance are the contract panel's figures. With that
    // panel off, "the balance is at least 35 beyond the allowance" would be the
    // only mention of an allowance on the page, with no allowance to read it
    // against, so the sentence stops at the credits drawn.
    if (prints.contract && term && c.total != null && c.total > 0 && c.remaining != null) {
      consequence += c.remaining < 0
        ? ` and the balance is at least ${n0(-c.remaining)} beyond the allowance`
        : ` and at most ${n0(c.remaining)} remain`
    }
    notes.push({
      key: 'unpriced',
      title: 'Not yet priced.',
      body: (
        <>
          A study with no credit figure has not been priced yet; it is not a zero.
          {drawnU.length > 0 && (
            <> {listNames(drawnU.map(title))} {drawnU.length === 1
              ? (allDelivered ? 'was delivered' : 'has gone into field')
              : (allDelivered ? 'were delivered' : 'have gone into field')}{term ? ` under the ${term.name}` : ''} and{' '}
              {is(drawnU)} not yet priced, so {consequence}.</>
          )}
          {idleU.length > 0 && <> {idleSentence(idleU, drawnU.length > 0)}</>}
        </>
      ),
    })
  }

  if (responsesShown(prints)) notes.push(finalNote(rows, neverRecorded, prints))

  if (creditsShown) {
    const anyCommitted = rows.some(p => creditCell(p, currentTermId).kind === 'committed')
    const anyOffTerm = rows.some(p => { const x = creditCell(p, currentTermId); return x.kind === 'drawn' && x.offTerm })
    notes.push({
      key: 'drawn',
      title: 'When credits are drawn.',
      body: (
        <>
          A study draws its credits when it goes into field; one not yet in field has drawn nothing.
          {anyCommitted && ' A study priced before it fields shows its credits as committed, and they are not counted as drawn.'}
          {term
            ? anyOffTerm
              // The † is printed only in the Credits column. Without it the
              // sentence still has to be true: not every credit here is on the
              // contract in force.
              ? prints.credits
                ? ` Credits marked † are not counted against the ${term.name}.`
                : ` Only credits drawn under the ${term.name} count against it.`
              : ` Every credit on this statement is drawn under the ${term.name}.`
            : ' No contract covers today’s date, so no credit here is measured against an allowance.'}
        </>
      ),
    })
  }

  notes.push({
    key: 'dates',
    title: prints.status ? 'Status and dates.' : 'Dates.',
    body: (
      <>
        Dates are US Eastern Time.{prints.status && ' A delivered study shows the day it was delivered; one in progress shows its scheduled due date.'}
        {' '}A dash means not recorded, or not applicable at that stage. Figures are as recorded
        at {time} on {fmtDayLong(today)} and will change as studies finish review and are priced.
      </>
    ),
  })
  return notes
}

/** The final count is explained while the Final column prints. The summary's
 *  final-responses figure, which carries the note's mark, follows that column
 *  itself, so there is nothing left to explain once it is off. */
const responsesShown = (p: Prints) => p.final

/** The four list notes. `prints` is what the page prints (everything by default). */
export function listNotes({ rows, neverRecorded, internalAccounts, time, today, prints = PRINTS_ALL }: {
  rows: StatementRow[]
  neverRecorded: Set<string>
  /** Set in internal mode. */
  internalAccounts: number | null
  time: string
  today: string
  prints?: Prints
}): Note[] {
  const notes: Note[] = []
  const drawnU = rows.filter(p => p.credits == null && hasDrawn(p))
  const idleU = rows.filter(p => p.credits == null && !hasDrawn(p))
  // Computed here from the listed rows rather than passed in, so the figure in
  // this sentence and the strip's figure above it are the same rollUp.
  const drawn = drawnFigure(rollUp(rows, null))
  const atLeast = drawn.kind === 'unknown' ? 'are not known yet' : `are at least ${n0(drawn.value)}`
  // A list prints credits in one place only — the Credits column, and the
  // summary strip's credit tile, which follows that same tick.
  if ((drawnU.length || idleU.length) && prints.credits) {
    notes.push({
      key: 'unpriced',
      title: 'Not yet priced.',
      body: (
        <>
          A study with no credit figure has not been priced yet; it is not a zero.
          {drawnU.length > 0 && (
            <> {listNames(drawnU.map(title))} {is(drawnU)} not yet priced, so the credits drawn by this list {atLeast}.</>
          )}
          {idleU.length > 0 && <> {idleSentence(idleU, drawnU.length > 0)}</>}
        </>
      ),
    })
  }
  if (responsesShown(prints)) notes.push(finalNote(rows, neverRecorded, prints))
  notes.push({
    key: 'list',
    title: 'What this list is.',
    body: internalAccounts != null
      ? `It lists the studies that match the selection above, across ${n0(internalAccounts)} ${
          internalAccounts === 1 ? 'account' : 'accounts'}. It is an internal document and is not a statement of any client’s contract position.`
      : 'It lists the studies that match the selection above. It is not a statement of your contract position; the Study Activity Statement shows that.',
  })
  const anyLive = rows.some(p => clientStage(p).group !== 'delivered')
  notes.push({
    key: 'dates',
    title: 'Dates.',
    // The per-survey dates are in the Status column; without it, only the clock.
    body: `Dates are US Eastern Time${!prints.status ? '' : anyLive
      ? '; a delivered study shows the day it was delivered, and one in progress its scheduled due date'
      : '; each study shows the day it was delivered'}. Figures are as recorded at ${time} on ${fmtDayLong(today)}.`,
  })
  return notes
}
