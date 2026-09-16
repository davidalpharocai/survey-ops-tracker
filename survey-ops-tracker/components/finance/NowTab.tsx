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

import { fmtNum } from '@/lib/utils/number'
import { Bar, Card, Empty, Figure, Note, ProjectLink, Row, money, pct } from './shared'
import type { Backlog, BudgetVariance, Exception, Exposure } from '@/lib/finance/analysis'

export function NowTab({ exposure, variance, queue, back, canFinance }: {
  exposure: Exposure[]
  variance: BudgetVariance
  queue: Exception[]
  back: Backlog
  canFinance: boolean
}) {
  const worstPct = exposure[0] ? Math.max(...exposure.map(e =>
    e.budget && e.budget > 0 ? e.spend / e.budget : 0)) : 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        wide
        tone={exposure.length > 0 ? 'alert' : undefined}
        title="Live exposure — money still moving"
        tip="In-flight surveys that have already passed their cost ceiling or their N target. Delivered work is history and belongs on The book; this is the only band on the page that changes an action today."
      >
        {exposure.length === 0 ? (
          <Empty>No survey in flight is past its ceiling or its target.</Empty>
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
                      {e.budget != null && e.budget > 0 && (
                        <span className="text-muted-foreground"> / {money(e.budget)}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.reasons.join(' · ')}
                    {e.overTargetCost > 0 && <> · about {money(e.overTargetCost)} already unbillable</>}
                  </div>
                  {e.budget != null && e.budget > 0 && (
                    <Bar value={e.spend} max={Math.max(e.spend, e.budget) * (worstPct > 1 ? 1 : 1)} tone="neg" />
                  )}
                </div>
              ))}
            </div>
            <Note tone="neg">
              {fmtNum(exposure.length)} survey{exposure.length === 1 ? '' : 's'} in flight
              {exposure.length > 8 && <> ({fmtNum(exposure.length - 8)} more not shown)</>}.
              Every dollar here is being spent now, against a limit somebody already set.
            </Note>
          </>
        )}
      </Card>

      <Card
        title="Budget variance"
        tip="survey_projects.budget is a COST CEILING — the most we intend to spend — not client revenue. Overrun and headroom are shown side by side and never netted: headroom on one survey cannot pay for an overrun on another, and subtracting them reports roughly zero and hides both."
      >
        <div className="grid grid-cols-2 divide-x divide-border/60">
          <Figure
            value={money(variance.overrun)} label="spent past a ceiling"
            sub={`${fmtNum(variance.breaches.length)} of ${fmtNum(variance.measurable)} surveys that carry both a ceiling and a cost`}
            tone="neg"
          />
          <Figure
            value={money(variance.headroom)} label="unused headroom"
            sub={`${fmtNum(variance.underSurveys)} surveys came in under. NOT an offset — it is on different surveys.`}
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
                sub={`${money(b.spend)} against ${money(b.budget)}${b.lifecycle === 'inflight' ? ` — still in ${b.board}` : ''}`}
              />
            ))}
          </div>
        )}
        <Note>
          {variance.noCost > 0 && <>
            {fmtNum(variance.noCost)} more surveys carry a ceiling but no recorded cost, so they are
            unmeasurable rather than compliant.{' '}
          </>}
          {variance.breaches.length > 0 && (() => {
            const blast = variance.breaches.filter(b => b.route === 'blast').length
            return blast > variance.breaches.length / 2 ? (
              <>{blast} of {variance.breaches.length} breaches are blast-fielded — the ceiling holds on panel and does not on blast.</>
            ) : null
          })()}
        </Note>
      </Card>

      <Card
        title="What to look at"
        tip="One row per survey, worst first, deduplicated — a survey that is both loss-making and over budget occupies one line, not two. Ranked by dollars at stake."
      >
        {queue.length === 0 ? (
          <Empty>Nothing in this view is out of line.</Empty>
        ) : (
          <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
            {queue.slice(0, 20).map(e => (
              <div key={e.id + e.kind} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <ProjectLink id={e.id} code={e.code} />
                    <span className="ml-2 text-muted-foreground">{e.account}</span>
                  </span>
                  <span className={
                    'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ' +
                    (e.kind === 'loss' ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                      : e.kind === 'over-budget' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground')
                  }>
                    {e.kind.replace('-', ' ')}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px]">{e.headline}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {canFinance && (
        <Card
          wide
          title="Backlog — contracted, not yet billed"
          tip="In-flight surveys that carry a client rate, valued at their target N. An UPPER bound: it assumes every one lands exactly on target, and surveys regularly come in short."
        >
          <div className="grid grid-cols-2 divide-x divide-border/60">
            <Figure
              value={money(back.revenueAtTarget)} label="if every one lands on target"
              sub={`${fmtNum(back.surveys)} in-flight surveys carrying a rate · ${money(back.spentSoFar)} spent against it so far`}
              tone="pos"
            />
            <Figure
              value={fmtNum(back.unpriced)} label="in-flight surveys with no rate"
              sub="invisible to this figure — the pipeline is larger than the number beside it"
              size="md"
            />
          </div>
          <Note>
            Revenue is billed at rate × min(delivered, target), so this is a ceiling and not a
            forecast. {back.surveys > 0 && back.spentSoFar > 0 && (
              <>Field cost committed so far is {pct(back.spentSoFar, back.revenueAtTarget)}% of the
                value at target.</>
            )}
          </Note>
        </Card>
      )}
    </div>
  )
}
