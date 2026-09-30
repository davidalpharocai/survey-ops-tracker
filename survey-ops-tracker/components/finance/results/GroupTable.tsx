'use client'

/**
 * The Tile 2 table for every grouping except Survey and Panel supplier.
 *
 * Price and cost are both per BILLED respondent, so the two per-respondent
 * columns subtract to what we keep per respondent. A group whose margin
 * surveys span more than one route prints no per-respondent figure on its own
 * row — a $3 panel price averaged with a $150 blast price describes the mix,
 * not the client — and splits into route rows beneath it that do.
 */

import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { money, moneyOrDash, pctText } from '@/lib/finance/format'
import {
  goalKeptWords, GROUP_BY_OPTIONS, GROUP_MIN_N,
  type GroupRow, type GroupRouteRow, type ResultsGroupBy,
} from '@/lib/finance/results'
import { KEEP_GOAL } from '@/lib/finance/revenue'
import type { Route } from '@/lib/finance/hub'
import { fmtNum } from '@/lib/utils/number'

const COLS: { key: string; label: string; tip: string; num?: boolean }[] = [
  { key: 'n', label: 'In margin / all', tip: 'Studies with both a client price and a recorded cost, out of every delivered study in the group. The money columns count only the first number.', num: true },
  { key: 'price', label: 'Client price', tip: 'What clients pay on those studies: price per N × billed N.', num: true },
  { key: 'cost', label: 'Our cost', tip: 'Recorded field cost on the same studies, net of rewards recovered. No salaries or overhead.', num: true },
  { key: 'kept', label: 'Kept $', tip: 'Client price minus our cost, before salaries and overhead.', num: true },
  { key: 'pct', label: 'Kept %', tip: `Kept $ ÷ client price. The goal is ${goalKeptWords()}: green at or above it, red below zero.`, num: true },
  { key: 'ppn', label: 'Price per billed N', tip: 'Client price ÷ billed N: what the group pays per respondent. Blank on a row that blends routes, because a panel price averaged with a blast price describes the mix.', num: true },
  { key: 'cpn', label: 'Cost per billed N', tip: 'Our cost ÷ billed N, on the same respondents as the price, so the two subtract to what we keep per respondent. A study whose segment counts do not add up is left out of both figures.', num: true },
  { key: 'np', label: 'Spend with no price', tip: 'Spend on the group’s delivered studies that carry no client price: money no margin figure can see. Click it to see those studies.', num: true },
]

const pctTone = (p: number | null) =>
  p == null ? 'text-muted-foreground'
    : p < 0 ? 'text-[var(--chart-loss)]'
      : p >= KEEP_GOAL ? 'text-[var(--chart-keep)]' : ''

const button = 'rounded text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]'

/** Why a per-respondent cell reads as it does. A row that blends routes shows
 *  its figures on the route rows beneath. A survey whose N actual counts only
 *  some of its segments is left out of BOTH figures — its cost covers every
 *  segment and that N does not — so the cell says how many were dropped rather
 *  than quietly printing a cost per respondent that is too high. */
const perRespondentTitle = (blended: boolean, excluded: number, value: number | null) => {
  if (blended) return 'Blends routes: see the route rows below'
  if (excluded === 0) return undefined
  const s = excluded === 1
    ? '1 study is left out: its segment counts do not add up, so its cost covers segments its N does not.'
    : `${fmtNum(excluded)} studies are left out: their segment counts do not add up, so their cost covers segments their N does not.`
  return value == null ? `${s} Nothing is left to measure here.` : s
}

