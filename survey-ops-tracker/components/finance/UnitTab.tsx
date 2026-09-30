'use client'

/**
 * Tab 2 — UNIT ECONOMICS. What one respondent costs, and what we charge for it.
 *
 * This is the pricing tab, and it exists because the old page could show what
 * an account SPENT but never what it PAID. Price and cost are now both per
 * BILLED respondent and split by route, so reading across an account's route
 * row gives what we keep per respondent — and a price gap between two accounts
 * on the same route, at the same cost, reads as the price review it is.
 */

import { fmtNum } from '@/lib/utils/number'
import { Bar, BlockedFigure, Card, Empty, Note, Row, money, money2, moneyAuto, pct1, type CardBlocks } from './shared'
import { Drillable } from './DrillPanel'
import type { AccountPnl, BidLadder } from '@/lib/finance/analysis'
import type { Cpqr, MixedCoverage } from '@/lib/finance/cpqr'
import type { RouteCost } from '@/lib/finance/hub'

export function UnitTab({ cpqr, mixed, rates, accounts, ladder, incidence, canFinance, blocks, onDrill }: {
  cpqr: Cpqr[]
  /** 117: the mixed-route surveys these rates could not price, and why. */
  mixed?: MixedCoverage
  rates: RouteCost[]
  accounts: AccountPnl[]
  ladder: BidLadder | null
  incidence: { reach: number; completes: number; rate: number } | null
  canFinance: boolean
  /** What did not load. A price-built figure shows the reason instead of a
   *  number; a spend-built one says it is a floor. */
  blocks: CardBlocks
  onDrill: (key: string) => void
}) {
  const panel = cpqr.find(c => c.route === 'panel')
  const blast = cpqr.find(c => c.route === 'blast')
  // Every account with a survey in the margin set. Per-respondent figures live
  // on the ROUTE rows; an account fielded more than one way prints none on its
  // blended row, because a price averaged across routes describes the mix.
  const priced = accounts.filter(a => a.measured > 0)
  const maxRate = Math.max(0, ...priced.flatMap(a => a.routes.map(r => r.realisedRate ?? 0)))
  const ROUTE_NAME: Record<string, string> = { blast: 'Blast', panel: 'Panel', both: 'Both routes', none: 'No field rows' }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="CPQR — cost per qualified respondent"
        floor={blocks.costs}
        tip="Recorded spend (net of recovered rewards) ÷ n_actual, the post-QA count the client actually received. The 'per complete bought' figure on each row is the same spend ÷ the completes we PAID for, on exactly the same studies — so the gap between the two is exactly the scrub. Delivered studies only, and only those whose recorded completes cover both the N collected and the N delivered — without that guard this card reported blast at half its true cost and an impossible 116% QA yield. A study fielded both ways contributes one observation to each route, built from that route's own spend and its own delivered respondents, and only once both can be established."
      >
        {cpqr.length === 0 ? (
          <Empty>No delivered study here has both a recorded cost and a post-QA count.</Empty>
        ) : (
          <div className="divide-y divide-border/60">
            {cpqr.map(c => (
              <div key={c.route} className="px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <Drillable onOpen={() => onDrill('cpqr-' + c.route)}
                    title={`Show the ${c.n} studies behind this rate`}>
                    <span className="text-sm font-medium">
                      {c.route === 'panel' ? 'PureSpectrum panel' : 'B2B blasts'}
                    </span>
                  </Drillable>
                  <span className="tabular-nums text-sm">
                    {money2(c.blended)}<span className="text-muted-foreground"> / qualified N</span>
                  </span>
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  typical study {money2(c.median)} · {money2(c.p25)} – {money2(c.p75)} · n={c.n}
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {money2(c.perComplete)} per complete bought, on the same studies
                  {c.recovered < 0 && <> · {money2(c.blendedGross)} per qualified before {money(-c.recovered)} of rewards came back</>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtNum(c.paid)} bought → {fmtNum(c.qualified)} delivered ·{' '}
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {Math.round(c.scrubRate * 100)}% scrubbed across the book
                  </span>
                  {', '}<span className="font-medium">{Math.round(c.scrubRateMedian * 100)}% on the typical study</span>
                  {c.excluded > 0 && <> · {fmtNum(c.excluded)} excluded, records do not reconcile</>}
                  {c.mixed > 0 && (
                    <> · {fmtNum(c.mixed)} of these {c.mixed === 1 ? 'is' : 'are'} one side of a
                    study fielded both ways, counted on its own money</>
                  )}
                </div>
              </div>
            ))}
            {(panel || blast) && (
              <Note>
                <span className="font-medium text-foreground">Use the right one of those two.</span>{' '}
                The book figure is what one qualified respondent cost across the whole book; the
                typical-study figure is what to expect on the next one, and they differ because a
                handful of studies scrub catastrophically rather than because the routes behave
                differently. Per-study keep runs{' '}
                {panel && <>{Math.round(panel.keepP25 * 100)}–{Math.round(panel.keepP75 * 100)}% on panel</>}
                {panel && blast && ' and '}
                {blast && <>{Math.round(blast.keepP25 * 100)}–{Math.round(blast.keepP75 * 100)}% on blast</>}
                {' '}— wide enough that any single buy-multiple under-buys about half the time.
              </Note>
            )}
            {mixed && mixed.surveys > mixed.priced && (
              <Note>
                <span className="font-medium text-foreground">
                  {fmtNum(mixed.surveys - mixed.priced)} stud
                  {mixed.surveys - mixed.priced === 1 ? 'y' : 'ies'} fielded BOTH ways{' '}
                  {mixed.surveys - mixed.priced === 1 ? 'is' : 'are'} missing from the two rates
                  above
                </span>
                {' '}— {money2(mixed.blockedSpend)} of spend and {fmtNum(mixed.blockedN)} delivered
                respondents. A study that used blasts and PureSpectrum together only reaches these
                figures once every dollar and every delivered respondent can be placed on one side
                or the other, because a rate built by splitting them down the middle would be wrong
                on both.{' '}
                {mixed.reasons['no-split'] ? (
                  <>{fmtNum(mixed.reasons['no-split'])} need{mixed.reasons['no-split'] === 1 ? 's' : ''} the
                  delivered N split by route — join the deliverable&rsquo;s transaction IDs to the QA
                  file, then record it on the study. </>
                ) : null}
                {mixed.reasons['unrouted-cost'] ? (
                  <>{fmtNum(mixed.reasons['unrouted-cost'])} carr
                  {mixed.reasons['unrouted-cost'] === 1 ? 'ies' : 'y'} a flat cost line
                  ({money2(mixed.unroutedSpend)}) that does not say which route it bought — a
                  contacts export is a blast cost. </>
                ) : null}
                {mixed.reasons['no-n-actual'] ? (
                  <>{fmtNum(mixed.reasons['no-n-actual'])} ha
                  {mixed.reasons['no-n-actual'] === 1 ? 's' : 've'} no post-QA count at all. </>
                ) : null}
                {mixed.reasons['under-recorded'] ? (
                  <>{fmtNum(mixed.reasons['under-recorded'])} ha
                  {mixed.reasons['under-recorded'] === 1 ? 's' : 've'} field rows that do not cover
                  the N claimed. </>
                ) : null}
                {mixed.reasons['estimated'] ? (
                  <>{fmtNum(mixed.reasons['estimated'])} carr
                  {mixed.reasons['estimated'] === 1 ? 'ies' : 'y'} a split recorded as an estimate,
                  which is kept but deliberately never priced. </>
                ) : null}
              </Note>
            )}
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
        floor={blocks.costs}
        tip="The median study's recorded cost ÷ completes we PAID for, on studies whose records cover their collected N. A different statistic and a different set of studies from the CPQR card, so do not subtract one from the other — the CPQR card's own 'per complete bought' line is the like-for-like comparison."
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
          floor={blocks.prices ? null : blocks.costs}
          tip="Price and cost are both per BILLED respondent (min of delivered and the N sold), on the same studies, so price minus cost is what we keep per respondent. Split by route: an account fielded more than one way shows its per-respondent figures on each route row only, because a panel price averaged with a blast price describes the mix, not the client. `n` is on every row — a figure from two studies is not comparable to one from fourteen."
        >
          {blocks.prices ? (
            <BlockedFigure text={blocks.prices} />
          ) : priced.length === 0 ? (
            <Empty>No account in this view has a study with both a client price and a recorded cost.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border/60 px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>Account · route</span>
                <span className="text-right" title="Client price ÷ billed respondents">Price / billed N</span>
                <span className="text-right" title="Our field cost ÷ the same billed respondents">Cost / billed N</span>
                <span className="text-right" title="(Client price − our cost) ÷ client price. Field contribution, before salaries and overhead.">We keep</span>
                <span className="text-right" title="Studies behind the row">n</span>
              </div>
              <div className="divide-y divide-border/60">
                {priced.slice(0, 12).map(a => {
                  const lines = a.routes.length > 1
                    ? [{ key: 'all', label: a.account, row: a, sub: false }, ...a.routes.map(r => ({ key: r.route, label: ROUTE_NAME[r.route] ?? r.route, row: r, sub: true }))]
                    : [{ key: 'all', label: `${a.account}${a.routes[0] ? ` · ${ROUTE_NAME[a.routes[0].route] ?? a.routes[0].route}` : ''}`, row: a.routes[0] ?? a, sub: false }]
                  return (
                    <div key={a.accountId ?? a.account} className="px-4 py-2.5">
                      {lines.map(l => (
                        <div key={l.key} className={l.sub ? 'mt-1 pl-4' : ''}>
                          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-x-4 text-sm">
                            <span className={'min-w-0 truncate ' + (l.sub ? 'text-muted-foreground' : '')}>{l.label}</span>
                            <span className="tabular-nums text-right">{l.row.realisedRate != null ? moneyAuto(l.row.realisedRate) : '—'}</span>
                            <span className="tabular-nums text-right text-muted-foreground">
                              {l.row.costPerBilledN != null ? moneyAuto(l.row.costPerBilledN) : '—'}
                            </span>
                            <span className={
                              'tabular-nums text-right ' +
                              ((l.row.marginPct ?? 0) < 0.2 ? 'text-red-600 dark:text-red-400' : '')
                            }>
                              {l.row.marginPct != null ? Math.round(l.row.marginPct * 100) + '%' : '—'}
                            </span>
                            <span className="tabular-nums text-right text-xs text-muted-foreground">{l.row.measured}</span>
                          </div>
                          {l.row.realisedRate != null && (
                            <Bar value={l.row.realisedRate} max={maxRate} tone={(l.row.marginPct ?? 0) < 0.2 ? 'neg' : 'primary'} />
                          )}
                        </div>
                      ))}
                      {a.routes.length > 1 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Fielded more than one way, so per-respondent figures are shown per route only.
                        </div>
                      )}
                      {a.freeSurveys > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Includes {fmtNum(a.freeSurveys)} stud{a.freeSurveys === 1 ? 'y' : 'ies'} given away at $0.
                        </div>
                      )}
                      {a.unpricedSpend > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {money(a.unpricedSpend)} of this account&apos;s spend carries no price and is not in the
                          figures above
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <Note>
                &ldquo;We keep&rdquo; is <span className="font-medium text-foreground">field contribution</span> —
                client price minus recorded field cost, before salaries and overhead. SOCC has no labour
                table, so this is the contribution on bought interviews and nothing more.
              </Note>
            </>
          )}
        </Card>
      )}

      {ladder && (
        <Card
          wide
          title="The bid ladder — does paying more buy more?"
          floor={blocks.costs}
          tip="Each project compared against its OWN lowest bid, so a cheap project and an expensive one are never compared with each other. Averaging every bid into one response rate would destroy this signal. Rewards are as issued, before any unclaimed reward came back."
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
