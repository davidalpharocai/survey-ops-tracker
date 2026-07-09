import Link from 'next/link';

import { currentUserEmail, currentUserIsAdmin } from '../lib/auth';
import LinkPending from './_components/LinkPending';

export const metadata = { title: 'AlphaROC Credit Management' };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default async function HomePage() {
  const [userEmail, isAdmin] = await Promise.all([
    currentUserEmail(),
    currentUserIsAdmin(),
  ]);

  return (
    <div className="hub">
      <h1 className="hub-title">AlphaROC Credit Management</h1>

      {userEmail ? (
        <>
          <p className="hub-eyebrow">Record a transaction</p>
          {/* Tiles use default <Link> prefetch + per-route loading.tsx for an
              instant shell; LinkPending gives immediate click feedback. Do
              not set prefetch={false} (it would kill the instant shell). */}
          <div className="hub-actions">
            <Link className="hub-action" href="/studies/new">
              <span className="hub-link-title">Record a Study</span>
              <span className="hub-link-sub">Log a survey that draws down a client&apos;s credits or dollars, attributed to one of their contacts.</span>
              <LinkPending />
            </Link>
            <Link className="hub-action" href="/contracts/new">
              <span className="hub-link-title">Add a Contract</span>
              <span className="hub-link-sub">Top up a client&apos;s available credits and/or dollars — funds their studies.</span>
              <LinkPending />
            </Link>
          </div>

          <div className="hub-panels">
            <section className="panel">
              <h2>Balances &amp; Reports</h2>
              <Link className="hub-link" href="/reports">
                <span className="hub-link-title">Client Balances</span>
                <span className="hub-link-sub">Any client&apos;s current balance — credits and dollars — plus full transaction history.</span>
                <LinkPending />
              </Link>
            </section>

            <section className="panel">
              <h2>Clients &amp; Contacts</h2>
              <Link className="hub-link" href="/clients">
                <span className="hub-link-title">Manage Client List</span>
                <span className="hub-link-sub">Add, edit, or remove clients · edit each client&apos;s contacts inline.</span>
                <LinkPending />
              </Link>
              <Link className="hub-link" href="/users">
                <span className="hub-link-title">Client Contacts</span>
                <span className="hub-link-sub">Search and browse every contact across all clients.</span>
                <LinkPending />
              </Link>
            </section>

            {isAdmin && (
              <section className="panel">
                <h2>Administration</h2>
                <Link className="hub-link" href="/admin">
                  <span className="hub-link-title">Audit Log</span>
                  <span className="hub-link-sub">Every change made and every blocked attempt, across all team members.</span>
                  <LinkPending />
                </Link>
                <Link className="hub-link" href="/admin/import">
                  <span className="hub-link-title">Import Data</span>
                  <span className="hub-link-sub">Upload a spreadsheet (CCM import template or Survey Ops export), preview, apply.</span>
                  <LinkPending />
                </Link>
                <Link className="hub-link" href="/admin/socc-sync">
                  <span className="hub-link-title">Sync from SOCC</span>
                  <span className="hub-link-sub">Upload a Survey Ops export to stamp each survey&apos;s current SOCC stage (e.g. Fielding). Status only — never touches money.</span>
                  <LinkPending />
                </Link>
                <a className="hub-link" href={`${BASE_PATH}/admin/export`} download>
                  <span className="hub-link-title">Export Data</span>
                  <span className="hub-link-sub">Download all clients, contracts &amp; studies as a ZIP (re-importable workbook + raw ledger).</span>
                </a>
                <Link className="hub-link" href="/admin/archive">
                  <span className="hub-link-title">Recently Archived</span>
                  <span className="hub-link-sub">Restore archived clients, contacts, contracts &amp; studies — nothing is ever destroyed.</span>
                  <LinkPending />
                </Link>
                <Link className="hub-link" href="/admin/team">
                  <span className="hub-link-title">AlphaROC Team</span>
                  <span className="hub-link-sub">Invite or remove @alpharoc.ai staff and set who is an admin.</span>
                  <LinkPending />
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
