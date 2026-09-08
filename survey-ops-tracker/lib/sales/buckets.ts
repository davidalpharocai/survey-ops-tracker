/**
 * The three-way split David asked for: "a breakdown between whats been
 * completed, whats being scoped, whats active".
 *
 * Pure so it can be tested, and shared so the sales view and any later export
 * agree. The definitions are NOT invented here — they mirror the predicates the
 * Operations list already uses, so sales and ops never disagree about whether a
 * study is active.
 *
 * WHY `scoping_stage` IS NEVER USED for this: 302 of 375 rows read "New
 * Inquiry", including 201 that have been delivered. It was never maintained, so
 * bucketing on it would put most of the portfolio in Scoping.
 */

export type BucketId = 'active' | 'scoping' | 'completed' | 'hold' | 'closed'

export interface BucketInput {
  status: string | null
  phase: string | null
  board_column: string | null
}

export interface Bucket {
  id: BucketId
  label: string
  /** One line, shown as the tile's tooltip — these words are the definition. */
  hint: string
}

export const BUCKETS: Bucket[] = [
  {
    id: 'active',
    label: 'Active',
    hint: 'Scoped and running — in programming, QA, fielding or delivery, and not yet delivered.',
  },
  {
    id: 'scoping',
    label: 'Scoping',
    hint: 'Still being scoped and priced. Not committed work yet.',
  },
  {
    id: 'completed',
    label: 'Delivered',
    hint: 'Delivered to the client. This is what "completed" means here — it reached the Delivery stage.',
  },
  {
    id: 'hold',
    label: 'On hold',
    hint: 'Paused. Shown separately rather than folded into Active, because it is not moving.',
  },
  {
    id: 'closed',
    label: 'Closed',
    hint: 'Archived or cancelled without being delivered.',
  },
]

/**
 * Which bucket one survey belongs to. Exactly one, always.
 *
 * ORDER MATTERS and is deliberate:
 *   1. Delivered wins over everything. A delivered study whose status is still
 *      'Open' (the app leaves it Open until it is closed) is DELIVERED, not
 *      active — that is the distinction the project-status model draws, where
 *      Delivered means it reached the Delivery stage and Archived means legacy
 *      or off-board.
 *   2. Then Hold, so a paused study never counts as Active.
 *   3. Then Closed/Cancelled, which at this point did NOT reach delivery.
 *   4. Then the phase split for whatever is still genuinely open.
 */
export function bucketOf(p: BucketInput): BucketId {
  if (p.board_column === 'Delivery') return 'completed'
  if (p.status === 'Hold') return 'hold'
  if (p.status === 'Closed' || p.status === 'Cancelled') return 'closed'
  if (p.phase === 'Scoping') return 'scoping'
  return 'active'
}

/** Count each bucket. Every input lands in exactly one, so the parts sum to the
 *  whole — which is the property that makes the tiles trustworthy as a summary
 *  rather than five unrelated numbers. */
export function countBuckets<T extends BucketInput>(rows: T[]): Record<BucketId, number> {
  const out: Record<BucketId, number> = {
    active: 0, scoping: 0, completed: 0, hold: 0, closed: 0,
  }
  for (const r of rows) out[bucketOf(r)]++
  return out
}
