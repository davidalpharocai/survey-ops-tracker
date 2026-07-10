import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import type { Salesperson } from '../../../lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'View as user · AlphaROC' };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function ImpersonatePage({ searchParams }: PageProps) {
  if (!(await currentUserIsAdmin())) notFound();
  const sp = await searchParams;

  const api = await apiForRequest();
  const salespeople = await api.listSalespeople().catch(() => [] as Salesperson[]);
  const withEmail = salespeople.filter(s => s.email);
  // Native POST → route handler → full-page redirect (see app/api/impersonate).
  const action = `${BASE_PATH}/api/impersonate`;

  return (
    <>
      <Link className="back" href="/admin">← Administration</Link>
      <h1>View as user</h1>
      <p className="muted">
        See CCM exactly as a teammate sees it — handy for confirming a
        salesperson only sees their own clients. It is <strong>read-only</strong>:
        while viewing as someone else you can&apos;t change any data. A banner
        stays on screen until you exit, and the session ends on its own after
        two hours.
      </p>

      {sp?.error && (
        <p className="warn">Enter a valid @alpharoc.ai email address.</p>
      )}

      <form method="post" action={action} className="card form-narrow">
        <input type="hidden" name="intent" value="start" />
        <label>Email to view as
          <input
            name="email"
            type="email"
            list="impersonate-suggestions"
            required
            placeholder="name@alpharoc.ai"
          />
          <datalist id="impersonate-suggestions">
            {withEmail.map(s => (
              <option key={s.id} value={s.email as string}>{s.name}</option>
            ))}
          </datalist>
          <span className="muted small">
            Pick a salesperson or type any @alpharoc.ai address.
          </span>
        </label>
        <div className="actions">
          <button type="submit" className="btn">Start viewing</button>
        </div>
      </form>

      {withEmail.length > 0 && (
        <div className="card">
          <h3>Salespeople</h3>
          <p className="muted small">One click to view as a rep (restricted to their own clients).</p>
          <div className="impersonate-quick">
            {withEmail.map(s => (
              <form key={s.id} method="post" action={action} className="inline-form">
                <input type="hidden" name="intent" value="start" />
                <input type="hidden" name="email" value={s.email as string} />
                <button type="submit" className="btn-sm">{`View as ${s.name}`}</button>
              </form>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
