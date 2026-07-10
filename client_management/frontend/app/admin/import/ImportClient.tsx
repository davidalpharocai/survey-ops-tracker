'use client';

import { useRef, useState, useTransition } from 'react';

import type { ApplyResult, ImportPlan, PlanRow } from '../../../lib/importer';
import { applyImportAction, previewImportAction } from './actions';

const TAB_LABEL: Record<string, string> = {
  clients: 'Clients',
  users: 'Users',
  contracts: 'Contracts',
  studies: 'Studies',
};

function ChangeList({ row }: { row: PlanRow }) {
  if (row.error) return <span className="neg">{row.error}</span>;
  if (!row.changes.length) return null;
  return (
    <>
      {row.changes.map((c, i) => (
        <span key={i} style={{ display: 'inline-block', marginRight: 12 }}>
          <span className="muted">{c.field}:</span>{' '}
          {c.from ? <>{c.from} → </> : null}
          <strong>{c.to}</strong>
        </span>
      ))}
    </>
  );
}

export default function ImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const preview = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose an .xlsx file first.');
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    setError('');
    setResult(null);
    startTransition(async () => {
      const res = await previewImportAction(fd);
      if (res.error) {
        setError(res.error);
        setPlan(null);
      } else {
        setPlan(res.plan ?? null);
      }
    });
  };

  const apply = () => {
    if (!plan) return;
    setError('');
    startTransition(async () => {
      const res = await applyImportAction(JSON.stringify(plan));
      if (res.error) {
        setError(res.error);
      } else {
        setResult(res.result ?? null);
        setPlan(null);
        if (fileRef.current) fileRef.current.value = '';
      }
    });
  };

  const actionable = plan ? plan.counts.create + plan.counts.update : 0;
  const shown = plan ? plan.rows.filter(r => r.action !== 'unchanged') : [];

  return (
    <div>
      <div className="filterbar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept=".xlsx" onChange={() => { setPlan(null); setResult(null); setError(''); }} />
        <button className="btn btn-sm" onClick={preview} disabled={pending}>
          {pending && !plan ? 'Reading…' : 'Preview'}
        </button>
      </div>

      {error && <p className="neg" role="alert">{error}</p>}

      {plan && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>
            Preview — {plan.fileName}{' '}
            <span className="muted" style={{ fontWeight: 'normal', fontSize: '0.85em' }}>
              (detected: {plan.format === 'socc' ? 'Survey Ops export' : 'CCM import template'})
            </span>
          </h2>
          <p>
            <strong>{plan.counts.create}</strong> to create ·{' '}
            <strong>{plan.counts.update}</strong> to update ·{' '}
            {plan.counts.unchanged} unchanged
            {plan.counts.error > 0 && (
              <> · <span className="neg">{plan.counts.error} with errors (will be skipped)</span></>
            )}
          </p>

          {shown.length > 0 ? (
            <table className="report">
              <thead>
                <tr>
                  <th>Tab</th>
                  <th>Action</th>
                  <th>Client</th>
                  <th>Name</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td>{TAB_LABEL[r.tab]}</td>
                    <td>
                      <span className={`tag ${r.action === 'error' ? 'tag-study' : r.action === 'create' ? 'tag-contract' : ''}`}>
                        {r.action}
                      </span>
                    </td>
                    <td>{r.client}</td>
                    <td>{r.name}</td>
                    <td><ChangeList row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Everything in this file already matches the database — nothing to apply.</p>
          )}

          {actionable > 0 && (
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={apply} disabled={pending}>
                {pending ? 'Applying…' : `Apply ${actionable} change${actionable === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Import complete</h2>
          <p>
            <strong>{result.applied}</strong> applied
            {result.failed > 0 && (
              <> · <span className="neg"><strong>{result.failed}</strong> failed — fix below and re-upload; already-applied rows are safe to resend</span></>
            )}
          </p>
          {result.failed > 0 && (
            <table className="report">
              <thead>
                <tr>
                  <th>Tab</th>
                  <th>Client</th>
                  <th>Name</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.filter(r => !r.ok).map((r, i) => (
                  <tr key={i}>
                    <td>{TAB_LABEL[r.tab]}</td>
                    <td>{r.client}</td>
                    <td>{r.name}</td>
                    <td className="neg">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
