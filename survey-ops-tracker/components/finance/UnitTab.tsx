'use client'

/**
 * Tab 2 — UNIT ECONOMICS. What one respondent costs, and what we charge for it.
 *
 * This is the pricing tab, and it exists because the old page could show what
 * an account SPENT but never what it PAID — so the largest finding in the data
 * was invisible: BAM's blast work costs about the same per complete as DE
 * Shaw's and realises roughly $22/N less. That is a price review, not an
 * execution problem, and no card could say so.
 */

import { fmtNum } from '@/lib/utils/number'
import { Bar, Card, Empty, Note, Row, money, money2, moneyAuto, pct1 } from './shared'
import type { AccountPnl, BidLadder } from '@/lib/finance/analysis'
import type { Cpqr } from '@/lib/finance/cpqr'
import type { RouteCost } from '@/lib/finance/hub'

export function UnitTab({ cpqr, rates, accounts, ladder, incidence, canFinance }: {
  cpqr: Cpqr[]
  rates: RouteCost[]
  accounts: AccountPnl[]
  ladder: BidLadder | null
  incidence: { reach: number; completes: number; rate: number } | null
  canFinance: boolean
}) {
  const panel = cpqr.find(c => c.route === 'panel')
  const blast = cpqr.find(c => c.route === 'blast')
  const priced = accounts.filter(a => a.measured > 0 && a.realisedRate != null)
  const maxRate = priced.length ? Math.max(...priced.map(a => a.realisedRate!)) : 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="CPQR — cost per qualified respondent"
        tip="Recorded spend ÷ n_actual, the post-QA count the client actually received. Cost per complete divides by what we PAID for instead; the gap between the two is the scrub. Delivered surveys only, and only those whose recorded completes cover both the N collected and the N delivered — without that guard this card reported blast at half its true cost and an impossible 116% QA yield."
      >
        {cpqr.length === 0 ? (
          <Empty>No delivered survey here has both a recorded cost and a post-QA count.</Empty>
        ) : (
          <div className="divide-y divide-border/60">
            {cpqr.map(c => (
              <div key={c.route} className="px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">
                    {c.route === 'panel' ? 'PureSpectrum panel' : 'B2B blasts'}
                  </span>
                  <span className="tabular-nums text-sm">
                    {money2(c.blended)}<span className="text-muted-foreground"> / qualified N</span>
                  </span>
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  typical survey {money2(c.median)} · {money2(c.p25)} – {money2(c.p75)} · n={c.n}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtNum(c.paid)} bought → {fmtNum(c.qualified)} delivered ·{' '}
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {Math.round(c.scrubRate * 100)}% scrubbed
                  </span>
                  {c.excluded > 0 && <> · {fmtNum(c.excluded)} excluded, records do not reconcile</>}
                </div>
              </div>
            ))}
            {panel && blast && (
              <Note>
                A qualified B2B respondent costs{' '}
                <span className="font-semibold text-foreground">
                  {Math.round(blast.median / panel.median)}×
                </span>{' '}
                a qualified panel one. The routes are not substitutes — choose the one the audience is
                on, then price the consequence.
              </Note>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Cost per complete — what we bought"
        tip="Total recorded cost ÷ completes we PAID for. Sits beside CPQR deliberately: the difference between the two cards is exactly what QA removed, and showing only one of them hides it."
      >
        {rates.length === 0 ? (
          <Empty>Nothing in this view reconciles well enough to price.</Empty>
        ) : (
          <div className="divide-y divide-border/60">
            {rates.map(r => (
              <Row
                key={r.route}
                k={r.route === 'panel' ? 'PureSpectrum panel' : 'B2B blasts'}
                v={<>{money2(r.median)}<span className="text-muted-foreground"> / complete</span></>}
                sub={`${money2(r.p25)} – ${money2(r.p75)} · n=${r.n}`}
              />
            ))}
            {incidence && (
              <Note>
                <span className="font-medium text-foreground">Blast incidence is {pct1(incidence.rate)}</span>
                {' '}— {fmtNum(incidence.completes)} completes from {fmtNum(incidence.reach)} people reached.
                There is no panel equivalent: PureSpectrum reach is never recorded, so the common claim
                that the cost gap is &ldquo;mostly incidence&rdquo; cannot be tested here and is not made.
              </Note>
            )}
          </div>
        )}
      </Card>

      {canFinance && (
        <Card
          wide
          title="Account P&L — what they pay against what they cost"
          tip="Realised rate is revenue ÷ billable N: what an account ACTUALLY pays per interview, which the rate card may never have charged because billing caps at min(delivered, target). Cost per complete is computed on the same surveys, so the two can be compared without crossing populations. `n` is on every row — a realised rate from two surveys is not comparable to one from fourteen."
        >
          {priced.length === 0 ? (
            <Empty>No account in this view has a survey with both a rate and a recorded cost.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border/60 px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>Account</span><span className="text-right">Realised $/N</span>
                <span className="text-right">Cost/complete</span><span className="text-right">Margin</span>
                <span className="text-right">n</span>
              </div>
              <div className="divide-y divide-border/60">
                {priced.slice(0, 12).map(a => (
                  <div key={a.accountId ?? a.account} className="px-4 py-2.5">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-x-4 text-sm">
                      <span className="min-w-0 truncate">{a.account}</span>
                      <span className="tabular-nums text-right">{money(a.realisedRate!)}</span>
                      <span className="tabular-nums text-right text-muted-foreground">
                        {a.costPerComplete != null ? moneyAuto(a.costPerComplete) : '—'}
                      </span>
                      <span className={
                        'tabular-nums text-right ' +
                        ((a.marginPct ?? 0) < 0.2 ? 'text-red-600 dark:text-red-400' : '')
                      }>
                        {a.marginPct != null ? Math.round(a.marginPct * 100) + '%' : '—'}
                      </span>
                      <span className="tabular-nums text-right text-xs text-muted-foreground">{a.measured}</span>
                    </div>
                    <Bar value={a.realisedRate!} max={maxRate} tone={(a.marginPct ?? 0) < 0.2 ? 'neg' : 'primary'} />
                    {a.unpricedSpend > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {money(a.unpricedSpend)} of this account&apos;s spend carries no rate and is not in the
                        figures above
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Note>
                Margin here is <span className="font-medium text-foreground">contribution after field cost only</span> —
                no labour, no overhead, no platform cost. SOCC has no labour table, so this is the
                gross margin on bought interviews and nothing more.
              </Note>
            </>
          )}
        </Card>
      )}

      {ladder && (
        <Card
          wide
          title="The bid ladder — does paying more buy more?"
          tip="Each project compared against its OWN lowest bid, so a cheap project and an expensive one are never compared with each other. Blast efficiency elsewhere averages every bid into one response rate, which destroys this signal entirely."
        >
          <div className="grid grid-cols-2 divide-x divide-border/60 text-sm">
            <div className="px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">At its own lowest bid</div>
              <div className="mt-1 tabular-nums text-xl font-semibold">{money(ladder.base.costPer)}</div>
              <div className="text-xs text-muted-foreground">per complete</div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                {fmtNum(ladder.base.completes)} completes from {fmtNum(ladder.base.sends)} sends · {pct1(ladder.base.rate)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">After raising the bid</div>
              <div className="mt-1 tabular-nums text-xl font-semibold text-red-600 dark:text-red-400">
                {money(ladder.raised.costPer)}
              </div>
              <div className="text-xs text-muted-foreground">per complete</div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                {fmtNum(ladder.raised.completes)} completes from {fmtNum(ladder.raised.sends)} sends · {pct1(ladder.raised.rate)}
              </div>
            </div>
          </div>
          <Note tone="neg">
            <span className="font-semibold">
              {money(ladder.premium)} paid above each project&apos;s own base rate
            </span>{' '}
            across {fmtNum(ladder.projects)} projects that ran more than one bid level. Head to head
            with 500+ sends in both arms, the higher bid produced a <em>worse</em> response rate in{' '}
            <span className="font-semibold">{ladder.worseAfterRaise} of {ladder.headToHead}</span>.
            <span className="mt-1 block text-muted-foreground">
              Read this as evidence about <em>order</em>, not about money: escalation is sequential, so
              the expensive blast is chasing a list the cheap one already worked. Either way the next
              move is more list, not a higher bid.
            </span>
          </Note>
        </Card>
      )}
    </div>
  )
}
