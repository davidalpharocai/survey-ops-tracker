import { apiForRequest } from '../../lib/action';
import type { BalanceHealthRow, BalanceRow, RenewalRow } from '../../lib/types';
import ClientPulseView from './ClientPulseView';

/**
 * Home "Client Pulse" dashboard. Reuses the three existing report endpoints
 * (balances, renewals, balance-health) and hands them to the client view,
 * which filters to "my clients" vs "all" and renders the KPI strip + tables.
 *
 * Self-contained so it can later move to a /dashboard route. Report errors
 * degrade to an empty dashboard (the rest of the homepage still renders)
 * rather than failing the whole page.
 */
export default async function ClientPulse({ email }: { email: string }) {
  const api = await apiForRequest();
  const [balances, renewals, health] = await Promise.all([
    api.allBalances().catch(() => [] as BalanceRow[]),
    api.listRenewals().catch(() => [] as RenewalRow[]),
    api.balanceHealth().catch(() => [] as BalanceHealthRow[]),
  ]);

  // Nothing to show on a fresh/empty database — skip the section entirely.
  if (balances.length === 0 && renewals.length === 0 && health.length === 0) {
    return null;
  }

  return (
    <ClientPulseView
      email={email}
      balances={balances}
      renewals={renewals}
      health={health}
    />
  );
}
