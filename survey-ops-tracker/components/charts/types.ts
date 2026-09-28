/**
 * The shared shape of every chart's props. Learn it once:
 *
 *   data        the rows, in the order they should be drawn (charts never sort)
 *   accessors   small functions that read a row: `x`, `label`, `value`, …
 *   series      for multi-series charts, one entry per coloured mark
 *   valueFormat how numbers print on the axis, labels, tooltip and table
 *   onSelect    called with the ROW when a mark is clicked, or activated with
 *               Enter / Space; marks are only focusable when this (or href) is set
 *   href        optional real link per row, so right-click / middle-click /
 *               cmd-click open the drill in a new tab (house rule: every
 *               hyperlink is a real <a href>)
 *   ariaLabel   what the chart is, for screen readers; each chart appends a
 *               computed summary of the data to it
 *   emptyMessage shown instead of the plot when there is nothing to draw
 */

import type { Formatter } from './format'

export type { Formatter }

export interface ChartCommon<D> {
  /** What the chart shows, e.g. "Client price vs our cost by month". Required:
   *  a chart with no accessible name is a picture nobody can find. */
  ariaLabel: string
  /** Optional visible heading above the chart. */
  title?: string
  /** (i) explainer beside the title. */
  info?: string
  /** Plot height in px (the frame adds legend and table toggle around it). */
  height?: number
  /** Fixed width in px. Normally omitted: the chart measures its container. */
  width?: number
  /** Replaces the default "No data in this view". */
  emptyMessage?: string
  /** Drill: called with the row behind the clicked / activated mark. */
  onSelect?: (d: D) => void
  /** A real URL for the row's drill, so the mark is an <a href>. */
  href?: (d: D) => string | null | undefined
  /** Show the "View as table" toggle (default true). */
  table?: boolean
  /** Open the table on first render. */
  tableOpen?: boolean
  className?: string
}

/** One coloured series in a column or line chart. */
export interface Series<D> {
  /** Stable id; also the React key. */
  key: string
  /** Legend, tooltip and table header text. */
  label: string
  /** The row's value for this series; null = missing (drawn as a gap, never 0). */
  value: (d: D) => number | null | undefined
  /** Any CSS colour; use the chart tokens, e.g. 'var(--chart-price)'. */
  color?: string
  /** Draw with the grey "no data / no price" hatch instead of a solid fill. */
  hatch?: boolean
  /** One-line explainer: the legend item's and table header's title= text. */
  description?: string
  /** Dashed line (line charts only), e.g. for a projection. */
  dashed?: boolean
}

/** A horizontal (value) reference line, e.g. a goal or a budget. */
export interface ReferenceLine {
  value: number
  label: string
  color?: string
}

/** A vertical rule at a category, e.g. "costs reliable from here". */
export interface CategoryRule {
  /** The category (x label, or heatmap column key) the rule sits BEFORE. */
  at: string
  label: string
  color?: string
}
