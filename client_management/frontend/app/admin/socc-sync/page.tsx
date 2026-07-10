import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUserIsAdmin } from '../../../lib/auth';
import SoccSyncClient from './SoccSyncClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sync from SOCC · AlphaROC' };

export default async function SoccSyncPage() {
  if (!(await currentUserIsAdmin())) notFound();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Sync from SOCC</h1>
      <p className="muted">
        Upload a Survey Ops export. CCM matches each project to a study by its{' '}
        <strong>PR#####</strong> code and records its current SOCC stage (e.g.{' '}
        <em>Fielding</em>) on the study. This is <strong>status only</strong> — it never
        changes credits, balances, or any report. Projects with no matching study are
        listed so you can reconcile them.
      </p>
      <SoccSyncClient />
    </>
  );
}
