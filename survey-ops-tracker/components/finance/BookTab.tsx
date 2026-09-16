'use client'

/**
 * Tab 3 — THE BOOK. What happened, over time, and how much of it we can see.
 *
 * ── THE TRAP THIS TAB IS BUILT AROUND ───────────────────────────────────────
 * Cost capture began in May 2026. February to April show real delivered N
 * against $0 of recorded spend. A naive monthly cost line therefore reads as
 * 30x growth when it is the ledger filling in, and a naive cost-per-N line
 * reads as an 8x cost explosion for the same reason. Every point here carries
 * its own coverage, and cost per N is computed on the costed subset only —
 * same numerator, same denominator.
 */

import { fmtNum } from '@/lib/utils/number'
import { Bar, Card, Empty, Figure, Note, Row, money, money2, pct } from './shared'
import type { Period, UnpricedAccount } from '@/lib/finance/analysis'
import type { ClientSpend, Coverage, MoneyLost, Foregone } from '@/lib/finance/hub'

export function BookTab({
  periods, split, byAccount, lost, gone, cover, unpriced, canFinance,
}: {
  periods: Period[]
  split: { reward: number; send: number; panel: number; other: number }
  byAccount: { clients: ClientSpend[]; total: number }
  lost: MoneyLost
  gone: Foregone
  cover: Coverage
  unpriced: { total: number; share: number; accounts: UnpricedAccount[] }
  canFinance: boolean
}) {
  const maxSpend = periods.length ? Math.max(...periods.map(p => p.spend)) : 0
  const maxClient = byAccount.clients[0]?.total ?? 0
  const totalSplit = split.panel + split.reward + split.send + split.other
  // The first period that recorded any cost. Everything before it is a coverage
  // artefact, not a business fact, and the chart says so where it happens.
  const firstCosted = periods.find(p => p.spend > 0)?.key ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        wide
        title="Month by month"
        tip="Cost per N is computed on the COSTED surveys only — dividing recorded spend by all delivered N would show cost collapsing as record-keeping improves. Coverage is on every row so a rising cost line can be read against a rising share of surveys that carry any cost at all."
      >
        {periods.length === 0 ? (
          <Empty>Nothing in this view carries a date.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 border-b border-border/60 px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Period</span><span>Recorded spend</span>
              <span className="text-right">Delivered N</span>
              <span className="text-right">$/N costed</span>
              <span className="text-right">Coverage</span>
            </div>
            <div className="divide-y divide-border/60">
              {periods.map(p => (
                <div key={p.key} className="px-4 py-2">
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 text-sm">
                    <span className="tabular-nums">{p.key}</span>
                    <span className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-right tabular-nums">{money(p.spend)}</span>
                      <Bar value={p.spend} max={maxSpend} tone={p.spend > 0 ? 'primary' : 'muted'} />
                    </span>
                    <span className="tabular-nums text-right">{fmtNum(p.n)}</span>
                    <span className="tabular-nums text-right">
                      {p.costPerN != null ? money2(p.costPerN) : <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className={
                      'tabular-nums text-right text-xs ' +
                      (p.coverage < 0.25 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')
                    }>
                      {Math.round(p.coverage * 100)}%
                    </span>
                  </div>
                  {firstCosted === p.key && (
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      ── cost recording begins here ──
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Note>
              Periods before cost recording began show real delivered N against $0 of spend. The rise
              in this column is substantially the ledger filling in, not costs growing — read it
              against the coverage column beside it, and treat a month under 25% coverage as an
              estimate rather than a measurement.
            </Note>
          </>
        )}
      </Card>

      <Card
        title="Where the money went"
        tip="Recorded spend split by what it bought. Send cost is paid whether or not anyone answers; email sends are free (migration 112)."
      >
        <div className="divide-y divide-border/60">
          {([
            ['Panel completes', split.panel],
            ['Blast rewards', split.reward],
            ['Blast sends', split.send],
            ['Other cost lines', split.other],
          ] as const).map(([label, v]) => (
            <div key={label} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between text-sm">
                <span>{label}</span>
                <span className="tabular-nums">
                  {money(v)}<span className="ml-2 text-xs text-muted-foreground">{pct(v, totalSplit)}%</span>
                </span>
              </div>
              <Bar value={v} max={Math.max(split.panel, split.reward, split.send, split.other)} />
            </div>
          ))}
          <Row k={<span className="font-medium">Total recorded</span>}
            v={<span className="font-medium">{money(totalSplit)}</span>} />
          <Note>
            <span className="font-medium text-foreground">{money(split.send)} of this is a modelled number.</span>{' '}
            Every blast on file carries the same $0.02 per send, backfilled rather than taken from an
            invoice — so {pct(split.send, totalSplit)}% of the spend on this page rests on one
            assumption nobody has checked against a bill.
          </Note>
        </div>
      </Card>

      <Card
        title="N we cannot bill"
        tip="Three different things that all cost money, deliberately not summed. Scrub and over-delivery are cash that left, priced at each survey's own cost per complete. Revenue foregone is an invoice never raised, priced at the client rate."
      >
        <div className="divide-y divide-border/60">
          <Row k={<>Lost in QA <span className="text-muted-foreground">(scrub)</span></>}
            v={money(lost.scrub.dollars)} tone="neg"
            sub={`${fmtNum(lost.scrub.n)} completes bought and never delivered, across ${fmtNum(lost.scrub.surveys)} surveys`} />
          <Row k="Delivered above target" v={money(lost.overTarget.dollars)} tone="neg"
            sub={`${fmtNum(lost.overTarget.n)} completes past the promised N`} />
          {lost.cancelled.dollars > 0 && (
            <Row k="Cancelled before delivery" v={money(lost.cancelled.dollars)} tone="neg"
              sub={`${fmtNum(lost.cancelled.surveys)} survey${lost.cancelled.surveys === 1 ? '' : 's'} called off after spending began`} />
          )}
          {canFinance && (
            <Row k={<>Revenue foregone <span className="text-xs text-muted-foreground">(different currency)</span></>}
              v={money(gone.dollars)} tone="neg"
              sub={`${fmtNum(gone.n)} N short of target on ${fmtNum(gone.surveys)} priced surveys${gone.unpricedN > 0 ? ` · ${fmtNum(gone.unpricedN)} more N short on ${fmtNum(gone.unpricedSurveys)} unpriced surveys` : ''}`} />
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

      {canFinance && unpriced.total > 0 && (
        <Card
          wide
          title="Spend that can never reach a margin"
          tip="Recorded cost on surveys with no client rate. Nothing here can ever appear in a margin figure, so this is a data-entry worklist ranked by how much it is worth fixing."
        >
          <div className="px-4 py-3">
            <div className="tabular-nums text-2xl font-semibold text-red-600 dark:text-red-400">
              {money(unpriced.total)}
            </div>
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
            Ranked by dollars, so it ranks itself. Pricing the top few accounts moves more of the book
            into the margin figures than pricing everything else combined.
          </Note>
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
            There is no labour, overhead or platform cost anywhere in SOCC, and no invoice or contract
            table — so every margin here is contribution after <em>field cost only</em>, and revenue
            is a rate × a count rather than anything that was ever billed. Demo and test accounts are
            excluded throughout.
          </Note>
        </div>
      </Card>
    </div>
  )
}
