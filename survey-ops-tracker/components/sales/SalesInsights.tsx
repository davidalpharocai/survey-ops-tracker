'use client'

import Link from 'next/link'
import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { BarChart, ColumnChart, LineChart, fmtPct, type CategoryRule, type Series } from '@/components/charts'
import { InsightsCard } from '@/components/insights/InsightsCard'
import { fmtNum } from '@/lib/utils/number'
import { stageLabel } from '@/lib/utils/stage'
import { RANGE_PRESETS, type RangePreset } from '@/lib/insights/range'
import { parseInsightsFilter, TYPE_LABEL, type InsightsFilter, type TypeKey } from '@/lib/insights/filters'
import {
  CYCLE_DAYS_GOAL, NO_ACCOUNT, ON_TIME_GOAL, daysText, pctText, typeHelp, typeLabel,
  type Comparison, type GroupRow, type InsightsModel, type MonthRow,
} from '@/lib/insights/model'
import {
  PLACEHOLDER_MIGRATION, PLACEHOLDER_ON_FLAG_ALONE, SALES_DROPS,
  buildSalesInsights, salesInsightsHref, salesInsightsState, type SalesProjectRow,
} from '@/lib/sales/insights'

/**
 * /sales/insights — the same dashboard the analysts read, narrowed to one book.
 *
 * David, 2026-09-30: "in the sales view, they should be able to see an insights
 * type of dashboard catered to their book as well."
 *
 * ── IT RENDERS THE ANALYST MODEL, IT DOES NOT REBUILD IT ────────────────────
 * Every figure comes from lib/insights/model.ts through lib/sales/insights.ts.
 * This file lays them out and says what they rest on; it computes no count, no
 * share and no average. See the adapter's header for why that matters more than
 * the saved keystrokes.
 *
 * ── WHY IT IS NOT components/insights/InsightsDashboard ─────────────────────
 * That component is bound to the analyst tier in three ways that cannot be
 * configured away honestly: it reads survey_projects through useInsightsData
 * (a sales session gets zero rows — migration 102 dropped both policies), every
 * link it draws goes to /insights, /list or /surveys, and its captain slices
 * would render as one grey "No captain" bar over a whole book. So the model is
 * shared and the rendering is not.
 *
 * ── NO MONEY ANYWHERE, AND NOTHING INTERNAL ────────────────────────────────
 * Counts, days, percentages and respondent totals. No budget, no spend, no
 * price, no margin, no internal target — none of which sales_projects carries,
 * so there is nothing here to leak. No captain and no workload either: see
 * SALES_DROPS, printed at the foot of the page so the omission is a stated
 * choice rather than something a reader has to notice is missing.
 */

