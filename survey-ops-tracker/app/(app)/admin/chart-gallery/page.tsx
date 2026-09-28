'use client'

/**
 * /admin/chart-gallery — every chart primitive in components/charts, drawn on
 * MADE-UP data. Deliberately unlinked: it is a workbench for whoever builds
 * the Finance and Insights charts, and a place to eyeball light/dark mode
 * and phone width without real data in the way.
 *
 * SAMPLE DATA ONLY. /admin is reachable by every analyst, and analysts must
 * never see client prices or our costs — so nothing here may be a real
 * client name or a real finance figure. Every number below is invented,
 * round, and deliberately a different size from the book (small dollar
 * amounts, generic "Lever A" / "Route A" names), so it cannot be mistaken
 * for it or used to back into it. Keep it that way when adding samples.
 */

import { useState, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  BarChart,
  BulletChart,
  ColumnChart,
  DumbbellChart,
  Heatmap,
  LineChart,
  RangeChart,
  Sparkline,
  fmtCount,
  fmtMoney,
  fmtMoneyCompact,
  fmtPct,
  type HeatCell,
} from '@/components/charts'

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'

// ─── sample data (invented) ─────────────────────────────────────────────────

interface MonthMoney {
  month: string
  price: number | null
  cost: number | null
  unpriced: number
  surveys: number
  coverage: number
}
const MONTHS: MonthMoney[] = [
  { month: 'Apr', price: null, cost: null, unpriced: 400, surveys: 0, coverage: 0.2 },
  { month: 'May', price: 600, cost: 400, unpriced: 900, surveys: 1, coverage: 0.4 },
  { month: 'Jun', price: 3000, cost: 1800, unpriced: 5000, surveys: 5, coverage: 1 },
  { month: 'Jul', price: 7000, cost: 3000, unpriced: 6000, surveys: 8, coverage: 1 },
  { month: 'Aug', price: 8000, cost: 5000, unpriced: 6000, surveys: 15, coverage: 1 },
  { month: 'Sep', price: 9000, cost: 6000, unpriced: 1000, surveys: 20, coverage: 1 },
]
const keptPct = (d: MonthMoney) => (d.price && d.cost != null ? (d.price - d.cost) / d.price : null)

interface TypeMonth {
  month: string
  panel: number
  blast: number
  both: number
}
const DELIVERED: TypeMonth[] = [
  { month: 'Apr', panel: 12, blast: 4, both: 1 },
  { month: 'May', panel: 14, blast: 5, both: 1 },
  { month: 'Jun', panel: 22, blast: 10, both: 2 },
  { month: 'Jul', panel: 24, blast: 12, both: 3 },
  { month: 'Aug', panel: 28, blast: 13, both: 2 },
  { month: 'Sep', panel: 25, blast: 15, both: 4 },
]

const totalOf = (d: TypeMonth) => d.panel + d.blast + d.both
const lastOf = <T,>(rows: T[]): T => rows[rows.length - 1]
const ON_TIME_GOAL = 0.9
const MONTHLY_GOAL = 40

interface Group {
  name: string
  kept: number
  pct: number
  n: number
}
const GROUPS: Group[] = [
  { name: 'Account A', kept: 3000, pct: 0.5, n: 9 },
  { name: 'Account B', kept: 2600, pct: 0.4, n: 7 },
  { name: 'Account C', kept: 2100, pct: 0.3, n: 16 },
  { name: 'Account D', kept: 1500, pct: 0.6, n: 5 },
  { name: 'Account E', kept: 400, pct: 0.3, n: 3 },
  { name: 'Account F with a long name that has to be cut', kept: 2000, pct: 0.8, n: 1 },
  { name: 'Account G', kept: -300, pct: -0.5, n: 1 },
  { name: 'Account H', kept: -150, pct: -0.2, n: 4 },
]

const CAPTAINS = [
  { name: 'Captain A', delivered: 41 },
  { name: 'Captain B', delivered: 33 },
  { name: 'Captain C', delivered: 27 },
  { name: 'Captain D', delivered: 12 },
]

