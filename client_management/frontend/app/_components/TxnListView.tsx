'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { filterOwned, ownsAny, type PulseMode } from '../../lib/clientPulse';
import {
  credits as creditsFmt,
  creditsSigned,
  dollars,
  dollarsSigned,
  isoDate,
} from '../../lib/format';
import type { ContractListRow, StudyListRow } from '../../lib/types';
import InfoTooltip from './InfoTooltip';

const TIP =
  'Shows the records for clients whose salesperson is you (matched by your sign-in email). It is only a filter — switch to “All” to see everyone. Your choice is remembered on this device.';

type Props =
  | { kind: 'study'; email: string; rows: StudyListRow[]; canCreate?: boolean; restricted?: boolean }
  | { kind: 'contract'; email: string; rows: ContractListRow[]; canCreate?: boolean; restricted?: boolean };

export default function TxnListView(props: Props) {
  const { kind, email } = props;
  const canCreate = props.canCreate !== false;
  const restricted = props.restricted === true;
  const noun = kind === 'study' ? 'studies' : 'contracts';
  const lsKey = `ccm-${noun}-mode`;
  const newHref = kind === 'study' ? '/studies/new' : '/contracts/new';
  const newLabel = kind === 'study' ? '+ Record a study' : '+ Add a contract';

  const [mode, setMode] = useState<PulseMode>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(lsKey);
    if (saved === 'mine' || saved === 'all') setMode(saved);
    else setMode(ownsAny(props.rows, email) ? 'mine' : 'all');
  }, [props.rows, email, lsKey]);

  const choose = (m: PulseMode) => {
    setMode(m);
    try {
      localStorage.setItem(lsKey, m);
    } catch {
      /* private mode */
    }
  };

  // Restricted reps only receive their own records from the backend, so the
  // My/All toggle is a no-op — force "all" (= everything returned) for them.
  const effectiveMode = restricted ? 'all' : mode;
  const view = useMemo(() => {
    // The per-kind branch narrows props.rows to a single row type.
    const owned =
      kind === 'study'
        ? filterOwned(props.rows, email, effectiveMode)
        : filterOwned(props.rows, email, effectiveMode);
    const term = q.trim().toLowerCase();
    if (!term) return owned;
    return owned.filter(
      r =>
        r.name.toLowerCase().includes(term) ||
        r.client.name.toLowerCase().includes(term) ||
        (r.soccProjectCode || '').toLowerCase().includes(term),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.rows, email, effectiveMode, q, kind]);

  return (
    <div className="txnlist">
      <div className="list-head">
        {canCreate ? (
          <Link className="btn" href={newHref}>{newLabel}</Link>
        ) : kind === 'contract' ? (
          <Link className="btn" href="/credit-requests/new">+ Request credits</Link>
        ) : null}
        <input
          type="search"
          className="ledger-search"
          placeholder={`Search ${noun} by name, client, or code…`}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {!restricted && (
          <>
            <span className="pulse-toggle" role="group" aria-label="Which records to show">
              <button type="button" className={mode === 'mine' ? 'is-active' : ''} aria-pressed={mode === 'mine'} onClick={() => choose('mine')}>
                My {noun}
              </button>
              <button type="button" className={mode === 'all' ? 'is-active' : ''} aria-pressed={mode === 'all'} onClick={() => choose('all')}>
                All {noun}
              </button>
            </span>
            <InfoTooltip text={TIP} align="right" />
          </>
        )}
      </div>

      {view.length === 0 ? (
        <p className="muted">
          {mode === 'mine'
            ? `No ${noun} for your clients yet.`
            : `No ${noun} recorded yet.`}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="report compact">
            {kind === 'study' ? (
              <>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Study</th>
                    <th>For</th>
                    <th className="num">Credits Δ</th>
                    <th className="num">Dollars Δ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(view as StudyListRow[]).map(s => {
                    const cd = Number(s.creditsDelta);
                    const dd = Number(s.dollarsDelta);
                    return (
                      <tr key={s.id}>
                        <td>{isoDate(s.occurredOn)}</td>
                        <td><Link href={`/reports/transactions?client_id=${s.client.id}`}>{s.client.name}</Link></td>
                        <td>
                          {s.name}
                          {s.soccProjectCode ? <span className="muted small"> · {s.soccProjectCode}</span> : null}
                          {s.soccBoardColumn ? <span className={`tag tag-socc${s.soccBoardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{s.soccBoardColumn}</span> : null}
                        </td>
                        <td>{(s.userObjs || []).map(u => u.name).join(', ') || (s.clientUser ? s.clientUser.name : '')}</td>
                        <td className={`num${cd < 0 ? ' neg' : cd > 0 ? ' pos' : ''}`}>{creditsSigned(s.creditsDelta)}</td>
                        <td className={`num${dd < 0 ? ' neg' : dd > 0 ? ' pos' : ''}`}>{dollarsSigned(s.dollarsDelta)}</td>
                        <td className="row-actions">
                          <Link className="btn-sm" href={`/studies/new?client_id=${s.client.id}#s${s.id}`}>Edit</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Contract</th>
                    <th className="num">Credits</th>
                    <th className="num">Dollars</th>
                    <th>Renewal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(view as ContractListRow[]).map(c => (
                    <tr key={c.id}>
                      <td>{isoDate(c.occurredOn)}</td>
                      <td><Link href={`/reports/transactions?client_id=${c.client.id}`}>{c.client.name}</Link></td>
                      <td>
                        {c.name}
                        {c.soccProjectCode ? <span className="muted small"> · {c.soccProjectCode}</span> : null}
                      </td>
                      <td className="num">{Number(c.creditsAmount) ? `${creditsFmt(c.creditsAmount)} cr` : '—'}</td>
                      <td className="num">{Number(c.dollarsAmount) ? dollars(c.dollarsAmount) : '—'}</td>
                      <td>{c.renewalOn ? isoDate(c.renewalOn) : '—'}</td>
                      <td className="row-actions">
                        {canCreate && (
                          <Link className="btn-sm" href={`/contracts/new?client_id=${c.client.id}#c${c.id}`}>Edit</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
