'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';

import {
  credits as creditsFmt,
  creditsSigned,
  dollars,
  dollarsSigned,
  isoDate,
} from '../../../lib/format';
import { filterLedger } from '../../../lib/ledger';
import type { Ledger, LedgerContract, StudyTransaction } from '../../../lib/types';
import DeleteConfirm from '../../_components/DeleteConfirm';
import InfoTooltip from '../../_components/InfoTooltip';
import { deleteLedgerContractAction, deleteLedgerStudyAction } from './actions';

const REMAINING_TIP =
  'What is left on this contract: its funding minus every study that rolls up to it. Red means the contract is over-drawn.';
const UNASSIGNED_TIP =
  'Studies not tied to a specific contract. They still draw down the client total; assign one on the study form to roll it up.';

function remainingCell(c: LedgerContract) {
  // Show the currency the contract is funded in (contracts are normally
  // single-currency); fall back to credits.
  const isDollars = Number(c.dollarsAmount ?? c.dollarsDelta) !== 0 && Number(c.creditsAmount ?? c.creditsDelta) === 0;
  const value = isDollars ? c.remainingDollars : c.remainingCredits;
  const text = isDollars ? dollars(value) : creditsFmt(value);
  return <span className={value < 0 ? 'neg' : ''}>{text}</span>;
}

function StudyRow({ s, clientId }: { s: StudyTransaction; clientId: number }) {
  const cd = Number(s.creditsDelta);
  const dd = Number(s.dollarsDelta);
  return (
    <tr className="ledger-study">
      <td className="ledger-indent">
        {s.name}
        {s.soccProjectCode ? <span className="muted small"> · {s.soccProjectCode}</span> : null}
        {s.soccBoardColumn ? (
          <span className={`tag tag-socc${s.soccBoardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{s.soccBoardColumn}</span>
        ) : null}
      </td>
      <td>{s.clientUser ? s.clientUser.name : ''}</td>
      <td className={`num${cd < 0 ? ' neg' : cd > 0 ? ' pos' : ''}`}>{creditsSigned(s.creditsDelta)}</td>
      <td className={`num${dd < 0 ? ' neg' : dd > 0 ? ' pos' : ''}`}>{dollarsSigned(s.dollarsDelta)}</td>
      <td />
      <td className="num" />
      <td className="row-actions">
        <Link className="btn-sm" href={`/studies/new?client_id=${clientId}`}>Edit</Link>
        <DeleteConfirm action={deleteLedgerStudyAction} id={s.id} clientId={clientId} name={s.name} />
      </td>
    </tr>
  );
}

export default function LedgerTree({ ledger, clientId }: { ledger: Ledger; clientId: number }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const view = useMemo(() => filterLedger(ledger, q), [ledger, q]);
  const allIds = ledger.contracts.map(c => c.id);
  // Original (unfiltered) linked-study counts — a contract can only be
  // archived when nothing rolls up to it (the backend enforces this too).
  const studyCounts = useMemo(
    () => new Map(ledger.contracts.map(c => [c.id, c.studies.length])),
    [ledger],
  );

  const toggle = (id: number) =>
    setCollapsed(prev => {
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
          onChange={e => setQ(e.target.value)}
        />
        <span className="ledger-control-actions">
          <button type="button" className="btn-sm" onClick={() => setCollapsed(new Set(allIds))}>Collapse all</button>
          <button type="button" className="btn-sm" onClick={() => setCollapsed(new Set())}>Expand all</button>
        </span>
      </div>

      <table className="report ledger-table">
        <thead>
          <tr>
            <th>Contract / Study</th>
            <th>For user</th>
            <th className="num">Credits Δ</th>
            <th className="num">Dollars Δ</th>
            <th>Renewal</th>
            <th className="num">Remaining <InfoTooltip text={REMAINING_TIP} align="right" /></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {view.contracts.map(c => {
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
                  <td />
                  <td className="num pos">{creditsSigned(c.creditsDelta)}</td>
                  <td className="num">{dollarsSigned(c.dollarsDelta)}</td>
                  <td>{c.renewalOn ? isoDate(c.renewalOn) : ''}</td>
                  <td className="num ledger-remaining">{remainingCell(c)}</td>
                  <td className="row-actions">
                    <Link className="btn-sm" href={`/contracts/new?client_id=${clientId}`}>Edit</Link>
                    {canDelete ? (
                      <DeleteConfirm action={deleteLedgerContractAction} id={c.id} clientId={clientId} name={c.name} />
                    ) : (
                      <span className="muted small" title="Unlink or archive its surveys first">has surveys</span>
                    )}
                  </td>
                </tr>
                {!isCollapsed && c.studies.map(s => <StudyRow key={s.id} s={s} clientId={clientId} />)}
              </Fragment>
            );
          })}

          {view.unassigned.length > 0 && (
            <>
              <tr className="ledger-group">
                <td colSpan={7}>Unassigned <InfoTooltip text={UNASSIGNED_TIP} align="left" /></td>
              </tr>
              {view.unassigned.map(s => <StudyRow key={s.id} s={s} clientId={clientId} />)}
            </>
          )}

          {view.adjustments.length > 0 && (
            <>
              <tr className="ledger-group">
                <td colSpan={7}>Adjustments</td>
              </tr>
              {view.adjustments.map(a => {
                const cd = Number(a.creditsDelta);
                const dd = Number(a.dollarsDelta);
                return (
                  <tr key={a.id} className="ledger-study">
                    <td className="ledger-indent">{a.name}{a.note ? <span className="muted small"> · {a.note}</span> : null}</td>
                    <td />
                    <td className={`num${cd < 0 ? ' neg' : cd > 0 ? ' pos' : ''}`}>{creditsSigned(a.creditsDelta)}</td>
                    <td className={`num${dd < 0 ? ' neg' : dd > 0 ? ' pos' : ''}`}>{dollarsSigned(a.dollarsDelta)}</td>
                    <td />
                    <td className="num" />
                    <td />
                  </tr>
                );
              })}
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
