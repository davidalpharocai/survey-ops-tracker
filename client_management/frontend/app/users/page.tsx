import Link from 'next/link';

import { apiForRequest, parseId } from '../../lib/action';
import AutoSubmitSelect from '../_components/AutoSubmitSelect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client Contacts · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string; q?: string }>;
}

export default async function UsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const clientId = parseId(sp?.client_id);
  const q = (sp?.q || '').trim();

  const api = await apiForRequest();
  const [rows, clients] = await Promise.all([
    api.listUsersFiltered({ clientId, q }),
    api.listClients(),
  ]);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Client Contacts</h1>
      <p className="muted">Every contact across every client. Click a name to see the studies they requested; edits happen on the client&apos;s record.</p>

      <form method="get" className="filterbar">
        <label>Filter by client
          <AutoSubmitSelect name="client_id" defaultValue={clientId || ''}>
            <option value="">All clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </AutoSubmitSelect>
        </label>
        <label>Search
          <input name="q" type="search" defaultValue={q} placeholder="name or email" />
        </label>
        <button type="submit" className="btn-sm">Apply</button>
        {(clientId || q) && <Link href="/users" className="muted">Clear</Link>}
      </form>

      {rows.length > 0 ? (
        <table className="report">
          <thead>
            <tr>
              <th>Client</th>
              <th>Contact</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td>{u.client.name}</td>
                <td><Link href={`/users/${u.id}`}>{u.name}</Link></td>
                <td>{u.email || ''}</td>
                <td>
                  <Link href={`/users/${u.id}`}>Studies →</Link>
                  {' · '}
                  <Link href={`/clients?id=${u.client.id}`}>Client →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No contacts match those filters.</p>
      )}
    </>
  );
}
