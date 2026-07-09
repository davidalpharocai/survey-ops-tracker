'use client';

import { useState, useTransition } from 'react';

import type { ArchivedRecord, ArchivedRecordType, ArchiveList } from '../../../lib/api';
import { restoreArchivedAction, type ArchiveActionState } from './actions';

// Deterministic timestamp rendering (no locale) so SSR and client HTML match.
function fmtArchivedAt(iso: string | null): string {
  if (!iso) return '';
  return iso.replace('T', ' ').replace('Z', ' UTC');
}

export default function ArchiveClient({ data }: { data: ArchiveList }) {
  const [msg, setMsg] = useState<ArchiveActionState>({});
  const [pending, startTransition] = useTransition();

  const restore = (type: ArchivedRecordType, id: number) => {
    setMsg({});
    const fd = new FormData();
    fd.set('type', type);
    fd.set('id', String(id));
    startTransition(async () => setMsg(await restoreArchivedAction(fd)));
  };

  const section = (
    title: string,
    type: ArchivedRecordType,
    rows: ArchivedRecord[],
    withClient: boolean,
    emptyText: string,
  ) => (
    <section className="panel" style={{ marginTop: 12 }}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <table className="report compact">
          <thead>
            <tr>
              <th>Name</th>
              {type === 'transaction' && <th>Kind</th>}
              {withClient && <th>Client</th>}
              <th>Archived at</th>
              <th>Archived by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>{row.name}</td>
                {type === 'transaction' && (
                  <td>
                    {row.kind ? (
                      <span className={`tag tag-${row.kind}`}>{row.kind}</span>
                    ) : (
                      ''
                    )}
                  </td>
                )}
                {withClient && <td>{row.clientName || ''}</td>}
                <td className="muted">{fmtArchivedAt(row.deletedAt)}</td>
                <td className="muted">{row.updatedByEmail || ''}</td>
                <td className="row-actions">
                  <button
                    className="btn btn-sm"
                    disabled={pending}
                    onClick={() => restore(type, row.id)}
                  >
                    {pending ? 'Restoring…' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );

  return (
    <div>
      {msg.ok && <p className="pos" role="status">{msg.ok}</p>}
      {msg.error && <p className="neg" role="alert">{msg.error}</p>}

      {section(
        'Clients',
        'client',
        data.clients,
        false,
        'No archived clients.',
      )}
      {section(
        'Contacts',
        'user',
        data.users,
        true,
        'No individually archived contacts.',
      )}
      {section(
        'Contracts & Studies',
        'transaction',
        data.transactions,
        true,
        'No individually archived transactions.',
      )}
    </div>
  );
}
