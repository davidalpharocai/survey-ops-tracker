'use client'

/**
 * The frame every chart sits in: optional title with an (i) explainer, the
 * legend, the plot, the empty state, and the "View as table" twin.
 *
 * WHY A TABLE TWIN: a tooltip may enhance a chart but must never be the only
 * way to read a value. The table lists every number the chart draws (and
 * the ones it had to thin out of the axis to stop labels colliding), is a
 * real <table> a screen reader can walk, and — when the chart drills — each
 * row carries the same drill as its mark, so keyboard users are never worse
 * off than mouse users.
 */

import { useId, useState, type ReactNode, type Ref } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Legend, type LegendItem } from './Legend'

export const DEFAULT_EMPTY = 'No data in this view'

export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'right'
  /** Explainer for the header (title= tooltip). */
  title?: string
}

export interface TableRow {
  key: string
  cells: ReactNode[]
  /** Drill for this row; rendered as a button (or link, with href) in the first cell. */
  onSelect?: () => void
  href?: string | null
  /** Muted rows (e.g. "too few to judge") read quieter in the table too. */
  muted?: boolean
}

export interface ChartTable {
  columns: TableColumn[]
  rows: TableRow[]
}

export interface ChartFrameProps {
  ariaLabel: string
  title?: string
  info?: string
  legend?: LegendItem[]
  /** Extra legend content after the items, e.g. a heatmap colour scale. */
  legendExtra?: ReactNode
  /** The same data as a table; when present, a "View as table" toggle shows. */
  table?: ChartTable | null
  tableOpen?: boolean
  /** Show the empty state instead of the plot. */
  empty?: boolean
  emptyMessage?: string
  /** Plot height, so the empty state holds the same space (no layout jump). */
  height?: number
  /** Ref for the plot container the chart measures its width from. */
  plotRef?: Ref<HTMLDivElement>
  className?: string
  children?: ReactNode
}

export function ChartFrame({
  ariaLabel,
  title,
  info,
  legend,
  legendExtra,
  table,
  tableOpen = false,
  empty = false,
  emptyMessage = DEFAULT_EMPTY,
  height = 200,
  plotRef,
  className = '',
  children,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(tableOpen)
  const tableId = useId()
  const hasTable = !!table && !empty

  return (
    <figure aria-label={ariaLabel} className={`flex min-w-0 flex-col gap-2 ${className}`}>
      {title && (
        <figcaption className="flex items-center text-sm font-medium text-foreground">
          {title}
          {info && <InfoTooltip text={info} />}
        </figcaption>
      )}
      {!empty && ((legend && legend.length > 0) || legendExtra) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend && legend.length > 0 && <Legend items={legend} />}
          {legendExtra}
        </div>
      )}
      {/* The plot container is measured even while empty, so the chart
          already knows its width when data arrives. */}
      <div ref={plotRef} className="relative w-full min-w-0">
        {empty ? (
          <div
            role="status"
            className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground"
            style={{ minHeight: Math.max(64, Math.min(height, 160)) }}
          >
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
      {hasTable && (
        <div className="flex justify-end">
          <button
            type="button"
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => setShowTable((v) => !v)}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title="Every number in this chart as a table (also readable by screen readers)"
          >
            {showTable ? 'Hide table' : 'View as table'}
          </button>
        </div>
      )}
      {hasTable && showTable && (
        <div id={tableId} className="thin-scroll max-w-full overflow-x-auto rounded-lg border border-border">
          <DataTable table={table!} caption={ariaLabel} />
        </div>
      )}
    </figure>
  )
}

/** The accessible table twin. Exported so a page can show it without a chart. */
export function DataTable({ table, caption }: { table: ChartTable; caption: string }) {
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          {table.columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              title={c.title}
              className={`whitespace-nowrap px-2.5 py-1.5 font-medium text-muted-foreground ${
                c.align === 'right' ? 'text-right' : 'text-left'
              }`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r) => (
          <tr key={r.key} className={`border-b border-border/60 last:border-0 ${r.muted ? 'text-muted-foreground' : ''}`}>
            {r.cells.map((cell, i) => {
              const align = table.columns[i]?.align === 'right' ? 'text-right tabular-nums' : 'text-left'
              const content =
                i === 0 && (r.href || r.onSelect) ? <RowDrill row={r}>{cell}</RowDrill> : cell
              return i === 0 ? (
                <th key={i} scope="row" className={`px-2.5 py-1.5 font-normal ${align}`}>
                  {content}
                </th>
              ) : (
                <td key={i} className={`whitespace-nowrap px-2.5 py-1.5 ${align}`}>
                  {content}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The look of every drill control in a table twin: link colour, and the same
 *  2px focus ring as the rest of the app (the browser default is a faint 1px). */
export const DRILL_CONTROL_CLASS =
  'text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded-sm text-left'

function RowDrill({ row, children }: { row: TableRow; children: ReactNode }) {
  const cls = DRILL_CONTROL_CLASS
  if (row.href) {
    return (
      <Link
        href={row.href}
        className={cls}
        onClick={(e) => {
          // A plain click runs the in-page drill; a modified click (new tab,
          // new window) falls through to the browser like any link.
          if (row.onSelect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
            e.preventDefault()
            row.onSelect()
          }
        }}
      >
        {children}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} onClick={row.onSelect}>
      {children}
    </button>
  )
}
