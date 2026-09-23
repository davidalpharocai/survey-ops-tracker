/**
 * The only surveys that can be "due", "overdue" or "open".
 *
 * Lifted out of lib/mcp/data.ts, which is server-only (it imports the admin
 * client at module scope), so the board and the list can share the ONE
 * definition instead of each carrying a copy that drifts. data.ts re-exports it,
 * and the connector keeps importing it from there.
 *
 * Excludes Closed and On-Hold (status), pre-sale Scoping (phase), and Delivered
 * — the final 'Delivery' board column, shown in the UI as "Delivered". A
 * delivered project can still carry status='Open' until someone closes it by
 * hand, so board_column must be checked and status alone is not enough.
 */
export function isActiveOperational(p: {
  status?: unknown; phase?: unknown; board_column?: unknown
}): boolean {
  return p.status === 'Open' && p.phase === 'Active' && p.board_column !== 'Delivery'
}
