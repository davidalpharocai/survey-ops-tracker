'use client'

import Link from 'next/link'
import { BarChart, ColumnChart, LineChart, fmtPct, type CategoryRule, type Series } from '@/components/charts'
import { fmtNum } from '@/lib/utils/number'
import { formatRange, monthBounds } from '@/lib/insights/range'
import { insightsHref, NO_CAPTAIN } from '@/lib/insights/filters'
import {
  CYCLE_DAYS_GOAL, NO_ACCOUNT, ON_TIME_GOAL, daysText, pctText, typeHelp, typeLabel,
  type GroupRow, type InsightsModel, type MonthRow,
} from '@/lib/insights/model'
import { InsightsCard } from './InsightsCard'
import type { OpenDrill } from './drill'

/** One colour per type, in a fixed order so PS is always the same blue.
 *  "No type set" is drawn with the grey no-data hatch: it is missing
 *  information, not a category. */
const TYPE_COLOR: Record<string, string> = {
  PS: 'var(--chart-cat-1)',
  B2B: 'var(--chart-cat-2)',
  Rerun: 'var(--chart-cat-3)',
}
const EXTRA_COLORS = ['var(--chart-cat-4)', 'var(--chart-cat-5)', 'var(--chart-cat-6)']
const typeColor = (k: string, i: number) => TYPE_COLOR[k] ?? EXTRA_COLORS[i % EXTRA_COLORS.length]

