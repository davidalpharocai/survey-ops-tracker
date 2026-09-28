'use client'

/**
 * C6 — what each month's records carry.
 *
 * Every month with delivered work is a column, whatever dates the page is set
 * to: the date filter only HIGHLIGHTS the selected months (finance spec, page
 * chrome). Cut to "since 1 June" the grid could not show the before-and-after
 * that explains the banner, and a backfill of May would be invisible.
 *
 * The vertical rules are the banner's own reliability dates — computed on the
 * whole book in lib/finance/coverage.ts, never typed — so when David prices
 * June and July the price line moves here and in the banner at the same time.
 *
 * Clicking a cell lists the delivered surveys that month missing that field,
 * each code a real link to the project page where the field is entered.
 */

import { Heatmap, fmtPct } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { coverageCellDrill, type CoverageGrid, type CoverageHeatCell, type ImproveInput } from '@/lib/finance/improve'
import { monthShort, spansYears } from '../periodAxis'
import type { FinanceTabProps } from '../tabs/types'
import { FinanceCard, Note } from '../tabs/Card'

const HELP =
  'Each cell is the share of that month’s delivered surveys carrying the field. Every month with delivered work is shown whatever dates you pick; the months your dates select are highlighted. ' +
  'The lines are the dates the banner uses, computed on the whole book: a line moves by itself once the months before it are filled in. Click a cell to list the surveys missing that field.'

export function CoverageCard({ grid, input, props }: {
  grid: CoverageGrid
  input: ImproveInput
  props: Pick<FinanceTabProps, 'load' | 'filter' | 'openDrill' | 'hrefFor'>
}) {
  const open = (c: CoverageHeatCell) => {
    const { spec, month } = coverageCellDrill(input, grid, c.row, c.col)
    props.openDrill(spec, month ? {
      filter: {
        href: props.hrefFor({ range: { preset: 'custom', from: month.from, to: month.to } }),
        label: `Filter the page to ${month.label}`,
      },
    } : undefined)
  }
  const ignored = props.filter.range.preset === 'all' ? [] : ['Dates highlight months here; they do not remove any']
  // Every month with delivered work is a column whatever dates are picked, so
  // this axis nearly always runs across a year — and two columns reading "Jun"
  // a year apart name nothing. When the columns cross a year they carry it:
  // "Jun 25", "Jun 26". The full month stays on every cell's tooltip, on the
  // drawn header's own title, and in the table twin.
  //
  // The wider label used to cost this grid its newest month: Heatmap thinned
  // with `labelStep` and an `i % step` walk from the LEFT, so at 14 to 21
  // columns it named every other month and the last one only when the count
  // was odd. Heatmap now uses the same rule as the column charts (scale.ts
  // fitAxisLabels: shrink a step before thinning, pin both ends, a tick over
  // every column), so the newest month is named whatever the count.
  const crossesYear = spansYears(grid.columns.map(c => c.key))

  return (
    <FinanceCard
      id="coverage"
      title="What each month’s records carry"
      help={HELP}
      scope={grid.chip}
      ignored={ignored}
      needs={['survey_projects']}
      blocked={props.load.blocked}
      verdict={grid.verdict}
    >
      <div className="px-4 py-3">
        <Heatmap<CoverageHeatCell>
          ariaLabel="Share of delivered surveys carrying each field, by delivery month"
          rows={grid.rows.map(r => ({ key: r.key, label: r.label, description: r.help }))}
          columns={grid.columns.map(c => ({
            key: c.key, label: c.label, shortLabel: monthShort(c.key, crossesYear),
            description: `${fmtNum(c.delivered)} delivered survey${c.delivered === 1 ? '' : 's'}${c.selected ? ' · in your dates' : ''}`,
          }))}
          cells={grid.cells}
          rowHeader="Field"
          valueName="Share with the field"
          valueFormat={v => fmtPct(v)}
          domain={[0, 1]}
          rules={grid.rules.map(r => ({ at: r.at, label: r.label }))}
          highlight={grid.highlight}
          note={c => c.of === 0
            ? 'No surveys this row applies to'
            : `${fmtNum(c.have)} of ${fmtNum(c.of)}${c.missingIds.length ? ` · click to list the ${fmtNum(c.missingIds.length)} missing` : ''}`}
          onSelect={open}
          emptyMessage="No delivered surveys under the account and route picked."
        />
        {/* The row labels are drawn inside the chart, where an (i) cannot sit,
            so each one's explainer is here. */}
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="What each row counts">
          {grid.rows.map(r => (
            <li key={r.key} className="flex items-center">
              {r.label}
              <InfoTooltip text={r.help} />
            </li>
          ))}
        </ul>
      </div>
      {grid.blockedRows.length > 0 && (
        <Note tone="neg">
          {grid.blockedRows.join(' ')} {grid.blockedRows.length === 1 ? 'That row is' : 'Those rows are'} left off rather than shown as low coverage.
        </Note>
      )}
    </FinanceCard>
  )
}