const s = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`

const TONE: Record<Comparison['tone'], string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-muted-foreground',
}

/** One colour per type, matching /insights so the same study is the same
 *  colour whichever dashboard you opened. */
const TYPE_COLOR: Record<string, string> = {
  PS: 'var(--chart-cat-1)',
  B2B: 'var(--chart-cat-2)',
  Rerun: 'var(--chart-cat-3)',
}
const EXTRA = ['var(--chart-cat-4)', 'var(--chart-cat-5)', 'var(--chart-cat-6)']
const typeColor = (k: string, i: number) => TYPE_COLOR[k] ?? EXTRA[i % EXTRA.length]

export interface SalesInsightsProps {
  rows: SalesProjectRow[]
  /** client_id → name. A plain object, not a Map: Maps do not survive the
   *  server/client boundary. */
  accounts: Record<string, string>
  owner: string | null
  /** Today in Eastern time, decided on the server so every figure on the page
   *  and every date in the rest of the sales shell agree. */
  today: string
}

export function SalesInsights({ rows, accounts, owner, today }: SalesInsightsProps) {
  const router = useRouter()
  const params = useSearchParams()
  const filter = useMemo(() => {
    const f = parseInsightsFilter(params)
    // No captain control exists here, so a captain in the URL would filter
    // every figure with nothing on screen saying so.
    return { ...f, captain: null }
  }, [params])

  const state = useMemo(() => salesInsightsState(rows), [rows])
  const built = useMemo(() => {
    if (state === 'needs-migration') return null
    return buildSalesInsights({
      rows, accounts: new Map(Object.entries(accounts)), filter, today, owner,
    })
  }, [rows, accounts, filter, today, owner, state])

  const onChange = useCallback((next: InsightsFilter) => {
    // replace, not push: a filter tweak is not a place in history worth a Back
    // press each.
    router.replace(salesInsightsHref(next), { scroll: false })
  }, [router])

  if (state === 'needs-migration' || !built) return <NeedsMigration />

  const m = built.model

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-base text-foreground" aria-live="polite">
        {built.headline}
      </p>

      <SalesFilterBar model={m} onChange={onChange} />
      <Tiles model={m} />
      <Months model={m} />
      <Breakdowns model={m} />
      <Biggest model={m} />
      <RightNow model={m} />

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center gap-x-1">
          <span>
            Left out of every figure above: {s(m.excluded.placeholders, 'empty rerun placeholder')}
            {m.excluded.internal > 0 && ` and ${s(m.excluded.internal, 'internal project')}`}.
          </span>
          <InfoTooltip text={`An empty rerun placeholder is a wave the system created ahead of time that holds no respondents yet — not work anyone did. ${PLACEHOLDER_ON_FLAG_ALONE}`} />
        </p>
        <p>{SALES_DROPS}</p>
        <p>Counts, days and respondents only: this page shows no dollar figures.</p>
      </div>
    </div>
  )
}

/**
 * The page before migration 130 lands.
 *
 * It draws NOTHING rather than drawing the overstated count behind a warning.
 * Without is_placeholder every empty auto-spawned rerun shell parked in the
 * Delivery column classifies as delivered work — 18 of them across four books
 * when this was measured, 8 on one. A delivered count is a number a salesperson
 * reads to a client, and an asterisk is not the place to put "this may be 6%
 * too high".
 */
function NeedsMigration() {
  return (
    <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-300">
      <p className="font-medium">This dashboard is not ready yet.</p>
      <p className="mt-1">
        It cannot tell a delivered study from an empty rerun wave the system created ahead of time, so every figure
        would count work that does not exist. Rather than show you a number that is too high, it shows you none.
      </p>
      <p className="mt-2 text-xs">
        Your AlphaROC administrator needs to apply <code className="rounded bg-muted px-1 py-0.5">{PLACEHOLDER_MIGRATION}</code>.
        Nothing else on the site is affected, and this page works the moment they do.
      </p>
    </div>
  )
}

/* ── FILTERS ────────────────────────────────────────────────────────────── */

/**
 * Range, type and account. No captain — see SALES_DROPS.
 *
 * Written rather than reusing components/insights/FilterBar for the one reason
 * that matters: that bar renders a Captain control, and a control this page
 * cannot honour is worse than no control.
 */
function SalesFilterBar({ model: m, onChange }: { model: InsightsModel; onChange: (f: InsightsFilter) => void }) {
  const f = m.filter
  const filtered = f.range.preset !== 'this-month' || f.type != null || f.account != null

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <Field id="sales-insights-range" label="Dates" help="Which studies count: a delivered study is placed by its deliver date.">
        <select
          id="sales-insights-range"
          className={SELECT}
          value={f.range.preset}
          onChange={e => onChange({ ...f, range: { preset: e.target.value as RangePreset, from: null, to: null } })}
        >
          {RANGE_PRESETS.filter(p => p.id !== 'custom').map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </Field>

      <Field id="sales-insights-type" label="Type" help="What the study mainly is. The number beside each is how many of that type you delivered in these dates.">
        <select
          id="sales-insights-type"
          className={SELECT}
          value={f.type ?? ''}
          onChange={e => onChange({ ...f, type: (e.target.value || null) as TypeKey | null })}
        >
          <option value="">Every type</option>
          {m.options.types.map(o => (
            <option key={o.id} value={o.id}>{TYPE_LABEL[o.id as TypeKey] ?? o.label} ({fmtNum(o.count)})</option>
          ))}
        </select>
      </Field>

      <Field id="sales-insights-account" label="Account" help="One account on your book. The number beside each is how many studies it received in these dates.">
        <select
          id="sales-insights-account"
          className={SELECT}
          value={f.account ?? ''}
          onChange={e => onChange({ ...f, account: e.target.value || null })}
        >
          <option value="">Every account</option>
          {m.options.accounts.map(o => (
            <option key={o.id} value={o.id}>{o.label} ({fmtNum(o.count)})</option>
          ))}
        </select>
      </Field>

      {filtered && (
        <button
          type="button"
          onClick={() => onChange({ range: { preset: 'this-month', from: null, to: null }, type: null, captain: null, account: null })}
          title="Back to this month, every type and every account"
          className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

const SELECT =
  'rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="flex items-center text-xs text-muted-foreground">
        {label}<InfoTooltip text={help} />
      </label>
      {children}
    </div>
  )
}

/* ── TILES ──────────────────────────────────────────────────────────────── */

function Tile({ label, help, value, lines, compare }: {
  label: string
  help: string
  value: string
  lines: (string | null)[]
  compare?: Comparison
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-3 shadow-sm">
      <span className="flex items-center text-xs text-muted-foreground">{label}<InfoTooltip text={help} /></span>
      <span className="text-2xl font-semibold leading-tight tabular-nums text-foreground">{value}</span>
      {lines.filter(Boolean).map((l, i) => (
        <span key={i} className="text-xs text-muted-foreground">{l}</span>
      ))}
      {compare && <span className={`text-xs ${TONE[compare.tone]}`}>{compare.text}</span>}
    </div>
  )
}

function Tiles({ model: m }: { model: InsightsModel }) {
  const c = m.cur
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Studies delivered"
        help="Studies on your book that were delivered, placed by the day they were delivered. Empty rerun waves the system created ahead of time are not counted."
        value={fmtNum(c.delivered)}
        lines={[
          m.undatedDelivered > 0
            ? `${s(m.undatedDelivered, 'delivered study', 'delivered studies')} on your book ${m.undatedDelivered === 1 ? 'has' : 'have'} no deliver date and cannot be placed in any date range`
            : null,
        ]}
        compare={m.compare.delivered}
      />
      <Tile
        label="Respondents delivered"
        help="The sum of the final post-QA count (N actual) across those studies. A study whose count has not been entered is left out — not counted as zero."
        value={c.withN ? fmtNum(c.respondents) : '—'}
        lines={[
          c.withN
            ? `Across ${s(c.withN, 'study', 'studies')}${c.withoutN ? `; ${fmtNum(c.withoutN)} delivered with no count recorded` : ''}`
            : 'No delivered study here has a final count recorded yet',
        ]}
        compare={m.compare.respondents}
      />
      <Tile
        label="On time"
        help={`The share delivered on or before the due date, of those that have a due date. The goal is ${pctText(ON_TIME_GOAL)} — a goal, not a rule.`}
        value={pctText(c.onTimePct)}
        lines={[
          c.judged ? `${fmtNum(c.onTime)} of ${s(c.judged, 'study', 'studies')} with a due date` : 'No delivered study here has a due date to judge against',
          c.noDue ? `${s(c.noDue, 'study', 'studies')} ${c.noDue === 1 ? 'has' : 'have'} no due date and ${c.noDue === 1 ? 'is' : 'are'} left out` : null,
        ]}
        compare={m.compare.onTime}
      />
      <Tile
        label="Typical time to deliver"
        help={`Calendar days to the day it was delivered, counted from the day the client approved the questions — or, for studies that predate that step, from the day the study was submitted. The middle study, so one outlier cannot drag it. Lower is faster; the goal is ${daysText(CYCLE_DAYS_GOAL)}.`}
        value={daysText(c.cycleMedian)}
        lines={[
          c.cycleN ? `Middle of ${s(c.cycleN, 'study', 'studies')}` : 'No delivered study here has both dates',
          c.cycleMissing ? `${s(c.cycleMissing, 'study', 'studies')} missing a date and left out` : null,
        ]}
        compare={m.compare.cycle}
      />
    </div>
  )
}

/* ── MONTHS ─────────────────────────────────────────────────────────────── */

function Months({ model: m }: { model: InsightsModel }) {
  // The chart always draws at least six months so the shape of a book is
  // visible, which means months outside the chosen dates are on screen. They
  // are faded, and a dashed rule marks where the dates begin — otherwise
  // changing the range appears to do nothing.
  const firstIn = m.months.findIndex(d => d.coverage !== 'out')
  const rule: CategoryRule[] = firstIn > 0 ? [{ at: m.months[firstIn].key, label: `Your dates: ${m.rangeLabel}` }] : []
  const context = m.months.filter(d => d.coverage === 'out').length
  const scope = [
    'Delivered', 'by deliver month', m.rangeLabel,
    context > 0 ? `${s(context, 'earlier month')} for context` : null,
    ...m.filterWords,
  ].filter(Boolean).join(' · ')
  const fade = (d: MonthRow) => (d.coverage === 'out' ? 0.35 : 1)

  const series: Series<MonthRow>[] = m.monthTypes.map((k, i) => ({
    key: k,
    label: typeLabel(k),
    value: d => d.byType[k] ?? 0,
    color: typeColor(k, i),
    hatch: k === 'none',
    description: typeHelp(k),
  }))

  return (
    <div className="flex flex-col gap-4">
      <InsightsCard
        title="Delivered per month"
        help="Studies on your book delivered each calendar month, stacked by type. Months outside your dates are faded and shown for context, with a dashed rule where your dates begin."
        scope={scope}
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
          opacity={fade}
          opacityNote="outside your dates, shown for context"
          rules={rule}
          note={d => (d.undated > 0
            ? `${s(d.undated, 'more delivered study', 'more delivered studies')} with no deliver date probably ${d.undated === 1 ? 'belongs' : 'belong'} here and ${d.undated === 1 ? 'is' : 'are'} not in the column`
            : d.running ? 'This month so far' : null)}
          emptyMessage="No delivered studies in these months"
        />
      </InsightsCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsightsCard
          title="On time, by month"
          help={`The share of each month's deliveries that arrived on or before the due date, of those with a due date. The dashed line is the ${pctText(ON_TIME_GOAL)} goal. A month with no due dates to judge breaks the line rather than inventing a figure.`}
          scope={scope}
          verdict={m.verdicts.onTime}
        >
          <LineChart
            ariaLabel="Share of deliveries on time, by month"
            data={m.months}
            x={d => d.long}
            xShort={d => d.short}
            xKey={d => d.key}
            xLabel="Month"
            series={[{ key: 'ot', label: 'On time', value: d => d.onTimePct, color: 'var(--chart-keep)', description: 'Delivered on or before the due date' }]}
            valueFormat={v => fmtPct(v)}
            yDomain={[0, 1]}
            referenceLines={[{ value: ON_TIME_GOAL, label: `Goal ${fmtPct(ON_TIME_GOAL)}`, color: 'var(--chart-goal)' }]}
            opacity={fade}
            opacityNote="outside your dates, shown for context"
            rules={rule}
            note={d => (d.judged ? `${fmtNum(d.onTime)} of ${s(d.judged, 'study', 'studies')} with a due date` : 'No due dates to judge')}
            emptyMessage="No delivered study here has a due date"
          />
        </InsightsCard>

        <InsightsCard
          title="Time to deliver, by month"
          help={`Calendar days to delivery for the middle study each month, counted from the day the client approved the questions — or, for studies that predate that step, from the day the study was submitted. Lower is faster; the dashed line is the ${daysText(CYCLE_DAYS_GOAL)} goal. Studies missing either date are left out.`}
          scope={scope}
          verdict={m.verdicts.cycle}
        >
          <LineChart
            ariaLabel="Median days to deliver, by month"
            data={m.months}
            x={d => d.long}
            xShort={d => d.short}
            xKey={d => d.key}
            xLabel="Month"
            series={[{ key: 'cy', label: 'Median days', value: d => d.cycleMedian, color: 'var(--chart-cat-7)', description: 'Calendar days from start to delivery, middle study' }]}
            valueFormat={v => daysText(v)}
            axisFormat={v => fmtNum(v)}
            referenceLines={[{ value: CYCLE_DAYS_GOAL, label: `Goal ${daysText(CYCLE_DAYS_GOAL)}`, color: 'var(--chart-goal)' }]}
            opacity={fade}
            opacityNote="outside your dates, shown for context"
            rules={rule}
            note={d => (d.cycleN ? `Median of ${s(d.cycleN, 'study', 'studies')}` : 'No studies with both dates')}
            area
            emptyMessage="No delivered study here has both dates"
          />
        </InsightsCard>
      </div>
    </div>
  )
}

