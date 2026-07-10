import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUserIsAdmin } from '../../lib/auth';
import LinkPending from '../_components/LinkPending';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administration · AlphaROC' };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Admin landing hub. Each tool that used to sit on the home page's
// "Administration" panel lives here, so the home page stays focused on the
// day-to-day work and the dashboard.
export default async function AdminHubPage() {
  if (!(await currentUserIsAdmin())) notFound();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Administration</h1>
      <p className="muted">Tools for admins only. Everything here is logged.</p>

      <div className="hub-panels">
        <section className="panel">
          <h2>Records</h2>
          <Link className="hub-link" href="/admin/audit">
            <span className="hub-link-title">Audit Log</span>
            <span className="hub-link-sub">Every change made and every blocked attempt, across all team members.</span>
            <LinkPending />
          </Link>
          <Link className="hub-link" href="/admin/archive">
            <span className="hub-link-title">Recently Archived</span>
            <span className="hub-link-sub">Restore archived clients, contacts, contracts &amp; studies — nothing is ever destroyed.</span>
            <LinkPending />
          </Link>
        </section>

        <section className="panel">
          <h2>Data</h2>
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
        </section>

        <section className="panel">
          <h2>People</h2>
          <Link className="hub-link" href="/admin/team">
            <span className="hub-link-title">AlphaROC Team</span>
            <span className="hub-link-sub">Invite or remove @alpharoc.ai staff and set who is an admin.</span>
            <LinkPending />
          </Link>
          <Link className="hub-link" href="/salespeople">
            <span className="hub-link-title">Salespeople</span>
            <span className="hub-link-sub">Manage the salespeople clients are assigned to · set emails to power the &ldquo;my clients&rdquo; dashboard view.</span>
            <LinkPending />
          </Link>
        </section>
      </div>
    </>
  );
}
