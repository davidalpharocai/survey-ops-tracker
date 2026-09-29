'use client'

import { useState, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Sparkline, fmtCount, fmtPct, type Formatter } from '@/components/charts'
import { fmtNum } from '@/lib/utils/number'
import {
  CYCLE_DAYS_GOAL, ON_TIME_GOAL, daysText, pctText, type Comparison, type InsightsModel, type MonthRow,
} from '@/lib/insights/model'
import { filterSuffix, sideBucketRequest, type OpenDrill } from './drill'
import { OpenCount } from './OpenCount'

const TONE: Record<Comparison['tone'], string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-muted-foreground',
}

/** A tile: label + (i), the number (which opens the surveys behind it), the
 *  lines that qualify it, the comparison, and a sparkline of the months on the
 *  chart below. */
function Kpi({
  label, help, value, valueClass = 'text-foreground', onOpen, openTitle, lines, compare, children,
}: {
  label: string
  help: string
  value: string
  valueClass?: string
  onOpen?: () => void
  openTitle?: string
  lines: ReactNode[]
  compare?: Comparison
  children?: ReactNode
}) {
  const big = `text-2xl font-semibold leading-tight tabular-nums ${valueClass}`
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-3 shadow-sm">
      <span className="flex items-center text-xs text-muted-foreground">{label}<InfoTooltip text={help} /></span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title={openTitle ?? 'Show the surveys behind this number'}
          className={`${big} self-start text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none`}
        >
          {value}
        </button>
      ) : (
        <span className={big}>{value}</span>
      )}
      {lines.filter(Boolean).map((l, i) => (
        <span key={i} className="text-xs text-muted-foreground">{l}</span>
      ))}
      {compare && <span className={`text-xs ${TONE[compare.tone]}`}>{compare.text}</span>}
      {children && <div className="mt-auto pt-1">{children}</div>}
    </div>
  )
}

/**
 * A tile's sparkline and the one line of text under it.
 *
 * ── WHERE THE HOVERED MONTH GOES ────────────────────────────────────────────
 * The sparkline is 32px tall: no axis, no ticks, nowhere to float a tooltip
 * card. That used to be the end of the argument — it named its two ends and
 * its whole trend, and said nothing at all about the month under the pointer.
 * It is also the FIRST graphic on the page, so that is the one a reader
 * hovers first (David, 2026-09-28: "nothing happens when i hover over the
 * graphs"), and what he learned from it was that /insights does not answer.
 *
 * The room the graphic does not have, the line under it does. At rest that
 * line names the window's ends, as before. With a point under the pointer (or
 * the keyboard cursor) the SAME line becomes that month and its figure, and
 * goes back to the ends on the way out. One line either way, so the tile
 * never changes height and the grid never reflows.
 *
 * The month charts below still carry the tooltip card, the drill and the
 * table: this is the word-sized answer, not a replacement for them.
 */
function TileTrend({ ariaLabel, months, values, valueFormat = fmtCount, boundary, ...spark }: {
  ariaLabel: string
  months: MonthRow[]
  values: (number | null)[]
  valueFormat?: Formatter
  /** Index of the first month inside the reader's dates, or null. */
  boundary?: number | null
  color?: string
  goal?: number
  includeZero?: boolean
}) {
  const [at, setAt] = useState<number | null>(null)
  const labels = months.map(x => x.long)
  const first = months[0]
  const last = months[months.length - 1]
  const held = at != null ? months[at] : undefined
  const heldValue = at != null ? values[at] : null
  // A month with no figure says so. Printing a 0 here would be the page
  // asserting something the data never recorded.
  const heldText = heldValue == null ? 'not recorded' : valueFormat(heldValue)
  return (
    <div data-part="tile-trend">
      <Sparkline
        ariaLabel={ariaLabel}
        values={values}
        labels={labels}
        valueFormat={valueFormat}
        boundary={boundary}
        onActive={setAt}
        {...spark}
      />
      {first && (
        // The <svg> already spells the window out in its accessible name, so
        // this row is for the eye only; the screen-reader path is the live
        // region below, which is silent until a month is actually held.
        <div
          aria-hidden
          data-part="tile-readout"
          className="mt-0.5 flex min-w-0 justify-between gap-2 text-[10px] leading-none text-muted-foreground"
        >
          {held ? (
            <>
              <span className="truncate">{held.long}</span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">{heldText}</span>
            </>
          ) : (
            <>
              <span>{first.short}</span>
              {last.key !== first.key && <span>{last.short}</span>}
            </>
          )}
        </div>
      )}
      <span role="status" className="sr-only">
        {held ? `${ariaLabel}, ${held.long}: ${heldText}` : ''}
      </span>
    </div>
  )
}

