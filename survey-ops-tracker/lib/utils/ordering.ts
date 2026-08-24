// Fractional ordering for board cards (the Trello/Linear approach):
// a dropped card gets a sort_order between its new neighbors, so the
// position is persisted and survives refetches and realtime updates.

const GAP = 1000

type Orderable = {
  sort_order?: number | null
  created_at?: string
}

/** Render order within a column: sort_order asc; unset (new) cards first, newest first. */
export function boardOrder(a: Orderable, b: Orderable): number {
  const sa = a.sort_order ?? Number.NEGATIVE_INFINITY
  const sb = b.sort_order ?? Number.NEGATIVE_INFINITY
  if (sa !== sb) return sa - sb
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}

/** A sort_order value that lands between two neighbors (either may be absent). */
export function sortOrderBetween(
  prev: number | null | undefined,
  next: number | null | undefined
): number {
  const hasPrev = prev != null && Number.isFinite(prev)
  const hasNext = next != null && Number.isFinite(next)
  if (hasPrev && hasNext) return (prev! + next!) / 2
  if (hasPrev) return prev! + GAP
  if (hasNext) return next! - GAP
  return GAP
}

/**
 * The sort_order for a card dropped at `index` of a column.
 *
 * `index` is a position in the list the column RENDERED — that's the only thing
 * @hello-pangea/dnd knows about — so the neighbors the user aimed between come
 * out of `rendered` (filters applied, dragged card removed, in render order).
 * Reading them out of some other, longer list instead lands the card somewhere
 * the user didn't drop it the moment any filter is on.
 *
 * The value written, though, has to make sense in MANUAL order for everyone,
 * hidden cards and other browsers included: sort_order is a global column and
 * the sort mode is per-browser. So the aimed-at neighbor is mapped back into
 * `manual` (the same column, unfiltered, in hand-arranged order) by id and the
 * card takes a position beside it there. Filtered-out cards keep their relative
 * order, and the value never lands between a prev/next pair that isn't actually
 * adjacent — which is what drove sort_order values into collisions.
 */
export function dropSortOrder<T extends Orderable & { id: string }>(
  rendered: T[],
  manual: T[],
  index: number
): number {
  const prev = rendered[index - 1]
  const next = rendered[index]
  if (!prev && !next) return sortOrderBetween(null, null)
  if (prev) {
    const at = manual.findIndex(c => c.id === prev.id)
    // Right after `prev` in manual order — which may be a card the filter hides.
    const after = at >= 0 ? manual[at + 1] : next
    return sortOrderBetween(prev.sort_order, after?.sort_order)
  }
  const at = manual.findIndex(c => c.id === next!.id)
  return sortOrderBetween(at > 0 ? manual[at - 1]?.sort_order : null, next!.sort_order)
}

// ---------------------------------------------------------------------------
// The board's sort mode
//
// Drag-to-reorder writes sort_order (see sortOrderBetween above), so a forced
// date sort would silently override columns the team has hand-arranged. The
// date sort is therefore a MODE the user can switch off, not a replacement:
//   'due'    — soonest delivery at the top (the default for a fresh board)
//   'manual' — the hand-arranged order only, exactly as it always behaved
// ---------------------------------------------------------------------------

export type BoardSortMode = 'manual' | 'due'

/**
 * Which board a card is being sorted in. Each lane sorts slightly differently
 * and each one has a drop handler that has to compute sort_order against the
 * SAME order it renders in — a render order that disagrees with the drop math
 * lands the card somewhere the user didn't drop it. Hence one factory.
 */
export type BoardLane = 'pipeline' | 'scoping' | 'delivered'

type BoardCard = Orderable & {
  // The dates the 'due' mode sorts on.
  deliver_date?: string | null
  due_date?: string | null
  // Only present on rows fetched with it — the board's slim fetch doesn't
  // include it, so delivered cards fall back to deliver_date.
  delivered_at?: string | null
  // What columnSortRank reads.
  status?: string | null
  priority?: string | null
}

// Column order: urgent first, then high, then normal — Hold always sinks to the bottom
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1 }

export function columnSortRank(p: { status?: string | null; priority?: string | null }): number {
  if (p.status === 'Hold') return 100
  return PRIORITY_RANK[p.priority ?? ''] ?? 2
}

/**
 * The date the board sorts on: the client-facing delivery date, falling back to
 * the internal due date. The two are the same 99% of the time, and a live
 * project that only has a due date would otherwise sink to the bottom as if it
 * had no deadline at all.
 */
export function boardSortDate(c: BoardCard): string | null {
  return c.deliver_date || c.due_date || null
}

/**
 * A card nobody has positioned yet: no deadline of any kind AND never dragged.
 * That's exactly what the New Project form creates (it asks for a client and a
 * type, not for dates), so a fresh inquiry has to be excluded from the "no
 * deadline ⇒ sorts last" rule below or every new project is born buried at the
 * bottom of the longest column — the opposite of the manual-order rule, where
 * an unset sort_order deliberately floats a new card to the TOP.
 */
function isUnarranged(c: BoardCard): boolean {
  return c.sort_order == null && !boardSortDate(c)
}

/** Soonest first; a card with neither date has no deadline, so it sorts last. */
function bySoonest(a: BoardCard, b: BoardCard): number {
  const da = boardSortDate(a)
  const db = boardSortDate(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da.localeCompare(db)
}

/** Most recently delivered first; a card with no date sorts last. */
function byMostRecentlyDelivered(a: BoardCard, b: BoardCard): number {
  const da = a.delivered_at || boardSortDate(a)
  const db = b.delivered_at || boardSortDate(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  // delivered_at is a timestamp and deliver_date a plain date — compare the day
  // first so a mix of the two doesn't rank a timestamp behind the same day's date.
  const day = db.slice(0, 10).localeCompare(da.slice(0, 10))
  return day !== 0 ? day : db.localeCompare(da)
}

/**
 * THE board comparator. Every board surface — every render sort AND every drop
 * handler's position math — must sort through this, or the two drift apart and
 * a drop corrupts sort_order.
 *
 * `mode` is ignored for the 'delivered' lane: delivered cards can't be dragged,
 * so there is no hand-arranged order to protect there.
 */
export function cardOrder<T extends BoardCard>(
  lane: BoardLane,
  mode: BoardSortMode
): (a: T, b: T) => number {
  return (a, b) => {
    // Only the pipeline lanes rank by priority. Scoping renders flat (it always
    // has), and priority means nothing once the work is out the door.
    if (lane === 'pipeline') {
      const rank = columnSortRank(a) - columnSortRank(b)
      if (rank !== 0) return rank
    }
    if (lane === 'delivered') {
      // "Soonest due" is meaningless for finished work — show the freshest
      // deliveries at the top instead.
      const recency = byMostRecentlyDelivered(a, b)
      if (recency !== 0) return recency
    } else if (mode === 'due') {
      // A card nobody has dated or dragged yet floats to the top instead of
      // sinking (see isUnarranged): 'due' is the default mode, so otherwise
      // every brand-new inquiry lands at the bottom of the longest column and
      // takes its "new for me" highlight down there with it.
      if (isUnarranged(a) !== isUnarranged(b)) return isUnarranged(a) ? -1 : 1
      const soonest = bySoonest(a, b)
      if (soonest !== 0) return soonest
    }
    // Same date (or manual mode): the hand-arranged order decides.
    return boardOrder(a, b)
  }
}
