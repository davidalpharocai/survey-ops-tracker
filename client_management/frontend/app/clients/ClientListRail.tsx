'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { Client } from '../../lib/types';

// Left-pane client list with an in-pane text filter and a My/All scope toggle.
// Both operate purely on the already-loaded list (no refetch); selecting a
// client still navigates via <Link> so the detail pane server-renders as before.
export default function ClientListRail({
  clients,
  selectedId,
  myEmail,
}: {
  clients: Client[];
  selectedId: number | null;
  myEmail: string;
}) {
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const me = (myEmail || '').trim().toLowerCase();

  // Only offer the My/All toggle when the signed-in user actually owns clients.
  const ownsSome = useMemo(
    () => !!me && clients.some(c => (c.salespersonEmail || '').toLowerCase() === me),
    [clients, me],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return clients.filter(c => {
      if (mineOnly && (c.salespersonEmail || '').toLowerCase() !== me) return false;
      if (!term) return true;
      return `${c.name} ${c.soccCode || ''}`.toLowerCase().includes(term);
    });
  }, [clients, q, mineOnly, me]);

  return (
    <>
      <div className="rail-controls">
        <input
          type="search"
          className="rail-filter"
          placeholder="Filter clients…"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Filter clients by name or code"
        />
        {ownsSome && (
          <div className="rail-toggle" role="group" aria-label="Client scope">
            <button type="button" className={mineOnly ? '' : 'is-active'} onClick={() => setMineOnly(false)}>All</button>
            <button type="button" className={mineOnly ? 'is-active' : ''} onClick={() => setMineOnly(true)}>Mine</button>
          </div>
        )}
      </div>
      <ul className="client-list">
        {clients.length === 0 ? (
          <li className="empty muted">No clients yet — click + New.</li>
        ) : filtered.length === 0 ? (
          <li className="empty muted">No clients match.</li>
        ) : (
          filtered.map(c => (
            <li key={c.id} className={selectedId === c.id ? 'is-selected' : ''}>
              <Link href={`/clients?id=${c.id}`}>
                <span className="cl-name">{c.name}</span>
                {(c.salespersonName || c.relationshipManager) && (
                  <span className="cl-meta">Sales · {c.salespersonName || c.relationshipManager}</span>
                )}
              </Link>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
