import Link from 'next/link';

import { currentUserEmail, currentUserIsAdmin } from '../lib/auth';

export const metadata = { title: 'AlphaROC Client Credit Management' };

export default async function HomePage() {
  const [userEmail, isAdmin] = await Promise.all([
    currentUserEmail(),
    currentUserIsAdmin(),
  ]);

  return (
    <div className="hub">
      <h1 className="hub-title">AlphaROC Client Credit Management</h1>

      {userEmail ? (
        <div className="hub-panels">
          <section className="panel">
            <h2>Manage Client and User Lists</h2>
            <Link className="hub-link" href="/clients">
              <span className="hub-link-title">Manage Client List</span>
              <span className="hub-link-sub">Add, edit, or remove clients · edit each client&apos;s users inline</span>
            </Link>
            <Link className="hub-link" href="/users">
              <span className="hub-link-title">Manage User List</span>
              <span className="hub-link-sub">Search and browse every client user across all clients</span>
            </Link>
            <Link className="hub-link" href="/reports">
              <span className="hub-link-title">Transaction Reports</span>
              <span className="hub-link-sub">Balance summary, per-client transaction log, more reports coming</span>
            </Link>
          </section>

          <section className="panel">
            <h2>Add Studies and Contracts</h2>
            <Link className="hub-link" href="/studies/new">
              <span className="hub-link-title">Add User Study</span>
              <span className="hub-link-sub">Subtract credits or dollars from a client, attributed to one of their users</span>
            </Link>
            <Link className="hub-link" href="/contracts/new">
              <span className="hub-link-title">Add Contract</span>
              <span className="hub-link-sub">Top up a client&apos;s available credits and/or dollars</span>
            </Link>
          </section>

          {isAdmin && (
            <section className="panel">
              <h2>Administration</h2>
              <Link className="hub-link" href="/admin">
                <span className="hub-link-title">Audit Log</span>
                <span className="hub-link-sub">Browse every write action and denied attempt across all users</span>
              </Link>
            </section>
          )}
        </div>
      ) : (
        <p className="muted">
          <Link href="/login">Sign in</Link> to access the application.
        </p>
      )}
    </div>
  );
}
