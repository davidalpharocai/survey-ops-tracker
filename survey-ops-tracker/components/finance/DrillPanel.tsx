'use client'

/**
 * The drill-down: the surveys behind a figure, beside the figure.
 *
 * Every figure on this page used to be a dead end: there was no way to get from
 * "$52,612 of scrub" to the 84 surveys behind it. `grep -c "next/link|<a href"`
 * on the old finance page returned 0.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * The panel renders the rows a tab built into a `DrillSpec` (lib/finance/
 * drill.ts). It never re-filters or re-derives its own population: a detail
 * table that computes its own set will eventually disagree with the headline
 * above it, and a table that disagrees with its headline is worse than none.
 *
 * The strip at the top is the enforcement. It adds up the rows' contributions
 * and compares them with the spec's expected total — which the tab computed
 * with a DIFFERENT function — and compares the rows' ids with the ids the
 * figure counted. Green only when both agree; red with the gap, and the codes
 * of the surveys that are missing or extra, when they do not.
 *
 * ── A REAL DIALOG ───────────────────────────────────────────────────────────
 * role="dialog", aria-modal, labelled by its title and described by its
 * population sentence. Focus moves in, Tab stays in, Escape closes and hands
 * focus back to the figure that opened it, and the page behind does not
 * scroll (./shell/useModalDialog.ts). A slide-over on a wide screen, so the
 * figure stays beside its detail; a full-screen sheet on a phone.
 */

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { reconcile, reconcileText, type DrillRow, type DrillSpec } from '@/lib/finance/drill'
import { money, money2 } from '@/lib/finance/format'
import { exportDrill, exportLogMessage, type ExportAudit } from '@/lib/finance/exportFinance'
import { ProjectLink } from './tabs/Card'
import type { DrillOpts } from './tabs/types'
import { useModalDialog } from './shell/useModalDialog'

export type { DrillRow, DrillSpec }

/** What the page hands the panel so "Download these rows" writes the same
 *  header block and audit fields as the page's own export. Called at click
 *  time with the drill's row count, so the as-of time, the filters and the
 *  "Rows:" line are the ones on screen then. */
export interface DrillExportContext {
  header: string[]
  audit: ExportAudit
}

export interface OpenDrill {
  spec: DrillSpec
  opts?: DrillOpts
}

const fmtFor = (f: DrillSpec['format']) => (v: number) =>
  f === 'number' ? fmtNum(Math.round(v)) : f === 'money2' ? money2(v) : money(v)

/** A cell as the reader sees it: "—" for nothing, counts with separators. */
function cellText(v: string | number | null): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : '—'
  return v
}

/** How many codes to name in a red strip before "and N more". */
const NAME_AT_MOST = 12

