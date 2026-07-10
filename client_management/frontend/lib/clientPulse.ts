// Pure helpers for the home "Client Pulse" dashboard: deciding which
// clients are "mine", filtering the report rows by that, and reducing the
// KPI counts. Framework-free so the rules are unit-testable.

import type { BalanceHealthRow, BalanceRow, Client, RenewalRow } from './types';

export type PulseMode = 'mine' | 'all';

/** Whether a client belongs to the signed-in user (by salesperson email). */
export function ownsClient(
  client: Pick<Client, 'salespersonEmail'>,
  email: string,
): boolean {
  const me = (email || '').trim().toLowerCase();
  const owner = (client.salespersonEmail || '').trim().toLowerCase();
  return me !== '' && owner !== '' && me === owner;
}

/** Whether the signed-in user owns at least one client in these rows. */
export function ownsAny(rows: { client: Client }[], email: string): boolean {
  return rows.some(r => ownsClient(r.client, email));
}

/**
 * Filter report rows for the dashboard. `all` passes everything through;
 * `mine` keeps only rows whose client's salesperson email matches the user.
 */
export function filterOwned<T extends { client: Client }>(
  rows: T[],
  email: string,
  mode: PulseMode,
): T[] {
  if (mode === 'all') return rows;
  return rows.filter(r => ownsClient(r.client, email));
}

export interface PulseKpis {
  /** Clients with a negative credit or dollar balance. */
  negative: number;
  /** Clients projected to run out within the balance-health window. */
  low: number;
  /** Contract renewals due within 30 days. */
  renewals30: number;
  /** Sum of current-year dollar contract value across the given clients. */
  cyValue: number;
}

/** Reduce the (already owner-filtered) report rows into the KPI strip. */
export function computeKpis(
  health: BalanceHealthRow[],
  renewals: RenewalRow[],
  balances: BalanceRow[],
): PulseKpis {
  return {
    negative: health.filter(h => h.status === 'negative').length,
    low: health.filter(h => h.status === 'low').length,
    renewals30: renewals.filter(r => r.daysUntil <= 30).length,
    cyValue: balances.reduce((sum, b) => sum + (Number(b.cyValue) || 0), 0),
  };
}
