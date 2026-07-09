// Pure helper for the per-client ledger search box. Kept out of the
// React component so it can be unit-tested in isolation.

import type { Ledger } from './types';

function rowMatches(
  row: { name: string; soccProjectCode?: string | null },
  q: string,
): boolean {
  return `${row.name} ${row.soccProjectCode || ''}`.toLowerCase().includes(q);
}

/**
 * Filter a ledger by a free-text query (case-insensitive, matches name or
 * PR##### code). A contract that matches keeps all its studies; otherwise
 * it is kept only if some of its studies match (and only those show).
 * Unassigned studies and adjustments are filtered to matches.
 */
export function filterLedger(ledger: Ledger, query: string): Ledger {
  const q = query.trim().toLowerCase();
  if (!q) return ledger;
  const contracts = ledger.contracts
    .map(c => {
      if (rowMatches(c, q)) return c;
      const studies = c.studies.filter(s => rowMatches(s, q));
      return studies.length ? { ...c, studies } : null;
    })
    .filter((c): c is Ledger['contracts'][number] => c !== null);
  return {
    ...ledger,
    contracts,
    unassigned: ledger.unassigned.filter(s => rowMatches(s, q)),
    adjustments: ledger.adjustments.filter(a => rowMatches(a, q)),
  };
}
