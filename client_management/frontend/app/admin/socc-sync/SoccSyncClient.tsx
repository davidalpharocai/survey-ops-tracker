'use client';

import { useState } from 'react';

import { parseSoccStatuses } from '../../../lib/soccSync';
import type { SoccSyncResult } from '../../../lib/types';
import { applySoccSync } from './actions';

export default function SoccSyncClient() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<SoccSyncResult | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      const statuses = await parseSoccStatuses(file);
      if (statuses.length === 0) {
        setErr('No projects with a PR##### code were found in that file.');
        return;
      }
      setResult(await applySoccSync(statuses));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not read that file.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="card">
      <label className="add-row-form" style={{ display: 'block' }}>
        <strong>Upload SOCC export (.xlsx)</strong>
        <input type="file" accept=".xlsx" onChange={onFile} disabled={busy} />
      </label>
      {busy && <p className="muted">Reading and syncing…</p>}
      {err && <p className="warn" style={{ marginTop: '0.75rem' }}>{err}</p>}

      {result && (
        <div style={{ marginTop: '1rem' }}>
          <p>
            <strong>{result.matchedCount.toLocaleString()}</strong> studies updated ·{' '}
            <strong>{result.unmatchedCount.toLocaleString()}</strong> SOCC project(s) with no match.
          </p>

          {result.matched.length > 0 && (
            <table className="report compact" style={{ marginBottom: '1rem' }}>
              <thead><tr><th>PR code</th><th>Study</th><th>Client</th><th>SOCC stage</th></tr></thead>
              <tbody>
                {result.matched.map(m => (
                  <tr key={m.studyId}>
                    <td>{m.prCode}</td>
                    <td>{m.name}</td>
                    <td>{m.clientName}</td>
                    <td><span className={`tag tag-socc${m.boardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{m.boardColumn || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.unmatched.length > 0 && (
            <>
              <h3>Needs reconciling ({result.unmatchedCount})</h3>
              <p className="muted small">SOCC projects with no matching CCM study (by PR code) — create or link these in CCM.</p>
              <table className="report compact">
                <thead><tr><th>PR code</th><th>Project</th><th>Client</th><th>SOCC stage</th></tr></thead>
                <tbody>
                  {result.unmatched.map((u, i) => (
                    <tr key={`${u.prCode}-${i}`}>
                      <td>{u.prCode}</td>
                      <td>{u.projectName || '—'}</td>
                      <td>{u.clientName || '—'}</td>
                      <td><span className={`tag tag-socc${u.boardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{u.boardColumn || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