/* ── BREAKDOWNS ─────────────────────────────────────────────────────────── */

function Breakdowns({ model: m }: { model: InsightsModel }) {
  const router = useRouter()
  // Clicking a bar filters the PAGE rather than opening a drill panel: the
  // sales shell already has a full, filterable studies table behind the Studies
  // tab, and a second one in a modal here would be a worse copy of it.
  //
  // "No account recorded" is the one bar that does not filter. The filter would
  // work — the model groups those studies under their own key — but that key is
  // not in the account picker, so the page would sit filtered while the picker
  // read "Every account", with nothing on screen to undo. Same call the analyst
  // page makes, for the same reason.
  const go = (g: GroupRow, dim: 'type' | 'account') => {
    if (dim === 'account' && g.key === NO_ACCOUNT) return
    router.replace(salesInsightsHref(m.filter, dim === 'type' ? { type: g.key as TypeKey } : { account: g.key }), { scroll: false })
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InsightsCard
        title="Delivered by account"
        help="Which accounts on your book received the work in your dates. Click a bar to narrow the whole page to that account."
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
          color={d => (d.key === NO_ACCOUNT ? 'var(--chart-muted)' : 'var(--chart-cat-1)')}
          note={d => (d.key === NO_ACCOUNT ? 'No account recorded on these studies' : null)}
          emptyMessage="No studies delivered in this view"
          onSelect={d => go(d, 'account')}
        />
        {m.accountsMore.accounts > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {s(m.accountsMore.accounts, 'other account')} held {s(m.accountsMore.surveys, 'study', 'studies')}
            {m.accountsMore.accounts === 1 ? ' and is' : ' between them and are'} not drawn.
          </p>
        )}
      </InsightsCard>

      <InsightsCard
        title="Delivered by type"
        help="What the delivered work mainly was. Click a bar to narrow the whole page to that type."
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
          color={d => typeColor(d.key, m.monthTypes.indexOf(d.key))}
          note={d => d.help ?? null}
          emptyMessage="No studies delivered in this view"
          onSelect={d => go(d, 'type')}
        />
      </InsightsCard>
    </div>
  )
}

