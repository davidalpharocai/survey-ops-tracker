import Link from 'next/link';

import { apiForRequest, parseId } from '../../lib/action';
import { todayIsoDate } from '../../lib/dates';
import { credits as creditsFmt, dollars, isoDate } from '../../lib/format';
import type { Balance, ClientUser } from '../../lib/types';
import ConfirmButton from './ConfirmButton';
import NewClientDialog from './NewClientDialog';
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
  const defaultBal: Balance = { credits: 0, dollars: 0, cyValue: 0, cyRenewal: null };
  const [clients, selected, selectedUsers, bal] = await Promise.all([
    api.listClients(),
    selectedId ? api.getClient(selectedId) : Promise.resolve(null),
    selectedId ? api.listClientUsers(selectedId) : Promise.resolve([] as ClientUser[]),
    selectedId ? api.clientBalances(selectedId) : Promise.resolve(defaultBal),
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
            <NewClientDialog today={today} />
          </div>
          <ul className="client-list">
            {clients.length === 0 ? (
              <li className="empty muted">No clients yet — click + New.</li>
            ) : (
              clients.map(c => (
                <li key={c.id} className={selected && c.id === selected.id ? 'is-selected' : ''}>
                  <Link href={`/clients?id=${c.id}`}>
                    <span className="cl-name">{c.name}</span>
                    {c.relationshipManager && (
                      <span className="cl-meta">RM · {c.relationshipManager}</span>
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
                  <p className="muted">Client since {isoDate(selected.becameClientOn)}</p>
                </div>
                <div className="detail-balances">
                  <div className="bal">
                    <span className="bal-label">Credits</span>
                    <span className={`bal-value${bal.credits < 0 ? ' neg' : ''}`}>{creditsFmt(bal.credits)}</span>
                  </div>
                  <div className="bal">
                    <span className="bal-label">Dollars</span>
                    <span className={`bal-value${bal.dollars < 0 ? ' neg' : ''}`}>{dollars(bal.dollars)}</span>
                  </div>
                  <div className="bal">
                    <span className="bal-label">{currentYear} contract value</span>
                    <span className="bal-value">{dollars(bal.cyValue)}</span>
                  </div>
                  <div className="bal">
                    <span className="bal-label">{currentYear} renewal</span>
                    <span className="bal-value">{bal.cyRenewal ? isoDate(bal.cyRenewal) : '—'}</span>
                  </div>
                </div>
                <p className="detail-quicklinks">
                  <Link href={`/reports/transactions?client_id=${selected.id}`}>View transactions →</Link>
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
                  <label>Client since <input name="became_on" type="date" defaultValue={isoDate(selected.becameClientOn)} required /></label>
                  <label>Primary contact name <input name="primary_contact_name" type="text" defaultValue={selected.primaryContactName || ''} /></label>
                  <label>Primary contact cell <input name="primary_contact_cell" type="tel" defaultValue={selected.primaryContactCell || ''} /></label>
                  <label>Primary contact email <input name="primary_contact_email" type="email" defaultValue={selected.primaryContactEmail || ''} /></label>
                  <label>Relationship manager <input name="relationship_manager" type="text" defaultValue={selected.relationshipManager || ''} placeholder="AlphaROC team member" /></label>
                </div>
                <div className="actions">
                  <button type="submit">Save changes</button>
                </div>
              </form>

              <div className="card">
                <h3>Users at {selected.name}</h3>
                <p className="muted">Users are people on the client side. Studies are attributed to one user.</p>

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
                  <p className="muted">No users yet.</p>
                )}

                <form action={createClientUserAction} className="add-row-form">
                  <input type="hidden" name="client_id" value={selected.id} />
                  <strong>Add user</strong>
                  <label>Name <input name="name" type="text" required /></label>
                  <label>Email (optional) <input name="email" type="email" /></label>
                  <button type="submit" className="btn-sm">+ Add</button>
                </form>
              </div>

              <details className="danger-zone" id="delete-client">
                <summary>Delete this client (irreversible)</summary>
                <form action={deleteClientAction}>
                  <input type="hidden" name="id" value={selected.id} />
                  <p className="muted">Removes <strong>{selected.name}</strong> from the client list along with every user, contract, and study attached to them. This cannot be undone.</p>
                  <ConfirmButton
                    type="submit"
                    className="btn-danger"
                    message={`Delete ${selected.name} and all their contracts, studies, and users? This cannot be undone.`}
                  >
                    Delete {selected.name}
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
          <ConfirmButton type="submit" className="btn-sm btn-danger" message={`Delete user ${user.name}?`}>
            Delete
          </ConfirmButton>
        </form>
      </td>
    </tr>
  );
}
