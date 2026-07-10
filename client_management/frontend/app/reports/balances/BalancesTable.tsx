'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { contractValue, credits as creditsFmt, dollars, isoDate } from '../../../lib/format';
import { TIP } from '../../../lib/tooltips';
import type { BalanceRow } from '../../../lib/types';
import InfoTooltip from '../../_components/InfoTooltip';

interface Col {
  key: string;
  label: string;
  num: boolean;
  tip?: string;
}

function sortVal(r: BalanceRow, key: string): string | number {
  switch (key) {
    case 'client': return r.client.name.toLowerCase();
    case 'salesperson': return (r.client.salespersonName || r.client.relationshipManager || '').toLowerCase();
    case 'since': return new Date(r.client.becameClientOn).getTime();
    case 'credits': return r.credits;
    case 'dollars': return r.dollars;
    case 'cyvalue': return r.cyValue + r.cyCredits;
    case 'renewal': return r.cyRenewal ? new Date(r.cyRenewal).getTime() : Number.POSITIVE_INFINITY;
    default: return 0;
  }
}

export default function BalancesTable({ rows, currentYear }: { rows: BalanceRow[]; currentYear: number }) {
  const cols: Col[] = [
    { key: 'client', label: 'Client', num: false },
    { key: 'salesperson', label: 'Salesperson', num: false },
    { key: 'since', label: 'Client since', num: false },
    { key: 'credits', label: 'Credits remaining', num: true, tip: TIP.creditsRemaining },
    { key: 'dollars', label: 'Dollars remaining', num: true, tip: TIP.dollarsRemaining },
    { key: 'cyvalue', label: `${currentYear} contract value`, num: true, tip: TIP.cyValue },
    { key: 'renewal', label: 'Next renewal', num: false, tip: TIP.cyRenewal },
  ];
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'client', dir: 'asc' });

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortVal(a, sort.key);
      const bv = sortVal(b, sort.key);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort]);

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({
      credits: t.credits + r.credits,
      dollars: t.dollars + r.dollars,
      cyCredits: t.cyCredits + r.cyCredits,
      cyValue: t.cyValue + r.cyValue,
    }),
    { credits: 0, dollars: 0, cyCredits: 0, cyValue: 0 },
  ), [rows]);

  const click = (key: string) =>
    setSort(p => ({ key, dir: p.key === key && p.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <table className="report">
      <thead>
        <tr>
          {cols.map(c => (
            <th
              key={c.key}
              className={c.num ? 'num' : undefined}
              onClick={() => click(c.key)}
              style={{ cursor: 'pointer' }}
              aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              {c.label}{c.tip ? <InfoTooltip text={c.tip} /> : null}{' '}
              <span className="sort-ind">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.client.id}>
            <td><Link href={`/clients?id=${r.client.id}`}>{r.client.name}</Link></td>
            <td>{r.client.salespersonName || r.client.relationshipManager || '—'}</td>
            <td>{isoDate(r.client.becameClientOn)}</td>
            <td className={`num${r.credits < 0 ? ' neg' : ''}`}>{creditsFmt(r.credits)}</td>
            <td className={`num${r.dollars < 0 ? ' neg' : ''}`}>{dollars(r.dollars)}</td>
            <td className="num">{contractValue(r.cyCredits, r.cyValue)}</td>
            <td>{r.cyRenewal ? isoDate(r.cyRenewal) : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="report-totals">
          <td>Total · {rows.length} client{rows.length === 1 ? '' : 's'}</td>
          <td></td>
          <td></td>
          <td className={`num${totals.credits < 0 ? ' neg' : ''}`}>{creditsFmt(totals.credits)}</td>
          <td className={`num${totals.dollars < 0 ? ' neg' : ''}`}>{dollars(totals.dollars)}</td>
          <td className="num">{contractValue(totals.cyCredits, totals.cyValue)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  );
}
