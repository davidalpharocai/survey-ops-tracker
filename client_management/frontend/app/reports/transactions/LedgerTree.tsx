'use client';

import Link from 'next/link';
import { cloneElement, Fragment, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  credits as creditsFmt,
  creditsSigned,
  dollars,
  dollarsSigned,
  isoDate,
} from '../../../lib/format';
import { filterLedger } from '../../../lib/ledger';
import {
  DATA_COLUMN_IDS,
  moveColumn,
  normalizeColumnOrder,
  type DataColumnId,
} from '../../../lib/ledgerColumns';
import type { Ledger, LedgerAdjustment, LedgerContract, StudyTransaction } from '../../../lib/types';
import DeleteConfirm from '../../_components/DeleteConfirm';
import InfoTooltip from '../../_components/InfoTooltip';
import { deleteLedgerContractAction, deleteLedgerStudyAction } from './actions';

const LS_KEY = 'ccm-ledger-col-order';

const REMAINING_TIP =
  'What is left on this contract: its funding minus every study that rolls up to it. Red means the contract is over-drawn.';
const UNASSIGNED_TIP =
  'Studies not tied to a specific contract. They still draw down the client total; assign one on the study form to roll it up.';
const REORDER_TIP =
  'Drag a column header left or right to reorder these columns. Your order is remembered on this device; use “Reset columns” to restore the default.';

function remainingCell(c: LedgerContract) {
  // Show the currency the contract is funded in (contracts are normally
  // single-currency); fall back to credits.
  const isDollars = Number(c.dollarsAmount ?? c.dollarsDelta) !== 0 && Number(c.creditsAmount ?? c.creditsDelta) === 0;
  const value = isDollars ? c.remainingDollars : c.remainingCredits;
  const text = isDollars ? dollars(value) : creditsFmt(value);
  return <span className={value < 0 ? 'neg' : ''}>{text}</span>;
}

const numClass = (v: number) => `num${v < 0 ? ' neg' : v > 0 ? ' pos' : ''}`;

// The reorderable data columns. Each knows how to render its <td> for a
// contract row, a study row, and an adjustment row (cells differ by row
// type — e.g. Renewal/Remaining only apply to contracts). The pinned name
// column (col 0) and actions column (last) are handled outside this map.
interface ColumnDef {
  header: ReactNode;
  thClass: string;
  contract: (c: LedgerContract) => ReactElement;
  study: (s: StudyTransaction) => ReactElement;
  adjustment: (a: LedgerAdjustment) => ReactElement;
}

const COLUMNS: Record<DataColumnId, ColumnDef> = {
  forUser: {
    header: 'For user',
    thClass: '',
    contract: () => <td />,
    study: (s) => <td>{s.clientUser ? s.clientUser.name : ''}</td>,
    adjustment: () => <td />,
  },
  credits: {
    header: 'Credits Δ',
    thClass: 'num',
    contract: (c) => <td className="num pos">{creditsSigned(c.creditsDelta)}</td>,
    study: (s) => <td className={numClass(Number(s.creditsDelta))}>{creditsSigned(s.creditsDelta)}</td>,
    adjustment: (a) => <td className={numClass(Number(a.creditsDelta))}>{creditsSigned(a.creditsDelta)}</td>,
  },
  dollars: {
    header: 'Dollars Δ',
    thClass: 'num',
    contract: (c) => <td className="num">{dollarsSigned(c.dollarsDelta)}</td>,
    study: (s) => <td className={numClass(Number(s.dollarsDelta))}>{dollarsSigned(s.dollarsDelta)}</td>,
    adjustment: (a) => <td className={numClass(Number(a.dollarsDelta))}>{dollarsSigned(a.dollarsDelta)}</td>,
  },
  renewal: {
    header: 'Renewal',
    thClass: '',
    contract: (c) => <td>{c.renewalOn ? isoDate(c.renewalOn) : ''}</td>,
    study: () => <td />,
    adjustment: () => <td />,
  },
  remaining: {
    header: (
      <>
        Remaining <InfoTooltip text={REMAINING_TIP} align="right" />
      </>
    ),
    thClass: 'num',
    contract: (c) => <td className="num ledger-remaining">{remainingCell(c)}</td>,
    study: () => <td className="num" />,
    adjustment: () => <td className="num" />,
  },
};

// Render the ordered data cells for a row, tagging each with a stable key.
function dataCells(
  order: DataColumnId[],
  kind: 'contract' | 'study' | 'adjustment',
  row: LedgerContract | StudyTransaction | LedgerAdjustment,
) {
  return order.map((id) => {
    // The union is safe: callers only pass the row type matching `kind`.
    const cell = (COLUMNS[id][kind] as (r: typeof row) => ReactElement)(row);
    return cloneElement(cell, { key: id });
  });
}

