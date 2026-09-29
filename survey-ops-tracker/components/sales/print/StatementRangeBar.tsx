'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { DATE_BASES, PRESETS, type DateBasis, type PresetId } from '@/lib/sales/dateRange'

/**
 * The date-range control for a statement produced from the ANALYST side.
 *
 * WHY IT IS HERE AND NOT ON THE PAGE BEFORE IT. On the sales side the range is
 * chosen on the account screen and carried into the print URL — "the filter
 * state is the export state" (AccountDetail). The analyst route has no such
 * screen in front of it: it is opened straight from the client page, so the
 * range has to be choosable on the document itself or the reader would be stuck
 * with All time and no way to say otherwise. David, 2026-09-28: it "should be
 * the exact same thing as sales (ability to deselect columns, date ranges,
 * etc.)".
 *
 * It writes the SAME four parameters the sales print route reads — basis,
 * preset, from, to — through the same helpers, so the two routes cannot
 * interpret a range differently, and a copied link reproduces the document.
 *
 * `no-print`, like the pre-send panel it sits above: this is the last screen
 * before the PDF, not part of it.
 */
export function StatementRangeBar({ basis, preset, from, to }: {
  basis: DateBasis
  preset: PresetId
  from: string | null
  to: string | null
}) {
  const router = useRouter()
  const params = useSearchParams()
  const pathname = usePathname()

  // replace, not push: nudging a date range is not a place in history worth a
  // Back press each — the same rule the insights filters follow.
  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') sp.delete(k)
      else sp.set(k, v)
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  const field = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm'

  return (
    <div
      className="no-print mx-auto mb-3 flex w-[210mm] max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3"
      data-print="hide"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dates</span>
      <select
        value={basis}
        aria-label="Date basis"
        onChange={e => go({ basis: e.target.value })}
        title={DATE_BASES.find(b => b.id === basis)?.hint}
        className={field}
      >
        {DATE_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>

      <select
        value={preset}
        aria-label="Date range"
        onChange={e => go({ preset: e.target.value, from: null, to: null })}
        className={field}
      >
        {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {preset === 'custom' && (
        <>
          <input
            type="date" value={from ?? ''} aria-label="From"
            onChange={e => go({ from: e.target.value || null })}
            className={field}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date" value={to ?? ''} aria-label="To"
            onChange={e => go({ to: e.target.value || null })}
            className={field}
          />
        </>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        The range shapes the table and the activity summary. What prints is chosen below.
      </span>
    </div>
  )
}
