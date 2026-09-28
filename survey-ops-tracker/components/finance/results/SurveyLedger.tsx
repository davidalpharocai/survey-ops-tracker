'use client'

/**
 * The three-way ledger: every delivered survey in view, its client price, our
 * cost and its budget side by side, with a tag for each thing that went wrong.
 *
 * Losing money and going over budget are DIFFERENT events (a survey can go
 * over its budget and still make money), so they are separate tags, and a row
 * carries every tag that applies. A $0 price reads "given away" wherever a
 * ratio would divide by it. Worst kept first.
 */

import { useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { ProjectLink } from '../tabs/Card'
import { centsText, money, moneyOrDash, pctText } from '@/lib/finance/format'
import { goalCostWords, ROUTE_WORD, TAG_HELP, TAG_LABEL, type LedgerRow, type LedgerTag } from '@/lib/finance/results'
import { KEEP_GOAL } from '@/lib/finance/revenue'
import { fmtNum } from '@/lib/utils/number'

/** Rows shown before "Show all". */
const FIRST = 50

const COLS: { key: string; label: string; tip: string; num?: boolean }[] = [
  { key: 'account', label: 'Account', tip: 'The client account, old name variants rolled together.' },
  { key: 'route', label: 'Route', tip: 'How the survey was actually fielded, read from its cost records.' },
  { key: 'price', label: 'Client price', tip: 'Price per N × billed N. "no price" when none is recorded; a real $0 prints $0.', num: true },
  { key: 'cost', label: 'Our cost', tip: 'Recorded field cost, net of rewards recovered. No salaries or overhead.', num: true },
  { key: 'kept', label: 'Kept $', tip: 'Client price minus our cost — only where the survey has both a price and a recorded cost.', num: true },
  { key: 'pct', label: 'Kept %', tip: 'Kept $ ÷ client price. A $0 price reads "given away": $0 never divides.', num: true },
  { key: 'budget', label: 'Budget', tip: 'The most we planned to spend: a cost ceiling, never revenue.', num: true },
  { key: 'spb', label: 'Spend ÷ budget', tip: 'Our cost as a share of the budget. Over 100% went over budget, which is not the same as losing money.', num: true },
  { key: 'spp', label: 'Spend ÷ price', tip: `Cents of our cost per $1 of client price. The goal is at most ${goalCostWords()}.`, num: true },
  { key: 'ppn', label: 'Price per billed N', tip: 'Client price ÷ billed N.', num: true },
  { key: 'cpn', label: 'Cost per billed N', tip: 'Our cost ÷ billed N. Blank when the survey’s N actual only adds up some of its segments.', num: true },
  { key: 'tags', label: 'Tags', tip: 'What went wrong. A survey can carry more than one.' },
]

const TAG_TONE: Record<LedgerTag, string> = {
  'lost-money': 'border-[var(--chart-loss)] text-[var(--chart-loss)]',
  'over-budget': 'border-[var(--chart-goal)] text-[var(--chart-goal)]',
  'given-away': 'border-border text-muted-foreground',
  'no-price': 'border-dashed border-[var(--chart-muted)] text-muted-foreground',
}

function priceCell(l: LedgerRow): string {
  if (l.revenue != null) return money(l.revenue)
  if (!l.priced) return 'no price'
  if (l.revenueReason === 'no-n-actual') return 'no delivered N yet'
  if (l.revenueReason === 'no-cap') return 'no N target'
  return '—'
}

const ratio = (l: LedgerRow, v: number | null, f: (x: number | null) => string) =>
  l.free ? 'given away' : !l.priced ? 'no price' : !l.inMargin && l.revenue != null ? 'no cost' : f(v)

export function SurveyLedger({ rows }: { rows: LedgerRow[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST)
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                <span className="inline-flex items-center">Survey<InfoTooltip text="The survey code. It opens the project page, where prices and budgets are edited." /></span>
              </th>
              {COLS.map(c => (
                <th key={c.key} scope="col" className={'px-3 py-1.5 font-medium ' + (c.num ? 'text-right' : 'text-left')}>
                  <span className="inline-flex items-center">{c.label}<InfoTooltip text={c.tip} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map(l => (
              <tr key={l.id} className="hover:bg-accent/40">
                <th scope="row" className="px-3 py-1.5 text-left font-normal"><ProjectLink id={l.id} code={l.code} /></th>
                <td className="max-w-[180px] truncate px-3 py-1.5" title={l.account}>{l.account}</td>
                <td className="px-3 py-1.5">{ROUTE_WORD[l.route]}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{priceCell(l)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(l.cost)}</td>
                <td className={'px-3 py-1.5 text-right tabular-nums ' + (l.kept != null && l.kept < 0 ? 'text-[var(--chart-loss)]' : '')}>
                  {moneyOrDash(l.kept, money)}
                </td>
                <td className={'px-3 py-1.5 text-right tabular-nums ' + (l.keptPct != null && l.keptPct >= KEEP_GOAL ? 'text-[var(--chart-keep)]' : l.keptPct != null && l.keptPct < 0 ? 'text-[var(--chart-loss)]' : '')}>
                  {ratio(l, l.keptPct, pctText)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{moneyOrDash(l.budget, money)}</td>
                <td className={'px-3 py-1.5 text-right tabular-nums ' + (l.spendPerBudget != null && l.spendPerBudget > 1 ? 'text-[var(--chart-goal)]' : '')}>
                  {pctText(l.spendPerBudget)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{ratio(l, l.spendPerPrice, centsText)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{moneyOrDash(l.pricePerBilledN)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{moneyOrDash(l.costPerBilledN)}</td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {l.tags.map(tag => (
                      <span key={tag} title={TAG_HELP[tag]}
                        className={'whitespace-nowrap rounded border px-1.5 text-[10px] font-medium tracking-wide ' + TAG_TONE[tag]}>
                        {TAG_LABEL[tag]}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > FIRST && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing {fmtNum(shown.length)} of {fmtNum(rows.length)} ·{' '}
          <button type="button" onClick={() => setAll(a => !a)} className="font-medium text-primary underline-offset-2 hover:underline">
            {all ? 'Show fewer' : 'Show all'}
          </button>
        </p>
      )}
    </div>
  )
}
