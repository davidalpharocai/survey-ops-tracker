'use client'

import { fmtNum } from '@/lib/utils/number'

/**
 * "Export what you see": one button for the whole page. It writes the rows the
 * current tab registered for its main card (never a different cut of the
 * data), and then says whether the export was logged. The file downloads
 * first; the log answer arrives after and never holds it up.
 */
export function ExportControl({ rows, busy, message, onExport }: {
  /** Rows the tab registered; null while it has registered none. */
  rows: number | null
  busy: boolean
  message: { ok: boolean; text: string; title?: string } | null
  onExport: () => void
}) {
  const disabled = busy || rows == null || rows === 0
  const title = rows == null
    ? 'This tab has not listed the rows behind its main card yet.'
    : rows === 0
      ? 'There are no rows on screen to export.'
      : `Download the ${fmtNum(rows)} row${rows === 1 ? '' : 's'} behind this tab's main card as a CSV, with the filters written at the top. Every export is logged.`
  return (
    <>
      <button
        type="button"
        onClick={onExport}
        disabled={disabled}
        title={title}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--chart-price)]"
      >
        <span aria-hidden>⭳</span>
        {busy ? 'Exporting…' : 'Export what you see'}
        {rows != null && rows > 0 && !busy && (
          <span className="tabular-nums text-muted-foreground">({fmtNum(rows)})</span>
        )}
      </button>
      <span
        role="status"
        aria-live="polite"
        title={message?.title}
        className={'text-[12px] ' + (message && !message.ok ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}
      >
        {message?.text ?? ''}
      </span>
    </>
  )
}
