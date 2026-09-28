'use client'

/**
 * The live-logging strip: of the blast and panel rows recording work done in a
 * week, the share written within LOG_WITHIN_DAYS of the work.
 *
 * June to August look well recorded because they were BACKFILLED from exports
 * in September, not because anything was logged at the time (finance spec §2).
 * The heatmap beside this cannot tell the two apart; this strip can, and it is
 * the check that the September practice holds.
 *
 * A week is drawn faded while it is still inside its window: a row for that
 * week's work written after today would count as late, so the share can still
 * fall. The alert reads the latest CLOSED week only.
 */

import { ColumnChart, fmtPct } from '@/components/charts'
import { fmtNum } from '@/lib/utils/number'
import { dayLong, dayShort, spansYears } from '../periodAxis'
import {
  LOG_ALERT_BELOW, LOG_WEEKS, LOG_WITHIN_DAYS, loggingWeekDrill,
  type ImproveInput, type LoggingStrip, type LogWeek,
} from '@/lib/finance/improve'
import type { FinanceTabProps } from '../tabs/types'
import { Empty, FinanceCard, Note } from '../tabs/Card'

const HELP =
  `Of the blast and panel rows recording work done each week, the share written into SOCC within ${LOG_WITHIN_DAYS} days of the work: a blast against its send date, a panel purchase against its wave’s launch date, both on the Eastern calendar. ` +
  `Rows written ahead of the work (a scheduled blast) count as on time. A faded week is still inside its ${LOG_WITHIN_DAYS}-day window, so its share can still fall. The alert reads the latest finished week. At most the last ${LOG_WEEKS} weeks are shown.`

export function LoggingCard({ strip, input, props }: {
  strip: LoggingStrip
  input: ImproveInput
  props: Pick<FinanceTabProps, 'load' | 'openDrill'>
}) {
  // 26 weeks in a third of the page: most week labels are thinned away, and a
  // thinned one leaves only its tick. So the drawn label is as narrow as it can
  // be while still naming its week — "7 Sep", or "7 Sep 25" once the strip runs
  // back into the previous year — and the full date rides along in the tooltip,
  // the title on the drawn label, and the table twin.
  //
  // NOT FIXED HERE, and it should be: the card's alert sentence above uses
  // dayLong, but `LogWeek.label` is still the bare "7 Sep" (lib/finance/
  // improve.ts:807), and two sentences built from it — the verdict this card
  // renders (improve.ts:839) and the heading of the drill a column opens
  // (improve.ts:919) — therefore name a week without its year on a strip that
  // routinely crosses one. improve.ts is outside this change's ownership.
  const crossesYear = spansYears(strip.weeks.map(w => w.key))
  return (
    <FinanceCard
      id="live-logging"
      title="Logged within a week"
      help={HELP}
      scope={strip.chip}
      needs={['survey_projects']}
      blocked={props.load.blocked}
      verdict={strip.verdict}
    >
      {strip.cannot ? (
        <Empty>{strip.cannot}</Empty>
      ) : (
        <div className="px-4 py-3">
          <ColumnChart<LogWeek>
            ariaLabel={`Share of blast and panel rows written within ${LOG_WITHIN_DAYS} days of the work, by week`}
            data={strip.weeks}
            x={w => dayLong(w.key)}
            xShort={w => dayShort(w.key, crossesYear)}
            xKey={w => w.key}
            xLabel="Week of"
            series={[{
              key: 'share', label: `Written within ${LOG_WITHIN_DAYS} days`, value: w => w.share,
              color: 'var(--chart-cat-1)',
              description: `Rows written within ${LOG_WITHIN_DAYS} days of the work, as a share of the week’s rows.`,
            }]}
            valueFormat={v => fmtPct(v)}
            yDomain={[0, 1]}
            referenceLines={[{ value: LOG_ALERT_BELOW, label: `Alert below ${fmtPct(LOG_ALERT_BELOW)}`, color: 'var(--chart-loss)' }]}
            opacity={w => (w.open ? 0.45 : 1)}
            opacityNote="week still open: rows written late have not arrived yet"
            subLabel={{ name: 'Rows', text: w => fmtNum(w.rows), description: 'Blast and panel rows recording work done that week.' }}
            note={w =>
              `Blasts ${fmtNum(w.blast.onTime)} of ${fmtNum(w.blast.rows)} · panel rows ${fmtNum(w.panel.onTime)} of ${fmtNum(w.panel.rows)} on time` +
              (w.open ? ' · still open' : '')}
            onSelect={w => props.openDrill(loggingWeekDrill(input, strip, w.key))}
            height={200}
          />
        </div>
      )}
      {strip.alert && strip.latestClosed && (
        <Note tone="neg">
          Alert: the week of {dayLong(strip.latestClosed.key)} logged {fmtPct(strip.latestClosed.share)} of its rows on time, under the {fmtPct(LOG_ALERT_BELOW)} bar.
        </Note>
      )}
      {strip.notes.length > 0 && <Note>{strip.notes.join(' ')}</Note>}
    </FinanceCard>
  )
}
