'use client';

import { useState } from 'react';

import InfoTooltip from '../_components/InfoTooltip';
import type { Salesperson } from '../../lib/types';

const TIP =
  'Who sells/owns this account. Assigning it lets the home dashboard default to a salesperson’s own clients — it never hides anything from anyone. Pick from the list, or add a new salesperson (their email is what powers the "my clients" view).';

/**
 * Required salesperson picker for the client forms. Submits `salesperson_id`
 * (an existing id or the sentinel `__new__`); when adding a new salesperson
 * it also submits `new_salesperson_name` / `new_salesperson_email`, which the
 * server action turns into a salesperson before saving the client.
 */
export default function SalespersonPicker({
  salespeople,
  defaultId = null,
  defaultName = null,
}: {
  salespeople: Salesperson[];
  defaultId?: number | null;
  defaultName?: string | null;
}) {
  const [mode, setMode] = useState<string>(defaultId ? String(defaultId) : '');
  const isNew = mode === '__new__';
  // The currently-assigned salesperson may have been archived (not in the
  // active list). Keep them selectable so the required select isn't blank and
  // editing an unrelated field doesn't force a reassignment.
  const missing = defaultId != null && !salespeople.some(s => s.id === defaultId);
  return (
    <div className="sp-picker">
      <label>
        Salesperson <InfoTooltip text={TIP} />
        <select
          name="salesperson_id"
          required
          value={mode}
          onChange={e => setMode(e.target.value)}
        >
          <option value="">— select salesperson —</option>
          {missing && (
            <option value={String(defaultId)}>
              {defaultName ? `${defaultName} (archived)` : 'Current (archived)'}
            </option>
          )}
          {salespeople.map(s => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
              {s.email ? '' : ' (no email)'}
            </option>
          ))}
          <option value="__new__">＋ Add new salesperson…</option>
        </select>
      </label>
      {isNew && (
        <div className="sp-new">
          <label>
            New salesperson name
            <input name="new_salesperson_name" type="text" required autoFocus />
          </label>
          <label>
            Email <span className="muted small">(optional — enables their &ldquo;my clients&rdquo; view)</span>
            <input name="new_salesperson_email" type="email" placeholder="name@alpharoc.ai" />
          </label>
        </div>
      )}
    </div>
  );
}
