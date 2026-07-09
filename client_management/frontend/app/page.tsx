import Link from 'next/link';

import { currentUserEmail, currentUserIsAdmin } from '../lib/auth';

export const metadata = { title: 'AlphaROC Client Credit Management' };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default async function HomePage() {
  const [userEmail, isAdmin] = await Promise.all([
    currentUserEmail(),
    currentUserIsAdmin(),
  ]);

  return (
    <div className="hub">
      <h1 className="hub-title">AlphaROC Client Credit Management</h1>

      {userEmail ? (
        <>
          <p className="hub-eyebrow">Record a transaction</p>
          <div className="hub-actions">
            <Link className="hub-action" href="/studies/new">
              <span className="hub-link-title">Record a Study</span>
              <span className="hub-link-sub">Log a survey that draws down a client&apos;s credits or dollars, attributed to one of their contacts.</span>
            </Link>
            <Link className="hub-action" href="/contracts/new">
              <span className="hub-link-title">Add a Contract</span>
              <span className="hub-link-sub">Top up a client&apos;s available credits and/or dollars — funds their studies.</span>
            </Link>
          </div>

          <div className="hub-panels">
            <section className="panel">
              <h2>Balances &amp; Reports</h2>
              <Link className="hub-link" href="/reports">
                <span className="hub-link-title">Client Balances</span>
                <span className="hub-link-sub">Any client&apos;s current balance — credits and dollars — plus full transaction history.</span>
              </Link>
            </section>

            <section className="panel">
              <h2>Clients &amp; Contacts</h2>
              <Link className="hub-link" href="/clients">
                <span className="hub-link-title">Manage Client List</span>
                <span className="hub-link-sub">Add, edit, or remove clients · edit each client&apos;s contacts inline.</span>
              </Link>
              <Link className="hub-link" href="/users">
                <span className="hub-link-title">Client Contacts</span>
                <span className="hub-link-sub">Search and browse every contact across all clients.</span>
              </Link>
            </section>

            {isAdmin && (
              <section className="panel">
                <h2>Administration</h2>
                <Link className="hub-link" href="/admin">
                  <span className="hub-link-title">Audit Log</span>
                  <span className="hub-link-sub">Every change made and every blocked attempt, across all team members.</span>
                </Link>
                <Link className="hub-link" href="/admin/import">
                  <span className="hub-link-title">Import Data</span>
                  <span className="hub-link-sub">Upload a spreadsheet (CCM import template or Survey Ops export), preview, apply.</span>
                </Link>
                <a className="hub-link" href={`${BASE_PATH}/admin/export`} download>
                  <span className="hub-link-title">Export Data</span>
                  <span className="hub-link-sub">Download all clients, contracts &amp; studies as a ZIP (re-importable workbook + raw ledger).</span>
                </a>
                <Link className="hub-link" href="/admin/team">
                  <span className="hub-link-title">AlphaROC Team</span>
                  <span className="hub-link-sub">Invite or remove @alpharoc.ai staff and set who is an admin.</span>
                </Link>
              </section>
            )}
          </div>
        </>
      ) : (
        <p className="muted">
          <Link href="/login">Sign in</Link> to access the application.
        </p>
      )}
    </div>
  );
}
