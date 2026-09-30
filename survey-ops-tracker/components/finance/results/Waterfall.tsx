'use client'

/**
 * Where the delivered spend went, line by line — opened from the coverage
 * line's spend figure.
 *
 * Recovered rewards are their own negative line, drawn in the "kept" green
 * because it is money back, and never folded into Other costs (David,
 * 2026-09-24). Folded in, they turned "Other" negative and made a month whose
 * recoveries had been booked look cheaper than one still waiting for them.
 *
 * Every line opens the surveys behind it, checked against the same line summed
 * straight off the raw cost records.
 */

import { BarChart, fmtCount, fmtMoney } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { money } from '@/lib/finance/format'
import type { CostLineKey, Waterfall as WaterfallModel, WaterfallLine } from '@/lib/finance/results'

export function Waterfall({ model, onLine }: {
  model: WaterfallModel
  onLine: (key: CostLineKey) => void
}) {
  const lines = model.lines.filter(l => l.key !== 'total')
  const total = model.lines.find(l => l.key === 'total')
  return (
    <div id="results-waterfall" className="border-t border-border px-4 py-3">
      <BarChart<WaterfallLine>
        ariaLabel="Delivered spend by cost line, with recovered rewards as money back"
        title="Where the delivered spend went"
        info="Recorded field cost on every delivered study in view, split by what it bought. Blast rewards are gross; rewards that came back unclaimed are their own negative line. Click a line to see its studies."
        data={lines}
        label={l => l.label}
        labelHeader="Cost line"
        value={l => l.amount}
        valueName="Amount"
        valueFormat={v => fmtMoney(v)}
        valueLabel={{ name: 'Amount · studies', text: l => `${money(l.amount)} · ${fmtCount(l.surveys)}` }}
        diverging
        positiveLabel="Money out"
        negativeLabel="Money back"
        color="var(--chart-cost)"
        negativeColor="var(--chart-keep)"
        note={l => l.help}
        onSelect={l => onLine(l.key)}
      />
      {total && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1 text-sm">
          <span className="font-medium">{total.label}:</span>
          <button
            type="button"
            onClick={() => onLine('total')}
            title="Show every delivered study with spend, checked against the raw cost records"
            className="rounded font-semibold tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid"
          >
            {money(total.amount)}
          </button>
          <InfoTooltip text={total.help} />
        </p>
      )}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">SMS sends:</span> {model.sms.words}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.note}</p>
    </div>
  )
}
