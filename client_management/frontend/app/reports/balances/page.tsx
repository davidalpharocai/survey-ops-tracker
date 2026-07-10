import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import BalancesTable from './BalancesTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Balance summary · AlphaROC' };

export default async function BalancesPage() {
  const api = await apiForRequest();
  const rows = await api.allBalances();
  const currentYear = new Date().getUTCFullYear();

  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Credits and dollars remaining by client</h1>
      <p className="muted">Live balances across every client. {currentYear} contract value sums the credits and dollars from contracts dated this year; next renewal is the earliest upcoming renewal date across all of a client&apos;s contracts.</p>

      {rows.length > 0 ? (
        <div className="table-scroll">
          <BalancesTable rows={rows} currentYear={currentYear} />
        </div>
      ) : (
        <p>No clients yet. <Link href="/clients">Add the first one →</Link></p>
      )}
    </>
  );
}