interface Trend {
  month: string
  onTime: number | null
  cycle: number | null
}
const TRENDS: Trend[] = [
  { month: 'Apr', onTime: 0.7, cycle: 15 },
  { month: 'May', onTime: 0.74, cycle: 14 },
  { month: 'Jun', onTime: 0.8, cycle: 12 },
  { month: 'Jul', onTime: null, cycle: 11 },
  { month: 'Aug', onTime: 0.88, cycle: 10 },
  { month: 'Sep', onTime: 0.92, cycle: 8 },
]

interface Live {
  code: string
  who: string
  spend: number
  contract: number | null
  budget: number | null
  collected: number
  target: number
}
const LIVE: Live[] = [
  { code: 'SAMPLE-101', who: 'Account A · Fielding', spend: 1200, contract: 2000, budget: 900, collected: 170, target: 200 },
  { code: 'SAMPLE-102', who: 'Account C · Data QA', spend: 1400, contract: 2500, budget: 1100, collected: 300, target: 300 },
  { code: 'SAMPLE-103', who: 'Account B · Fielding', spend: 2200, contract: 2000, budget: 800, collected: 260, target: 200 },
  { code: 'SAMPLE-104', who: 'Account E · Fielding (no price yet)', spend: 300, contract: null, budget: 600, collected: 40, target: 150 },
  { code: 'SAMPLE-105', who: 'Account D · Fielding (a free trial)', spend: 250, contract: 0, budget: null, collected: 80, target: 100 },
]

interface Route {
  route: string
  perComplete: number
  perQualified: number
  removed: number
  box: { low: number; median: number; high: number }
  n: number
}
const ROUTES: Route[] = [
  { route: 'Route A (sample)', perComplete: 12, perQualified: 18, removed: 0.3, box: { low: 9, median: 16, high: 25 }, n: 20 },
  { route: 'Route B (sample)', perComplete: 0.8, perQualified: 1.2, removed: 0.3, box: { low: 0.6, median: 1, high: 1.9 }, n: 30 },
]

interface Lever {
  name: string
  low: number | null
  high: number | null
  confidence: string
  gives: string
}
const SAVE: Lever[] = [
  { name: 'Lever A: stop a costly habit', low: 0, high: 4000, confidence: 'Depends on others', gives: 'May leave a hard survey short' },
  { name: 'Lever B: renegotiate a rate', low: 1000, high: 2500, confidence: 'Measured', gives: 'Needs an invoice first' },
  { name: 'Lever C: buy the cheaper option first', low: null, high: 1500, confidence: 'Direction only', gives: 'Capacity is not recorded' },
  { name: 'Lever D: stop early', low: 500, high: 1200, confidence: 'Measured', gives: 'Gives up some completes' },
  { name: 'Lever E: on a small slice', low: null, high: null, confidence: 'Measured', gives: 'Widen the date range to see it' },
]
const EARN: Lever[] = [
  { name: 'Lever F: sell a range next time', low: null, high: 1800, confidence: 'Direction only', gives: 'Most of it is planned cushion' },
  { name: 'Lever G: top up short surveys', low: 600, high: 1400, confidence: 'Measured', gives: 'Costs field time' },
]

const COVERAGE_ROWS = [
  { key: 'cost', label: 'Any cost' },
  { key: 'price', label: 'Client price' },
  { key: 'n', label: 'Post-QA N' },
  { key: 'budget', label: 'Budget' },
  { key: 'date', label: 'Date' },
]
const COVERAGE_COLS = [
  ...['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'].map((m) => ({ key: m, label: m })),
  { key: 'und', label: 'Undated', shortLabel: 'Und.' },
]
const COVERAGE: HeatCell[] = [
  ...[0.1, 0.2, 0.3, 0.6, 0.7, 0.8, 0.9, 0.3].map((v, i) => ({ row: 'cost', col: COVERAGE_COLS[i].key, value: v })),
  ...[0, 0.1, 0.1, 0.2, 0.4, 0.6, 0.8, 0.2].map((v, i) => ({ row: 'price', col: COVERAGE_COLS[i].key, value: v })),
  ...[0.5, 0.6, 0.6, 0.7, 0.8, 0.9, 1, 0.3].map((v, i) => ({ row: 'n', col: COVERAGE_COLS[i].key, value: v })),
  ...[0, 0, 0.1, 0.1, 0.2, 0.4, 0.5, null].map((v, i) => ({ row: 'budget', col: COVERAGE_COLS[i].key, value: v })),
  ...[1, 1, 1, 1, 1, 1, 1].map((v, i) => ({ row: 'date', col: COVERAGE_COLS[i].key, value: v })),
]

