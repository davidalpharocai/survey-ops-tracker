'use client'

/**
 * Tab 1 — NOW. What needs a phone call today.
 *
 * The old page opened with an all-time margin percentage. An FP&A director
 * opens with what is unresolved: money that is still moving, ceilings already
 * breached, and the worklist. History is tab 3.
 *
 * Ordered by how fast the money stops moving: live exposure first, because a
 * survey still in the field is spending right now; then variance, which is
 * closed but repeatable; then the queue; then what is coming.
 */

import { useState } from 'react'
import { fmtNum } from '@/lib/utils/number'
import { Bar, BlockedFigure, Card, Empty, Figure, Note, ProjectLink, Row, money, pct, type CardBlocks } from './shared'
import { Drillable } from './DrillPanel'
import {
  BADGE_HELP, BADGE_LABEL, FINANCE_BADGES,
  type Backlog, type BudgetVariance, type Exception, type Exposure, type Holds,
} from '@/lib/finance/analysis'

/** Rows the worklist shows before "Show all". */
const QUEUE_PREVIEW = 20

export function NowTab({ exposure, variance, queue, back, holds, canFinance, blocks, onDrill }: {
  exposure: Exposure[]
  variance: BudgetVariance
  /** Built by exceptions() with the reader's capability, so for a reader
   *  without it no row exists because of a price or a budget. */
  queue: Exception[]
  back: Backlog
  /** Surveys on hold — their own bucket, never inside the live figures. */
  holds?: Holds
  canFinance: boolean
  /** What did not load. A price-built figure shows the reason instead of a
   *  number; a spend-built one says it is a floor. */
  blocks: CardBlocks
  /** Opens the rows behind a figure. Every headline here is a population, and
   *  a population you cannot open is a dead end. */
  onDrill: (key: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? queue : queue.slice(0, QUEUE_PREVIEW)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        wide
        tone={exposure.length > 0 ? 'alert' : undefined}
        title="Live exposure — money still moving"
        tip={canFinance
          ? 'Live studies that have already passed their budget or their N target. The date filter does not apply here — an overspend matters whenever the study launched. Studies on hold are counted separately below, never in this list.'
          : 'Live studies that have already collected more than their N target. The date filter does not apply here — an overspend matters whenever the study launched. Studies on hold are counted separately below, never in this list.'}
        floor={blocks.costs}
      >
        {exposure.length === 0 ? (
          <Empty>{canFinance ? 'No live study is past its budget or its target.' : 'No live study is past its target.'}</Empty>
        ) : (
          <>
            <div className="divide-y divide-border/60">
              {exposure.slice(0, 8).map(e => (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <ProjectLink id={e.id} code={e.code} />
                      <span className="ml-2 text-muted-foreground">{e.account}</span>
                      <span className="ml-2 text-xs text-muted-foreground">· {e.board}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">
                      {money(e.spend)}
                      {/* Budget is finance-only, here as everywhere else. */}
                      {canFinance && e.budget != null && e.budget > 0 && (
                        <span className="text-muted-foreground"> / {money(e.budget)}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.reasons.join(' · ')}
                    {e.overTargetCost > 0 && <> · about {money(e.overTargetCost)} already unbillable</>}
                  </div>
                  {canFinance && e.budget != null && e.budget > 0 && (
                    <Bar value={e.spend} max={Math.max(e.spend, e.budget)} tone="neg" />
                  )}
                </div>
              ))}
            </div>
            <Note tone="neg">
              <Drillable onOpen={() => onDrill('exposure')}>
                {fmtNum(exposure.length)} stud{exposure.length === 1 ? 'y' : 'ies'} in flight
              </Drillable>{' '}
              {exposure.length > 8 && <> — {fmtNum(exposure.length - 8)} more behind this figure</>}.
              Every dollar here is being spent now, against a limit somebody already set.
            </Note>
          </>
        )}
        {holds && holds.surveys > 0 && (
          <Note>
            <span className="font-medium text-foreground">
              {fmtNum(holds.surveys)} stud{holds.surveys === 1 ? 'y is' : 'ies are'} on hold
            </span>{holds.spend > 0 && <> with {money(holds.spend)} already spent</>}. Kept out of every live
            figure on this page. Resume or cancel each one.
          </Note>
        )}
      </Card>

      {canFinance && <Card
        title="Budget variance"
        tip="survey_projects.budget is a COST CEILING — the most we intend to spend — not client revenue. Overrun and headroom are shown side by side and never netted: headroom on one study cannot pay for an overrun on another, and subtracting them reports roughly zero and hides both."
        floor={blocks.costs}
      >
        <div className="grid grid-cols-2 divide-x divide-border/60">
          <Drillable onOpen={() => onDrill('breach')} title="Show the studies that blew their ceiling">
            <Figure
              value={money(variance.overrun)} label="spent past a ceiling"
              sub={`${fmtNum(variance.breaches.length)} of ${fmtNum(variance.measurable)} studies that carry both a ceiling and a cost`}
              tone="neg"
            />
          </Drillable>
          <Figure
            value={money(variance.headroom)} label="unused headroom"
            sub={`${fmtNum(variance.underSurveys)} studies came in under. NOT an offset — it is on different studies.`}
            size="md"
          />
        </div>
        {variance.breaches.length > 0 && (
          <div className="divide-y divide-border/60 border-t border-border/60">
            {variance.breaches.slice(0, 5).map(b => (
              <Row
                key={b.id}
                k={<>
                  <ProjectLink id={b.id} code={b.code} />
                  <span className="ml-2 text-muted-foreground">{b.account}</span>
                  <span className="ml-2 text-xs text-muted-foreground">· {b.route}</span>
                </>}
                v={<span className="text-red-600 dark:text-red-400">{Math.round(b.pct * 100)}%</span>}
                sub={`${money(b.spend)} against ${money(b.budget)}${b.lifecycle === 'active' ? ` — still in ${b.board}` : ''}`}
              />
            ))}
          </div>
        )}
        <Note>
          {variance.noCost > 0 && <>
            {fmtNum(variance.noCost)} more studies carry a ceiling but no recorded cost, so they are
            unmeasurable rather than compliant.{' '}
          </>}
          {variance.breaches.length > 0 && (() => {
            const blast = variance.breaches.filter(b => b.route === 'blast').length
            return blast > variance.breaches.length / 2 ? (
              <>{blast} of {variance.breaches.length} breaches are blast-fielded — the ceiling holds on panel and does not on blast.</>
            ) : null
          })()}
        </Note>
      </Card>}

      <Card
        title="What to look at"
        tip={canFinance
          ? "One row per study, carrying every badge that applies — losing money and going over budget are different events and are never merged. Ranked by dollars at stake: a cost outlier counts the total it cost above a typical study on its route (the whole book's median, so the yardstick does not move with the filter). Each row ends with what to do."
          : "One row per study: cost outliers and studies whose segment counts do not add up to the study's N actual. Ranked by dollars at stake: a cost outlier counts the total it cost above a typical study on its route (the whole book's median, so the yardstick does not move with the filter). Each row ends with what to do."}
        floor={blocks.costs}
      >
        {canFinance && blocks.prices && (
          <Note tone="neg">
            {blocks.prices}, so studies that lost money or were given away at $0 cannot be flagged
            here. The list below is missing them, not clear of them.
          </Note>
        )}
        {queue.length === 0 ? (
          <Empty>Nothing in this view is out of line.</Empty>
        ) : (
          <>
            <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
              {shown.map(e => (
                <div key={e.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <ProjectLink id={e.id} code={e.code} />
                      <span className="ml-2 text-muted-foreground">{e.account}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {/* A second lock: exceptions() already builds a
                          non-holder's list without these badges. */}
                      {e.badges.filter(b => canFinance || !FINANCE_BADGES.includes(b)).map(b => (
                        <span key={b} title={BADGE_HELP[b]} className={
                          'rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ' +
                          (b === 'lost-money' ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : b === 'over-budget' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground')
                        }>
                          {BADGE_LABEL[b]}
                        </span>
                      ))}
                    </span>
                  </div>
                  {e.items.filter(i => canFinance || !FINANCE_BADGES.includes(i.badge)).map(i => (
                    <div key={i.badge}>
                      <div className="mt-0.5 text-[13px]">{i.headline}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div>
                    </div>
                  ))}
                  <div className="mt-1 text-xs font-medium text-primary">{e.verb} →</div>
                </div>
              ))}
            </div>
            <Note>
              Showing {fmtNum(shown.length)} of {fmtNum(queue.length)}.{' '}
              {queue.length > QUEUE_PREVIEW && (
                <button onClick={() => setShowAll(v => !v)} className="font-medium text-primary underline-offset-2 hover:underline">
                  {showAll ? 'Show fewer' : 'Show all'}
                </button>
              )}
            </Note>
          </>
        )}
      </Card>

      {canFinance && (
        <Card
          wide
          title="Backlog — sold, not yet delivered"
          tip="Live studies that carry a client price, valued at the N sold. An UPPER bound: it assumes every one lands exactly on target, and studies regularly come in short. Studies on hold and in scoping are not included."
          floor={blocks.prices ? null : blocks.costs}
        >
          {blocks.prices ? <BlockedFigure text={blocks.prices} /> : <>
          <div className="grid grid-cols-2 divide-x divide-border/60">
            <Figure
              value={money(back.revenueAtTarget)} label="if every one lands on target"
              sub={`${fmtNum(back.surveys)} live studies carrying a price · ${money(back.spentSoFar)} spent against it so far`}
              tone="pos"
            />
            <Figure
              value={fmtNum(back.unpriced)} label="live studies with no price or no target"
              sub="invisible to this figure — the pipeline is larger than the number beside it"
              size="md"
            />
          </div>
          <Note>
            Revenue is price × min(delivered after QA, the top of the N sold), so this is a
            ceiling and not a forecast. {back.surveys > 0 && back.spentSoFar > 0 && (
              <>Field cost committed so far is {pct(back.spentSoFar, back.revenueAtTarget)}% of the
                value at target.</>
            )}
          </Note>
          </>}
        </Card>
      )}
    </div>
  )
}
