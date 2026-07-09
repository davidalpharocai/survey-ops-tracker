import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import { credits as creditsFmt, dollars, isoDate } from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import type { RenewalBucket, RenewalRow } from '../../../lib/types';
import InfoTooltip from '../../_components/InfoTooltip';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Renewal Radar · AlphaROC' };

const SECTIONS: { bucket: RenewalBucket; title: string }[] = [
  { bucket: '30', title: 'Next 30 days' },
  { bucket: '60', title: '31–60 days' },
  { bucket: '90', title: '61–90 days' },
  { bucket: 'later', title: 'Later' },
];

function RenewalTable({ rows }: { rows: RenewalRow[] }) {
  if (rows.length === 0) return <p className="muted">None</p>;
  return (
    <table className="report">
      <thead>
        <tr>
          <th>Client</th>
          <th>Contract</th>
          <th>Renewal date<InfoTooltip text={TIP.renewalDate} /></th>
          <th className="num">Days<InfoTooltip text={TIP.daysUntilRenewal} /></th>
          <th className="num">Contract credits<InfoTooltip text={TIP.contractCredits} /></th>
          <th className="num">Contract dollars<InfoTooltip text={TIP.contractDollars} /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.contractId}>
            <td><Link href={`/clients?id=${r.client.id}`}>{r.client.name}</Link></td>
            <td>{r.contractName}</td>
            <td>{isoDate(r.renewalOn)}</td>
            <td className="num">{r.daysUntil}</td>
            <td className="num">{creditsFmt(r.creditsAmount)}</td>
            <td className="num">{dollars(r.dollarsAmount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function RenewalsPage() {
  const api = await apiForRequest();
  const rows = await api.listRenewals();

  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Renewal Radar</h1>
      <p className="muted">Every upcoming contract renewal across active clients, soonest first, grouped by how close it is. Renewals already past are not shown.</p>

      {SECTIONS.map(s => (
        <section key={s.bucket}>
          <h2>{s.title}</h2>
          <RenewalTable rows={rows.filter(r => r.bucket === s.bucket)} />
        </section>
      ))}
    </>
  );
}
