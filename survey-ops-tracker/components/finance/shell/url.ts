/**
 * The finance page's address: which tab, which filter, as a real href.
 *
 * Every view of the page is a URL — shared, bookmarked, and it survives a
 * refresh. The filter's own keys belong to lib/finance/filters.ts
 * (parseFilter / serializeFilter); this file adds the tab and the rules for
 * what a link carries along.
 *
 * ── WHAT A LINK CARRIES ─────────────────────────────────────────────────────
 *   · The filter, always — changing tab never resets the date, account or route.
 *   · On the SAME tab, anything else on the URL (a tab's own group-by, say), so
 *     a filter change does not throw the reader's other choices away.
 *   · On ANOTHER tab, only the filter: a group-by or an open view belongs to the
 *     tab that set it, and would mean nothing (or something wrong) on another.
 *   · Never the old page's keys (lifecycle, type, contact, drill): the four-tab
 *     page does not read them, and carrying them forward would keep a dead
 *     choice in every link the reader copies.
 */

import {
  DEFAULT_FILTER, RANGE_PRESETS, serializeFilter, TAB_LABEL,
  type FinanceFilter, type FinanceTab,
} from '@/lib/finance/filters'

export const FINANCE_PATH = '/finance'

/** The four tabs, in the order the page shows them. */
export const TAB_ORDER: FinanceTab[] = ['results', 'this-week', 'per-respondent', 'improve']

export const DEFAULT_TAB: FinanceTab = 'results'

/** One line under each tab's name (the title on its link): the question it answers. */
export const TAB_HINT: Record<FinanceTab, string> = {
  'results': 'What we charged, what it cost and what we kept on delivered work',
  'this-week': 'Live work: money still moving, surveys past target, and holds',
  'per-respondent': 'What one respondent costs by route, and where money could come out',
  'improve': 'Which records are missing, and what to fill in first',
}

/**
 * The previous page's tab ids, so an old bookmark lands on the tab that now
 * answers the same question instead of silently resetting:
 *   now   (what needs a phone call today)        → This week
 *   unit  (what one respondent costs)            → Per respondent
 *   book  (what happened)                        → Results
 *   save  (where the money could come out)       → Per respondent, which now
 *                                                  carries the savings levers
 */
export const LEGACY_TAB: Record<string, FinanceTab> = {
  now: 'this-week',
  unit: 'per-respondent',
  book: 'results',
  save: 'per-respondent',
}

/** Keys the old page wrote that this page does not read. */
export const LEGACY_KEYS = ['lifecycle', 'type', 'contact', 'drill', 'preset'] as const

const TAB_IDS = new Set<string>(TAB_ORDER)

/** The tab a `?tab=` value names: a current id, a legacy id mapped forward, or
 *  the default for anything else (missing, misspelt, from a newer page). */
export function tabFromParam(v: string | null | undefined): FinanceTab {
  if (v && TAB_IDS.has(v)) return v as FinanceTab
  if (v && LEGACY_TAB[v]) return LEGACY_TAB[v]
  return DEFAULT_TAB
}

/** True when the URL carries something the page has to rewrite to be
 *  canonical: a legacy tab id, an unknown one, or one of the old page's keys. */
export function needsCanonical(params: URLSearchParams): boolean {
  const t = params.get('tab')
  if (t != null && !TAB_IDS.has(t)) return true
  if (t === DEFAULT_TAB) return true
  return LEGACY_KEYS.some(k => params.has(k))
}

export type HrefPatch = Partial<FinanceFilter> & { tab?: FinanceTab }

/**
 * A real href to the finance page with the filter patched, optionally on
 * another tab. `current` is the URL as it stands (for the tab's own keys),
 * `filter` and `tab` what the page parsed from it.
 *
 * The default tab and a default filter are left out, so the plain view is a
 * plain `/finance`.
 */
export function financeHref(
  current: URLSearchParams | string, filter: FinanceFilter, tab: FinanceTab, patch: HrefPatch = {},
): string {
  const { tab: nextTabRaw, ...filterPatch } = patch
  const nextTab = nextTabRaw ?? tab
  const cur = new URLSearchParams(typeof current === 'string' ? current : current.toString())
  const base = nextTab === tab ? cur : new URLSearchParams()
  for (const k of LEGACY_KEYS) base.delete(k)
  base.delete('tab')
  const next: FinanceFilter = { ...filter, ...filterPatch }
  const rest = serializeFilter(next, base)
  // The tab first, so the address reads in the order the page does.
  const out = new URLSearchParams()
  if (nextTab !== DEFAULT_TAB) out.set('tab', nextTab)
  rest.forEach((v, k) => out.append(k, v))
  const qs = out.toString()
  return qs ? `${FINANCE_PATH}?${qs}` : FINANCE_PATH
}

/** The same URL, rewritten to be canonical (legacy tab mapped, old keys
 *  dropped). Used once, on arrival, with router.replace. */
export function canonicalHref(params: URLSearchParams, filter: FinanceFilter): string {
  return financeHref(params, filter, tabFromParam(params.get('tab')))
}

/** The filter with one dimension put back to its default — what a chip's ✕ does. */
export function withoutDimension(f: FinanceFilter, dim: 'range' | 'account' | 'route'): FinanceFilter {
  if (dim === 'range') return { ...f, range: { ...DEFAULT_FILTER.range } }
  if (dim === 'account') return { ...f, account: null }
  return { ...f, route: DEFAULT_FILTER.route }
}

export const tabLabel = (t: FinanceTab) => TAB_LABEL[t]

/** "since 1 Jun 2026" — the default preset's own label in running text, so a
 *  link back to the default can never name a different window from the one it
 *  goes to. */
export const DEFAULT_RANGE_WORDS = (() => {
  const l = RANGE_PRESETS.find(p => p.id === DEFAULT_FILTER.range.preset)?.label ?? 'the default range'
  return l.charAt(0).toLowerCase() + l.slice(1)
})()
