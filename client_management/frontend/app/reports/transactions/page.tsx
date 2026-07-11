import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
import { onlyNotFound } from '../../../lib/api';
import { currentUserIsRestricted, currentUserReadOnly } from '../../../lib/auth';
import {
  contractValue,
  credits as creditsFmt,
  dollars,
  isoDate,
} from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import type { Balance, Family, Ledger } from '../../../lib/types';
import AutoSubmitSelect from '../../_components/AutoSubmitSelect';
import InfoTooltip from '../../_components/InfoTooltip';
import SubmitButton from '../../_components/SubmitButton';
import ExportCreditsSummary from './ExportCreditsSummary';
import LedgerTree from './LedgerTree';
import { createAdjustmentAction } from './actions';

const EMPTY_LEDGER: Ledger = { contracts: [], unassigned: [], adjustments: [], totals: { credits: 0, dollars: 0 } };

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contracts & Studies · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string; view?: string }>;
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
  // $0 balance for a real client. The family read is best-effort — a null
  // just hides the parent toggle rather than blocking the ledger.
  const [clients, selected, ledgerResult, balResult, family] = await Promise.all([
    api.listClients(),
    clientId ? api.getClient(clientId) : Promise.resolve(null),
    clientId
      ? api.clientLedger(clientId).catch(onlyNotFound(EMPTY_LEDGER))
      : Promise.resolve(EMPTY_LEDGER),
    clientId
      ? api.clientBalances(clientId).catch(onlyNotFound(defaultBal))
      : Promise.resolve(defaultBal),
    clientId
      ? api.clientFamily(clientId).catch(() => null as Family | null)
      : Promise.resolve(null as Family | null),
  ]);
  const ledger: Ledger = selected ? ledgerResult : EMPTY_LEDGER;
  const bal: Balance = selected ? balResult : defaultBal;
  // A parent (has sub-accounts) can flip the ledger between just this account
  // and the whole family. The rollup view sums balances only — it never
  // merges transactions, so the per-account ledger stays authoritative.
  const isParent = !!selected && (family?.children.length ?? 0) > 0;
  const familyView = isParent && sp?.view === 'family';
  const hasRows =
    ledger.contracts.length + ledger.unassigned.length + ledger.adjustments.length > 0;
  const exportContracts = ledger.contracts.map(c => ({ id: c.id, name: c.name }));
  const exportSurveys = [
    ...ledger.contracts.flatMap(c => c.studies),
    ...ledger.unassigned,
  ].map(s => ({ id: s.id, name: s.name }));

  const currentYear = new Date().getUTCFullYear();
  const [restricted, readOnly] = await Promise.all([
    currentUserIsRestricted(),
    currentUserReadOnly(),
  ]);

  return (
    <>
      <Link className="back" href="/reports">← Reports</Link>
      <h1>Contracts &amp; Studies</h1>

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
          <ExportCreditsSummary
            clientId={selected.id}
            contracts={exportContracts}
            surveys={exportSurveys}
          />
        )}
      </form>

      {selected ? (
        <>
          {isParent && (
            <div className="view-toggle" role="group" aria-label="Balance scope">
              <Link
                className={familyView ? '' : 'is-active'}
                href={`/reports/transactions?client_id=${selected.id}`}
              >
                This account
              </Link>
              <Link
                className={familyView ? 'is-active' : ''}
                href={`/reports/transactions?client_id=${selected.id}&view=family`}
              >
                Include sub-accounts
              </Link>
              <InfoTooltip text="This account shows only this client's ledger. Include sub-accounts rolls up balances across the whole family — it sums totals, it doesn't merge transactions." />
            </div>
          )}

          {familyView && family ? (
            <div className="detail-balances">
              <div className="bal">
                <span className="bal-label">Family credits <InfoTooltip text={TIP.creditsRemaining} /></span>
                <span className={`bal-value${family.rollup.credits < 0 ? ' neg' : ''}`}>{creditsFmt(family.rollup.credits)}</span>
              </div>
              <div className="bal">
                <span className="bal-label">Family dollars <InfoTooltip text={TIP.dollarsRemaining} /></span>
                <span className={`bal-value${family.rollup.dollars < 0 ? ' neg' : ''}`}>{dollars(family.rollup.dollars)}</span>
              </div>
              <div className="bal">
                <span className="bal-label">{currentYear} contract value <InfoTooltip text={TIP.cyValue} /></span>
                <span className="bal-value">{contractValue(family.rollup.cyCredits, family.rollup.cyValue)}</span>
              </div>
              <div className="bal">
                <span className="bal-label">Next renewal <InfoTooltip text={TIP.cyRenewal} /></span>
                <span className="bal-value">{family.rollup.nextRenewal ? isoDate(family.rollup.nextRenewal) : '—'}</span>
              </div>
            </div>
          ) : (
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
          )}

          {familyView && family ? (
            <div className="table-scroll">
              <table className="report compact">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Credits</th>
                    <th className="num">Dollars</th>
                    <th>Next renewal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>{selected.name}</strong> <span className="muted small">(this account)</span></td>
                    <td className={`num${bal.credits < 0 ? ' neg' : ''}`}>{creditsFmt(bal.credits)}</td>
                    <td className={`num${bal.dollars < 0 ? ' neg' : ''}`}>{dollars(bal.dollars)}</td>
                    <td>{bal.cyRenewal ? isoDate(bal.cyRenewal) : '—'}</td>
                  </tr>
                  {family.children.map(ch => (
                    <tr key={ch.id}>
                      <td><Link href={`/reports/transactions?client_id=${ch.id}`}>{ch.name}</Link></td>
                      <td className={`num${ch.credits < 0 ? ' neg' : ''}`}>{creditsFmt(ch.credits)}</td>
                      <td className={`num${ch.dollars < 0 ? ' neg' : ''}`}>{dollars(ch.dollars)}</td>
                      <td>{ch.cyRenewal ? isoDate(ch.cyRenewal) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="report-totals">
                    <td>Family total</td>
                    <td className={`num${family.rollup.credits < 0 ? ' neg' : ''}`}>{creditsFmt(family.rollup.credits)}</td>
                    <td className={`num${family.rollup.dollars < 0 ? ' neg' : ''}`}>{dollars(family.rollup.dollars)}</td>
                    <td>{family.rollup.nextRenewal ? isoDate(family.rollup.nextRenewal) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
              {family.partial && <p className="muted small">Showing only your clients in this family.</p>}
              <p className="muted small" style={{ marginTop: 8 }}>
                Open a sub-account to see its own contracts &amp; studies. Balances roll up here; transactions stay on each account.
              </p>
            </div>
          ) : hasRows ? (
            <LedgerTree ledger={ledger} clientId={selected.id} canEditMoney={!restricted && !readOnly} />
          ) : (
            <p className="muted">No contracts or studies yet for this client.</p>
          )}

          {familyView ? null : readOnly ? (
            <p className="muted" style={{ marginTop: 16 }}>
              You&apos;re viewing as another user (read-only) — exit to make changes.
            </p>
          ) : restricted ? (
            <p className="muted" style={{ marginTop: 16 }}>
              Need to add credits? <Link href="/credit-requests/new">Request credits</Link> — an approver will apply it to this client&apos;s balance.
            </p>
          ) : (
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
          )}
        </>
      ) : (
        <p className="muted">Pick a client above to see their contracts &amp; studies.</p>
      )}
    </>
  );
}