export function KpiTiles({ model: m, open }: { model: InsightsModel; open: OpenDrill }) {
  const c = m.cur
  const scope = m.scope
  const undated = m.undatedDelivered
  const allTime = m.range.from == null && m.range.to == null
  const s = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`
  const words = filterSuffix(m)
  const them = (n: number) => (n === 1 ? 'it' : 'them')
  const inRangeUndated = m.undated.inRange

  // The undated deliveries, openable so someone can fill in their dates: all
  // of them, and the ones that probably belong to the chosen dates.
  const undatedLine = undated > 0 && !allTime ? (
    <>
      <OpenCount
        title="Show every delivered survey with no deliver date"
        onOpen={() => open({
          key: 'kpi-undated-all', title: 'Delivered, with no deliver date', population: `Delivered · no deliver date · any time${words}`,
          query: { kind: 'delivered', undated: 'all' }, expected: undated, expectedWhere: 'in the tile',
        })}
      >
        {s(undated, 'delivered survey')}
      </OpenCount>
      {` ${undated === 1 ? 'has' : 'have'} no deliver date, so no date range can include ${them(undated)}.`}
      {inRangeUndated > 0 && (
        <>
          {' '}
          <OpenCount
            title="Show the undated deliveries whose due, launch or submitted date is in your dates"
            onOpen={() => open({
              key: 'kpi-undated-range', title: 'Delivered, with no deliver date · probably in your dates',
              population: `Delivered · no deliver date · due, launched or submitted ${m.rangeLabel}${words}`,
              query: { kind: 'delivered', undated: 'range' }, expected: inRangeUndated, expectedWhere: 'in the tile',
            })}
          >
            {inRangeUndated === undated ? (undated === 1 ? 'It' : 'All of them') : `${fmtNum(inRangeUndated)} of them`}
          </OpenCount>
          {` probably ${inRangeUndated === 1 ? 'falls' : 'fall'} in your dates, going by ${inRangeUndated === 1 ? 'its' : 'their'} due, launch or submitted date.`}
        </>
      )}
      {` All time counts ${them(undated)}.`}
    </>
  ) : null

  // Where the reader's dates begin on the shared month axis. The trend
  // always ENDS on the range's last month (trendMonths), so only the start
  // can fall inside the picture — one boundary, never two. -1 (no month is
  // out) and 0 (the first month is already inside) both mean "nothing to
  // mark": a rule on the left edge of the graphic marks nothing.
  const firstIn = m.months.findIndex(x => x.coverage !== 'out')
  const boundary = firstIn > 0 ? firstIn : null

  const onTimeGood = c.onTimePct != null && c.onTimePct >= ON_TIME_GOAL
  const cycleGood = c.cycleMedian != null && c.cycleMedian <= CYCLE_DAYS_GOAL

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Kpi
        label="Surveys delivered"
        help="Surveys in the Delivery column whose deliver date falls in the dates you picked. A survey is placed by its deliver date (the day the client had it), not by when it was submitted or created. Empty rerun placeholders the system made ahead of time are left out. A delivered survey with no deliver date cannot be placed; when enough of them probably belong to either period (going by their due, launch or submitted date) to change the answer, the comparison with the period before is left out, and an earlier count missing some reads “at least”."
        value={fmtNum(c.delivered)}
        onOpen={() => open({
          key: 'kpi-delivered', title: 'Surveys delivered', population: scope,
          query: { kind: 'delivered' }, expected: c.delivered, expectedWhere: 'in the tile',
        })}
        lines={[
          undated > 0 && allTime
            ? `Includes ${s(undated, 'survey')} with no deliver date — counted here, but no monthly chart can place ${them(undated)}.`
            : undatedLine,
        ]}
        compare={m.compare.delivered}
      >
        <TileTrend ariaLabel="Surveys delivered per month" months={m.months} values={m.months.map(x => x.total)} boundary={boundary} />
      </Kpi>

      <Kpi
        label="Respondents delivered"
        help="The post-QA N (the respondents that passed quality checks) summed across the delivered surveys. A survey with no post-QA N recorded is counted as missing, never as zero."
        value={c.withN ? fmtNum(c.respondents) : '—'}
        onOpen={() => open({
          key: 'kpi-respondents', title: 'Delivered surveys with respondents recorded', population: scope,
          query: { kind: 'delivered', withN: true }, expected: c.withN, expectedWhere: 'behind the tile',
        })}
        openTitle="Show the surveys whose respondents make up this number"
        lines={[
          c.withN ? `From ${s(c.withN, 'survey')}` : 'No respondent counts recorded here',
          c.withoutN > 0 ? `${s(c.withoutN, 'delivered survey has', 'delivered surveys have')} no respondent count recorded yet` : null,
        ]}
        compare={m.compare.respondents}
      >
        <TileTrend
          ariaLabel="Respondents delivered per month"
          months={m.months}
          values={m.months.map(x => (x.withN ? x.respondents : null))}
          boundary={boundary}
          color="var(--chart-cat-7)"
        />
      </Kpi>

      <Kpi
        label="On time"
        help={`On time: the deliver date is on or before the due date (our internal deadline). Late: delivered one or more days after it. Surveys with no due date are left out of the percentage, and counted below. The goal line is ${pctText(ON_TIME_GOAL)} — a goal, not a rule.`}
        value={pctText(c.onTimePct)}
        valueClass={c.onTimePct == null ? 'text-foreground' : onTimeGood ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}
        onOpen={() => open({
          key: 'kpi-ontime', title: 'Delivered surveys with a due date', population: scope,
          query: { kind: 'delivered', judgedOnly: true }, expected: c.judged, expectedWhere: 'behind the percentage',
        })}
        openTitle="Show the surveys this percentage is measured on, with each one's on-time result"
        lines={[
          c.judged ? `${fmtNum(c.onTime)} of ${s(c.judged, 'survey')} with a due date · ${fmtNum(c.late)} late` : 'No delivered survey here has a due date',
          c.noDue > 0 ? `${s(c.noDue, 'survey')} with no due date left out` : null,
          c.noDeliverDate > 0 ? `${s(c.noDeliverDate, 'survey')} with no deliver date left out` : null,
          `Goal ${fmtPct(ON_TIME_GOAL)}`,
        ]}
        compare={m.compare.onTime}
      >
        <TileTrend
          ariaLabel="Share delivered on time per month"
          months={m.months}
          values={m.months.map(x => x.onTimePct)}
          boundary={boundary}
          goal={ON_TIME_GOAL}
          includeZero={false}
          valueFormat={v => fmtPct(v)}
          color="var(--chart-keep)"
        />
      </Kpi>

      <Kpi
        label="Median cycle time"
        help={`Calendar days from the submitted date to the deliver date — the middle survey's figure, so one very slow or very fast survey cannot drag it. Surveys missing either date, or whose dates run backwards (a data error), are left out and counted below. The goal line is ${daysText(CYCLE_DAYS_GOAL)} — a goal, not a rule.`}
        value={daysText(c.cycleMedian)}
        valueClass={c.cycleMedian == null ? 'text-foreground' : cycleGood ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}
        onOpen={() => open({
          key: 'kpi-cycle', title: 'Delivered surveys with a cycle time', population: scope,
          query: { kind: 'delivered', cycleOnly: true }, expected: c.cycleN, expectedWhere: 'behind the median',
        })}
        openTitle="Show the surveys this median is taken from, with each one's days"
        lines={[
          c.cycleN ? `Submitted to delivered · ${s(c.cycleN, 'survey')}` : 'No survey here has both a submitted and a deliver date',
          c.cycleMissing > 0 ? `${s(c.cycleMissing, 'survey')} missing a submitted or deliver date left out` : null,
          c.cycleBackwards > 0 ? `${s(c.cycleBackwards, 'survey')} delivered before ${c.cycleBackwards === 1 ? 'its' : 'their'} submitted date left out — worth fixing` : null,
          `Goal ${daysText(CYCLE_DAYS_GOAL)} or less`,
        ]}
        compare={m.compare.cycle}
      >
        <TileTrend
          ariaLabel="Median days from submitted to delivered per month"
          months={m.months}
          values={m.months.map(x => x.cycleMedian)}
          boundary={boundary}
          goal={CYCLE_DAYS_GOAL}
          valueFormat={v => daysText(v)}
          color="var(--chart-cat-7)"
        />
      </Kpi>

      <Kpi
        label="In flight now"
        help="Surveys sold and running today: not delivered, not on hold, not cancelled, not still being scoped. Right now, whatever the dates above; the type, captain and account filters still apply. On-hold and scoping surveys are counted beside it, never inside it."
        value={fmtNum(m.now.inFlight)}
        onOpen={() => open({
          key: 'kpi-inflight', title: 'In flight now', population: `In flight · right now${words}`,
          query: { kind: 'open' }, expected: m.now.inFlight, expectedWhere: 'in the tile',
        })}
        lines={[
          `${m.now.overdue > 0 ? `${fmtNum(m.now.overdue)} overdue` : 'None overdue'} · ${fmtNum(m.now.dueSoon)} due this week`,
          <>
            <OpenCount title="Show the surveys on hold" onOpen={() => open(sideBucketRequest(m, 'hold', 'in the tile'))}>
              {fmtNum(m.now.hold)} on hold
            </OpenCount>
            {' · '}
            <OpenCount title="Show the surveys still being scoped" onOpen={() => open(sideBucketRequest(m, 'scoping', 'in the tile'))}>
              {fmtNum(m.now.scoping)} still scoping
            </OpenCount>
            {' — not counted'}
          </>,
          'Right now, whatever the dates',
        ]}
      />

      <Kpi
        label="Reruns delivered"
        help="Repeat waves of a recurring study: surveys in a rerun series, a later wave, or filed under the older Rerun type. Placed by deliver date like every other delivery."
        value={fmtNum(c.reruns)}
        onOpen={() => open({
          key: 'kpi-reruns', title: 'Reruns delivered', population: scope,
          query: { kind: 'delivered', rerunOnly: true }, expected: c.reruns, expectedWhere: 'in the tile',
        })}
        lines={[c.delivered ? `${fmtNum(c.reruns)} of ${s(c.delivered, 'delivery', 'deliveries')} (${pctText(c.reruns / c.delivered)})` : 'No deliveries in these dates']}
        compare={m.compare.reruns}
      >
        <TileTrend ariaLabel="Reruns delivered per month" months={m.months} values={m.months.map(x => x.reruns)} boundary={boundary} color="var(--chart-cat-3)" />
      </Kpi>
    </div>
  )
}
