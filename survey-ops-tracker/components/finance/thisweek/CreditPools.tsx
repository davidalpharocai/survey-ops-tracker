'use client'

/**
 * The credit-pool strip: one bar per client_terms contract.
 *
 *   navy        credits drawn on delivered work
 *   light navy  credits drawn on live work
 *   red tail    credits drawn past the pool
 *   hatch       credits on held surveys — shown apart, never counted as drawn
 *   dashed      live priced work carrying no credits yet, in credit terms at
 *               the derived rate (only when a rate can be derived)
 *   teal cap    the pool
 *   amber tick  even pace: where the drawdown would be if the pool were used
 *               evenly over the term, i.e. the pool × the share of the term gone
 *
 * The segments are plain HTML on the chart tokens: a pool is a single stacked
 * bar, which none of the chart primitives draw, so it sits in the shared
 * ChartFrame (legend, "View as table" twin) with the shared Legend and hatch.
 * Each bar opens the surveys drawing on that contract.
 */

import { ChartFrame, HATCH_CSS, type ChartTable, type LegendItem } from '@/components/charts'
import { money, pctText } from '@/lib/finance/format'
import { creditsText, dayText, type CreditPool } from '@/lib/finance/thisWeek'

const pct = (x: number) => `${Math.max(0, Math.min(100, x * 100))}%`

export function CreditPools({ pools, today, onOpen }: {
  pools: CreditPool[]
  today: string
  onOpen: (p: CreditPool) => void
}) {
  const anyHold = pools.some(p => p.hold > 0)
  const anyQueued = pools.some(p => p.queued.ids.length > 0 && p.queued.creditsEquiv != null)
  const anyOver = pools.some(p => p.over > 0)
  const legend: LegendItem[] = [
    { key: 'd', label: 'Drawn on delivered work', color: 'var(--chart-cost)' },
    { key: 'l', label: 'Drawn on live work', color: 'color-mix(in oklab, var(--chart-cost) 50%, var(--chart-surface))' },
    ...(anyOver ? [{ key: 'o', label: 'Past the pool', color: 'var(--chart-loss)' }] : []),
    ...(anyHold ? [{ key: 'h', label: 'On held surveys (not counted)', shape: 'hatch' as const }] : []),
    ...(anyQueued ? [{ key: 'q', label: 'Queued priced work with no credits (derived)', color: 'var(--chart-cost)', shape: 'dash' as const }] : []),
    { key: 'p', label: 'The pool', color: 'var(--chart-price)', shape: 'tick' as const },
    { key: 'e', label: 'Even pace for the term gone', color: 'var(--chart-goal)', shape: 'tick' as const, description: 'Where the drawdown would be if the pool were used evenly over the term.' },
  ]

  const table: ChartTable = {
    columns: [
      { key: 'c', label: 'Contract' },
      { key: 'a', label: 'Account' },
      { key: 'p', label: 'Pool', align: 'right', title: 'Credits the contract carries (a count, not dollars)' },
      { key: 'd', label: 'Delivered', align: 'right', title: 'Credits drawn on delivered work' },
      { key: 'l', label: 'Live', align: 'right', title: 'Credits drawn on live work' },
      { key: 'h', label: 'On hold', align: 'right', title: 'Credits on held surveys, not counted as drawn' },
      { key: 'o', label: 'Over', align: 'right', title: 'Delivered + live credits past the pool' },
      { key: 'q', label: 'Queued, no credits', align: 'right', title: 'Live surveys at this account priced per N but carrying no credits, valued at price × N sold' },
      { key: 't', label: 'Term gone', align: 'right', title: 'Share of the contract term elapsed' },
      { key: 'r', label: 'Renews', title: 'The renewal date on file' },
      { key: 'v', label: '$ per credit', align: 'right', title: 'Derived: from the contract value on file, else implied by the contract’s own priced surveys. A dash means no value could be derived — never $0.' },
    ],
    rows: pools.map(p => ({
      key: p.termId,
      cells: [
        p.name,
        p.account,
        p.pool == null ? '—' : creditsText(p.pool),
        creditsText(p.delivered),
        creditsText(p.live),
        creditsText(p.hold),
        p.pool == null ? '—' : creditsText(p.over),
        p.queued.ids.length ? `${p.queued.ids.length} · ${money(p.queued.value)}` : '—',
        p.elapsed == null ? '—' : pctText(p.elapsed),
        p.renewsOn ? dayText(p.renewsOn, today) : '—',
        p.perCredit ? `${money(p.perCredit.value)} (${p.perCredit.source === 'agreed' ? 'contract value' : `implied, n=${p.perCredit.n}`})` : '—',
      ],
      onSelect: () => onOpen(p),
    })),
  }

  return (
    <ChartFrame
      ariaLabel="Credits drawn against each contract's pool"
      legend={legend}
      table={table}
      empty={pools.length === 0}
      emptyMessage="No contract in view carries a credit pool."
      height={pools.length * 64}
    >
      <ul className="flex flex-col gap-3">
        {pools.map(p => <PoolBar key={p.termId} p={p} today={today} onOpen={() => onOpen(p)} />)}
      </ul>
    </ChartFrame>
  )
}

