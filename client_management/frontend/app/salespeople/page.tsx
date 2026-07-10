import Link from 'next/link';

import { apiForRequest } from '../../lib/action';
import type { Salesperson } from '../../lib/types';
import ConfirmButton from '../clients/ConfirmButton';
import InfoTooltip from '../_components/InfoTooltip';
import {
  createSalespersonAction,
  deleteSalespersonAction,
  restoreSalespersonAction,
  updateSalespersonAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Salespeople · AlphaROC' };

const EMAIL_TIP =
  'A salesperson’s email links them to their sign-in. When it matches the person viewing the home page, the dashboard can default to “my clients”. Names without an email still work for assigning clients — they just don’t get a personal filtered view.';

export default async function SalespeoplePage() {
  const api = await apiForRequest();
  const all = await api.listSalespeople(true); // include archived
  const salespeople = all.filter(s => s.active);
  const archived = all.filter(s => !s.active);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Salespeople</h1>
      <p className="muted">
        The people clients are assigned to. Assignment is only a filter for the
        home dashboard — it never hides a client from anyone. Add an email so a
        salesperson’s <em>my clients</em> view works when they sign in.
      </p>

      <div className="card">
        <h3>Add salesperson</h3>
        <form action={createSalespersonAction} className="add-row-form">
          <strong>New</strong>
          <label>Name <input name="name" type="text" required /></label>
          <label>Email (optional) <InfoTooltip text={EMAIL_TIP} /><input name="email" type="email" placeholder="name@alpharoc.ai" /></label>
          <button type="submit" className="btn-sm">+ Add</button>
        </form>
      </div>

      <div className="card">
        <h3>Current salespeople</h3>
        {salespeople.length > 0 ? (
          <table className="report compact">
            <thead><tr><th>Name</th><th>Email <InfoTooltip text={EMAIL_TIP} /></th><th></th></tr></thead>
            <tbody>
              {salespeople.map(s => (
                <SalespersonRow key={s.id} sp={s} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No salespeople yet — add one above, or add one inline while creating a client.</p>
        )}
      </div>

      {archived.length > 0 && (
        <div className="card">
          <h3>Archived</h3>
          <table className="report compact">
            <thead><tr><th>Name</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {archived.map(s => (
                <tr key={s.id}>
                  <td className="muted">{s.name}</td>
                  <td className="muted">{s.email || ''}</td>
                  <td className="row-actions">
                    <form action={restoreSalespersonAction} className="inline-form">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="name" value={s.name} />
                      <button type="submit" className="btn-sm">Restore</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SalespersonRow({ sp }: { sp: Salesperson }) {
  const formId = `sp-form-${sp.id}`;
  return (
    <tr>
      <td>
        <form id={formId} action={updateSalespersonAction}>
          <input type="hidden" name="id" value={sp.id} />
          <input name="name" type="text" defaultValue={sp.name} required />
        </form>
      </td>
      <td>
        <input name="email" type="email" defaultValue={sp.email || ''} form={formId} placeholder="name@alpharoc.ai" />
      </td>
      <td className="row-actions">
        <button type="submit" form={formId} className="btn-sm">Save</button>
        <form action={deleteSalespersonAction} className="inline-form">
          <input type="hidden" name="id" value={sp.id} />
          <ConfirmButton type="submit" className="btn-sm btn-danger" message={`Archive salesperson ${sp.name}? They’ll be removed from the picker; clients keep their current label.`}>
            Archive
          </ConfirmButton>
        </form>
      </td>
    </tr>
  );
}
