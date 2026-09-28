'use client'

/**
 * Chart C1 — client price against our cost, by delivery month.
 *
 * Price and cost are drawn from the SAME surveys (each month's margin set),
 * never from different populations: the old month table subtracted spend on
 * every survey from revenue on the priced ones and printed June at −132%. The
 * hatched bar is the month's spend on delivered surveys with no price at all,
 * so a reader sees how much of the month the two solid bars describe.
 *
 * Months before costs were recorded on most delivered work (a date computed on
 * the whole book, lib/finance/coverage.ts) are greyed and labelled; months
 * with thin price records are faded. Both stay clickable.
 */

import { ColumnChart, fmtCount, fmtMoney, fmtMoneyCompact, fmtPct } from '@/components/charts'
import { monthLabel } from '@/lib/finance/coverage'
import { monthShort, spansYears } from '../periodAxis'
import { goalKeptWords, type MonthBar } from '@/lib/finance/results'

/** How far a month fades: greyed before costs were recorded, lighter when thin. */
const OPACITY_BEFORE = 0.35
const OPACITY_THIN = 0.6

export function MonthChart({ months, costReliableFrom, onSelect }: {
  months: MonthBar[]
  costReliableFrom: string | null
  onSelect: (m: MonthBar) => void
}) {
  const anyBefore = months.some(m => m.beforeReliable)
  const firstReliable = months.find(m => !m.beforeReliable)
  // The axis names every month it draws. "Sep 2026" is wide enough that a
  // twelve-month view drops half its labels, so the axis prints "Sep 26" (or
  // "Sep" inside a single year) and the full month rides along as the drawn
  // label's title, the tooltip heading and the table row.
  const crossesYear = spansYears(months.map(m => m.key))
  return (
    <ColumnChart
      ariaLabel="Client price against our cost by delivery month, on surveys with both"
      title="By delivery month"
      info="Client price (teal) and our cost (navy) on the same surveys: the ones with both a price and a recorded cost. The hatched bar is spend on delivered surveys with no client price. We keep % sits in the strip above; the count under each month is surveys with a price and a cost, out of all delivered. Click a month to see its surveys."
      data={months}
      x={m => m.label}
      xShort={m => monthShort(m.key, crossesYear)}
      xKey={m => m.key}
      xLabel="Month"
      series={[
        { key: 'price', label: 'Client price', value: m => m.price, color: 'var(--chart-price)', description: 'What clients pay on the month’s surveys that have both a price and a recorded cost.' },
        { key: 'cost', label: 'Our cost', value: m => m.cost, color: 'var(--chart-cost)', description: 'Recorded field cost on the same surveys, net of rewards recovered.' },
        { key: 'noprice', label: 'Spend with no price', value: m => m.spendNoPrice, hatch: true, description: 'Spend on the month’s delivered surveys that carry no client price. No margin figure can see it.' },
      ]}
      valueFormat={v => fmtMoney(v)}
      axisFormat={v => fmtMoneyCompact(v)}
      overlay={{
        label: 'We keep %',
        value: m => m.keptPct,
        format: v => fmtPct(v),
        color: 'var(--chart-keep)',
        description: `Client price minus our cost, as a share of the price, on the month’s surveys with both. The goal is ${goalKeptWords()}.`,
      }}
      subLabel={{
        name: 'Priced of delivered',
        text: m => `${fmtCount(m.surveys)} of ${fmtCount(m.delivered)}`,
        description: 'Surveys with both a client price and a recorded cost, out of every delivered survey in the month.',
      }}
      opacity={m => (m.beforeReliable ? OPACITY_BEFORE : m.thin ? OPACITY_THIN : 1)}
      opacityNote={anyBefore ? 'costs not recorded yet, or few priced surveys' : 'few priced surveys this month'}
      note={m => [m.note, m.recoveriesPending ? `Reward recoveries still pending: ${fmtCount(m.creditedSurveys)} of ${fmtCount(m.rewardedSurveys)} blast surveys have theirs booked` : null].filter(Boolean).join('. ') || null}
      rules={anyBefore && costReliableFrom && firstReliable?.key === costReliableFrom
        ? [{ at: costReliableFrom, label: `costs recorded from ${monthLabel(costReliableFrom)}` }]
        : []}
      onSelect={onSelect}
      emptyMessage="No delivered survey in this view has a date to place it in a month."
    />
  )
}
