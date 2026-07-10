'use client';

import { useMemo, useState } from 'react';

import type { ClientUser, Cadence } from '../../../lib/types';
import { TIP } from '../../../lib/tooltips';
import InfoTooltip from '../../_components/InfoTooltip';
import SubmitButton from '../../_components/SubmitButton';
import { createStudyAction } from './actions';

const RUNS_PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4 };

interface Props {
  clientId: number | null;
  users: ClientUser[];
  contracts: { id: number; name: string }[];
}

export default function NewStudyForm({ clientId, users, contracts }: Props) {
  const [cadence, setCadence] = useState<Cadence>('single');
  const [cost, setCost] = useState('');
  const [selCount, setSelCount] = useState(0);
  const [addingContact, setAddingContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');

  const runs = RUNS_PER_YEAR[cadence] || 1;
  const isTracker = cadence in RUNS_PER_YEAR;
  const annual = useMemo(() => {
    const n = parseFloat(cost || '0');
    return Number.isFinite(n) ? n * runs : 0;
  }, [cost, runs]);

  const disabled = !clientId;
  // A study needs at least one contact — satisfied by an existing selection
  // OR a new contact typed inline (created on submit, then attributed).
  const hasContact = selCount > 0 || (addingContact && newContactName.trim().length > 0);

  return (
    <form action={createStudyAction} className="card form-narrow">
      <input type="hidden" name="client_id" value={clientId || ''} />

      {disabled && <p className="muted small">Pick a client above to enable this form.</p>}

      <label>Contacts at this client (pick one or more)<InfoTooltip text={TIP.studyUser} />
        <select
          name="client_user_ids"
          multiple
          size={4}
          disabled={disabled || users.length === 0}
          onChange={e => setSelCount(e.target.selectedOptions.length)}
        >
          {users.length === 0 && disabled ? null : users.length === 0 ? (
            <option value="" disabled>(no contacts yet — add one below)</option>
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
              ? 'This client has no contacts yet — add one below.'
              : 'Hold Cmd/Ctrl to select more than one, or add a new contact below.'}
        </span>
      </label>

      {!disabled && (
        <div className="inline-add">
          {addingContact ? (
            <div className="sp-new">
              <label>New contact name
                <input
                  name="new_contact_name"
                  type="text"
                  value={newContactName}
                  onChange={e => setNewContactName(e.target.value)}
                  placeholder="e.g. Jordan Lee"
                  autoFocus
                />
              </label>
              <label>Email <span className="muted small">(optional)</span>
                <input name="new_contact_email" type="email" placeholder="name@company.com" />
              </label>
              <button
                type="button"
                className="btn-sm"
                onClick={() => { setAddingContact(false); setNewContactName(''); }}
              >
                Cancel
              </button>
              <span className="muted small">This contact is created and attributed to the study when you publish.</span>
            </div>
          ) : (
            <button type="button" className="btn-sm" onClick={() => setAddingContact(true)}>
              ＋ Add a new contact
            </button>
          )}
        </div>
      )}

      <label>Study title
        <input name="name" type="text" required placeholder="e.g. Pilot screening, March cohort" disabled={disabled} />
      </label>

      <label>Study date
        <input name="occurred_on" type="date" defaultValue={todayIso()} required disabled={disabled} />
      </label>

      <div className="amounts-row">
        <label>Cadence<InfoTooltip text={TIP.cadence} />
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
        <label>Cost type<InfoTooltip text={TIP.costType} />
          <select name="cost_type" required disabled={disabled} defaultValue="credits">
            <option value="credits">Credits</option>
            <option value="dollars">Dollars</option>
          </select>
        </label>
      </div>

      <div className="amounts-row">
        <label>
          {isTracker ? 'Cost per run' : 'Cost'}<InfoTooltip text={TIP.studyCost} />
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
          <label>Setup (credits, one-time)<InfoTooltip text={TIP.setupCost} />
            <input name="setup_cost" type="number" step="0.01" min="0" defaultValue={0} disabled={disabled} />
          </label>
        )}
      </div>

      <label>Rolls up to contract (optional)<InfoTooltip text={TIP.studyContract} />
        <select name="contract_id" disabled={disabled}>
          <option value="">— none (Unassigned) —</option>
          {contracts.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="muted small">
          {contracts.length === 0
            ? 'This client has no contracts yet — the study will be Unassigned.'
            : 'Pick the contract this study draws its credits from.'}
        </span>
      </label>

      <label>Audience (optional)
        <InfoTooltip text="Who this study surveys — e.g. 'Institutional investors', 'US registered voters'. Free text, for your reference." />
        <input name="audience" type="text" placeholder="e.g. Institutional investors" disabled={disabled} />
      </label>

      <div className="amounts-row">
        <label>Target N (optional)
          <InfoTooltip text="The number of completed responses you're aiming for on this study." />
          <input name="target_n" type="number" min="0" step="1" placeholder="e.g. 600" disabled={disabled} />
        </label>
        <label>Actual N delivered (optional)
          <InfoTooltip text="The number of completes actually delivered. Can be filled in later once fielding wraps." />
          <input name="actual_n_delivered" type="number" min="0" step="1" placeholder="e.g. 542" disabled={disabled} />
        </label>
      </div>

      <label>Description (optional)
        <InfoTooltip text="A short note about this study — methodology, goal, or anything worth remembering." />
        <textarea name="description" rows={2} placeholder="Short description of this study" disabled={disabled} />
      </label>

      <div className="actions">
        <SubmitButton disabled={disabled || !hasContact} pendingLabel="Publishing…">Publish study</SubmitButton>
        {!disabled && !hasContact && (
          <span className="muted small">Select a contact above or add a new one.</span>
        )}
      </div>
    </form>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
