import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import { credits as creditsFmt, dollars, isoDate } from '../../../lib/format';

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
      <p className="muted">Live balances across every client. {currentYear} contract value sums dollars from contracts dated this year; renewal date is the next contract from this year that&apos;s up for renewal.</p>

      {rows.length > 0 ? (
        <table className="report">
          <thead>
            <tr>
              <th>Client</th>
              <th>Relationship manager</th>
              <th>Client since</th>
              <th className="num">Credits remaining</th>
              <th className="num">Dollars remaining</th>
              <th className="num">{currentYear} contract value</th>
              <th>{currentYear} renewal</th>
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
                <td className="num">{dollars(r.cyValue)}</td>
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
