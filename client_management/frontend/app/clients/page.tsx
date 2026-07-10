import Link from 'next/link';

import { apiForRequest, parseId } from '../../lib/action';
import { onlyNotFound } from '../../lib/api';
import { todayIsoDate } from '../../lib/dates';
import { contractValue, credits as creditsFmt, dollars, isoDate } from '../../lib/format';
import { TIP } from '../../lib/tooltips';
import type { Balance, ClientUser, Salesperson } from '../../lib/types';
import InfoTooltip from '../_components/InfoTooltip';
import ConfirmButton from './ConfirmButton';
import NewClientDialog from './NewClientDialog';
import SalespersonPicker from './SalespersonPicker';
import {
  createClientUserAction,
  deleteClientAction,
  deleteClientUserAction,
  updateClientAction,
  updateClientUserAction,
} from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Manage Client List · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ClientsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const selectedId = parseId(sp?.id);
  const api = await apiForRequest();
  const defaultBal: Balance = { credits: 0, dollars: 0, cyCredits: 0, cyValue: 0, cyRenewal: null };
  // getClient is 404-tolerant (orNull). The per-client reads now 404 for
  // an archived/nonexistent client too, so tolerate ONLY that here — a
  // stale ?id= URL falls back to the empty state, but a transient backend
  // error still surfaces rather than rendering a fake $0 balance for a
  // real client.
  const [clients, salespeople, selected, selectedUsers, bal] = await Promise.all([
    api.listClients(),
    api.listSalespeople(),
    selectedId ? api.getClient(selectedId) : Promise.resolve(null),
    selectedId
      ? api.listClientUsers(selectedId).catch(onlyNotFound([] as ClientUser[]))
      : Promise.resolve([] as ClientUser[]),
    selectedId
      ? api.clientBalances(selectedId).catch(onlyNotFound(defaultBal))
      : Promise.resolve(defaultBal),
  ]);

  const currentYear = new Date().getUTCFullYear();
  const today = todayIsoDate();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Manage Client List</h1>
      <p className="muted">Pick a client on the left to see and edit their full record. Use the <em>+ New client</em> button to add one.</p>

      <div className="two-pane">
        <aside className="pane-list">
          <div className="pane-list-header">
            <strong>Clients</strong>
            <NewClientDialog today={today} salespeople={salespeople} />
          </div>
          <ul className="client-list">
            {clients.length === 0 ? (
              <li className="empty muted">No clients yet — click + New.</li>
            ) : (
              clients.map(c => (
                <li key={c.id} className={selected && c.id === selected.id ? 'is-selected' : ''}>
                  <Link href={`/clients?id=${c.id}`}>
                    <span className="cl-name">{c.name}</span>
                    {(c.salespersonName || c.relationshipManager) && (
                      <span className="cl-meta">Sales · {c.salespersonName || c.relationshipManager}</span>
                    )}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="pane-detail">
          {selected ? (
            <>
              <div className="detail-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    Client since {isoDate(selected.becameClientOn)}
                    {selected.soccCode ? ` · ${selected.soccCode}` : ''}
                  </p>
                </div>
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
                <p className="detail-quicklinks">
                  <Link href={`/reports/transactions?client_id=${selected.id}`}>Contracts &amp; Surveys →</Link>
                  <Link href={`/contracts/new?client_id=${selected.id}`}>+ Add contract</Link>
                  <Link href={`/studies/new?client_id=${selected.id}`}>+ Add study</Link>
                  <a href="#delete-client" className="quicklink-danger">Delete client…</a>
                </p>
              </div>

              <form action={updateClientAction} className="card">
                <input type="hidden" name="id" value={selected.id} />
                <h3>Client details</h3>
                <div className="form-grid">
                  <label>Client name <input name="name" type="text" defaultValue={selected.name} required /></label>
                  <label>Client since <InfoTooltip text={TIP.becameOn} /><input name="became_on" type="date" defaultValue={isoDate(selected.becameClientOn)} required /></label>
                  <label>Primary contact name <InfoTooltip text={TIP.primaryContact} /><input name="primary_contact_name" type="text" defaultValue={selected.primaryContactName || ''} /></label>
                  <label>Primary contact cell <input name="primary_contact_cell" type="tel" defaultValue={selected.primaryContactCell || ''} /></label>
                  <label>Primary contact email <input name="primary_contact_email" type="email" defaultValue={selected.primaryContactEmail || ''} /></label>
                </div>
                <SalespersonPicker salespeople={salespeople} defaultId={selected.salespersonId ?? null} />
                <div className="actions">
                  <button type="submit">Save changes</button>
                </div>
              </form>

              <div className="card">
                <h3>Contacts at {selected.name}</h3>
                <p className="muted">Contacts are people on the client side. Studies are attributed to one contact.</p>

                {selectedUsers.length > 0 ? (
                  <table className="report compact">
                    <thead><tr><th>Name</th><th>Email</th><th></th></tr></thead>
                    <tbody>
                      {selectedUsers.map(u => (
                        <UserRow key={u.id} user={u} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No contacts yet.</p>
                )}

                <form action={createClientUserAction} className="add-row-form">
                  <input type="hidden" name="client_id" value={selected.id} />
                  <strong>Add contact</strong>
                  <label>Name <InfoTooltip text={TIP.clientUser} /><input name="name" type="text" required /></label>
                  <label>Email (optional) <input name="email" type="email" /></label>
                  <button type="submit" className="btn-sm">+ Add</button>
                </form>
              </div>

              <details className="danger-zone" id="delete-client">
                <summary>Archive this client</summary>
                <form action={deleteClientAction}>
                  <input type="hidden" name="id" value={selected.id} />
                  <p className="muted">Hides <strong>{selected.name}</strong> from every list and picker. Their contracts, studies, and contacts are kept (never destroyed) and can be restored by an admin.</p>
                  <ConfirmButton
                    type="submit"
                    className="btn-danger"
                    message={`Archive ${selected.name}? They'll be hidden from all lists; their history is kept and can be restored.`}
                  >
                    Archive {selected.name}
                  </ConfirmButton>
                </form>
              </details>
            </>
          ) : (
            <div className="empty-pane muted">
              <p>Pick a client on the left, or add a new one with <strong>+ New</strong>.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function UserRow({ user }: { user: ClientUser }) {
  const formId = `user-form-${user.id}`;
  return (
    <tr>
      <td>
        <form id={formId} action={updateClientUserAction}>
          <input type="hidden" name="id" value={user.id} />
          <input name="name" type="text" defaultValue={user.name} required />
        </form>
      </td>
      <td>
        <input name="email" type="email" defaultValue={user.email || ''} form={formId} />
      </td>
      <td className="row-actions">
        <button type="submit" form={formId} className="btn-sm">Save</button>
        <form action={deleteClientUserAction} className="inline-form">
          <input type="hidden" name="id" value={user.id} />
          <ConfirmButton type="submit" className="btn-sm btn-danger" message={`Delete contact ${user.name}?`}>
            Delete
          </ConfirmButton>
        </form>
      </td>
    </tr>
  );
}