const PANELS = ['Panel one', 'Panel two', 'Panel three', 'Panel four']
const DRIFT_COLS = ['May', 'Jun', 'Jul', 'Aug', 'Sep'].map((m) => ({ key: m, label: m }))
const DRIFT: (HeatCell & { panel: string })[] = PANELS.flatMap((p, pi) =>
  DRIFT_COLS.map((c, ci) => ({
    panel: p,
    row: p,
    col: c.key,
    value: pi === 3 && ci === 0 ? null : Math.round((2 + pi * 0.5 + ci * 0.3 * (pi % 2 ? 1.5 : 0.5)) * 100) / 100,
    weight: [900, 400, 150, 60][(pi + ci) % 4],
  })),
)

// ─── page ───────────────────────────────────────────────────────────────────

export default function ChartGalleryPage() {
  const [phone, setPhone] = useState(false)
  const [picked, setPicked] = useState<string>('nothing yet')
  const pick = (what: string) => setPicked(what)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Chart gallery</h1>
        <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Sample data
        </span>
        <span className="text-sm text-muted-foreground">
          Every chart building block, drawn on made-up numbers. No real clients, no real money.
        </span>
      </div>

      <div className={`${tile} flex flex-wrap items-center gap-x-6 gap-y-2 text-sm`}>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={phone} onChange={(e) => setPhone(e.target.checked)} />
          Preview at phone width
          <InfoTooltip text="Squeezes every chart to the width of a 390px phone screen (358px inside the page gutters), to check labels thin out instead of colliding." />
        </label>
        <span className="text-muted-foreground" aria-live="polite">
          Last clicked: <span className="font-medium text-foreground">{picked}</span>
          <InfoTooltip text="Charts that drill call back with the row behind the mark. Click a bar, or Tab to it and press Enter or Space." />
        </span>
      </div>

      <div className={phone ? 'mx-auto flex w-[358px] max-w-full flex-col gap-4' : 'flex flex-col gap-4'}>
        <Section title="Columns: price vs cost by month" tip="ColumnChart, grouped. Client price (teal) and our cost (navy) on the same surveys, a hatched bar for spend with no price, kept % in its own strip above (a second unit never shares the dollar axis), survey count under each month, and months with thin cost records faded. Click a month.">
          <ColumnChart
            ariaLabel="Client price vs our cost by delivery month (sample data)"
            data={MONTHS}
            x={(d) => d.month}
            xLabel="Month"
            series={[
              { key: 'price', label: 'Client price', value: (d) => d.price, color: 'var(--chart-price)', description: 'What clients pay on surveys with both a price and a cost.' },
              { key: 'cost', label: 'Our cost', value: (d) => d.cost, color: 'var(--chart-cost)', description: 'Recorded field cost on the same surveys.' },
              { key: 'np', label: 'Spend with no price', value: (d) => d.unpriced, hatch: true, description: 'Spend on surveys that carry no client price.' },
            ]}
            valueFormat={fmtMoney}
            axisFormat={fmtMoneyCompact}
            overlay={{ label: 'We keep', value: keptPct, format: (v) => fmtPct(v), color: 'var(--chart-keep)' }}
            subLabel={{ name: 'Surveys', text: (d) => `${fmtCount(d.surveys)} surv.` }}
            opacity={(d) => d.coverage}
            opacityNote="costs not reliably recorded"
            note={(d) => (d.coverage < 1 ? 'Costs not reliably recorded this month' : null)}
            rules={[{ at: 'Jun', label: 'costs reliable from here' }]}
            onSelect={(d) => pick(`month ${d.month}`)}
          />
        </Section>

        <Section title="Stacked columns: surveys delivered by type" tip="ColumnChart, stacked, categorical colours in fixed order. A dashed goal line. No money: this is the analyst dashboard shape.">
          <ColumnChart
            ariaLabel="Surveys delivered per month by type (sample data)"
            mode="stacked"
            data={DELIVERED}
            x={(d) => d.month}
            xLabel="Month"
            series={[
              { key: 'panel', label: 'Panel', value: (d) => d.panel, color: 'var(--chart-cat-1)' },
              { key: 'blast', label: 'B2B blast', value: (d) => d.blast, color: 'var(--chart-cat-2)' },
              { key: 'both', label: 'Both', value: (d) => d.both, color: 'var(--chart-cat-3)' },
            ]}
            topLabel={{ name: 'Total', text: (d) => fmtCount(d.panel + d.blast + d.both) }}
            referenceLines={[{ value: MONTHLY_GOAL, label: `Goal: ${fmtCount(MONTHLY_GOAL)} a month` }]}
            onSelect={(d) => pick(`delivered ${d.month}`)}
          />
        </Section>

        <Section title="Diverging bars: what we keep by account" tip="BarChart, diverging. Teal to the right of zero, red to the left, labelled kept % · surveys. Accounts with fewer than 3 surveys are faded and tagged. At phone width the names move above the bars.">
          <BarChart
            ariaLabel="What we keep by account (sample data)"
            data={GROUPS}
            label={(d) => d.name}
            labelHeader="Account"
            value={(d) => d.kept}
            valueName="We keep"
            valueFormat={fmtMoney}
            valueLabel={{ name: 'We keep · kept % · surveys', text: (d) => `${fmtMoneyCompact(d.kept)} · ${fmtPct(d.pct)} · ${d.n}` }}
            diverging
            positiveLabel="Kept"
            negativeLabel="Lost"
            muted={(d) => d.n < 3}
            onSelect={(d) => pick(d.name)}
          />
        </Section>

        <Section title="Bars: surveys delivered by captain" tip="BarChart, plain. One series, one colour, so no legend box.">
          <BarChart
            ariaLabel="Surveys delivered by captain (sample data)"
            data={CAPTAINS}
            label={(d) => d.name}
            labelHeader="Captain"
            value={(d) => d.delivered}
            valueName="Delivered"
            onSelect={(d) => pick(d.name)}
          />
        </Section>

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Line: on-time delivery" tip="LineChart with a goal line and a labelled rule. July has no figure, so the line breaks instead of inventing one.">
            <LineChart
              ariaLabel="On-time delivery by month (sample data)"
              data={TRENDS}
              x={(d) => d.month}
              xLabel="Month"
              series={[{ key: 'ot', label: 'On time', value: (d) => d.onTime, color: 'var(--chart-cat-1)' }]}
              valueFormat={(v) => fmtPct(v)}
              yDomain={[0, 1]}
              referenceLines={[{ value: ON_TIME_GOAL, label: `Goal ${fmtPct(ON_TIME_GOAL)}` }]}
              rules={[{ at: 'Jun', label: 'new intake form' }]}
              onSelect={(d) => pick(`on-time ${d.month}`)}
            />
          </Section>
          <Section title="Line: cycle time (days)" tip="LineChart with an area wash. A separate chart from on-time %, because two units never share one axis.">
            <LineChart
              ariaLabel="Days from launch to delivery by month (sample data)"
              data={TRENDS}
              x={(d) => d.month}
              xLabel="Month"
              series={[{ key: 'c', label: 'Median days', value: (d) => d.cycle, color: 'var(--chart-cat-7)' }]}
              area
            />
          </Section>
        </div>

        <Section title="Bullets: live surveys this week" tip="BulletChart. Each row on its own scale: the teal track is the contract value (price × target), navy is spend so far (red past the contract value), the ink tick is the budget, the amber tick is the 50%-of-price goal, and the thin bar is N collected against target. A row with no price, or a $0 price (a free trial, 'given away'), shows spend against budget on a hatched track.">
          <BulletChart
            ariaLabel="Live surveys: spend against contract value (sample data)"
            data={LIVE}
            label={(d) => d.code}
            sublabel={(d) => d.who}
            value={(d) => d.spend}
            max={(d) => d.contract}
            budget={(d) => d.budget}
            goal={(d) => (d.contract == null ? null : d.contract * 0.5)}
            progress={(d) => ({ value: d.collected, target: d.target })}
            onSelect={(d) => pick(d.code)}
          />
        </Section>

        <Section title="Dumbbell: what one respondent costs" tip="DumbbellChart. The two routes differ about 15×, so each gets its own axis automatically. Ring = cost per complete bought, dot = cost per qualified respondent, the line between them is what QA removed, and the box is the typical survey (middle half, median ticked).">
          <DumbbellChart
            ariaLabel="Cost per respondent by route (sample data)"
            data={ROUTES}
            label={(d) => d.route}
            labelHeader="Route"
            sublabel={(d) => `${fmtCount(d.n)} surveys`}
            start={(d) => d.perComplete}
            end={(d) => d.perQualified}
            connectorLabel={(d) => `QA removed ${fmtPct(d.removed)}`}
            box={(d) => d.box}
            onSelect={(d) => pick(d.route)}
          />
        </Section>

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Ranges: save cost" tip="RangeChart. Each lever from its low to its high estimate, with a confidence tag. Faded levers say why. A lever with no figure draws no bar and says why instead. Cost savings and revenue are different dollars, so they get separate charts and are never added up.">
            <RangeChart
              ariaLabel="Ways to save cost (sample data)"
              data={SAVE}
              label={(d) => d.name}
              sublabel={(d) => d.gives}
              low={(d) => d.low}
              high={(d) => d.high}
              confidence={(d) => d.confidence}
              muted={(d) => d.confidence === 'Direction only'}
              mutedNote="direction only"
              missingText={() => 'too few surveys here to call'}
              valueName="Could save"
              axisFormat={fmtMoneyCompact}
              onSelect={(d) => pick(d.name)}
            />
          </Section>
          <Section title="Ranges: earn more" tip="RangeChart in the price colour, on its own axis.">
            <RangeChart
              ariaLabel="Ways to earn more (sample data)"
              data={EARN}
              label={(d) => d.name}
              sublabel={(d) => d.gives}
              low={(d) => d.low}
              high={(d) => d.high}
              confidence={(d) => d.confidence}
              color="var(--chart-price)"
              valueName="Could earn"
              axisFormat={fmtMoneyCompact}
            />
          </Section>
        </div>

        <Section title="Heatmap: what each month's records carry" tip="Heatmap, sequential. Each cell is the share of delivered surveys that month with that field. Labelled rules mark where the data becomes reliable; the highlighted months are what a date filter would select. The hatch means no figure at all. Click a cell (or Tab in and use the arrow keys).">
          <Heatmap
            ariaLabel="Record coverage by field and month (sample data)"
            rows={COVERAGE_ROWS}
            columns={COVERAGE_COLS}
            cells={COVERAGE}
            rowHeader="Field"
            valueName="Coverage"
            valueFormat={(v) => fmtPct(v)}
            domain={[0, 1]}
            rules={[
              { at: 'Jun', label: 'costs reliable from here' },
              { at: 'Aug', label: 'prices and budgets start here' },
            ]}
            highlight={['Jun', 'Jul', 'Aug', 'Sep']}
            onSelect={(c) => pick(`${c.row} · ${c.col}`)}
          />
        </Section>

        <Section title="Heatmap: panel price drift" tip="Heatmap with a weight: colour = price per complete, and the short line under each figure = how many completes stand behind that price (a full line is the most).">
          <Heatmap
            ariaLabel="Price per complete by panel and month (sample data)"
            rows={PANELS.map((p) => ({ key: p, label: p }))}
            columns={DRIFT_COLS}
            cells={DRIFT}
            rowHeader="Panel"
            valueName="Price per complete"
            valueFormat={fmtMoney}
            weightName="Completes"
            color="var(--chart-cost)"
          />
        </Section>

        <Section title="Sparklines in KPI tiles" tip="Sparkline. The tile prints the number; the line shows the trend, with an optional dashed goal.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Delivered this month" value={fmtCount(totalOf(lastOf(DELIVERED)))} sub={lastOf(DELIVERED).month}>
              <Sparkline ariaLabel="Surveys delivered per month" values={DELIVERED.map(totalOf)} labels={DELIVERED.map((d) => d.month)} />
            </Kpi>
            <Kpi label="On time" value={fmtPct(lastOf(TRENDS).onTime)} sub={`goal ${fmtPct(ON_TIME_GOAL)}`}>
              <Sparkline ariaLabel="On-time share per month" values={TRENDS.map((d) => d.onTime)} labels={TRENDS.map((d) => d.month)} goal={ON_TIME_GOAL} includeZero={false} valueFormat={(v) => fmtPct(v)} color="var(--chart-keep)" />
            </Kpi>
            <Kpi label="Median days" value={fmtCount(lastOf(TRENDS).cycle)} sub="launch to delivery">
              <Sparkline ariaLabel="Median days to deliver per month" values={TRENDS.map((d) => d.cycle)} labels={TRENDS.map((d) => d.month)} color="var(--chart-cat-7)" />
            </Kpi>
            <Kpi label="A brand-new measure" value="—" sub="no history yet">
              <Sparkline ariaLabel="A measure with no history" values={[]} />
            </Kpi>
          </div>
        </Section>

        <Section title="Edge cases" tip="What each chart does with nothing, one value, all zeros, or only losses. None of these may break the page or print $0 for a missing figure.">
          <div className="grid gap-4 md:grid-cols-2">
            <ColumnChart ariaLabel="Empty (sample)" title="No rows" data={[] as TypeMonth[]} x={(d) => d.month} series={[{ key: 'p', label: 'Panel', value: (d) => d.panel }]} />
            <ColumnChart ariaLabel="One value (sample)" title="A single month" data={[DELIVERED[0]]} x={(d) => d.month} series={[{ key: 'p', label: 'Panel', value: (d) => d.panel }]} />
            <ColumnChart
              ariaLabel="All zero (sample)"
              title="All zeros"
              data={DELIVERED.slice(0, 4)}
              x={(d) => d.month}
              series={[{ key: 'z', label: 'Zero', value: () => 0 }]}
            />
            <BarChart
              ariaLabel="Only losses (sample)"
              title="Only losses"
              data={GROUPS.filter((g) => g.kept < 0)}
              label={(d) => d.name}
              value={(d) => d.kept}
              valueFormat={fmtMoney}
              diverging
              positiveLabel="Kept"
              negativeLabel="Lost"
            />
          </div>
        </Section>

        <Section title="Number formats" tip="components/charts/format.ts. Negatives use the real minus sign, money under $10 keeps its cents, and a missing value prints a dash, never $0.">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-1 pr-4 font-medium" title="The function in components/charts/format.ts">Helper</th>
                <th className="py-1 pr-4 font-medium" title="The number passed in">Input</th>
                <th className="py-1 font-medium" title="What the chart prints">Prints</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(
                [
                  ['fmtMoney', -1234, fmtMoney(-1234)],
                  ['fmtMoney', 1.214, fmtMoney(1.214)],
                  ['fmtMoneyCompact', 12345, fmtMoneyCompact(12345)],
                  ['fmtMoneyCompact', 1234567, fmtMoneyCompact(1234567)],
                  ['fmtPct', 0.429, fmtPct(0.429)],
                  ['fmtCount', 1234567, fmtCount(1234567)],
                  ['fmtMoney', null, fmtMoney(null)],
                ] as [string, number | null, string][]
              ).map(([h, input, out], i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-4 font-mono text-xs">{h}</td>
                  <td className="py-1 pr-4">{input == null ? 'null' : String(input)}</td>
                  <td className="py-1 font-medium">{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, tip, children }: { title: string; tip: string; children: ReactNode }) {
  return (
    <section className={`${tile} min-w-0`}>
      <h2 className="mb-3 flex items-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {title}
        <InfoTooltip text={tip} />
      </h2>
      {children}
    </section>
  )
}

function Kpi({ label, value, sub, children }: { label: string; value: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold leading-tight text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
      {children}
    </div>
  )
}
