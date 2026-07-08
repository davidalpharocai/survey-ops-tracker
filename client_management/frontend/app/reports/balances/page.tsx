import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import { contractValue, credits as creditsFmt, dollars, isoDate } from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import InfoTooltip from '../../_components/InfoTooltip';

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
        <table className="report">
          <thead>
            <tr>
              <th>Client</th>
              <th>Relationship manager</th>
              <th>Client since</th>
              <th className="num">Credits remaining<InfoTooltip text={TIP.creditsRemaining} /></th>
              <th className="num">Dollars remaining<InfoTooltip text={TIP.dollarsRemaining} /></th>
              <th className="num">{currentYear} contract value<InfoTooltip text={TIP.cyValue} /></th>
              <th>Next renewal<InfoTooltip text={TIP.cyRenewal} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client.id}>
                <td><Link href={`/clients?id=${r.client.id}`}>{r.client.name}</Link></td>
                <td>{r.client.relationshipManager || '—'}</td>
                <td>{isoDate(r.client.becameClientOn)}</td>
                <td className={`num${r.credits < 0 ? ' neg' : ''}`}>{creditsFmt(r.credits)}</td>
                <td className={`num${r.dollars < 0 ? ' neg' : ''}`}>{dollars(r.dollars)}</td>
                <td className="num">{contractValue(r.cyCredits, r.cyValue)}</td>
                <td>{r.cyRenewal ? isoDate(r.cyRenewal) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No clients yet. <Link href="/clients">Add the first one →</Link></p>
      )}
    </>
  );
}
