'use client'

/**
 * The Tile 2 group-by picker. Each choice is a real link that sets `?by=` and
 * keeps everything else on the URL (the filter, the tab), so a grouping can be
 * bookmarked, shared, or opened in a new tab.
 */

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { DEFAULT_GROUP_BY, GROUP_BY_OPTIONS, type ResultsGroupBy } from '@/lib/finance/results'

/** The href for one grouping: the current URL with `by` set (and dropped for
 *  the default, so the default view keeps a clean URL). */
export function groupByHref(pathname: string, params: URLSearchParams, by: ResultsGroupBy): string {
  const next = new URLSearchParams(params.toString())
  if (by === DEFAULT_GROUP_BY) next.delete('by')
  else next.set('by', by)
  const q = next.toString()
  return q ? `${pathname}?${q}` : pathname
}

export function GroupByPicker({ by }: { by: ResultsGroupBy }) {
  const pathname = usePathname() ?? '/finance'
  const params = useSearchParams()
  const current = new URLSearchParams(params?.toString() ?? '')
  return (
    <nav aria-label="Group Where it was made and lost by" className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center text-xs text-muted-foreground">
        Group by
        <InfoTooltip text="Choose how the card below splits the margin: by account, route, month, contact, type as filed, survey, or panel supplier." />
      </span>
      {GROUP_BY_OPTIONS.map(o => {
        const on = o.id === by
        return (
          <Link
            key={o.id}
            href={groupByHref(pathname, current, o.id)}
            scroll={false}
            aria-current={on ? 'page' : undefined}
            title={o.help}
            className={
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
              (on
                ? 'border-[var(--chart-price)] bg-[var(--chart-price)] text-[var(--chart-on-strong)]'
                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground')
            }
          >
            {o.label}
          </Link>
        )
      })}
    </nav>
  )
}
