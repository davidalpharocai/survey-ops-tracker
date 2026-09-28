import { n0, NBSP, type StatementFigures } from '@/lib/sales/statement'
import { Meter } from './Meter'
import { Fn } from './StatusGlyph'

/**
 * The contract panel: credits drawn against the contract in force, the
 * balance, and the pace meter.
 *
 * Its scope is the CONTRACT, stated in its own heading, and it does not move
 * with the reader's date range — the Activity panel beside it does. Every
 * qualifier ("at least", "at most", "≥") is printed on the figure it
 * qualifies, so a reader who takes in only the big number still gets the truth.
 */
export function ContractCluster({ F, fnUnpriced }: {
  F: StatementFigures
  /** The note number that explains "Not yet priced", when that note exists. */
  fnUnpriced: number | null
}) {
  const { c, captions, balance, meter } = F
  return (
    <div className="st-cluster">
      <div className="st-cluster-head"><b>{captions.heading}</b><span>{captions.aside}</span></div>
      <div className="st-figs">
        <div>
          <div className="st-fig-label">Credits drawn</div>
          <div className="st-fig-num">
            {F.notPriced ? (
              <span className="st-fig-word">Not yet priced{fnUnpriced != null && <Fn n={fnUnpriced} />}</span>
            ) : (
              <>{c.isFloor && <span className="st-q">at least</span>}{n0(c.used)}</>
            )}
          </div>
          <div className="st-fig-cap">
            {captions.pct && <b>{captions.pct}</b>}
            {captions.unpriced && <> {captions.unpriced}{fnUnpriced != null && <Fn n={fnUnpriced} />}.</>}
            {captions.committed && <> {captions.committed}</>}
            {captions.noBalance && <> {captions.noBalance}</>}
          </div>
        </div>
        <div>
          {balance && (
            <>
              <div className="st-fig-label">{balance.label}</div>
              <div className="st-fig-num">
                {balance.qualifier && <span className="st-q">{balance.qualifier}</span>}
                {balance.figure}
              </div>
              <div className="st-fig-cap">{balance.caption}</div>
            </>
          )}
        </div>
      </div>
      {meter && c.pct != null && (
        <Meter
          geometry={meter}
          drawnLabel={`${c.isFloor ? `≥${NBSP}` : ''}${Math.round(c.pct)}%`}
          termLabel={F.elapsedPct == null ? null : `${Math.round(F.elapsedPct)}%`}
          ariaLabel={`${c.isFloor ? 'At least ' : ''}${Math.round(c.pct)}% of the credit allowance drawn${
            F.elapsedPct == null ? '' : `, with ${Math.round(F.elapsedPct)}% of the contract term elapsed`}`}
        />
      )}
    </div>
  )
}
