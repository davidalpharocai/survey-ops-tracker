'use client';

import { useMemo, useState } from 'react';

import type { ClientUser, Cadence } from '../../../lib/types';
import { createStudyAction } from './actions';

const RUNS_PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4 };

interface Props {
  clientId: number | null;
  users: ClientUser[];
}

export default function NewStudyForm({ clientId, users }: Props) {
  const [cadence, setCadence] = useState<Cadence>('single');
  const [cost, setCost] = useState('');

  const runs = RUNS_PER_YEAR[cadence] || 1;
  const isTracker = cadence in RUNS_PER_YEAR;
  const annual = useMemo(() => {
    const n = parseFloat(cost || '0');
    return Number.isFinite(n) ? n * runs : 0;
  }, [cost, runs]);

  const disabled = !clientId;

  return (
    <form action={createStudyAction} className="card form-narrow">
      <input type="hidden" name="client_id" value={clientId || ''} />

      {disabled && <p className="muted small">Pick a client above to enable this form.</p>}

      <label>Users at this client (pick one or more)
        <select name="client_user_ids" multiple size={4} required disabled={disabled || users.length === 0}>
          {users.length === 0 && disabled ? null : users.length === 0 ? (
            <option value="" disabled>(no users on this client)</option>
          ) : (
            users.map(u => (
              <option key={u.id} value={u.id}>
                {u.email ? `${u.name} (${u.email})` : u.name}
              </option>
            ))
          )}
        </select>
        <span className="muted small">
          {disabled
            ? 'Pick a client first.'
            : users.length === 0
              ? 'Add a user to this client on Manage Client List, then come back.'
              : 'Hold Cmd/Ctrl to select more than one.'}
        </span>
      </label>

      <label>Study title
        <input name="name" type="text" required placeholder="e.g. Pilot screening, March cohort" disabled={disabled} />
      </label>

      <label>Study date
        <input name="occurred_on" type="date" defaultValue={todayIso()} required disabled={disabled} />
      </label>

      <div className="amounts-row">
        <label>Cadence
          <select
            name="cadence"
            value={cadence}
            onChange={e => setCadence(e.target.value as Cadence)}
            disabled={disabled}
          >
            <option value="single">Single (one-shot)</option>
            <option value="weekly">Weekly tracker</option>
            <option value="monthly">Monthly tracker</option>
            <option value="quarterly">Quarterly tracker</option>
          </select>
        </label>
        <label>Cost type
          <select name="cost_type" required disabled={disabled} defaultValue="credits">
            <option value="credits">Credits</option>
            <option value="dollars">Dollars</option>
          </select>
        </label>
      </div>

      <div className="amounts-row">
        <label>
          {isTracker ? 'Cost per run' : 'Cost'}
          <input
            name="cost"
            type="number"
            step="0.01"
            min="0"
            required
            disabled={disabled}
            value={cost}
            onChange={e => setCost(e.target.value)}
          />
          <span className="muted small">Total / yr: {Math.round(annual).toLocaleString('en-US')}</span>
        </label>
        {isTracker && (
          <label>Setup (credits, one-time)
            <input name="setup_cost" type="number" step="0.01" min="0" defaultValue={0} disabled={disabled} />
          </label>
        )}
      </div>

      <div className="actions">
        <button type="submit" disabled={disabled}>Publish study</button>
      </div>
    </form>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
