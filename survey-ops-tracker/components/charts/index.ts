/**
 * SOCC chart primitives — hand-rolled, typed SVG (there is no chart library
 * in package.json, by choice). See types.ts for the shared prop shape, and
 * the demo page at /admin/chart-gallery for every chart on sample data.
 *
 * Colour: use the chart tokens from app/globals.css, never hex —
 *   var(--chart-price)  client price (teal)      var(--chart-cost)  our cost (navy)
 *   var(--chart-keep)   what we keep (green)     var(--chart-loss)  a loss (red)
 *   var(--chart-goal)   a goal / target line     var(--chart-budget) the budget tick
 *   var(--chart-cat-1..8) identity (type, captain), assigned in order;
 *   slots 1-3 are clear of the money colours, 4-8 are not (see globals.css)
 * The grey hatch ("no data / no price") is built in: `hatch: true` on a series.
 *
 * Drill: pass onSelect and/or href. A row whose href returns null (and with
 * no onSelect) simply does not drill; a chart where no row drills stays a
 * plain image to screen readers.
 */

export { ChartFrame, DataTable, DEFAULT_EMPTY, DRILL_CONTROL_CLASS } from './ChartFrame'
export type { ChartFrameProps, ChartTable, TableColumn, TableRow } from './ChartFrame'
export { Legend, Swatch, HATCH_CSS } from './Legend'
export type { LegendItem, SwatchShape } from './Legend'
export { ColumnChart } from './ColumnChart'
export type { ColumnChartProps, ColumnOverlay, DatumLabel } from './ColumnChart'
export { BarChart } from './BarChart'
export type { BarChartProps } from './BarChart'
export { LineChart } from './LineChart'
export type { LineChartProps } from './LineChart'
export { BulletChart } from './BulletChart'
export type { BulletChartProps, BulletProgress } from './BulletChart'
export { DumbbellChart } from './DumbbellChart'
export type { DumbbellChartProps, DumbbellBox } from './DumbbellChart'
export { RangeChart } from './RangeChart'
export type { RangeChartProps } from './RangeChart'
export { Heatmap } from './Heatmap'
export type { HeatmapProps, HeatCell, HeatAxisItem } from './Heatmap'
export { Sparkline, describeTrend } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export {
  fmtMoney,
  fmtMoneyCompact,
  fmtPct,
  fmtCount,
  fmtCountCompact,
  withMinus,
  MINUS,
  MISSING,
} from './format'
export type { Formatter } from './format'
export type { ChartCommon, Series, ReferenceLine, CategoryRule } from './types'
export { niceDomain, niceStep, fitText, textWidth } from './scale'
export { useChartWidth, DEFAULT_CHART_WIDTH } from './useChartWidth'