export function GroupTable({ by, rows, onGroup, onUnpriced }: {
  by: ResultsGroupBy
  rows: GroupRow[]
  onGroup: (row: GroupRow, route?: Route) => void
  onUnpriced: (row: GroupRow) => void
}) {
  const head = GROUP_BY_OPTIONS.find(o => o.id === by)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-3 py-1.5 text-left font-medium">
              <span className="inline-flex items-center">{head?.label ?? 'Group'}<InfoTooltip text={head?.help ?? 'The group.'} /></span>
            </th>
            {COLS.map(c => (
              <th key={c.key} scope="col" className={'px-3 py-1.5 font-medium ' + (c.num ? 'text-right' : 'text-left')}>
                <span className="inline-flex items-center justify-end">{c.label}<InfoTooltip text={c.tip} /></span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(r => (
            <GroupRows key={r.key} row={r} onGroup={onGroup} onUnpriced={onUnpriced} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ row: r, onGroup, onUnpriced }: {
  row: GroupRow
  onGroup: (row: GroupRow, route?: Route) => void
  onUnpriced: (row: GroupRow) => void
}) {
  const muted = r.measured > 0 && r.tooFew
  return (
    <>
      <tr className={muted ? 'text-muted-foreground' : ''}>
        <th scope="row" className="px-3 py-1.5 text-left font-medium">
          {r.measured > 0 ? (
            <button type="button" className={button} onClick={() => onGroup(r)}
              title={`Show the ${fmtNum(r.measured)} studies behind ${r.label}, worst first`}>
              {r.label}
            </button>
          ) : r.label}
          {r.sub && <span className="block text-[11px] font-normal text-muted-foreground">{r.sub}</span>}
          {muted && (
            <span className="ml-1.5 rounded-full border border-dashed border-border px-1.5 text-[10px] font-normal"
              title={`Fewer than ${fmtNum(GROUP_MIN_N)} studies with a price and a cost: one study's price is not a group's pricing.`}>
              too few to judge
            </span>
          )}
        </th>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.measured)} / {fmtNum(r.surveys)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{r.measured > 0 ? money(r.revenue) : '—'}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{r.measured > 0 ? money(r.cost) : '—'}</td>
        <td className={'px-3 py-1.5 text-right tabular-nums ' + (r.measured > 0 && r.kept < 0 ? 'text-[var(--chart-loss)]' : '')}>
          {r.measured > 0 ? money(r.kept) : '—'}
        </td>
        <td className={'px-3 py-1.5 text-right tabular-nums ' + pctTone(r.keptPct)}>{pctText(r.keptPct)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums"
          title={perRespondentTitle(r.blended, r.partialExcluded, r.pricePerBilledN)}>
          {r.blended ? '—' : moneyOrDash(r.pricePerBilledN)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums"
          title={perRespondentTitle(r.blended, r.partialExcluded, r.costPerBilledN)}>
          {r.blended ? '—' : moneyOrDash(r.costPerBilledN)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {r.unpricedSurveys > 0 ? (
            <button type="button" className={button} onClick={() => onUnpriced(r)}
              title={`Show the ${fmtNum(r.unpricedSurveys)} studies with spend and no client price`}>
              {money(r.unpricedSpend)}
            </button>
          ) : <span className="text-muted-foreground">$0</span>}
        </td>
      </tr>
      {r.routes.map((x: GroupRouteRow) => (
        <tr key={`${r.key}-${x.route}`} className="bg-muted/20 text-[12px] text-muted-foreground">
          <th scope="row" className="py-1 pl-7 pr-3 text-left font-normal">
            <button type="button" className={button} onClick={() => onGroup(r, x.route)}
              title={`Show ${r.label}'s ${x.label.toLowerCase()} studies, worst first`}>
              {x.label}
            </button>
          </th>
          <td className="px-3 py-1 text-right tabular-nums">{fmtNum(x.measured)}</td>
          <td className="px-3 py-1 text-right tabular-nums">{money(x.revenue)}</td>
          <td className="px-3 py-1 text-right tabular-nums">{money(x.cost)}</td>
          <td className={'px-3 py-1 text-right tabular-nums ' + (x.kept < 0 ? 'text-[var(--chart-loss)]' : '')}>{money(x.kept)}</td>
          <td className={'px-3 py-1 text-right tabular-nums ' + pctTone(x.keptPct)}>{pctText(x.keptPct)}</td>
          <td className="px-3 py-1 text-right tabular-nums"
            title={perRespondentTitle(false, x.partialExcluded, x.pricePerBilledN)}>
            {moneyOrDash(x.pricePerBilledN)}
          </td>
          <td className="px-3 py-1 text-right tabular-nums"
            title={perRespondentTitle(false, x.partialExcluded, x.costPerBilledN)}>
            {moneyOrDash(x.costPerBilledN)}
          </td>
          <td className="px-3 py-1" />
        </tr>
      ))}
    </>
  )
}
