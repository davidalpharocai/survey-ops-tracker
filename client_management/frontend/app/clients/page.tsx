import Link from 'next/link';

import { apiForRequest, parseId } from '../../lib/action';
import { onlyNotFound } from '../../lib/api';
import { currentUserEmail, currentUserIsRestricted } from '../../lib/auth';
import { todayIsoDate } from '../../lib/dates';
import { contractValue, credits as creditsFmt, dollars, isoDate } from '../../lib/format';
import { TIP } from '../../lib/tooltips';
import type { Balance, ClientUser, Family, Salesperson } from '../../lib/types';
import InfoTooltip from '../_components/InfoTooltip';
import ConfirmButton from './ConfirmButton';
import ClientListRail from './ClientListRail';
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
  const [clients, salespeople, selected, selectedUsers, bal, family, restricted, myEmail] = await Promise.all([
    api.listClients(),
    api.listSalespeople(),
    selectedId ? api.getClient(selectedId) : Promise.resolve(null),
    selectedId
      ? api.listClientUsers(selectedId).catch(onlyNotFound([] as ClientUser[]))
      : Promise.resolve([] as ClientUser[]),
    selectedId
      ? api.clientBalances(selectedId).catch(onlyNotFound(defaultBal))
      : Promise.resolve(defaultBal),
    selectedId
      ? api.clientFamily(selectedId).catch(() => null as Family | null)
      : Promise.resolve(null as Family | null),
    currentUserIsRestricted(),
    currentUserEmail(),
  ]);

  const currentYear = new Date().getUTCFullYear();
  const today = todayIsoDate();
  // A client with sub-accounts is a parent (can't also be a child); a child
  // or standalone can be assigned a parent. Only admins/approvers set structure.
  const isParent = (family?.children.length ?? 0) > 0;
  const eligibleParents = selected
    ? clients.filter(c => c.parentId == null && c.id !== selected.id)
    : [];
  const showParentPicker = !!selected && !restricted && !isParent;

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
          <ClientListRail clients={clients} selectedId={selected?.id ?? null} myEmail={myEmail} />
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
                  {family?.parent && (
                    <p className="muted small">
                      Part of <Link href={`/clients?id=${family.parent.id}`}>{family.parent.name} ↑</Link>
                    </p>
                  )}
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
                  <Link href={`/reports/transactions?client_id=${selected.id}`}>Contracts &amp; Studies →</Link>
                  <Link href={`/contracts/new?client_id=${selected.id}`}>+ Add contract</Link>
                  <Link href={`/studies/new?client_id=${selected.id}`}>+ Add study</Link>
                  <a href="#delete-client" className="quicklink-danger">Archive client…</a>
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
                <SalespersonPicker salespeople={salespeople} defaultId={selected.salespersonId ?? null} defaultName={selected.salespersonName ?? null} requiredField={false} />
                {showParentPicker && (
                  <label className="parent-picker">Parent account (optional)
                    <InfoTooltip text="Roll this client up under a parent account. Balances still live on each client — the parent just shows a family total. Only top-level clients can be parents." />
                    <select name="parent_id" defaultValue={selected.parentId ?? ''}>
                      <option value="">— none (top-level) —</option>
                      {eligibleParents.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="actions">
                  <button type="submit">Save changes</button>
                </div>
              </form>

              {isParent && family && (
                <div className="card">
                  <h3>Sub-accounts <span className="muted small">({family.children.length})</span></h3>
                  <p className="muted small">Each sub-account keeps its own balance; the total below rolls them up with this account.</p>
                  <div className="table-scroll">
                    <table className="report compact">
                      <thead><tr><th>Client</th><th className="num">Credits</th><th className="num">Dollars</th><th>Next renewal</th></tr></thead>
                      <tbody>
                        {family.children.map(ch => (
                          <tr key={ch.id}>
                            <td><Link href={`/clients?id=${ch.id}`}>{ch.name}</Link></td>
                            <td className={`num${ch.credits < 0 ? ' neg' : ''}`}>{creditsFmt(ch.credits)}</td>
                            <td className={`num${ch.dollars < 0 ? ' neg' : ''}`}>{dollars(ch.dollars)}</td>
                            <td>{ch.cyRenewal ? isoDate(ch.cyRenewal) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="report-totals">
                          <td>Family total (incl. this account)</td>
                          <td className={`num${family.rollup.credits < 0 ? ' neg' : ''}`}>{creditsFmt(family.rollup.credits)}</td>
                          <td className={`num${family.rollup.dollars < 0 ? ' neg' : ''}`}>{dollars(family.rollup.dollars)}</td>
                          <td>{family.rollup.nextRenewal ? isoDate(family.rollup.nextRenewal) : '—'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {family.partial && <p className="muted small">Showing only your clients in this family.</p>}
                </div>
              )}

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
        <Link className="btn-sm" href={`/users/${user.id}`}>Studies →</Link>
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
