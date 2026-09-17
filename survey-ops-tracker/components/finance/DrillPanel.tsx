'use client'

/**
 * The drill-down.
 *
 * Every figure on this page used to be a dead end: there was no way to get from
 * "$52,612 of scrub" to the 84 surveys behind it. `grep -c "next/link|<a href"`
 * on the old finance page returned 0.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * The panel renders the ROWS THE AGGREGATE SUMMED. It is handed the ids and it
 * never re-filters or re-derives its own population. A detail table that
 * computes its own set will eventually disagree with the headline above it, and
 * a table that disagrees with its headline is worse than no table.
 *
 * The reconciliation strip at the top is the enforcement: it adds the column
 * the reader is looking at and compares it to the headline, in the panel, every
 * time it opens. If those ever drift the panel says so in red rather than
 * quietly showing a different number than the card that opened it.
 *
 * ── WHY A SLIDE-OVER AND NOT A ROUTE ────────────────────────────────────────
 * The aggregate stays on screen beside its own detail, so a reader can check
 * one against the other without navigating. It writes ?drill=<key> to the URL,
 * so browser Back closes it and the view is shareable. The page never unmounts
 * and never refetches — the panel reads the same useMemo result, so opening it
 * costs nothing.
 */

import { useEffect } from 'react'
import { fmtNum } from '@/lib/utils/number'
import { money, money2, ProjectLink } from './shared'

export interface DrillColumn {
  header: string
  /** Right-aligned and tabular — every numeric column should set this. */
  num?: boolean
  value: (row: DrillRow) => React.ReactNode
  /** Sort key. Absent means the column is not sortable. */
  sort?: (row: DrillRow) => number | string
}

export interface DrillRow {
  id: string
  code: string | null
  /** What this row contributes to the headline. The reconciliation strip adds
   *  these, so it must be in the same unit as the total. */
  contribution: number
  [k: string]: unknown
}

export interface DrillSpec {
  key: string
  title: string
  /** The population sentence: "Delivered · all routes · 84 of 325 surveys". */
  population: string
  rows: DrillRow[]
  columns: DrillColumn[]
  total: { label: string; value: number }
  /** How to render the total and each contribution. */
  format?: 'money' | 'money2' | 'number'
}

const fmt = (v: number, f: DrillSpec['format']) =>
  f === 'number' ? fmtNum(Math.round(v)) : f === 'money2' ? money2(v) : money(v)

export function DrillPanel({ spec, onClose }: { spec: DrillSpec | null; onClose: () => void }) {
  // Esc closes. Registered on the document because the panel does not hold
  // focus when a reader is still looking at the card that opened it.
  useEffect(() => {
    if (!spec) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [spec, onClose])

  if (!spec) return null

  const summed = spec.rows.reduce((t, r) => t + r.contribution, 0)
  // To the cent. A drift of $0.01 is rounding; anything larger means the panel
  // and the card are describing different sets and the reader must be told.
  const agrees = Math.abs(summed - spec.total.value) < 0.01
  const running: number[] = []
  let acc = 0
  for (const r of spec.rows) { acc += r.contribution; running.push(acc) }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={spec.title}
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-2xl md:w-[760px]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{spec.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{spec.population}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </header>

        {/* The most important element here. It makes drift self-reporting
            instead of silent. */}
        <div className={
          'border-b px-4 py-2 text-[13px] tabular-nums ' +
          (agrees
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
            : 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400')
        }>
          {agrees ? (
            <>Σ of the {fmtNum(spec.rows.length)} rows below = {fmt(summed, spec.format)} ✓</>
          ) : (
            <>
              These rows sum to {fmt(summed, spec.format)} but the figure above says{' '}
              {fmt(spec.total.value, spec.format)} — a gap of {fmt(Math.abs(summed - spec.total.value), spec.format)}.
              Do not trust either until this is explained.
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {spec.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing behind this figure.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-1.5 text-left font-medium">Survey</th>
                  {spec.columns.map(c => (
                    <th key={c.header}
                      className={'px-3 py-1.5 font-medium ' + (c.num ? 'text-right' : 'text-left')}>
                      {c.header}
                    </th>
                  ))}
                  {/* Concentration reads straight off the page: if the top five
                      rows are 60% of the total, the problem is five surveys and
                      not a systemic one. */}
                  <th className="px-3 py-1.5 text-right font-medium">Cum %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {spec.rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-accent/40">
                    <td className="px-3 py-1.5"><ProjectLink id={r.id} code={r.code} /></td>
                    {spec.columns.map(c => (
                      <td key={c.header}
                        className={'px-3 py-1.5 ' + (c.num ? 'text-right tabular-nums' : '')}>
                        {c.value(r)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {summed > 0 ? Math.round((running[i] / summed) * 100) + '%' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {spec.total.label}: <span className="tabular-nums text-foreground">{fmt(spec.total.value, spec.format)}</span>
          {' · '}Every code is a real link — right-click or middle-click to open in a tab.
          {' · '}Esc closes.
        </footer>
      </aside>
    </>
  )
}

/** A figure that opens a drill-down. Renders as a button but reads as a number:
 *  the affordance is the underline on hover, not a control that competes with
 *  the value for attention. */
export function Drillable({ onOpen, children, title }: {
  onOpen: () => void; children: React.ReactNode; title?: string
}) {
  return (
    <button
      onClick={onOpen}
      title={title ?? 'Show the surveys behind this'}
      className="text-left underline-offset-4 hover:underline focus:underline focus:outline-none"
    >
      {children}
    </button>
  )
}
