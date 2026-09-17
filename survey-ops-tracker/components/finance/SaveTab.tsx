'use client'

/**
 * Tab 4 — SAVE. Where the money could come out.
 *
 * David, 2026-09-17: "we need to scale the business and cut costs … all levels
 * of suggestions of where we can improve and cut costs."
 *
 * ── EVERY LEVER SHOWS WHAT IT COSTS TO PULL ─────────────────────────────────
 * A saving quoted without its price is not a saving, it is an argument for
 * doing less work. So each row carries the completes it gives up and the risk
 * of acting on it, in the same block as the dollars, and the total is a RANGE
 * rather than a single figure a reader would mistake for a target.
 *
 * ── AND WHAT THE ENGINE REFUSES TO DO ───────────────────────────────────────
 * The obvious rule — cap spend at target ÷ expected QA yield — is not here,
 * because that yield is written at delivery, after the money is spent. Replayed
 * wave by wave it would have saved $13,625 and broken twelve client deliveries
 * worth $28,714. The panel at the bottom says so, because a reader who does not
 * see the rule that was rejected will propose it again next quarter.
 */

import { fmtNum } from '@/lib/utils/number'
import { Bar, Card, Empty, Note, money, pct } from './shared'
import { Drillable } from './DrillPanel'
import type { SavingsView } from '@/lib/finance/savings'

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: 'high confidence', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  medium: { label: 'medium', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  low: { label: 'low', cls: 'bg-muted text-muted-foreground' },
}

export function SaveTab({ view, onDrill }: {
  view: SavingsView
  onDrill: (key: string) => void
}) {
  const max = view.levers.length ? Math.max(...view.levers.map(l => l.high)) : 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        wide
        title="Where the money could come out"
        tip="Every lever is recomputed from current data on each load, never read from a stored figure — so this cannot quote a saving that was captured months ago. Thresholds are percentiles of the comparable surveys, not constants, so the engine sharpens as data accumulates."
      >
        {view.levers.length === 0 ? (
          <Empty>Nothing in this view carries enough recorded cost to find a lever in.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 divide-x divide-border/60 border-b border-border/60">
              <div className="px-4 py-3">
                <div className="tabular-nums text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {money(view.totalLow)} – {money(view.totalHigh)}
                </div>
                <div className="mt-0.5 text-sm">available against {money(view.spend)} of recorded spend</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {pct(view.totalLow, view.spend)}–{pct(view.totalHigh, view.spend)}% of the book.
                  A range, not a target: most of these depend on something outside the data —
                  a carrier&apos;s willingness, an audience&apos;s depth.
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="tabular-nums text-2xl font-semibold">
                  {fmtNum(view.forgone)}
                </div>
                <div className="mt-0.5 text-sm">completes given up if every lever were pulled</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  This is the price of the column beside it. A lever that forgoes completes on a
                  survey already short of target is a delivery risk, not a saving.
                </div>
              </div>
            </div>

            <div className="divide-y divide-border/60">
              {view.levers.map((l, i) => (
                <div key={l.key} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium">
                      <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                      <Drillable onOpen={() => onDrill('lever-' + l.key)}
                        title="Show the surveys behind this lever">
                        {l.title}
                      </Drillable>
                    </span>
                    <span className="shrink-0 tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                      {l.low === l.high ? money(l.high) : `${money(l.low)} – ${money(l.high)}`}
                    </span>
                  </div>
                  <Bar value={l.high} max={max} tone="pos" />
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={'rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ' + CONF[l.confidence].cls}>
                      {CONF[l.confidence].label}
                    </span>
                    {l.forgoneCompletes > 0 ? (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-red-700 dark:text-red-400">
                        gives up {fmtNum(l.forgoneCompletes)} completes
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        costs nothing to try
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{l.population}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{l.rule}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium">Risk:</span> {l.risk}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card
        wide
        title="What this engine refuses to do"
        tip="Rules that look obvious, were tested against the data, and lose money. Recorded so nobody proposes them again next quarter without the numbers."
      >
        <div className="divide-y divide-border/60">
          <div className="px-4 py-3">
            <div className="text-sm font-medium">Cap spend at target ÷ expected QA yield</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The obvious rule, and the one three separate analyses reached for first. It has no
              input: <span className="font-medium text-foreground">the QA yield is written at
              delivery, after the money is spent</span> — it lands before a survey&apos;s last blast
              on 11 of 412 surveys. Nor can it be forecast from account history: BofA&apos;s own p25
              keep is 0.444 against a 0.801 median. Replayed wave by wave, a 1.13× cap would have
              saved {money(13625)} and broken <span className="font-medium text-foreground">twelve
              deliveries worth {money(28714)}</span>.
            </p>
          </div>
          <div className="px-4 py-3">
            <div className="text-sm font-medium">Move blast work onto the panel because it is 50× cheaper</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              There is no audience overlap between the two routes to substitute across. A B2B
              audience is not on a consumer panel, so the cheap rate is not available at any volume
              — the gap is what the routes reach, not how well they are bought.
            </p>
          </div>
          <div className="px-4 py-3">
            <div className="text-sm font-medium">Switch SMS to email because email sends are free</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Email response is about nine times worse inside the same survey. Replacing the SMS
              volume would need roughly 91M addresses against the 358,766 ever sent.
            </p>
          </div>
        </div>
        <Note>
          These are listed because a rejected rule with its numbers is worth more than a silent
          omission — the next person to propose one can see what it was tested against.
        </Note>
      </Card>
    </div>
  )
}