/* ── BIGGEST ────────────────────────────────────────────────────────────── */

function Biggest({ model: m }: { model: InsightsModel }) {
  return (
    <InsightsCard
      title="Largest deliveries"
      help="The delivered studies in your dates with the most respondents. A study whose final count has not been entered cannot be ranked and is not here."
      scope={m.scope}
      verdict={m.verdicts.biggest}
    >
      {m.biggest.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing to rank yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Code</th>
                <th className="py-1.5 pr-3 font-medium">Study</th>
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 text-right font-medium">Respondents</th>
                <th className="py-1.5 text-right font-medium">Delivered</th>
              </tr>
            </thead>
            <tbody>
              {m.biggest.map(b => (
                <tr key={b.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {/* A real href, so right-click and middle-click work. */}
                    <Link href={`/sales/surveys/${b.id}`} className="font-medium underline-offset-2 hover:underline">{b.code}</Link>
                  </td>
                  <td className="py-1.5 pr-3">{b.name}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{b.account}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">{b.type}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{fmtNum(b.respondents)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right text-muted-foreground">{b.deliver ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </InsightsCard>
  )
}

/* ── RIGHT NOW ──────────────────────────────────────────────────────────── */

/**
 * Open work, which the date range deliberately does NOT apply to — work that is
 * open is open whenever it started. The type and account filters do apply.
 *
 * The stage names go through stageLabel: the board column is stored as
 * 'Survey Programming' and every screen in this shell says "Study Programming".
 */
function RightNow({ model: m }: { model: InsightsModel }) {
  const n = m.now
  const words = m.filterWords.length ? ' · ' + m.filterWords.join(' · ') : ''
  return (
    <InsightsCard
      title="Open right now"
      help="Work on your book that is sold and running today: not delivered, not on hold, not cancelled, not still being scoped. Your dates do not apply here — open work is open whenever it started — but the type and account filters do."
      scope={`In flight${words} · ${s(n.inFlight, 'study', 'studies')}`}
      verdict={n.stageVerdict}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Small label="In flight" value={fmtNum(n.inFlight)} help="Sold and running today." />
        <Small
          label="Overdue"
          value={fmtNum(n.overdue)}
          help="Past the due date and not yet delivered."
          tone={n.overdue > 0 ? 'text-amber-700 dark:text-amber-400' : undefined}
        />
        <Small label="Due within a week" value={fmtNum(n.dueSoon)} help="Due in the next seven days." />
        <Small
          label="Being scoped"
          value={fmtNum(n.scoping)}
          help="Still being scoped or priced, and not yet buying respondents. Not sold work, so not counted as in flight."
        />
      </div>

      {n.hold > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {s(n.hold, 'study', 'studies')} on hold, counted separately and never inside the in-flight figure.
        </p>
      )}

      {n.inFlight > 0 && (
        <div className="mt-4">
          <BarChart
            ariaLabel="Open studies by stage"
            data={n.byStage.filter(r => r.count > 0)}
            label={d => stageLabel(d.stage)}
            labelHeader="Stage"
            value={d => d.count}
            valueName="Open"
            color="var(--chart-cat-2)"
            note={d => d.help}
            emptyMessage="Nothing is in flight"
          />
        </div>
      )}

      {n.collectionPct != null && (
        <p className="mt-3 text-xs text-muted-foreground">
          {fmtNum(n.collected)} responses collected so far against a target of {fmtNum(n.targetMin ?? 0)}
          {n.targetMax != null && n.targetMax !== n.targetMin ? `–${fmtNum(n.targetMax)}` : ''} ({pctText(n.collectionPct)})
          {/* The responses those studies hold are out of the top line too, not
              just the bottom one — saying only that they are "left out of the
              share" would leave a reader adding them to the figure. */}
          {n.untargeted > 0 && `. ${s(n.untargeted, 'open study has', 'open studies have')} no target and ${n.untargeted === 1 ? 'is' : 'are'} left out of both figures, along with the ${fmtNum(n.untargetedCollected)} ${n.untargetedCollected === 1 ? 'response' : 'responses'} ${n.untargeted === 1 ? 'it holds' : 'they hold'}`}.
        </p>
      )}
    </InsightsCard>
  )
}

function Small({ label, value, help, tone = 'text-foreground' }: { label: string; value: string; help: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <span className="flex items-center text-xs text-muted-foreground">{label}<InfoTooltip text={help} /></span>
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}
