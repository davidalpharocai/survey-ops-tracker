import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import { credits as creditsFmt, dollars, isoDate } from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import type { BalanceHealthStatus } from '../../../lib/types';
import InfoTooltip from '../../_components/InfoTooltip';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Balance Health · AlphaROC' };

const STATUS_TAG: Record<BalanceHealthStatus, string> = {
  negative: 'tag-error',
  low: 'tag-denied',
  ok: 'tag-success',
};

export default async function BalanceHealthPage() {
  const api = await apiForRequest();
  const rows = await api.balanceHealth();

  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Balance Health</h1>
      <p className="muted">One row per client with recorded activity. Monthly burn is the credits consumed by studies over the trailing 90 days divided by 3; the run-out date projects the current balance forward at that pace. Clients already negative are flagged first, then anyone projected to run out within 60 days.</p>

      {rows.length > 0 ? (
        <table className="report">
          <thead>
            <tr>
              <th>Client</th>
              <th className="num">Credits<InfoTooltip text={TIP.creditsRemaining} /></th>
              <th className="num">Dollars<InfoTooltip text={TIP.dollarsRemaining} /></th>
              <th className="num">Monthly credit burn<InfoTooltip text={TIP.monthlyBurn} /></th>
              <th>Projected credit run-out<InfoTooltip text={TIP.runOutDate} /></th>
              <th>Status<InfoTooltip text={TIP.healthStatus} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client.id}>
                <td><Link href={`/clients?id=${r.client.id}`}>{r.client.name}</Link></td>
                <td className={`num${r.credits < 0 ? ' neg' : ''}`}>{creditsFmt(r.credits)}</td>
                <td className={`num${r.dollars < 0 ? ' neg' : ''}`}>{dollars(r.dollars)}</td>
                <td className="num">{creditsFmt(r.monthlyCreditBurn)}</td>
                <td>{r.creditsRunOutOn ? isoDate(r.creditsRunOutOn) : '—'}</td>
                <td><span className={`tag ${STATUS_TAG[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No client activity yet — this report fills in once contracts and studies are recorded.</p>
      )}
    </>
  );
}
