import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
import { todayIsoDate } from '../../../lib/dates';
import { isoDate } from '../../../lib/format';
import ConfirmButton from '../../clients/ConfirmButton';
import AutoSubmitSelect from '../../_components/AutoSubmitSelect';
import RenewalAutofill from './RenewalAutofill';
import {
  createContractAction,
  deleteContractAction,
  updateContractAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add Contract · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string }>;
}

export default async function NewContractPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const preselect = parseId(sp?.client_id);

  const api = await apiForRequest();
  const clients = await api.listClients();

  let selectedClient = null;
  let existingContracts: Awaited<ReturnType<typeof api.listContractsByClient>> = [];
  if (preselect) {
    selectedClient = clients.find(c => c.id === preselect) || null;
    if (selectedClient) {
      existingContracts = await api.listContractsByClient(preselect);
    }
  }

  const today = todayIsoDate();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Add Contract</h1>
      <p className="muted">Contracts top up a client&apos;s available credits and/or dollars.</p>

      {clients.length === 0 ? (
        <p className="warn">No clients yet. <Link href="/clients">Create one first →</Link></p>
      ) : (
        <>
          <form method="get" action="" className="filterbar">
            <label>Client
              <AutoSubmitSelect name="client_id" defaultValue={preselect || ''}>
                <option value="">— pick a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </AutoSubmitSelect>
            </label>
          </form>

          {selectedClient && (
            <>
              <h2>
                Existing contracts for {selectedClient.name}{' '}
                <span className="muted small">({existingContracts.length})</span>
              </h2>

              {existingContracts.length === 0 ? (
                <p className="muted">No contracts recorded yet for this client.</p>
              ) : (
                <table className="report compact contracts-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Title</th>
                      <th className="num">Credits</th>
                      <th className="num">Dollars</th>
                      <th>Renewal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {existingContracts.map(t => {
                      const fid = `contract-form-${t.id}`;
                      return (
                        <tr key={t.id}>
                          <td>
                            <form id={fid} action={updateContractAction}>
                              <input type="hidden" name="id" value={t.id} />
                              <input name="occurred_on" type="date" defaultValue={isoDate(t.occurredOn)} required />
                            </form>
                          </td>
                          <td>
                            <input form={fid} name="name" type="text" defaultValue={t.name} required />
                          </td>
                          <td className="num">
                            <input form={fid} name="credits_amount" type="number" step="0.01" min="0" defaultValue={String(t.creditsAmount)} />
                          </td>
                          <td className="num">
                            <input form={fid} name="dollars_amount" type="number" step="0.01" min="0" defaultValue={String(t.dollarsAmount)} />
                          </td>
                          <td>
                            <input form={fid} name="renewal_on" type="date" defaultValue={t.renewalOn ? isoDate(t.renewalOn) : ''} required />
                          </td>
                          <td className="row-actions">
                            <button type="submit" form={fid} className="btn-sm">Save</button>
                            <form action={deleteContractAction} className="inline-form">
                              <input type="hidden" name="id" value={t.id} />
                              <ConfirmButton type="submit" className="btn-sm btn-danger" message={`Delete contract '${t.name}'?`}>
                                Delete
                              </ConfirmButton>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          <h2>Record a new contract</h2>

          <form action={createContractAction} className="card form-narrow">
            <input type="hidden" name="client_id" value={selectedClient ? selectedClient.id : ''} />

            {!selectedClient && (
              <p className="muted small">Pick a client above to enable this form.</p>
            )}

            <label>Contract title
              <input name="name" type="text" required placeholder="e.g. Q4 2025 Initial Contract" disabled={!selectedClient} />
            </label>

            <div className="amounts-row">
              <label>Contract date
                <input name="occurred_on" id="occurred-on" type="date" defaultValue={today} required disabled={!selectedClient} />
              </label>
              <label>Renewal date
                <input name="renewal_on" id="renewal-on" type="date" required disabled={!selectedClient} />
                <span className="muted small">Defaults to one year after the contract date.</span>
              </label>
            </div>

            <div className="amounts-row">
              <label>Credits to add
                <input name="credits_amount" type="number" step="0.01" min="0" placeholder="0" disabled={!selectedClient} />
              </label>
              <label>Dollars to add
                <input name="dollars_amount" type="number" step="0.01" min="0" placeholder="0" disabled={!selectedClient} />
              </label>
            </div>
            <p className="muted small">Enter at least one of credits or dollars. Both are optional individually.</p>

            <div className="actions">
              <button type="submit" disabled={!selectedClient}>Record contract</button>
            </div>
          </form>

          {selectedClient && <RenewalAutofill />}
        </>
      )}
    </>
  );
}
