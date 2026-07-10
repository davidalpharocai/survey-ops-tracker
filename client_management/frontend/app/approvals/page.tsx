import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest } from '../../lib/action';
import { currentUserIsApprover } from '../../lib/auth';
import { credits as creditsFmt, dollars, isoDate } from '../../lib/format';
import type { CreditRequest } from '../../lib/types';
import ConfirmButton from '../clients/ConfirmButton';
import { approveCreditRequestAction, rejectCreditRequestAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals · AlphaROC' };

export default async function ApprovalsPage() {
  if (!(await currentUserIsApprover())) notFound();

  const api = await apiForRequest();
  const [pending, recent] = await Promise.all([
    api.listCreditRequests('pending').catch(() => [] as CreditRequest[]),
    api.listCreditRequests().catch(() => [] as CreditRequest[]),
  ]);
  const decided = recent.filter(r => r.status !== 'pending').slice(0, 15);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Credit approvals</h1>
      <p className="muted">
        Requests from the sales team to add credits or dollars to a client.
        Approving one records the adjustment on that client&apos;s balance.
      </p>

      <div className="card">
        <h3>Pending <span className="muted small">({pending.length})</span></h3>
        {pending.length === 0 ? (
          <p className="muted">Nothing waiting. All caught up.</p>
        ) : (
          <div className="table-scroll">
            <table className="report compact">
              <thead>
                <tr>
                  <th>Requested</th><th>Client</th><th>By</th>
                  <th className="num">Credits</th><th className="num">Dollars</th>
                  <th>Note</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(r => (
                  <tr key={r.id}>
                    <td className="muted small">{isoDate(r.createdAt)}</td>
                    <td>{r.client ? <Link href={`/reports/transactions?client_id=${r.client.id}`}>{r.client.name}</Link> : r.clientId}</td>
                    <td className="muted small">{r.requestedByEmail}</td>
                    <td className="num">{Number(r.creditsDelta) ? `${creditsFmt(r.creditsDelta)} cr` : '—'}</td>
                    <td className="num">{Number(r.dollarsDelta) ? dollars(r.dollarsDelta) : '—'}</td>
                    <td>{r.note}</td>
                    <td className="row-actions">
                      <form action={approveCreditRequestAction} className="inline-form">
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmButton type="submit" className="btn-sm" message={`Approve ${creditsFmt(r.creditsDelta)} cr / ${dollars(r.dollarsDelta)} for ${r.client?.name ?? 'this client'}? This adds it to their balance.`}>
                          Approve
                        </ConfirmButton>
                      </form>
                      <form action={rejectCreditRequestAction} className="inline-form">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="decision_note" type="text" className="decision-note-input" placeholder="Reason (shown to requester)" />
                        <ConfirmButton type="submit" className="btn-sm btn-danger" message="Reject this credit request?">
                          Reject
                        </ConfirmButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div className="card">
          <h3>Recently decided</h3>
          <div className="table-scroll">
            <table className="report compact">
              <thead>
                <tr><th>Client</th><th>By</th><th className="num">Credits</th><th className="num">Dollars</th><th>Status</th><th>Decided by</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {decided.map(r => (
                  <tr key={r.id}>
                    <td>{r.client ? r.client.name : r.clientId}</td>
                    <td className="muted small">{r.requestedByEmail}</td>
                    <td className="num">{Number(r.creditsDelta) ? `${creditsFmt(r.creditsDelta)} cr` : '—'}</td>
                    <td className="num">{Number(r.dollarsDelta) ? dollars(r.dollarsDelta) : '—'}</td>
                    <td><span className={`pulse-chip${r.status === 'approved' ? ' is-accent' : r.status === 'rejected' ? ' is-neg' : ''}`}>{r.status}</span></td>
                    <td className="muted small">{r.decidedByEmail || '—'}</td>
                    <td className="muted small">{r.decisionNote || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
