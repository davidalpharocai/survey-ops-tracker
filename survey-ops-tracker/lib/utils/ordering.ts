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
