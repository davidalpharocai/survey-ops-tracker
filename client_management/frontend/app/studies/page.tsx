import Link from 'next/link';

import { apiForRequest } from '../../lib/action';
import { currentUserEmail } from '../../lib/auth';
import type { StudyListRow } from '../../lib/types';
import TxnListView from '../_components/TxnListView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studies · AlphaROC' };

export default async function StudiesPage() {
  const api = await apiForRequest();
  const [email, rows] = await Promise.all([
    currentUserEmail(),
    api.listAllStudies().catch(() => [] as StudyListRow[]),
  ]);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Studies</h1>
      <p className="muted">
        Every survey across all clients. Record a new one with the button, or switch to
        <strong> My studies</strong> to focus on your own clients.
      </p>
      <TxnListView kind="study" email={email} rows={rows} />
    </>
  );
}
