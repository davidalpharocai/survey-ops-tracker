'use client';

import { Fragment, useMemo, useState } from 'react';

import type { Cadence, ClientUser, CostType, StudyTransaction } from '../../../lib/types';
import ConfirmButton from '../../clients/ConfirmButton';
import {
  bulkUpdateStudiesAction,
  deleteStudyAction,
  markStudyReviewedAction,
} from './actions';

const RUNS_PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4 };

interface ColumnDef {
  key: string;
  type: 'date' | 'text' | 'num';
  label: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', type: 'date', label: 'Date' },
  { key: 'name', type: 'text', label: 'Name' },
  { key: 'users', type: 'text', label: 'Contacts' },
  { key: 'cadence', type: 'text', label: 'Cadence' },
  { key: 'costType', type: 'text', label: 'Cost type' },
  { key: 'costPerRun', type: 'num', label: 'Cost / run' },
  { key: 'setup', type: 'num', label: 'Setup (cr)' },
  { key: 'totalYr', type: 'num', label: 'Total / yr' },
];

const DEFAULT_SORT = { col: 7, dir: 'desc' as 'asc' | 'desc' };

function isoDateStr(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

interface RowState {
  id: number;
  isImported: boolean;
  occurredOn: string;
  name: string;
  cadence: Cadence;
  costType: CostType;
  cost: string;
  setup: string;
  userIds: string[];
  userNames: string;
  audience: string;
  targetN: string;
  actualN: string;
  description: string;
}

interface Props {
  studies: StudyTransaction[];
  clientUsers: ClientUser[];
  clientId: number;
  readOnly?: boolean;
}

export default function ExistingStudiesTable({ studies, clientUsers, clientId, readOnly = false }: Props) {
  const [rows, setRows] = useState<RowState[]>(() =>
    studies.map(t => ({
      id: t.id,
      isImported: !!t.isImported,
      occurredOn: isoDateStr(t.occurredOn),
      name: t.name || '',
      cadence: (t.cadence || 'single') as Cadence,
      costType: (t.costType || 'credits') as CostType,
      cost: String(t.costPerRun ?? 0),
      setup: String(t.setupCost ?? 0),
      userIds: (t.userIds || []).map(String),
      userNames: (t.userObjs || []).map(u => u.name).join(', '),
      audience: t.audience || '',
      targetN: t.targetN != null ? String(t.targetN) : '',
      actualN: t.actualNDelivered != null ? String(t.actualNDelivered) : '',
      description: t.description || '',
    })),
  );
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const sorted = useMemo(() => {
    const col = COLUMNS[sort.col];
    if (!col) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortValue(a, col.key);
      const bv = sortValue(b, col.key);
      const cmp = col.type === 'num'
        ? (parseFloat(av || '0') - parseFloat(bv || '0'))
        : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort]);

  function updateRow(id: number, patch: Partial<RowState>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function clickHeader(idx: number) {
    setSort(prev => ({
      col: idx,
      dir: prev.col === idx && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }

  return (
    <>
      <form id="bulk-form" action={bulkUpdateStudiesAction}>
        <input type="hidden" name="client_id" value={clientId} />
      </form>

      {rows.map(r => (
        <span key={`row-forms-${r.id}`}>
          <form id={`delete-form-${r.id}`} action={deleteStudyAction}>
            <input type="hidden" name="id" value={r.id} />
          </form>
          {r.isImported && (
            <form id={`reviewed-form-${r.id}`} action={markStudyReviewedAction}>
              <input type="hidden" name="id" value={r.id} />
            </form>
          )}
        </span>
      ))}

      <table className="report compact studies-table" id="studies-table">
        <thead>
          <tr>
            {COLUMNS.map((c, idx) => (
              <th
                key={c.key}
                className={c.type === 'num' ? 'num' : undefined}
                onClick={() => clickHeader(idx)}
                style={{ cursor: 'pointer' }}
              >
                {c.label}{' '}
                <span className="sort-ind">
                  {sort.col === idx ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                </span>
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const pfx = `studies[${r.id}]`;
            const runs = RUNS_PER_YEAR[r.cadence] || 1;
            const annual = parseFloat(r.cost || '0') * runs;
            const isSingle = r.cadence === 'single';
            const isExp = expanded.has(r.id);
            const hasMeta = !!(r.audience || r.targetN || r.actualN || r.description);
            return (
              <Fragment key={r.id}>
              <tr id={`s${r.id}`} className={`study-row${r.isImported ? ' is-pending' : ''}`}>
                <td>
                  <input
                    form="bulk-form"
                    name={`${pfx}[occurred_on]`}
                    type="date"
                    value={r.occurredOn}
                    required
                    onChange={e => updateRow(r.id, { occurredOn: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    form="bulk-form"
                    name={`${pfx}[name]`}
                    type="text"
                    value={r.name}
                    required
                    onChange={e => updateRow(r.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    form="bulk-form"
                    name={`${pfx}[client_user_ids][]`}
                    multiple
                    size={3}
                    required
                    value={r.userIds}
                    onChange={e => updateRow(r.id, {
                      userIds: Array.from(e.target.selectedOptions).map(o => o.value),
                    })}
                  >
                    {clientUsers.map(u => (
                      <option key={u.id} value={String(u.id)}>{u.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    form="bulk-form"
                    name={`${pfx}[cadence]`}
                    value={r.cadence}
                    onChange={e => updateRow(r.id, { cadence: e.target.value as Cadence })}
                  >
                    <option value="single">Single</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </td>
                <td>
                  <select
                    form="bulk-form"
                    name={`${pfx}[cost_type]`}
                    value={r.costType}
                    onChange={e => updateRow(r.id, { costType: e.target.value as CostType })}
                  >
                    <option value="credits">Credits</option>
                    <option value="dollars">Dollars</option>
                  </select>
                </td>
                <td className="num">
                  <input
                    form="bulk-form"
                    name={`${pfx}[cost]`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.cost}
                    required
                    onChange={e => updateRow(r.id, { cost: e.target.value })}
                  />
                </td>
                <td className="num">
                  <input
                    form="bulk-form"
                    name={`${pfx}[setup_cost]`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={isSingle ? '0' : r.setup}
                    disabled={isSingle}
                    onChange={e => updateRow(r.id, { setup: e.target.value })}
                  />
                </td>
                <td className="num annual-cell">
                  {Math.round(annual).toLocaleString('en-US')}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className={`btn-sm${hasMeta ? ' has-meta' : ''}`}
                    onClick={() => toggleExpanded(r.id)}
                    aria-expanded={isExp}
                    title="Audience, target / actual N, and description"
                  >
                    Details {isExp ? '▾' : '▸'}{hasMeta ? ' •' : ''}
                  </button>
                  {!readOnly && r.isImported && (
                    <button
                      type="submit"
                      form={`reviewed-form-${r.id}`}
                      className="btn-sm"
                      title="Clear the 'cost not recorded' flag without changing the cost"
                    >
                      Mark reviewed
                    </button>
                  )}
                  {!readOnly && (
                    <ConfirmButton
                      type="submit"
                      form={`delete-form-${r.id}`}
                      className="btn-sm btn-danger"
                      message={`Delete study '${r.name}'?`}
                    >
                      Delete
                    </ConfirmButton>
                  )}
                </td>
              </tr>
              {/* Detail row is always rendered (hidden when collapsed) so its
                  inputs always submit the current values with the bulk save —
                  a collapsed row must not blank out its own metadata. */}
              <tr className="study-detail-row" style={{ display: isExp ? undefined : 'none' }}>
                <td colSpan={COLUMNS.length + 1}>
                  <div className="study-detail-grid">
                    <label>Audience
                      <input
                        form="bulk-form"
                        name={`${pfx}[audience]`}
                        type="text"
                        placeholder="e.g. Institutional investors"
                        value={r.audience}
                        onChange={e => updateRow(r.id, { audience: e.target.value })}
                      />
                    </label>
                    <label>Target N
                      <input
                        form="bulk-form"
                        name={`${pfx}[target_n]`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="e.g. 600"
                        value={r.targetN}
                        onChange={e => updateRow(r.id, { targetN: e.target.value })}
                      />
                    </label>
                    <label>Actual N delivered
                      <input
                        form="bulk-form"
                        name={`${pfx}[actual_n_delivered]`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="e.g. 542"
                        value={r.actualN}
                        onChange={e => updateRow(r.id, { actualN: e.target.value })}
                      />
                    </label>
                    <label className="study-detail-desc">Description
                      <textarea
                        form="bulk-form"
                        name={`${pfx}[description]`}
                        rows={2}
                        placeholder="Short description of this study"
                        value={r.description}
                        onChange={e => updateRow(r.id, { description: e.target.value })}
                      />
                    </label>
                  </div>
                </td>
              </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {!readOnly && (
        <div className="bulk-actions">
          <button type="submit" form="bulk-form">Save all changes</button>
          <span className="muted small">Saves every row at once. Delete buttons act per row.</span>
        </div>
      )}
    </>
  );
}

function sortValue(r: RowState, key: string): string {
  switch (key) {
    case 'date': return r.occurredOn;
    case 'name': return (r.name || '').toLowerCase();
    case 'users': return (r.userNames || '').toLowerCase();
    case 'cadence': return r.cadence;
    case 'costType': return r.costType;
    case 'costPerRun': return r.cost;
    case 'setup': return r.cadence === 'single' ? '0' : r.setup;
    case 'totalYr': return String(parseFloat(r.cost || '0') * (RUNS_PER_YEAR[r.cadence] || 1));
    default: return '';
  }
}
