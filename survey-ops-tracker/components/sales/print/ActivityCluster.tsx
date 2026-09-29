import { listNames, n0, NBSP, type ActivityFigures, type Glyph } from '@/lib/sales/statement'
import { BelowMark, Fn, StatusGlyph } from './StatusGlyph'

const KEY: [Glyph, string][] = [
  ['full', 'Delivered'],
  ['half', 'In field or quality review'],
  ['open', 'Not yet in field'],
  ['hold', 'On hold'],
  ['cancel', 'Cancelled or closed'],
]

/**
 * The activity panel: what was delivered and what came back, over exactly the
 * surveys in the table below — so its scope follows the reader's filter, and
 * its heading says what that scope is.
 *
 * Target and Final are compared only over the delivered surveys that have
 * BOTH. Adding a survey with no final count to the target side would read as a
 * shortfall that is really a missing record.
 *
 * THE PANEL FOLLOWS THE COLUMNS (printColumns), figure by figure. A number the
 * salesperson turned off must not come back here in 25pt type, which is what it
 * did until 2026-09-28: with Target off the panel still printed "104% of the
 * 895 targeted". So with Target off it states no target and no percentage; with
 * Final off there is no final count to report and the whole tile goes; with
 * Status off the stage counts and the key to the marks go; with Credits off the
 * period's credit line goes. Unticking a SECTION can only take a panel away —
 * it can never be the only way to take a figure off the page.
 */
export function ActivityCluster({
  A, scope, ranged, fnFinal, glyphs, status = true, target = true, final = true, credits = true,
}: {
  A: ActivityFigures
  /** "All time · 15 surveys" or "Delivered 1 Jul – 24 Sep 2026 · 10 surveys". */
  scope: string
  ranged: boolean
  /** The note that explains the final count; null when it does not print. */
  fnFinal: number | null
  /** Which status marks the table uses, so the key explains only those. */
  glyphs: Set<Glyph>
  /** The Status column prints: the stages are its words, and its marks need a key. */
  status?: boolean
  /** The Target column prints, so the target and the percentage may be stated. */
  target?: boolean
  /** The Final column prints. Without it there is no final count to report. */
  final?: boolean
  /** The Credits column prints, so the period's credit line may be stated. */
  credits?: boolean
}) {
  const { t } = A
  const pct = target && t.target > 0 ? Math.round((t.final / t.target) * 100) : null
  // The set both figures are over, named without naming the target figure —
  // the same words the ledger's own subtotal note uses.
  const paired = `the ${n0(t.pairedN)} delivered ${t.pairedN === 1 ? 'survey' : 'surveys'} with both a target and a final count`
  return (
    <div className="st-cluster">
      <div className="st-cluster-head"><b>Activity</b><span>{scope}</span></div>
      <div className="st-figs">
        <div>
          <div className="st-fig-label">Delivered</div>
          <div className="st-fig-num">{n0(A.delivered)}</div>
          <div className="st-fig-cap">
            {ranged
              ? 'in the period.'
              : `of ${n0(A.total)} ${A.total === 1 ? 'survey' : 'surveys'}${
                  status && A.others.length ? `; ${listNames(A.others)}` : ''}.`}
          </div>
        </div>
        {final && (
          <div>
            <div className="st-fig-label">Final responses</div>
            {t.pairedN === 0 ? (
              <>
                <div className="st-fig-num"><span className="st-dash">—</span></div>
                <div className="st-fig-cap">No survey here has been delivered with both a target and a final count yet.</div>
              </>
            ) : (
              <>
                <div className="st-fig-num">{n0(t.final)}{fnFinal != null && <Fn n={fnFinal} />}</div>
                <div className="st-fig-cap">
                  {pct != null
                    ? <><b>{pct}% of the {n0(t.target)} targeted</b>, across {paired}.</>
                    : <>Across {paired}.</>}
                  {' '}{n0(t.met)}{NBSP}met or beat {pct != null ? 'it' : 'target'}
                  {t.below > 0 && <>; {n0(t.below)}{NBSP}fell short{NBSP}<span className="st-nw">(<BelowMark inline />)</span></>}.
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {credits && A.periodLine && <div className="st-period"><b>In this period</b>{A.periodLine}</div>}
      {status && (
        <div className="st-key" aria-label="Status key">
          {KEY.filter(([g]) => g === 'full' || g === 'half' || g === 'open' || glyphs.has(g)).map(([g, label]) => (
            <span key={g}><StatusGlyph kind={g} />{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}
