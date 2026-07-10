import Link from 'next/link';

import { apiForRequest } from '../../lib/action';
import { currentUserEmail } from '../../lib/auth';
import type { ContractListRow } from '../../lib/types';
import TxnListView from '../_components/TxnListView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contracts · AlphaROC' };

export default async function ContractsPage() {
  const api = await apiForRequest();
  const [email, rows] = await Promise.all([
    currentUserEmail(),
    api.listAllContracts().catch(() => [] as ContractListRow[]),
  ]);

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Contracts</h1>
      <p className="muted">
        Every contract across all clients. Add a new one with the button, or switch to
        <strong> My contracts</strong> to focus on your own clients.
      </p>
      <TxnListView kind="contract" email={email} rows={rows} />
    </>
  );
}
