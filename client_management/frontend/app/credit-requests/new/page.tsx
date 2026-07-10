import Link from 'next/link';

import { apiForRequest } from '../../../lib/action';
import { credits as creditsFmt, dollars, isoDate } from '../../../lib/format';
import type { Client, CreditRequest } from '../../../lib/types';
import ConfirmButton from '../../clients/ConfirmButton';
import SubmitButton from '../../_components/SubmitButton';
import { cancelMyCreditRequestAction, submitCreditRequestAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request credits · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ submitted?: string }>;
}

export default async function RequestCreditsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const api = await apiForRequest();
  const [clients, mine] = await Promise.all([
    api.listClients().catch(() => [] as Client[]),
    api.listCreditRequests().catch(() => [] as CreditRequest[]),
  ]);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Request credits</h1>
      <p className="muted">
        Ask an approver (Vineet, Shanu, or David) to add credits or dollars to a
        client. Once approved it lands on the client&apos;s balance automatically.
      </p>

      {sp?.submitted && (
        <p className="banner-ok">Request submitted — it&apos;s now in the approval queue.</p>
      )}

      <form action={submitCreditRequestAction} className="card form-narrow">
        <label>Client
          <select name="client_id" required defaultValue="">
            <option value="" disabled>— pick a client —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <div className="amounts-row">
          <label>Credits to add
            <input name="credits" type="number" step="0.01" min="0" placeholder="0" />
          </label>
          <label>Dollars to add
            <input name="dollars" type="number" step="0.01" min="0" placeholder="0" />
          </label>
        </div>
        <p className="muted small">Enter at least one of credits or dollars.</p>
        <label>Reason
          <input name="note" required placeholder="Why these credits are needed" />
        </label>
        <div className="actions">
          <SubmitButton className="btn" pendingLabel="Submitting…">Submit request</SubmitButton>
        </div>
      </form>

      <div className="card">
        <h3>Your requests</h3>
        {mine.length === 0 ? (
          <p className="muted">No requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="report compact">
              <thead>
                <tr><th>Date</th><th>Client</th><th className="num">Credits</th><th className="num">Dollars</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {mine.map(r => (
                  <tr key={r.id}>
                    <td className="muted small">{isoDate(r.createdAt)}</td>
                    <td>{r.client ? r.client.name : r.clientId}</td>
                    <td className="num">{Number(r.creditsDelta) ? `${creditsFmt(r.creditsDelta)} cr` : '—'}</td>
                    <td className="num">{Number(r.dollarsDelta) ? dollars(r.dollarsDelta) : '—'}</td>
                    <td><span className={`pulse-chip${r.status === 'approved' ? ' is-accent' : r.status === 'rejected' ? ' is-neg' : ''}`}>{r.status}</span></td>
                    <td className="row-actions">
                      {r.status === 'pending' && (
                        <form action={cancelMyCreditRequestAction} className="inline-form">
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmButton type="submit" className="btn-sm" message="Withdraw this request?">Cancel</ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
