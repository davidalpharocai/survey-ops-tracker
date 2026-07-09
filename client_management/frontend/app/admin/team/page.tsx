import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import type { TeamList } from '../../../lib/api';
import TeamClient from './TeamClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AlphaROC Team · AlphaROC' };

export default async function TeamPage() {
  if (!(await currentUserIsAdmin())) notFound();

  let data: TeamList | null = null;
  let error = '';
  try {
    const api = await apiForRequest();
    data = await api.listTeam();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not load team.';
  }

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>AlphaROC Team</h1>
      <p className="muted">
        Who can sign in to this app. Access is restricted to{' '}
        <strong>@{data?.allowedDomain || 'alpharoc.ai'}</strong> Google accounts;
        admins can additionally invite users, export data, and manage this list.
      </p>
      {error && <p className="neg" role="alert">{error}</p>}
      {data && <TeamClient data={data} />}
    </>
  );
}