export function DrillPanel({ drill, onClose, codeOf, exportContext }: {
  drill: OpenDrill | null
  onClose: () => void
  /** Survey code by id — a MISSING survey is by definition not in the rows, so
   *  the panel cannot read its code from them. */
  codeOf?: (id: string) => string | null
  exportContext?: (rows: number) => DrillExportContext
}) {
  const open = drill != null
  const closeRef = useRef<HTMLButtonElement>(null)
  const ref = useModalDialog(open, onClose, { initialFocus: closeRef })
  const titleId = useId()
  const popId = useId()
  const [busy, setBusy] = useState(false)
  const [logged, setLogged] = useState<ReturnType<typeof exportLogMessage> | null>(null)
  const spec = drill?.spec ?? null
  // A new drill starts with no export message.
  useEffect(() => { setLogged(null); setBusy(false) }, [spec])

  if (!drill || !spec) return null

  const fmt = fmtFor(spec.format)
  const rec = reconcile({ rows: spec.rows, expectedTotal: spec.expectedTotal, expectedIds: spec.expectedIds })
  const strip = reconcileText(rec, fmt)
  const rowCode = new Map(spec.rows.map(r => [r.id, r.code]))
  const codeFor = (id: string) => rowCode.get(id) ?? codeOf?.(id) ?? null
  // Concentration reads straight off the page: if the top five rows are 60% of
  // the total, the problem is five surveys and not a systemic one. Only
  // meaningful when every row adds (a negative row makes a running share lie).
  const showCum = rec.rowSum > 0 && spec.rows.every(r => Number(r.contribution) >= 0)
  const running: number[] = []
  let acc = 0
  for (const r of spec.rows) { acc += Number.isFinite(r.contribution) ? r.contribution : 0; running.push(acc) }

  const download = async () => {
    if (!exportContext || busy) return
    setBusy(true)
    try {
      const ctx = exportContext(spec.rows.length)
      setLogged(exportLogMessage(await exportDrill(spec, ctx.header, ctx.audit)))
    } finally {
      setBusy(false)
    }
  }

  const codes = (ids: string[]) => (
    <>
      {ids.slice(0, NAME_AT_MOST).map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <ProjectLink id={id} code={codeFor(id)} />
        </span>
      ))}
      {ids.length > NAME_AT_MOST && <> and {fmtNum(ids.length - NAME_AT_MOST)} more</>}
    </>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={popId}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-card shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:w-[760px] md:border-l md:border-border"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">{spec.title}</h2>
            <p id={popId} className="mt-0.5 text-xs text-muted-foreground">{spec.population}</p>
            {drill.opts?.filter && (
              <p className="mt-1 text-xs">
                <Link href={drill.opts.filter.href} replace scroll={false} onClick={onClose}
                  className="font-medium text-primary underline-offset-2 hover:underline">
                  {drill.opts.filter.label}
                </Link>
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the list"
            className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chart-price)]"
          >
            ✕
          </button>
        </header>

        {/* The most important element here: it makes drift self-reporting
            instead of silent. */}
        <div
          data-testid="drill-check"
          data-ok={strip.ok ? 'true' : 'false'}
          role={strip.ok ? undefined : 'alert'}
          className={
            'border-b px-4 py-2 text-[13px] tabular-nums ' +
            (strip.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400')
          }
        >
          <p>
            {strip.ok ? <><span aria-hidden>✓ </span>{strip.text}</> : strip.text}
            {strip.ok && spec.expectedTotal == null && (
              <span className="text-muted-foreground"> This figure is not a sum of the rows, so only the list of surveys is checked.</span>
            )}
          </p>
          {!rec.ok && rec.missingIds.length > 0 && (
            <p className="mt-0.5">Missing from this list: {codes(rec.missingIds)}.</p>
          )}
          {!rec.ok && rec.extraIds.length > 0 && (
            <p className="mt-0.5">Listed here but not in the figure: {codes(rec.extraIds)}.</p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {spec.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing behind this figure.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                    <span className="inline-flex items-center">Survey<InfoTooltip text="The survey's code. It is a real link: click to open the project, or right-click or middle-click to open it in a new tab." /></span>
                  </th>
                  {spec.columns.map(c => (
                    <th key={c.key} scope="col"
                      className={'whitespace-nowrap px-3 py-1.5 font-medium ' + (c.num ? 'text-right' : 'text-left')}>
                      <span className={'inline-flex items-center ' + (c.num ? 'justify-end' : '')}>
                        {c.header}
                        {c.tip ? <InfoTooltip text={c.tip} /> : null}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                    <span className="inline-flex items-center justify-end">
                      {spec.totalLabel}
                      <InfoTooltip text="What this row adds to the figure. The check at the top adds up this column." />
                    </span>
                  </th>
                  {showCum && (
                    <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                      <span className="inline-flex items-center justify-end">
                        Running share
                        <InfoTooltip text="This row and every row above it, as a share of the total. If the first few rows reach most of it, the figure is about a few surveys." />
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {spec.rows.map((r, i) => (
                  <tr key={`${r.id}-${i}`} className="hover:bg-accent/40">
                    <td className="whitespace-nowrap px-3 py-1.5"><ProjectLink id={r.id} code={r.code} /></td>
                    {spec.columns.map(c => (
                      <td key={c.key} className={'px-3 py-1.5 ' + (c.num ? 'whitespace-nowrap text-right tabular-nums' : '')}>
                        {cellText(c.value(r))}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {Number.isFinite(r.contribution) ? fmt(r.contribution) : '—'}
                    </td>
                    {showCum && (
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {Math.round((running[i] / rec.rowSum) * 100)}%
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            {spec.totalLabel}:{' '}
            <span className="tabular-nums text-foreground">
              {spec.expectedTotal == null ? 'not a sum of these rows' : fmt(spec.expectedTotal)}
            </span>
          </span>
          {exportContext && (
            <button
              type="button"
              onClick={download}
              disabled={busy || spec.rows.length === 0}
              title="Download these rows as a CSV, with the filters and this check written at the top. Every export is logged."
              className="rounded-md border border-border px-2 py-1 text-[12px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Downloading…' : 'Download these rows'}
            </button>
          )}
          <span role="status" aria-live="polite" title={logged?.title}
            className={logged && !logged.ok ? 'text-red-700 dark:text-red-400' : ''}>
            {logged?.text ?? ''}
          </span>
          <span className="ml-auto">Esc closes.</span>
        </footer>
      </div>
    </>
  )
}

/** A figure that opens a drill-down. Renders as a button but reads as a number:
 *  the affordance is the underline on hover, not a control that competes with
 *  the value for attention. (Kept for the old tabs until they are retired.) */
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
