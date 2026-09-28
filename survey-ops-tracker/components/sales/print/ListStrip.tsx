import { drawnFigure, drawnLine, listNames, n0, NBSP, NOT_YET_PRICED, type ActivityFigures } from '@/lib/sales/statement'
import { BelowMark, Fn } from './StatusGlyph'

/**
 * The survey list's one-row summary: how many are listed, what came back, and
 * what they drew. One scope — the selection printed in the masthead — so no
 * figure here can be mistaken for the contract position. The Survey Activity
 * Statement carries that.
 *
 * THE STRIP FOLLOWS THE COLUMNS (printColumns), figure by figure, for the same
 * reason the statement's activity panel does: a figure the salesperson turned
 * off must not reappear here in the largest type on the page. With Target off
 * it states no target and no percentage; with Final off the final-responses
 * tile goes; with Credits off the credits-drawn tile goes; with Status off the
 * stage counts go. The strip then holds one, two or three tiles and the grid
 * follows (statementCss `.st-strip-1`, `.st-strip-2`).
 */
export function ListStrip({
  A, delivered, ranged, groupTotal, groupNoun, undated, notDelivered, basisWord, fnUnpriced, fnFinal,
  status = true, target = true, final = true, credits = true,
}: {
  A: ActivityFigures
  /** True when the list is the Delivered group, so the first cell can say so. */
  delivered: boolean
  ranged: boolean
  /** Rows in the group before the date range was applied. */
  groupTotal: number
  /** "delivered surveys", "active surveys", "surveys". */
  groupNoun: string
  undated: number
  notDelivered: number
  /** "delivery", "submission", "launch" — for "no delivery date on record". */
  basisWord: string
  /** Footnote marks; null when the note does not print. */
  fnUnpriced: number | null
  fnFinal: number | null
  /** The Status column prints, so the stages may be counted out. */
  status?: boolean
  /** The Target column prints, so the target may be stated. */
  target?: boolean
  /** The Final column prints. Without it there is no final count to report. */
  final?: boolean
  /** The Credits column prints, so the credits drawn may be stated. */
  credits?: boolean
}) {
  const { t } = A
  const listed = A.total
  const pct = target && t.target > 0 ? Math.round((t.final / t.target) * 100) : null
  const is = (k: number) => (k === 1 ? 'is' : 'are')
  // One rule for the figure and its sentence (statement.ts drawnFigure): the
  // headline can never say "at least 0" while the caption says something else.
  const drawn = drawnFigure(t)
  const line = drawnLine(t)
  const fn = fnUnpriced != null ? <Fn n={fnUnpriced} /> : null
  const tiles = 1 + (final ? 1 : 0) + (credits ? 1 : 0)

  let first: string
  if (ranged) {
    first = `${n0(listed)} of the ${n0(groupTotal)} ${groupNoun} fall in these dates.`
    if (notDelivered > 0) first += ` ${n0(notDelivered)} not yet delivered ${is(notDelivered)} not listed.`
    if (undated > 0) {
      const other = undated === 1 && listed + notDelivered + 1 === groupTotal
      first += other
        ? ` The other has no ${basisWord} date on record and is not listed.`
        : ` ${n0(undated)} ${undated === 1 ? 'has' : 'have'} no ${basisWord} date on record and ${is(undated)} not listed.`
    }
  } else {
    // The stages are the Status column's own words; with it off, only the
    // delivered count, which is what this panel is for.
    const parts = [A.delivered ? `${n0(A.delivered)} delivered` : '', ...(status ? A.others : [])].filter(Boolean)
    first = parts.length
      ? `${listNames(parts)}.`
      : listed > 0 ? 'None has been delivered yet.' : 'Nothing matches the selection above.'
  }

  return (
    <section className={`st-strip${tiles < 3 ? ` st-strip-${tiles}` : ''}`} aria-label="Summary">
      <div>
        <div className="st-fig-label">{delivered ? 'Surveys delivered' : 'Surveys listed'}</div>
        <div className="st-fig-num">{n0(listed)}</div>
        <div className="st-fig-cap">{first}</div>
      </div>
      {final && (
        <div>
          <div className="st-fig-label">Final responses</div>
          {t.pairedN === 0 ? (
            <>
              <div className="st-fig-num"><span className="st-dash">—</span></div>
              <div className="st-fig-cap">A final count arrives on delivery; none of these surveys has both a target and a final count yet.</div>
            </>
          ) : (
            <>
              <div className="st-fig-num">{n0(t.final)}{fnFinal != null && <Fn n={fnFinal} />}</div>
              <div className="st-fig-cap">
                {pct != null && <><b>{pct}% of the {n0(t.target)} targeted.</b>{' '}</>}
                {n0(t.met)}{NBSP}met or beat target
                {t.below > 0 && <>; {n0(t.below)}{NBSP}fell short{NBSP}<span className="st-nw">(<BelowMark inline />)</span></>}.
              </div>
            </>
          )}
        </div>
      )}
      {credits && (
        <div>
          <div className="st-fig-label">Credits drawn</div>
          <div className="st-fig-num">
            {drawn.kind === 'unknown'
              ? <span className="st-fig-word">{NOT_YET_PRICED}{fn}</span>
              : <>{drawn.kind === 'floor' && <span className="st-q">at least</span>}{n0(drawn.value)}</>}
          </div>
          <div className="st-fig-cap">
            {line.head}
            {line.unpriced && <> {line.unpriced}{fn}.</>}
            {t.committed > 0 && <> A further {n0(t.committed)} {t.committed === 1 ? 'is' : 'are'} committed and not counted as drawn.</>}
          </div>
        </div>
      )}
    </section>
  )
}
