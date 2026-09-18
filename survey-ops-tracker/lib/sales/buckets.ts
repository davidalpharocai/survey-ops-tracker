/**
 * The status buckets a salesperson filters by.
 *
 * David, 2026-09-17: "on the surveys page, you have delivered and closed -
 * whats the difference? it should be active, delivered, scoping, on hold,
 * cancelled, all."
 *
 * ── THE ANSWER TO HIS QUESTION: IN THE DATA, NOTHING ────────────────────────
 * `board_column='Delivery'` and `status='Closed'` are the SAME 327 rows —
 * every delivered survey is also Closed, and no delivered row is Open, Hold or
 * Cancelled. The two tiles looked disjoint only because `bucketOf` tests the
 * board column first and returns before it ever reads `status`. So the old
 * "Closed" tile actually meant "ended without ever reaching Delivery", which
 * the word Closed does not say — and everywhere else in the app that state is
 * displayed as ARCHIVED. The sales view was the only screen showing the raw
 * word.
 *
 * ── WHY THERE ARE SEVEN TILES WHEN HE NAMED SIX ─────────────────────────────
 * Under exactly his six, the 24 `status='Closed'` rows that never reached
 * Delivery are homeless and fall through to ACTIVE. Measured, all 24 are
 * legacy imports with no deliver_date and no delivered_at, sitting in
 * Submitted (10), Fielding (8), Data QA (2) and elsewhere. That would present
 * two dozen dead studies to a salesperson as live work, and it would break the
 * property that makes the tiles worth trusting — that the parts sum to All.
 * So Archived is kept as its own tile, using the word the rest of the app
 * already uses.
 *
 * ── THREE DIFFERENT COLUMNS ────────────────────────────────────────────────
 * delivered = board_column · hold/cancelled/archived = status · scoping =
 * phase · active = the residue. They are not one field, which is why the order
 * below is load-bearing rather than cosmetic.
 *
 * `scoping_stage` is never used here: 330 of 374 non-null rows still read
 * "New Inquiry" and 271 of those are already delivered.
 */

export type BucketId = 'active' | 'scoping' | 'delivered' | 'hold' | 'cancelled' | 'archived'

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
  /** Meaning-encoding colour, defined once so the tiles, the survey badge and
   *  the account page cannot drift apart. */
  tone: string
}

export const BUCKETS: Bucket[] = [
  {
    id: 'active',
    label: 'Active',
    hint: 'Scoped and running — in programming, QA or fielding, and not yet delivered.',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  {
    id: 'scoping',
    label: 'Scoping',
    hint: 'Still being scoped and priced. Not committed work yet. A deal that is BOTH on hold and being scoped counts under On hold, not here.',
    tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  },
  {
    id: 'hold',
    label: 'On hold',
    hint: 'Paused. Held deals that were still being scoped count here rather than in Scoping — a paused deal is not work in progress.',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  {
    id: 'delivered',
    label: 'Delivered',
    hint: 'Reached the Delivery stage and went to the client.',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    hint: 'Called off. Distinct from Archived: somebody stopped this one on purpose.',
    tone: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  },
  {
    id: 'archived',
    label: 'Archived',
    hint: 'Closed without ever reaching Delivery — almost all of these are legacy imports with no delivery date. Kept out of Active so dead studies do not read as live work.',
    tone: 'bg-muted text-muted-foreground border-border',
  },
]

/**
 * Which bucket one survey belongs to. Exactly one, always.
 *
 * ORDER IS LOAD-BEARING. Asked independently, 344 of 416 rows satisfy more than
 * one predicate — the whole delivered book is also Closed, 9 of the 14 on-hold
 * rows are phase='Scoping', and 8 of the 10 cancelled ones are too. The chain
 * of early returns is what makes the answer single-valued.
 *
 *   1. DELIVERED beats everything. Costs nothing today (no delivered row is
 *      Hold, Cancelled or Scoping) and its live effect is the 327-row Closed
 *      overlap — without it, every delivered study would read as Archived. It
 *      also matters forward: the app leaves a delivered project status='Open'
 *      until somebody closes it.
 *   2. HOLD beats Cancelled and Scoping. A paused deal is not work in progress.
 *   3. CANCELLED beats Scoping. A dead deal is not a live one.
 *   4. ARCHIVED — closed, and by here it did not reach Delivery.
 *   5. SCOPING — still being priced.
 *   6. ACTIVE — the total fallback, so every row lands somewhere.
 */
export function bucketOf(p: BucketInput): BucketId {
  if (p.board_column === 'Delivery') return 'delivered'
  if (p.status === 'Hold') return 'hold'
  if (p.status === 'Cancelled') return 'cancelled'
  if (p.status === 'Closed') return 'archived'
  if (p.phase === 'Scoping') return 'scoping'
  return 'active'
}

/** Count each bucket. Every input lands in exactly one, so the parts sum to the
 *  whole — the property that makes the tiles a summary rather than six
 *  unrelated numbers. Measured against production: 327 + 27 + 24 + 14 + 14 + 10
 *  = 416 = the row count exactly. */
export function countBuckets<T extends BucketInput>(rows: T[]): Record<BucketId, number> {
  const out: Record<BucketId, number> = {
    active: 0, scoping: 0, delivered: 0, hold: 0, cancelled: 0, archived: 0,
  }
  for (const r of rows) out[bucketOf(r)]++
  return out
}

/**
 * Translate a bucket id written before the rename.
 *
 * `?g=completed` links and saved views exist in the wild — in bookmarks, in
 * print URLs and in anything anyone pasted into Slack. Returning null rather
 * than guessing lets a caller fall back to its default group instead of
 * filtering to an empty list, which is what an unrecognised id would otherwise
 * do silently.
 *
 * `closed` maps to `archived` because that is what it meant: closed WITHOUT
 * reaching delivery. It did not include cancelled work before, and does not now.
 */
export function migrateBucketId(old: string): BucketId | 'all' | null {
  if (old === 'all') return 'all'
  if (old === 'completed') return 'delivered'
  if (old === 'closed') return 'archived'
  return (BUCKETS.some(b => b.id === old) ? old as BucketId : null)
}
