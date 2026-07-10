import Link from 'next/link';

import { apiForRequest } from '../../lib/action';
import { currentUserEmail, currentUserIsRestricted } from '../../lib/auth';
import type { StudyListRow } from '../../lib/types';
import TxnListView from '../_components/TxnListView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studies · AlphaROC' };

export default async function StudiesPage() {
  const api = await apiForRequest();
  const [email, restricted, rows] = await Promise.all([
    currentUserEmail(),
    currentUserIsRestricted(),
    api.listAllStudies().catch(() => [] as StudyListRow[]),
  ]);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Studies</h1>
      <p className="muted">
        {restricted
          ? 'Every study for your clients. Record a new one with the button.'
          : 'Every study across all clients. Record a new one with the button, or switch to My studies to focus on your own clients.'}
      </p>
      <TxnListView kind="study" email={email} rows={rows} restricted={restricted} />
    </>
  );
}
