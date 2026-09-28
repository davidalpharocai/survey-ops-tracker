'use client'

/**
 * Tab 3 — THE BOOK. What happened, over time, and how much of it we can see.
 *
 * ── THE TRAP THIS TAB IS BUILT AROUND ───────────────────────────────────────
 * Costs are only recorded on most delivered surveys from a certain month (the
 * reliability line, computed from coverage on the whole book in
 * lib/finance/coverage.ts). Earlier months show real delivered N against little
 * recorded spend, so a naive monthly cost line reads as growth when it is the
 * ledger filling in. Every month carries its own coverage; cost per N is split
 * by ROUTE (a blast respondent costs tens of times a panel one, so one blended
 * column moves with the mix) and computed on surveys that carry both a cost and
 * a delivered N; and the Undated and Total rows make the months add up.
 */

import { fmtNum } from '@/lib/utils/number'
import { Bar, BlockedFigure, Card, Empty, Figure, Note, Row, money, money2, pct, type CardBlocks } from './shared'
import { Drillable } from './DrillPanel'
import type { MonthTable, UnpricedAccount } from '@/lib/finance/analysis'
import { COST_LINES, type ClientSpend, type CostBreakdown, type Coverage, type MoneyLost, type Foregone } from '@/lib/finance/hub'
import { monthLabel } from '@/lib/finance/coverage'

