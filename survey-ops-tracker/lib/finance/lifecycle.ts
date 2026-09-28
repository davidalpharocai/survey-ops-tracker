/**
 * The ONE survey classifier for the finance hub.
 *
 * Before this there were two orders and three predicates. `lifecycleOf` put
 * Cancelled ahead of Delivered and had no Hold branch, so the nine held surveys
 * fell into "in flight"; `isScoping` keyed on the raw `phase` column, so a
 * survey still marked Scoping while it was being fielded (PR00443, $2,863.68 of
 * SMS sends) vanished from every total, and 20 cancelled or held deals were
 * hidden with it; and the page never read `is_placeholder`, so 20 empty rerun
 * shells counted as delivered work and dragged July's cost coverage from 85% to
 * 73%. One function, checked in one order, ends all three.
 *
 * ── THE ORDER IS LOAD-BEARING ───────────────────────────────────────────────
 * Asked independently, most surveys satisfy more than one test (the whole
 * delivered book is also status Closed). The first match wins:
 *
 *   1. EMPTY PLACEHOLDER — `is_placeholder` with no blast, panel or cost row
 *      and no N. Excluded everywhere: it is a shell the rerun spawner made, not
 *      work. A placeholder that DOES hold data (PR00352 $1,510, PR00344 $1,009)
 *      is not empty and falls through to the real tests below, so its money is
 *      never hidden — the flag on it is a data error to clear, not a class.
 *   2. DELIVERED — board_column 'Delivery'. Beats everything, as it does in the
 *      sales buckets (lib/sales/buckets.ts): a delivered study is finished work
 *      whatever else its row says.
 *   3. CANCELLED — status 'Cancelled', or a cancelled_at stamp. Both are read so
 *      a future path that sets only one cannot drop a survey out of the money.
 *   4. HOLD — status 'Hold'. Its own bucket, kept OUT of live totals (David,
 *      2026-09-24: "give it its own bucket and keep out of live totals. im
 *      trying to minimize # of holds"). Visible, counted, never summed as live.
 *   5. ARCHIVED — status 'Closed' and, by here, never delivered.
 *   6. SCOPING — phase 'Scoping' AND status 'Open' AND no blast or panel rows.
 *      A survey that has started buying respondents is being fielded whatever
 *      its phase says, so field rows override a stale phase.
 *   7. ACTIVE — everything else: sold, open, not yet delivered.
 */

/** The fields the classifier reads. Structural, so any project shape fits. */
export interface ClassifySubject {
  board_column: string | null
  status: string | null
  phase: string | null
  cancelled_at?: string | null
  is_placeholder?: boolean | null
  n_collected?: number | null
  n_actual?: number | null
}

export type FinClass =
  | 'placeholder'
  | 'delivered'
  | 'cancelled'
  | 'hold'
  | 'archived'
  | 'scoping'
  | 'active'

/** How many child rows a survey has. `costs` counts flat cost lines. */
export interface FieldRowCounts {
  blasts: number
  suppliers: number
  costs?: number
}

export const NO_ROWS: FieldRowCounts = { blasts: 0, suppliers: 0, costs: 0 }

/** Every class, in the classifier's order. */
export const CLASSES: FinClass[] = [
  'placeholder', 'delivered', 'cancelled', 'hold', 'archived', 'scoping', 'active',
]

/** Plain-English labels, for chips, scope lines and exports. */
export const CLASS_LABEL: Record<FinClass, string> = {
  placeholder: 'Empty placeholder',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  hold: 'On hold',
  archived: 'Archived',
  scoping: 'Scoping',
  active: 'Live',
}

/** One-sentence explainers, for the (i) beside each label. */
export const CLASS_HELP: Record<FinClass, string> = {
  placeholder: 'A rerun wave the system created ahead of time that holds no costs, no respondents and no N yet. Left out of every figure.',
  delivered: 'Finished and handed to the client (board column Delivery).',
  cancelled: 'Called off before delivery. Any money it spent bought nothing billable.',
  hold: 'Paused. Counted on its own and kept out of live totals, so a hold is visible without inflating the pipeline.',
  archived: 'Closed without ever reaching Delivery — mostly legacy imports.',
  scoping: 'Still being scoped or priced, and not yet buying respondents. Not sold work, so not in any total.',
  active: 'Sold and running: not yet delivered, not on hold, not cancelled.',
}

const hasN = (p: ClassifySubject) =>
  Number(p.n_collected ?? 0) > 0 || p.n_actual != null

/** Classify one survey. See the header for why the order is what it is. */
export function classify(p: ClassifySubject, rows: FieldRowCounts = NO_ROWS): FinClass {
  const fieldRows = (rows.blasts ?? 0) + (rows.suppliers ?? 0)
  const anyRows = fieldRows + (rows.costs ?? 0) > 0
  if (p.is_placeholder === true && !anyRows && !hasN(p)) return 'placeholder'
  if (p.board_column === 'Delivery') return 'delivered'
  if (p.status === 'Cancelled' || p.cancelled_at != null) return 'cancelled'
  if (p.status === 'Hold') return 'hold'
  if (p.status === 'Closed') return 'archived'
  if (p.phase === 'Scoping' && p.status === 'Open' && fieldRows === 0) return 'scoping'
  return 'active'
}

/** Anything shaped like the finance index (lib/finance/hub.ts FinIndex). */
export interface RowIndexLike {
  blasts: Map<string, unknown[]>
  suppliers: Map<string, unknown[]>
  costs: Map<string, unknown[]>
}

/** Child-row counts for one survey, read off the index. */
export function rowCountsOf(id: string, ix: RowIndexLike): FieldRowCounts {
  return {
    blasts: ix.blasts.get(id)?.length ?? 0,
    suppliers: ix.suppliers.get(id)?.length ?? 0,
    costs: ix.costs.get(id)?.length ?? 0,
  }
}

/** Classify with the index — the form every looping caller uses. */
export function classOf(p: ClassifySubject & { id: string }, ix?: RowIndexLike): FinClass {
  return classify(p, ix ? rowCountsOf(p.id, ix) : NO_ROWS)
}

/** Work that is running and counts toward live totals. Hold is NOT live. */
export const isLive = (c: FinClass) => c === 'active'

/** True for the one class that is excluded everywhere. */
export const isEmptyPlaceholder = (c: FinClass) => c === 'placeholder'
