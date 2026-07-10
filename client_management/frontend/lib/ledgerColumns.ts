// Pure helpers for the reorderable data columns on the Contracts & Surveys
// ledger. The name column (col 0) and the actions column (last) are pinned
// and never part of this order — only the middle data columns move.
//
// Kept framework-free so the ordering rules are unit-testable without React.

export const DATA_COLUMN_IDS = [
  'forUser',
  'credits',
  'dollars',
  'renewal',
  'remaining',
] as const;

export type DataColumnId = (typeof DATA_COLUMN_IDS)[number];

const KNOWN = new Set<string>(DATA_COLUMN_IDS);

// Turn whatever was in localStorage into a valid, complete ordering:
//  - drop unknown ids (schema changed / tampering),
//  - drop duplicates (keep first occurrence),
//  - append any known ids the saved value was missing, in default order.
// Always returns exactly the known ids, once each, in a usable order.
export function normalizeColumnOrder(saved: unknown): DataColumnId[] {
  const out: DataColumnId[] = [];
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (typeof item === 'string' && KNOWN.has(item) && !out.includes(item as DataColumnId)) {
        out.push(item as DataColumnId);
      }
    }
  }
  for (const id of DATA_COLUMN_IDS) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Move `fromId` so it sits immediately before `toId`. Returns a new array;
// never mutates the input. No-op (returns a copy) when the move is
// meaningless (same column, or either id absent).
export function moveColumn(
  order: DataColumnId[],
  fromId: DataColumnId,
  toId: DataColumnId,
): DataColumnId[] {
  if (fromId === toId) return order.slice();
  if (!order.includes(fromId) || !order.includes(toId)) return order.slice();
  const next = order.filter((id) => id !== fromId);
  const idx = next.indexOf(toId);
  next.splice(idx, 0, fromId);
  return next;
}
