import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import type { ArchiveList } from '../../../lib/api';
import ArchiveClient from './ArchiveClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recently Archived · AlphaROC' };

export default async function ArchivePage() {
  if (!(await currentUserIsAdmin())) notFound();

  let data: ArchiveList | null = null;
  let error = '';
  try {
    const api = await apiForRequest();
    data = await api.listArchived();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not load archived records.';
  }

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Recently Archived</h1>
      <p className="muted">
        Deleting anything in this app only <strong>archives</strong> it — the
        row is hidden, never destroyed. Restore any record here. A contact or
        transaction whose client is still archived must wait until the client
        is restored first; restoring a client automatically brings back
        everything that was hidden with it.
      </p>
      {error && <p className="neg" role="alert">{error}</p>}
      {data && <ArchiveClient data={data} />}
    </>
  );
}