function StudyRow({
  s,
  clientId,
  order,
}: {
  s: StudyTransaction;
  clientId: number;
  order: DataColumnId[];
}) {
  return (
    <tr className="ledger-study">
      <td className="ledger-indent">
        {s.name}
        {s.soccProjectCode ? <span className="muted small"> · {s.soccProjectCode}</span> : null}
        {s.soccBoardColumn ? (
          <span className={`tag tag-socc${s.soccBoardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{s.soccBoardColumn}</span>
        ) : null}
      </td>
      {dataCells(order, 'study', s)}
      <td className="row-actions">
        <Link className="btn-sm" href={`/studies/new?client_id=${clientId}#s${s.id}`}>Edit</Link>
        <DeleteConfirm action={deleteLedgerStudyAction} id={s.id} clientId={clientId} name={s.name} />
      </td>
    </tr>
  );
}

export default function LedgerTree({ ledger, clientId, canEditMoney = true }: { ledger: Ledger; clientId: number; canEditMoney?: boolean }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Column order: start from the default (matches SSR markup so there is no
  // hydration mismatch), then adopt any saved order after mount.
  const [order, setOrder] = useState<DataColumnId[]>(() => [...DATA_COLUMN_IDS]);
  const [dragId, setDragId] = useState<DataColumnId | null>(null);
  const [dropId, setDropId] = useState<DataColumnId | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      setOrder(normalizeColumnOrder(saved));
    } catch {
      /* keep default */
    }
  }, []);

  const persist = (next: DataColumnId[]) => {
    setOrder(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — order still applies for this session */
    }
  };

  const dropOn = (targetId: DataColumnId) => {
    if (dragId && dragId !== targetId) persist(moveColumn(order, dragId, targetId));
    setDragId(null);
    setDropId(null);
  };

  const resetColumns = () => {
    setOrder([...DATA_COLUMN_IDS]);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  };

  const isCustomOrder = order.some((id, i) => id !== DATA_COLUMN_IDS[i]);

  const view = useMemo(() => filterLedger(ledger, q), [ledger, q]);
  const allIds = ledger.contracts.map((c) => c.id);
  // Original (unfiltered) linked-study counts — a contract can only be
  // archived when nothing rolls up to it (the backend enforces this too).
  const studyCounts = useMemo(
    () => new Map(ledger.contracts.map((c) => [c.id, c.studies.length])),
    [ledger],
  );

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="ledger">
      <div className="ledger-controls">
        <input
          type="search"
          className="ledger-search"
          placeholder="Search this client's contracts & studies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ledger-control-actions">
          {isCustomOrder && (
            <button type="button" className="btn-sm" onClick={resetColumns}>Reset columns</button>
          )}
          <button type="button" className="btn-sm" onClick={() => setCollapsed(new Set(allIds))}>Collapse all</button>
          <button type="button" className="btn-sm" onClick={() => setCollapsed(new Set())}>Expand all</button>
        </span>
      </div>

      <table className="report ledger-table">
        <thead>
          <tr>
            <th>Contract / Study</th>
            {order.map((id) => (
              <th
                key={id}
                className={`ledger-th-move${COLUMNS[id].thClass ? ' ' + COLUMNS[id].thClass : ''}${dropId === id ? ' is-drop' : ''}`}
                draggable
                onDragStart={() => setDragId(id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== id) setDropId(id);
                }}
                onDragLeave={() => setDropId((prev) => (prev === id ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropId(null);
                }}
                title="Drag to reorder this column"
              >
                <span className="ledger-th-grip" aria-hidden="true">⠿</span>
                {COLUMNS[id].header}
              </th>
            ))}
            <th aria-label="Row actions">
              <InfoTooltip text={REORDER_TIP} align="right" />
            </th>
          </tr>
        </thead>
        <tbody>
          {view.contracts.map((c) => {
            const isCollapsed = collapsed.has(c.id);
            const canDelete = (studyCounts.get(c.id) ?? 0) === 0;
            return (
              <Fragment key={c.id}>
                <tr className="ledger-contract">
                  <td>
                    <button
                      type="button"
                      className="ledger-contract-toggle"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} contract ${c.name}`}
                      onClick={() => toggle(c.id)}
                    >
                      <span className="tree-toggle" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                      <span className="tag tag-contract">contract</span>
                      <span className="ledger-contract-name">{c.name}</span>
                      {c.soccProjectCode ? <span className="muted small"> · {c.soccProjectCode}</span> : null}
                      {c.studies.length ? <span className="muted small"> ({c.studies.length})</span> : null}
                    </button>
                  </td>
                  {dataCells(order, 'contract', c)}
                  <td className="row-actions">
                    {canEditMoney ? (
                      <>
                        <Link className="btn-sm" href={`/contracts/new?client_id=${clientId}#c${c.id}`}>Edit</Link>
                        {canDelete ? (
                          <DeleteConfirm action={deleteLedgerContractAction} id={c.id} clientId={clientId} name={c.name} />
                        ) : (
                          <span className="muted small" title="Unlink or archive its surveys first">has surveys</span>
                        )}
                      </>
                    ) : null}
                  </td>
                </tr>
                {!isCollapsed && c.studies.map((s) => <StudyRow key={s.id} s={s} clientId={clientId} order={order} />)}
              </Fragment>
            );
          })}

          {view.unassigned.length > 0 && (
            <>
              <tr className="ledger-group">
                <td colSpan={7}>Unassigned <InfoTooltip text={UNASSIGNED_TIP} align="left" /></td>
              </tr>
              {view.unassigned.map((s) => <StudyRow key={s.id} s={s} clientId={clientId} order={order} />)}
            </>
          )}

          {view.adjustments.length > 0 && (
            <>
              <tr className="ledger-group">
                <td colSpan={7}>Adjustments</td>
              </tr>
              {view.adjustments.map((a) => (
                <tr key={a.id} className="ledger-study">
                  <td className="ledger-indent">{a.name}{a.note ? <span className="muted small"> · {a.note}</span> : null}</td>
                  {dataCells(order, 'adjustment', a)}
                  <td />
                </tr>
              ))}
            </>
          )}

          {view.contracts.length === 0 && view.unassigned.length === 0 && view.adjustments.length === 0 && (
            <tr><td colSpan={7} className="muted">No matches.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
