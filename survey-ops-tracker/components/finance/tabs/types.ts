/**
 * The contract between the finance shell and its four tabs.
 *
 * ── WHY ONE PROPS SHAPE ─────────────────────────────────────────────────────
 * The old page computed each tab's population in the page and passed each tab
 * a different bag of pre-cut arrays, so two tabs could describe "delivered
 * since June" as two different sets of surveys. Here the shell loads once,
 * classifies once and filters once, and every tab is handed the same object:
 * its population is `populationFor(items, tab, filter, today)` and nothing
 * else. A tab that wants a different set of surveys has to say so in code
 * that reads `items` directly, where a reviewer can see it.
 *
 * ── WHAT A TAB MAY NOT DO ───────────────────────────────────────────────────
 * Re-read anything `load` already holds, compute revenue other than through
 * lib/finance/revenue.ts, or sum a figure from the same rows its drill checks
 * against (rule 5 of the finance spec: drills reconcile against something
 * else).
 */

import type { Blocked, FinanceLoad, FinanceTable } from '@/lib/finance/load'
import type { FilterDescription, FinanceFilter, FinanceTab, FinItem } from '@/lib/finance/filters'
import type { FinIndex } from '@/lib/finance/hub'
import type { DrillSpec } from '@/lib/finance/drill'

export interface FinanceTabProps {
  tab: FinanceTab
  /** Every read the hub makes, settled table by table. */
  load: FinanceLoad
  /** `buildIndex(raw.blasts, raw.suppliers, raw.costs)`, built once per load. */
  ix: FinIndex
  /** Every survey except empty placeholders, classified, routed and placed once. */
  items: FinItem[]
  /** `populationFor(items, tab, filter, today)` — the tab's surveys. */
  population: FinItem[]
  /** `sideBucketFor(...)` — Hold on This week, [] elsewhere. Shown beside the
   *  population as its own bucket and NEVER summed into it. */
  side: FinItem[]
  filter: FinanceFilter
  /** Today in Eastern time, 'YYYY-MM-DD'. */
  today: string
  /** `describe(filter, { tab, today, count: population.length, accountName })`:
   *  the scope chip every card prints, and the filters this tab ignores. */
  scope: FilterDescription
  /** Account name by clients.id; '(unknown account)' when not found. */
  accountName: (clientId: string | null | undefined) => string
  /** Open the drill panel on a spec whose expectedTotal came from a function
   *  other than the one that built its rows. */
  openDrill: (spec: DrillSpec, opts?: DrillOpts) => void
  /** A real href to this page with the filter patched, optionally on another
   *  tab — for "Filter the page to Aug 2026" and for cross-tab links. */
  hrefFor: (patch: Partial<FinanceFilter> & { tab?: FinanceTab }) => string
  /** Register the rows behind the tab's MAIN tile, so the shell's one "Export
   *  what you see" button writes what is on screen. Call it from an effect
   *  keyed on the tab's model; pass null on unmount. */
  registerExport: (x: FinanceExport | null) => void
}

/** Extras a drill header can offer beside its rows. */
export interface DrillOpts {
  /** "Filter the page to Aug 2026": a real href from `hrefFor`, and its words. */
  filter?: { href: string; label: string }
}

/** The rows behind a tab's main tile, as the export will write them. The shell
 *  adds the header block (as-of time, every filter, row count) from `scope`. */
export interface FinanceExport {
  /** File-name stem: 'finance-results-surveys'. */
  name: string
  columns: { key: string; header: string }[]
  rows: Record<string, string | number | null>[]
}

/** The tables a card needs, so it can show "Blocked: <table> did not load"
 *  instead of a number computed on a missing read. */
export type Needs = FinanceTable[]

export const blockedFor = (blocked: Blocked[], needs: Needs): Blocked[] =>
  blocked.filter(b => needs.includes(b.table))