export function BookTab({
  months, split, byAccount, lost, gone, cover, unpriced, reliableFrom, canFinance, blocks, onDrill,
}: {
  months: MonthTable
  split: CostBreakdown
  /** The month costs became reliable, computed on the WHOLE book — a fixed
   *  line, never the first month that happens to have spend in this view. */
  reliableFrom: string | null
  byAccount: { clients: ClientSpend[]; total: number }
  lost: MoneyLost
  gone: Foregone
  cover: Coverage
  unpriced: { total: number; share: number; accounts: UnpricedAccount[] }
  canFinance: boolean
  /** What did not load. A price-built figure shows the reason instead of a
   *  number; a spend-built one says it is a floor. */
  blocks: CardBlocks
  onDrill: (key: string) => void
}) {
  const rowsShown = [...months.periods, ...(months.undated ? [months.undated] : [])]
  const maxSpend = rowsShown.length ? Math.max(...rowsShown.map(p => p.spend)) : 0
  const maxClient = byAccount.clients[0]?.total ?? 0
  const totalSplit = split.total
  const perN = (v: number | null) => (v != null ? money2(v) : '—')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        wide
        title="Month by month"
        tip="Cost per N is split by route and computed on surveys that carry both a recorded cost and a delivered N — one population for the top and bottom of the division. Coverage is the share of surveys in the month with any recorded cost. The line marks the month costs became reliable across the whole book, whatever this view is filtered to."
        floor={blocks.costs}
      >
        {rowsShown.length === 0 ? (
          <Empty>Nothing in this view.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 border-b border-border/60 px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Period</span><span>Recorded spend</span>
              <span className="text-right" title="Delivered N, after QA, on surveys that have one">Delivered N</span>
              <span className="text-right" title="Blast cost per delivered respondent, on blast-only surveys with a cost and a delivered N">Blast $/N</span>
              <span className="text-right" title="Panel cost per delivered respondent, on panel-only surveys with a cost and a delivered N">Panel $/N</span>
              <span className="text-right" title="Share of the period's surveys with any recorded cost">Coverage</span>
            </div>
            <div className="divide-y divide-border/60">
              {[...rowsShown, months.total].map(p => (
                <div key={p.key} className={'px-4 py-2 ' + (p.key === 'total' ? 'bg-muted/30 font-medium' : '')}>
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-4 text-sm">
                    <span className="tabular-nums">{p.key === 'total' ? 'Total' : monthLabel(p.key)}</span>
                    <span className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-right tabular-nums">{money(p.spend)}</span>
                      {p.key !== 'total' && <Bar value={p.spend} max={maxSpend} tone={p.spend > 0 ? 'primary' : 'muted'} />}
                    </span>
                    <span className="tabular-nums text-right"
                      title={p.nMissing > 0 ? `${fmtNum(p.nMissing)} delivered surveys have no delivered N yet` : undefined}>
                      {fmtNum(p.n)}{p.nMissing > 0 && <span className="text-xs text-muted-foreground"> +{fmtNum(p.nMissing)}?</span>}
                    </span>
                    <span className="tabular-nums text-right">{perN(p.byRoute.blast.costPerN)}</span>
                    <span className="tabular-nums text-right">{perN(p.byRoute.panel.costPerN)}</span>
                    <span className={
                      'tabular-nums text-right text-xs ' +
                      (p.coverage < 0.25 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')
                    }>
                      {Math.round(p.coverage * 100)}%
                    </span>
                  </div>
                  {p.key !== 'total' && p.recoveriesPending && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground"
                      title="Unclaimed blast rewards come back in batches. Until this period's are booked, its blast cost reads high.">
                      Recoveries pending: {fmtNum(p.creditedSurveys)} of {fmtNum(p.rewardedSurveys)} blast
                      surveys have their unclaimed rewards booked, so this spend will come down.
                    </div>
                  )}
                  {reliableFrom === p.key && (
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      ── costs reliable from here ──
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Note>
              {reliableFrom
                ? <>Costs are recorded on most delivered surveys from {monthLabel(reliableFrom)}. Months before
                  it show real delivered N against little recorded spend, so read them against the coverage
                  column — a month under 25% coverage is an estimate, not a measurement.</>
                : <>Costs are not yet recorded on most delivered surveys in any month, so read every row
                  against its coverage column.</>}{' '}
              {months.undated && <>The Undated row holds surveys with no deliver, launch or submitted date,
                which no date range can place.</>}
            </Note>
          </>
        )}
      </Card>

      <Card
        title="Where the money went"
        tip="Recorded spend split by what it bought. Blast rewards are shown gross, and the rewards that came back unclaimed are their own negative line — never folded into another — so the gross can always be backed out. Send cost is paid whether or not anyone answers; email sends are free."
        floor={blocks.costs}
      >
        <div className="divide-y divide-border/60">
          {COST_LINES.filter(l => l.key !== 'total').map(l => {
            const v = split[l.key] as number
            return (
              <div key={l.key} className="px-4 py-2.5" title={l.help}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{l.label}</span>
                  <span className={'tabular-nums ' + (v < 0 ? 'text-emerald-700 dark:text-emerald-400' : '')}>
                    {money(v)}<span className="ml-2 text-xs text-muted-foreground">{pct(v, totalSplit)}%</span>
                  </span>
                </div>
                <Bar value={v} max={Math.max(split.panel, split.rewardsGross, split.sends, split.other, Math.abs(split.recovered))}
                  tone={v < 0 ? 'pos' : 'primary'} />
              </div>
            )
          })}
          <Row k={<span className="font-medium">Total field cost</span>}
            v={<span className="font-medium">{money(totalSplit)}</span>}
            sub={split.recovered < 0
              ? `Net of ${money(-split.recovered)} of rewards recovered on ${fmtNum(split.recoveredSurveys)} surveys. Blast rewards net of recoveries: ${money(split.rewardsNet)}.`
              : 'No recovered rewards are booked on these surveys yet.'} />
          <Note>
            <span className="font-medium text-foreground">{money(split.sends)} of this is a modelled number.</span>{' '}
            SMS send cost uses the per-message rate recorded on each blast, which was backfilled rather
            than taken from an invoice — so {pct(split.sends, totalSplit)}% of the spend on this page rests
            on one assumption nobody has checked against a bill.
          </Note>
        </div>
      </Card>

      <Card
        title="N we cannot bill"
        tip="Three different things that all cost money, deliberately not summed. Scrub and over-delivery are cash that left, priced at each survey's own cost per complete. Revenue foregone is an invoice never raised, priced at the client rate."
        floor={blocks.costs}
      >
        <div className="divide-y divide-border/60">
          <Row
            k={<Drillable onOpen={() => onDrill('scrub')} title={`Show the ${lost.scrub.surveys} scrubbed surveys`}>
              Lost in QA <span className="text-muted-foreground">(scrub)</span>
            </Drillable>}
            v={money(lost.scrub.dollars)} tone="neg"
            sub={`${fmtNum(lost.scrub.n)} completes bought and never delivered, across ${fmtNum(lost.scrub.surveys)} surveys`} />
          <Row
            k={<Drillable onOpen={() => onDrill('over')} title={`Show the ${lost.overTarget.surveys} over-delivered surveys`}>
              Delivered above the N sold
            </Drillable>}
            v={money(lost.overTarget.dollars)} tone="neg"
            sub={`${fmtNum(lost.overTarget.n)} completes past the promised N`} />
          {lost.cancelled.dollars > 0 && (
            <Row k="Cancelled before delivery" v={money(lost.cancelled.dollars)} tone="neg"
              sub={`${fmtNum(lost.cancelled.surveys)} survey${lost.cancelled.surveys === 1 ? '' : 's'} called off after spending began`} />
          )}
          {canFinance && (
            <Row k={blocks.prices
              ? <>Revenue foregone <span className="text-xs text-muted-foreground">(at the client price)</span></>
              : <Drillable onOpen={() => onDrill('foregone')} title="Show the surveys that came up short">
                Revenue foregone <span className="text-xs text-muted-foreground">(at the client price)</span>
              </Drillable>}
              v={blocks.prices ? '—' : money(gone.dollars)} tone={blocks.prices ? undefined : 'neg'}
              sub={blocks.prices
                ? `${blocks.prices}. This figure is missing, not zero.`
                : `${fmtNum(gone.n)} N short of target on ${fmtNum(gone.surveys)} priced surveys${gone.unpricedN > 0 ? ` · ${fmtNum(gone.unpricedN)} more N short on ${fmtNum(gone.unpricedSurveys)} unpriced surveys` : ''}`} />
          )}
          <Note>
            {lost.scrub.surveys > 0 && <>
              <span className="font-medium text-foreground">
                {fmtNum(lost.scrubStillHitTarget)} of {fmtNum(lost.scrub.surveys)} scrubbed surveys still cleared their target
              </span>, so that scrub cost cash and cost no revenue at all — a buying problem, not a
              billing one.{' '}
            </>}
            The last row is measured at what the client pays and the others at what we paid. They are
            different currencies of loss and must not be added.
          </Note>
        </div>
      </Card>

      <Card
        wide
        title="Spend by account"
        tip="One row per account, resolved through clients.id — BAM's nine legacy labels roll into one line instead of splitting the largest account nine ways. 'costed' says how many of an account's surveys carry a cost record at all."
        floor={blocks.costs}
      >
        {byAccount.clients.length === 0 ? (
          <Empty>Nothing in this view.</Empty>
        ) : (
          <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
            {byAccount.clients.filter(c => c.total > 0).map(c => (
              <div key={c.client} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{c.client}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(c.total)}
                    <span className="ml-2 text-xs text-muted-foreground">{Math.round(c.share * 100)}%</span>
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtNum(c.costed)} of {fmtNum(c.surveys)} surveys costed
                </div>
                <Bar value={c.total} max={maxClient} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {canFinance && (blocks.prices || unpriced.total > 0) && (
        <Card
          wide
          title="Spend that can never reach a margin"
          tip="Recorded cost on surveys with no client rate. Nothing here can ever appear in a margin figure, so this is a data-entry worklist ranked by how much it is worth fixing."
          floor={blocks.prices ? null : blocks.costs}
        >
          {/* With no prices read, every dollar would read as unpriced — 100% of
              the spend, all of it false. */}
          {blocks.prices ? <BlockedFigure text={blocks.prices} /> : <>
          <div className="px-4 py-3">
            <Drillable onOpen={() => onDrill('unpriced')} title="Show every costed survey with no rate">
              <div className="tabular-nums text-2xl font-semibold text-red-600 dark:text-red-400">
                {money(unpriced.total)}
              </div>
            </Drillable>
            <div className="mt-0.5 text-sm">
              {Math.round(unpriced.share * 100)}% of every dollar recorded, on work with no price attached
            </div>
          </div>
          <div className="divide-y divide-border/60 border-t border-border/60">
            {unpriced.accounts.slice(0, 8).map(a => (
              <Row key={a.accountId ?? a.account} k={a.account} v={money(a.spend)}
                sub={`${fmtNum(a.surveys)} survey${a.surveys === 1 ? '' : 's'}`} />
            ))}
          </div>
          <Note>
            Ranked by dollars, so it ranks itself.{' '}
            {(() => {
              // Computed, never typed: the claim moves as prices are entered.
              const top = unpriced.accounts.slice(0, 5)
              const topSpend = top.reduce((t, a) => t + a.spend, 0)
              return unpriced.accounts.length > top.length
                ? <>Pricing the top {fmtNum(top.length)} accounts would bring {money(topSpend)} ({pct(topSpend, unpriced.total)}% of
                  this spend) into the margin figures.</>
                : null
            })()}
          </Note>
          </>}
        </Card>
      )}

      <Card wide title="What these numbers cannot tell you"
        tip="The standing caveats, computed rather than written, so they cannot go stale.">
        <div className="divide-y divide-border/60">
          <Row k="Delivered surveys with any recorded cost"
            v={`${fmtNum(cover.deliveredCosted)} of ${fmtNum(cover.delivered)}`}
            sub={`${cover.deliveredPct}% — every total on this page is a floor, not a total`} />
          <Row k="Surveys collecting more N than their records account for"
            v={fmtNum(cover.unreconciled)}
            sub={`${fmtNum(cover.unattributedCompletes)} completes with no cost attached to them`} />
          <Note>
            There is no labour, overhead or platform cost anywhere in SOCC, and no invoice table — so
            &ldquo;we keep&rdquo; is field contribution (client price minus recorded field cost, before
            salaries and overhead), and the client price is a price × the delivered N rather than an
            invoice. Demo and test accounts and empty rerun placeholders are excluded throughout.
          </Note>
        </div>
      </Card>
    </div>
  )
}
