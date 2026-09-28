'use client'

import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import type { BannerModel } from './banner'
import { DEFAULT_RANGE_WORDS as DEFAULT_WORDS } from './url'

/**
 * The one banner under the filter bar, on every tab, and the integrity line
 * under it. Every word is computed (./banner.ts and lib/finance/load.ts); this
 * file only lays them out.
 */
export function DataBanner({ model, improveHref, defaultHref }: {
  model: BannerModel
  /** A real href to the Improve tab, or null when the reader is already on it. */
  improveHref: string | null
  /** A real href to the default window, for "Back to since 1 Jun 2026". */
  defaultHref: string
}) {
  const amber = model.tone === 'amber'
  return (
    <section
      aria-label="How complete the finance data is"
      className={
        'rounded-lg border px-4 py-2.5 text-[13px] leading-relaxed ' +
        (amber
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
          : 'border-border bg-muted/30 text-muted-foreground')
      }
    >
      <p>
        <span className="font-semibold text-foreground">{model.reliability.join(' ')}</span>{' '}
        {model.view.join(' ')}{' '}
        {model.floor}
        <InfoTooltip text={model.help} />
      </p>
      {model.priceGap && (
        <p className="mt-1">
          {model.priceGap}{' '}
          {improveHref && (
            <Link href={improveHref} scroll={false} className="font-medium text-primary underline-offset-2 hover:underline">
              See which surveys need a price on the Improve tab
            </Link>
          )}
        </p>
      )}
      {model.mixed && (
        <p className="mt-1">
          {model.mixed}{' '}
          {model.offerDefault && (
            <Link href={defaultHref} scroll={false} className="font-medium text-primary underline-offset-2 hover:underline">
              Back to {DEFAULT_WORDS}
            </Link>
          )}
        </p>
      )}
      {!model.priceGap && improveHref && (
        <p className="mt-1">
          <Link href={improveHref} scroll={false} className="text-primary underline-offset-2 hover:underline">
            What to fill in next: the Improve tab
          </Link>
        </p>
      )}
    </section>
  )
}

/** "Loaded 441 surveys · 1,063 blasts · … · 18:40", grey; red and naming the
 *  table when a read failed, a count disagreed or no prices came back. */
export function IntegrityLine({ line, warnings }: { line: string; warnings: string[] }) {
  if (warnings.length === 0) {
    return (
      <p className="px-1 text-[11px] text-muted-foreground" title="What this page read from the database, and a check that the spend it recomputed matches the stored figure.">
        {line}
      </p>
    )
  }
  return (
    <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-[12px] text-red-700 dark:text-red-400">
      {warnings.map(w => <p key={w}>{w}</p>)}
      <p className="mt-0.5 text-[11px] opacity-80">{line}</p>
    </div>
  )
}
