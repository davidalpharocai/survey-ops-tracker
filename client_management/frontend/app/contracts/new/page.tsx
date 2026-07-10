import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
import { onlyNotFound } from '../../../lib/api';
import { currentUserIsRestricted, currentUserReadOnly } from '../../../lib/auth';
import { todayIsoDate } from '../../../lib/dates';
import { isoDate } from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import ConfirmButton from '../../clients/ConfirmButton';
import AutoSubmitSelect from '../../_components/AutoSubmitSelect';
import InfoTooltip from '../../_components/InfoTooltip';
import SubmitButton from '../../_components/SubmitButton';
import RenewalAutofill from './RenewalAutofill';
import {
  createContractAction,
  deleteContractAction,
  updateContractAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a Contract · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string }>;
}

export default async function NewContractPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const preselect = parseId(sp?.client_id);

  const api = await apiForRequest();
  // One parallel wave: the per-client contracts read only needs `preselect`
  // (a URL int), so it need not wait for the client list. A stale preselect
  // 404s to an empty list; other errors still surface.
  type ContractRows = Awaited<ReturnType<typeof api.listContractsByClient>>;
  const [clients, fetchedContracts, readOnly, restricted] = await Promise.all([
    api.listClients(),
    preselect
      ? api.listContractsByClient(preselect).catch(onlyNotFound([] as ContractRows))
      : Promise.resolve([] as ContractRows),
    currentUserReadOnly(),
    currentUserIsRestricted(),
  ]);

  const selectedClient = preselect ? clients.find(c => c.id === preselect) || null : null;
  const existingContracts: ContractRows = selectedClient ? fetchedContracts : [];
  // Restricted reps can't create/edit contracts (they Request Credits instead);
  // impersonating admins are read-only. Either way, hide the edit controls.
  const noEdit = readOnly || restricted;

  const today = todayIsoDate();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Add a Contract</h1>
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
                      <th>Description</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {existingContracts.map(t => {
                      const fid = `contract-form-${t.id}`;
                      return (
                        <tr key={t.id} id={`c${t.id}`}>
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
                          <td>
                            <input form={fid} name="description" type="text" defaultValue={t.description || ''} placeholder="—" />
                          </td>
                          <td className="row-actions">
                            {!noEdit && (
                              <>
                                <button type="submit" form={fid} className="btn-sm">Save</button>
                                <form action={deleteContractAction} className="inline-form">
                                  <input type="hidden" name="id" value={t.id} />
                                  <ConfirmButton type="submit" className="btn-sm btn-danger" message={`Delete contract '${t.name}'?`}>
                                    Delete
                                  </ConfirmButton>
                                </form>
                              </>
                            )}
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

          {noEdit && (
            restricted && !readOnly ? (
              <p className="muted">
                Salespeople don&apos;t add contracts directly.{' '}
                <Link href="/credit-requests/new">Request credits</Link> and an approver
                will apply them to the client&apos;s balance.
              </p>
            ) : (
              <p className="muted">You&apos;re viewing as another user (read-only) — exit to add or edit contracts.</p>
            )
          )}

          {!noEdit && (
          <form action={createContractAction} className="card form-narrow">
            <input type="hidden" name="client_id" value={selectedClient ? selectedClient.id : ''} />

            {!selectedClient && (
              <p className="muted small">Pick a client above to enable this form.</p>
            )}

            <label>Contract title <InfoTooltip text={TIP.contract} />
              <input name="name" type="text" required placeholder="e.g. Q4 2025 Initial Contract" disabled={!selectedClient} />
            </label>

            <div className="amounts-row">
              <label>Contract date <InfoTooltip text={TIP.contractDate} />
                <input name="occurred_on" id="occurred-on" type="date" defaultValue={today} required disabled={!selectedClient} />
              </label>
              <label>Renewal date <InfoTooltip text={TIP.renewalDate} />
                <input name="renewal_on" id="renewal-on" type="date" required disabled={!selectedClient} />
                <span className="muted small">Defaults to one year after the contract date.</span>
              </label>
            </div>

            <div className="amounts-row">
              <label>Credits to add <InfoTooltip text={TIP.creditsToAdd} />
                <input name="credits_amount" type="number" step="0.01" min="0" placeholder="0" disabled={!selectedClient} />
              </label>
              <label>Dollars to add <InfoTooltip text={TIP.dollarsToAdd} />
                <input name="dollars_amount" type="number" step="0.01" min="0" placeholder="0" disabled={!selectedClient} />
              </label>
            </div>
            <p className="muted small">Enter at least one of credits or dollars. Both are optional individually.</p>

            <label>Description (optional)
              <InfoTooltip text="A short note about this contract — scope, terms, or anything worth remembering." />
              <textarea name="description" rows={2} placeholder="Short description of this contract" disabled={!selectedClient} />
            </label>

            <div className="actions">
              <SubmitButton disabled={!selectedClient} pendingLabel="Saving…">Save Contract</SubmitButton>
            </div>
          </form>
          )}

          {selectedClient && !noEdit && <RenewalAutofill />}
        </>
      )}
    </>
  );
}
