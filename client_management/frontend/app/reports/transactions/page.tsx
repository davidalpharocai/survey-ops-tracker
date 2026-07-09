import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
import { onlyNotFound } from '../../../lib/api';
import {
  contractValue,
  credits as creditsFmt,
  creditsSigned,
  dollars,
  dollarsSigned,
  fmtDateTime,
  isoDate,
} from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import type { Balance, Transaction } from '../../../lib/types';
import AutoSubmitSelect from '../../_components/AutoSubmitSelect';
import InfoTooltip from '../../_components/InfoTooltip';
import SubmitButton from '../../_components/SubmitButton';
import { createAdjustmentAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Per-client transactions · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string }>;
}

export default async function TransactionsReportPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const clientId = parseId(sp?.client_id);

  const api = await apiForRequest();
  const defaultBal: Balance = { credits: 0, dollars: 0, cyCredits: 0, cyValue: 0, cyRenewal: null };
  // One parallel wave instead of two sequential ones: the per-client reads
  // depend only on clientId (an int from the URL), not on the resolved
  // `selected` object, so there is no reason to wait for getClient first.
  // Transient errors are NOT swallowed — only a 404 (archived/stale id)
  // degrades to the empty state; a 5xx surfaces rather than showing a fake
  // $0 balance for a real client.
  const [clients, selected, txResult, balResult] = await Promise.all([
    api.listClients(),
    clientId ? api.getClient(clientId) : Promise.resolve(null),
    clientId
      ? api.listTransactionsByClient(clientId).catch(onlyNotFound([] as Transaction[]))
      : Promise.resolve([] as Transaction[]),
    clientId
      ? api.clientBalances(clientId).catch(onlyNotFound(defaultBal))
      : Promise.resolve(defaultBal),
  ]);
  const transactions: Transaction[] = selected ? txResult : [];
  const bal: Balance = selected ? balResult : defaultBal;

  const currentYear = new Date().getUTCFullYear();

  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Per-client transaction log</h1>

      <form method="get" className="filterbar">
        <label>Client
          <AutoSubmitSelect name="client_id" defaultValue={selected ? selected.id : ''}>
            <option value="">— pick a client —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </AutoSubmitSelect>
        </label>
        {selected && (
          // Plain <a> (not <Link>): this is a file download served by a
          // route handler, so it must be a full navigation — and plain
          // anchors don't get basePath prepended automatically.
          <a
            className="btn btn-sm"
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/reports/transactions/pdf?client_id=${selected.id}`}
            download
          >
            Download PDF
          </a>
        )}
      </form>

      {selected ? (
        <>
          <div className="detail-balances">
            <div className="bal">
              <span className="bal-label">Credits <InfoTooltip text={TIP.creditsRemaining} /></span>
              <span className={`bal-value${bal.credits < 0 ? ' neg' : ''}`}>{creditsFmt(bal.credits)}</span>
            </div>
            <div className="bal">
              <span className="bal-label">Dollars <InfoTooltip text={TIP.dollarsRemaining} /></span>
              <span className={`bal-value${bal.dollars < 0 ? ' neg' : ''}`}>{dollars(bal.dollars)}</span>
            </div>
            <div className="bal">
              <span className="bal-label">{currentYear} contract value <InfoTooltip text={TIP.cyValue} /></span>
              <span className="bal-value">{contractValue(bal.cyCredits, bal.cyValue)}</span>
            </div>
            <div className="bal">
              <span className="bal-label">Next renewal <InfoTooltip text={TIP.cyRenewal} /></span>
              <span className="bal-value">{bal.cyRenewal ? isoDate(bal.cyRenewal) : '—'}</span>
            </div>
          </div>

          {transactions.length > 0 ? (
            <table className="report">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>For user</th>
                  <th className="num">Credits Δ <InfoTooltip text={TIP.creditsDelta} /></th>
                  <th className="num">Dollars Δ <InfoTooltip text={TIP.dollarsDelta} /></th>
                  <th>Renewal</th>
                  <th>Recorded by</th>
                  <th>At</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => {
                  const cd = Number(t.creditsDelta);
                  const dd = Number(t.dollarsDelta);
                  return (
                    <tr key={t.id}>
                      <td>{isoDate(t.occurredOn)}</td>
                      <td><span className={`tag tag-${t.kind}`}>{t.kind}</span></td>
                      <td>{t.name}</td>
                      <td>{t.clientUser ? t.clientUser.name : ''}</td>
                      <td className={`num${cd < 0 ? ' neg' : cd > 0 ? ' pos' : ''}`}>{creditsSigned(t.creditsDelta)}</td>
                      <td className={`num${dd < 0 ? ' neg' : dd > 0 ? ' pos' : ''}`}>{dollarsSigned(t.dollarsDelta)}</td>
                      <td>{t.renewalOn ? isoDate(t.renewalOn) : ''}</td>
                      <td>{t.actorEmail}</td>
                      <td className="muted">{fmtDateTime(t.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">No transactions yet for this client.</p>
          )}

          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Add adjustment</h2>
            <p className="muted small">
              Corrections are recorded as new ledger rows — history is never
              edited. Signed amounts: negative subtracts, positive adds.
            </p>
            <form action={createAdjustmentAction} className="add-row-form">
              <input type="hidden" name="client_id" value={selected.id} />
              <label>Credits Δ
                <input name="credits_delta" placeholder="e.g. -100" />
              </label>
              <label>Dollars Δ
                <input name="dollars_delta" placeholder="e.g. 250" />
              </label>
              <label>Note
                <input
                  name="note"
                  required
                  placeholder="Why this correction is needed"
                />
              </label>
              <SubmitButton className="btn" pendingLabel="Recording…">Record adjustment</SubmitButton>
            </form>
          </section>
        </>
      ) : (
        <p className="muted">Pick a client above to see their transaction log.</p>
      )}
    </>
  );
}