const s = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`

export function DeliveredCharts({ model: m, open }: { model: InsightsModel; open: OpenDrill }) {
  const f = m.filter
  const words = m.filterWords.length ? ' · ' + m.filterWords.join(' · ') : ''

  /* ── THE MONTH CARDS AND THE DATE RANGE ──────────────────────────────────
   * A month chart always draws at least MIN_TREND_MONTHS months (range.ts),
   * so "This month", "This quarter" and "Since 1 Jun" can all land on the
   * same six-month axis and look alike. That padding is deliberate — one
   * column with no neighbours is not a trend — but it left the reader with
   * almost nothing to see when the preset changed (David, 2026-09-28:
   * "nothing happens on the date range in the graph when i change it in the
   * filters").
   *
   * Two answers, neither of which touches the months drawn:
   *   the RULE  — a labelled dashed line where the chosen dates begin, so the
   *               window is a thing on the chart and not just a wash. The
   *               months always END on the range's last month (trendMonths),
   *               so only the start can fall inside the picture: one rule.
   *   the CHIP  — the words say the range and how much of the picture is
   *               context, so the card changes even where the pixels barely
   *               can. */
  const firstIn = m.months.findIndex(d => d.coverage !== 'out')
  const rangeRule: CategoryRule[] = firstIn > 0
    ? [{ at: m.months[firstIn].key, label: `Your dates: ${m.rangeLabel}` }]
    : []
  const contextMonths = m.months.filter(d => d.coverage === 'out').length
  const monthScope = [
    'Delivered',
    'by deliver month',
    m.rangeLabel,
    contextMonths > 0 ? `${s(contextMonths, 'earlier month')} for context` : null,
    ...m.filterWords,
  ].filter(Boolean).join(' · ')
  // The months outside the chosen dates, drawn the same way on all three
  // month charts: washed out, still hoverable, still clickable.
  const outOfRange = (d: MonthRow) => (d.coverage === 'out' ? 0.35 : 1)
  const OUT_NOTE = 'outside your dates, shown for context'

  const monthNote = (d: MonthRow) => {
    const where = d.coverage === 'out' ? 'Outside your dates — shown for context'
      : d.coverage === 'partial' ? (d.running ? 'This month so far' : 'Only part of this month is in your dates; the column counts the whole month')
        : d.running ? 'This month so far' : null
    // An old month can be missing deliveries that have no deliver date; say
    // how many probably belong here, so a short column is not read as a slow
    // month.
    const missing = d.undated > 0
      ? `${s(d.undated, 'more delivered study', 'more delivered studies')} with no deliver date probably ${d.undated === 1 ? 'belongs' : 'belong'} here (by due, launch or submitted date) and ${d.undated === 1 ? 'is' : 'are'} not in the column`
      : null
    return [where, missing].filter(Boolean).join('. ') || null
  }

  const openMonth = (d: MonthRow, q: { judgedOnly?: boolean; cycleOnly?: boolean }, expected: number, what: string) => {
    const b = monthBounds(d.key)
    open({
      key: `month-${d.key}-${what}`,
      title: `${what} · ${d.long}`,
      population: `Delivered · ${d.long}${words}`,
      query: { kind: 'delivered', month: d.key, ...q },
      expected,
      expectedWhere: 'on the chart',
      filterHref: insightsHref(f, { range: { preset: 'custom', from: b.from, to: b.to } }),
      filterLabel: `Filter the page to ${formatRange(b)}`,
    })
  }

  const series: Series<MonthRow>[] = m.monthTypes.map((k, i) => ({
    key: k,
    label: typeLabel(k),
    value: d => d.byType[k] ?? 0,
    color: typeColor(k, i),
    hatch: k === 'none',
    description: typeHelp(k),
  }))

  const openGroup = (
    g: GroupRow,
    dim: 'captain' | 'type' | 'account',
    title: string,
  ) => {
    const patch = dim === 'captain' ? { captain: g.key } : dim === 'type' ? { type: g.key as typeof f.type } : { account: g.key }
    const canFilter = !(dim === 'account' && g.key === NO_ACCOUNT)
    open({
      key: `${dim}-${g.key}`,
      title: `${title} · ${g.label}`,
      population: `${m.scopeBase} · ${g.label}`,
      query: dim === 'captain' ? { kind: 'delivered', captain: g.key }
        : dim === 'type' ? { kind: 'delivered', type: g.key }
          : { kind: 'delivered', account: g.key },
      expected: g.count,
      expectedWhere: 'on the bar',
      filterHref: canFilter ? insightsHref(f, patch) : undefined,
      filterLabel: canFilter ? `Filter the page to ${g.label}` : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <InsightsCard
        title="Delivered per month"
        help="Studies delivered each calendar month, stacked by type, placed by deliver date. The months in your dates are solid; the months before them are faded and shown for context, with a dashed rule where your dates begin (on the first month they touch — a month is drawn whole even when your dates cover part of it). Click a month for its studies."
        scope={monthScope}
        verdict={m.verdicts.months}
      >
        <ColumnChart
          ariaLabel="Studies delivered per month, by type"
          mode="stacked"
          data={m.months}
          x={d => d.long}
          xShort={d => d.short}
          xKey={d => d.key}
          xLabel="Month"
          series={series}
          topLabel={{ name: 'Total', text: d => fmtNum(d.total), description: 'Every type together' }}
          opacity={outOfRange}
          opacityNote={OUT_NOTE}
          rules={rangeRule}
          note={monthNote}
          emptyMessage="No delivered studies in these months"
          onSelect={d => openMonth(d, {}, d.total, 'Delivered')}
        />
      </InsightsCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsightsCard
          title="On time, by month"
          help={`The share of each month's deliveries that arrived on or before the due date, of those with a due date. The dashed line is the ${pctText(ON_TIME_GOAL)} goal — a goal, not a rule. A month with no due dates to judge breaks the line rather than inventing a figure. Months before your dates are faded and shown for context, with a dashed rule where your dates begin.`}
          scope={monthScope}
          verdict={m.verdicts.onTime}
        >
          <LineChart
            ariaLabel="Share of deliveries on time, by month"
            data={m.months}
            x={d => d.long}
            xShort={d => d.short}
            xKey={d => d.key}
            xLabel="Month"
            series={[{ key: 'ot', label: 'On time', value: d => d.onTimePct, color: 'var(--chart-keep)', description: 'Delivered on or before the due date, of those with a due date' }]}
            valueFormat={v => fmtPct(v)}
            yDomain={[0, 1]}
            referenceLines={[{ value: ON_TIME_GOAL, label: `Goal ${fmtPct(ON_TIME_GOAL)}`, color: 'var(--chart-goal)' }]}
            opacity={outOfRange}
            opacityNote={OUT_NOTE}
            rules={rangeRule}
            note={d => (d.judged ? `${fmtNum(d.onTime)} of ${s(d.judged, 'study', 'studies')} with a due date` : 'No due dates to judge')}
            emptyMessage="No delivered study here has a due date"
            onSelect={d => openMonth(d, { judgedOnly: true }, d.judged, 'On time')}
          />
        </InsightsCard>

        <InsightsCard
          title="Median cycle time, by month"
          help={`Calendar days from submitted to delivered for the middle study each month. Lower is faster. The dashed line is the goal of ${daysText(CYCLE_DAYS_GOAL)} — a goal, not a rule. Studies missing either date are left out. Months before your dates are faded and shown for context, with a dashed rule where your dates begin.`}
          scope={monthScope}
          verdict={m.verdicts.cycle}
        >
          <LineChart
            ariaLabel="Median days from submitted to delivered, by month"
            data={m.months}
            x={d => d.long}
            xShort={d => d.short}
            xKey={d => d.key}
            xLabel="Month"
            series={[{ key: 'cy', label: 'Median days', value: d => d.cycleMedian, color: 'var(--chart-cat-7)', description: 'Calendar days from submitted to delivered, middle study' }]}
            valueFormat={v => daysText(v)}
            axisFormat={v => fmtNum(v)}
            referenceLines={[{ value: CYCLE_DAYS_GOAL, label: `Goal ${daysText(CYCLE_DAYS_GOAL)}`, color: 'var(--chart-goal)' }]}
            opacity={outOfRange}
            opacityNote={OUT_NOTE}
            rules={rangeRule}
            note={d => (d.cycleN ? `Median of ${s(d.cycleN, 'study', 'studies')}` : 'No studies with both dates')}
            area
            emptyMessage="No delivered study here has both a submitted and a deliver date"
            onSelect={d => openMonth(d, { cycleOnly: true }, d.cycleN, 'Cycle time')}
          />
        </InsightsCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsightsCard
          title="Delivered by captain"
          help="Studies delivered in your dates, by the study's lead captain. Co-captains are not counted, so each study appears once. Click a bar for the studies."
          scope={m.scope}
          verdict={m.verdicts.captain}
        >
          <BarChart
            ariaLabel="Studies delivered by captain"
            data={m.byCaptain}
            label={d => d.label}
            labelHeader="Captain"
            value={d => d.count}
            valueName="Delivered"
            valueLabel={{ name: 'Delivered · share', text: d => `${fmtNum(d.count)} · ${pctText(d.share)}` }}
            color={d => (d.key === NO_CAPTAIN ? 'var(--chart-muted)' : 'var(--chart-cat-1)')}
            note={d => (d.key === NO_CAPTAIN ? 'No captain recorded on these studies' : null)}
            emptyMessage="No studies delivered in this view"
            onSelect={d => openGroup(d, 'captain', 'Delivered')}
          />
        </InsightsCard>

        <InsightsCard
          title="Delivered by type"
          help="Studies delivered in your dates, by what the study mainly is. Click a bar for the studies."
          scope={m.scope}
          verdict={m.verdicts.type}
        >
          <BarChart
            ariaLabel="Studies delivered by type"
            data={m.byType}
            label={d => d.label}
            labelHeader="Type"
            value={d => d.count}
            valueName="Delivered"
            valueLabel={{ name: 'Delivered · share', text: d => `${fmtNum(d.count)} · ${pctText(d.share)}` }}
            color={d => (d.key === 'none' ? 'var(--chart-muted)' : typeColor(d.key, 0))}
            note={d => d.help}
            emptyMessage="No studies delivered in this view"
            onSelect={d => openGroup(d, 'type', 'Delivered')}
          />
        </InsightsCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsightsCard
          title="Delivered by account"
          help="The accounts that received the most studies in your dates, grouped by the account record (not the free-text client label, which splits one firm many ways). Click a bar for the studies."
          scope={m.scope}
          verdict={m.verdicts.account}
        >
          <BarChart
            ariaLabel="Studies delivered by account"
            data={m.byAccount}
            label={d => d.label}
            labelHeader="Account"
            value={d => d.count}
            valueName="Delivered"
            valueLabel={{ name: 'Delivered · share', text: d => `${fmtNum(d.count)} · ${pctText(d.share)}` }}
            color={d => (d.key === NO_ACCOUNT ? 'var(--chart-muted)' : 'var(--chart-cat-2)')}
            emptyMessage="No studies delivered in this view"
            onSelect={d => openGroup(d, 'account', 'Delivered')}
          />
          {m.accountsMore.accounts > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              And {s(m.accountsMore.accounts, 'more account')} with {s(m.accountsMore.surveys, 'study', 'studies')} between them.
            </p>
          )}
        </InsightsCard>

        <InsightsCard
          title="Biggest deliveries"
          help="The delivered studies in your dates with the most respondents (post-QA N). Studies with no respondent count recorded are not ranked."
          scope={m.scope}
          verdict={m.verdicts.biggest}
        >
          {m.biggest.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No respondent counts recorded in this view.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2 font-medium" title="The study's code; opens the project">Study</th>
                  <th className="py-1 pr-2 font-medium" title="Project name and account">What</th>
                  <th className="py-1 pr-2 text-right font-medium" title="The deliver date">Delivered</th>
                  <th className="py-1 text-right font-medium" title="Respondents that passed QA (post-QA N)">Respondents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {m.biggest.map(b => (
                  <tr key={b.id} className="align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <Link href={`/projects/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{b.code}</Link>
                    </td>
                    <td className="w-full max-w-0 py-1.5 pr-2">
                      <span className="block truncate text-foreground" title={b.name}>{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground" title={`${b.account} · ${b.type}`}>{b.account} · {b.type}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">{b.deliver ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium text-foreground">{fmtNum(b.respondents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </InsightsCard>
      </div>
    </div>
  )
}