function PoolBar({ p, today, onOpen }: { p: CreditPool; today: string; onOpen: () => void }) {
  const queued = p.queued.creditsEquiv ?? 0
  const scale = Math.max(p.pool ?? 0, p.used + p.hold + queued, 1)
  const at = (x: number) => x / scale
  const seg = (from: number, to: number, style: React.CSSProperties, key: string) =>
    to > from ? <span key={key} aria-hidden className="absolute inset-y-0" style={{ left: pct(at(from)), width: pct(at(to - from)), ...style }} /> : null
  const summary = `${p.account}, ${p.name}: ${p.sentence}`
  const renews = p.renewsOn ? ` · renews ${dayText(p.renewsOn, today)}` : ''
  const perCredit = p.perCredit
    ? ` · ≈${money(p.perCredit.value)} per credit, derived ${p.perCredit.source === 'agreed' ? 'from the contract value on file' : `from ${p.perCredit.n} of its own priced ${p.perCredit.n === 1 ? 'survey' : 'surveys'}`}`
    : ''
  const queuedText = p.queued.ids.length
    ? ` ${p.queued.ids.length} live priced ${p.queued.ids.length === 1 ? 'survey carries' : 'surveys carry'} no credits (${money(p.queued.value)} at target${p.queued.creditsEquiv != null ? `, ≈${creditsText(p.queued.creditsEquiv)} credits derived` : ''}).`
    : ''
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${summary} Open the surveys drawing on it.`}
        title="Open the surveys drawing on this contract"
        className="block w-full rounded-md p-1 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chart-price)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
          <span className="font-medium text-foreground">{p.account} · &ldquo;{p.name}&rdquo;</span>
          <span className="tabular-nums text-muted-foreground">
            {p.pool == null ? `${creditsText(p.used)} credits drawn · no pool recorded` : `${creditsText(p.used)} of ${creditsText(p.pool)} credits`}
            {p.elapsed != null && ` · ${pctText(Math.min(1, Math.max(0, p.elapsed)))} of term gone`}
            {renews}
          </span>
        </div>
        <div className="relative mt-1 h-3 w-full overflow-hidden rounded-sm" style={{ background: 'var(--chart-grid)' }}>
          {p.pool != null && seg(0, p.pool, { background: 'color-mix(in oklab, var(--chart-price) 22%, var(--chart-surface))' }, 'track')}
          {seg(0, p.delivered, { background: 'var(--chart-cost)' }, 'd')}
          {seg(p.delivered, p.used, { background: 'color-mix(in oklab, var(--chart-cost) 50%, var(--chart-surface))' }, 'l')}
          {p.pool != null && p.used > p.pool && seg(p.pool, p.used, { background: 'var(--chart-loss)' }, 'o')}
          {seg(p.used, p.used + p.hold, { background: HATCH_CSS }, 'h')}
          {queued > 0 && seg(p.used + p.hold, p.used + p.hold + queued, { border: '1.5px dashed var(--chart-cost)', borderRadius: 2 }, 'q')}
          {p.pool != null && p.pool > 0 && (
            <span aria-hidden className="absolute inset-y-0 w-[3px] -translate-x-1/2" style={{ left: pct(at(p.pool)), background: 'var(--chart-price)' }} />
          )}
          {p.pool != null && p.pool > 0 && p.elapsed != null && (
            <span aria-hidden className="absolute inset-y-0 w-[2px] -translate-x-1/2" style={{ left: pct(at(p.pool * Math.min(1, Math.max(0, p.elapsed)))), background: 'var(--chart-goal)' }} />
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {p.sentence}{perCredit ? `${perCredit.replace(/^ · /, ' ')}.` : ''}{queuedText}
        </p>
      </button>
    </li>
  )
}
