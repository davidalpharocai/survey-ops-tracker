'use client';

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

const COLS: { key: string; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'name', label: 'Name' },
  { key: 'contact', label: 'For user' },
  { key: 'credits', label: 'Credits' },
  { key: 'dollars', label: 'Dollars' },
  { key: 'renewal', label: 'Renewal' },
  { key: 'recordedBy', label: 'Recorded by' },
  { key: 'soccStage', label: 'SOCC stage' },
];
const DEFAULT_COLS = ['date', 'type', 'name', 'contact', 'credits', 'dollars', 'renewal', 'recordedBy'];

type Scope = 'all' | 'contract' | 'survey';
interface Opt { id: number; name: string }

export default function ExportCreditsSummary({
  clientId,
  contracts,
  surveys,
}: {
  clientId: number;
  contracts: Opt[];
  surveys: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);

  const today = new Date().toISOString().slice(0, 10);
  const thisYear = () => { setFrom(`${new Date().getUTCFullYear()}-01-01`); setTo(today); };
  const last12 = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); setFrom(d.toISOString().slice(0, 10)); setTo(today); };
  const allTime = () => { setFrom(''); setTo(''); };
  const toggleCol = (k: string) => setCols(c => (c.includes(k) ? c.filter(x => x !== k) : [...c, k]));

  function download() {
    const p = new URLSearchParams();
    p.set('client_id', String(clientId));
    p.set('scope', scope);
    if (scope !== 'all' && targetId) p.set('id', targetId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('cols', COLS.filter(c => cols.includes(c.key)).map(c => c.key).join(','));
    window.location.assign(`${BASE}/reports/transactions/pdf?${p.toString()}`);
  }

  const disabled = (scope !== 'all' && !targetId) || cols.length === 0;

  return (
    <div className="export-summary">
      <button type="button" className="btn btn-sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Export Credits Summary ▾
      </button>
      {open && (
        <div className="export-pop card" role="dialog" aria-label="Export Credits Summary options">
          <label className="export-field">
            <span>Records</span>
            <select value={scope} onChange={e => { setScope(e.target.value as Scope); setTargetId(''); }}>
              <option value="all">Everything (this client)</option>
              <option value="contract">A single contract</option>
              <option value="survey">A single study</option>
            </select>
          </label>

          {scope === 'contract' && (
            <label className="export-field">
              <span>Contract</span>
              <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                <option value="">— pick a contract —</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {scope === 'survey' && (
            <label className="export-field">
              <span>Study</span>
              <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                <option value="">— pick a study —</option>
                {surveys.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}

          <div className="export-field">
            <span>Time range</span>
            <div className="export-range">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
              <span className="muted small">to</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
            </div>
            <div className="export-presets">
              <button type="button" className="btn-sm" onClick={thisYear}>This year</button>
              <button type="button" className="btn-sm" onClick={last12}>Last 12 mo</button>
              <button type="button" className="btn-sm" onClick={allTime}>All time</button>
            </div>
          </div>

          <div className="export-field">
            <span>Columns</span>
            <div className="export-cols">
              {COLS.map(c => (
                <label key={c.key} className="export-col">
                  <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          </div>

          <div className="actions">
            <button type="button" className="btn" onClick={download} disabled={disabled}>Download PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}
