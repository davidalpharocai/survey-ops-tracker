'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  computeKpis,
  filterOwned,
  ownsAny,
  type PulseMode,
} from '../../lib/clientPulse';
import { credits as creditsFmt, dollars, isoDate } from '../../lib/format';
import type { BalanceHealthRow, BalanceRow, RenewalRow } from '../../lib/types';
import InfoTooltip from './InfoTooltip';

const LS_KEY = 'ccm-pulse-mode';
const CAP = 8;

const PULSE_TIP =
  'A quick read on your clients: who is negative or running low, and whose contracts renew soon. “My clients” shows the ones assigned to you; switch to “All clients” to see everyone. Nothing is hidden — this is just a filter.';

// Every number/section respects the My/All toggle above.
const KPI_TIPS = {
  negative: 'How many clients have a credit or dollar balance below zero (over-drawn). Counts the clients shown by the toggle above.',
  low: 'How many clients are projected to run out of credits or dollars within about 60 days, based on their recent burn rate.',
  renewals30: 'How many contracts have a renewal date within the next 30 days.',
  cyDollars: 'Total dollar value of contracts dated this calendar year, summed across the clients shown.',
  cyCredits: 'Total credits granted by contracts dated this calendar year, summed across the clients shown.',
};
const ATTENTION_TIP =
  'Your call-today list: clients that are over-drawn or running low, worst first. Click a client to open their contracts & studies.';
const RENEWALS_TIP =
  'Contracts coming up for renewal, soonest first. Click a client to open their contracts & studies.';

function statusChip(status: BalanceHealthRow['status']) {
  if (status === 'negative') return <span className="pulse-chip is-neg">Negative</span>;
  if (status === 'low') return <span className="pulse-chip is-low">Low</span>;
  return <span className="pulse-chip">OK</span>;
}

export default function ClientPulseView({
  email,
  balances,
  renewals,
  health,
  restricted = false,
}: {
  email: string;
  balances: BalanceRow[];
  renewals: RenewalRow[];
  health: BalanceHealthRow[];
  restricted?: boolean;
}) {
  // SSR renders "all"; after mount adopt the saved choice, or default to
  // "mine" when the signed-in user actually owns clients.
  const [mode, setMode] = useState<PulseMode>('all');
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'mine' || saved === 'all') setMode(saved);
    else setMode(ownsAny(balances, email) ? 'mine' : 'all');
  }, [balances, email]);

  const choose = (m: PulseMode) => {
    setMode(m);
    try {
      localStorage.setItem(LS_KEY, m);
    } catch {
      /* private mode */
    }
  };

  // Restricted salespeople only ever receive their own clients from the
  // backend, so the My/All toggle is a no-op for them — hide it and show
  // everything returned (which is already just their book).
  const effectiveMode: PulseMode = restricted ? 'all' : mode;
  const fHealth = filterOwned(health, email, effectiveMode);
  const fRenewals = filterOwned(renewals, email, effectiveMode);
  const fBalances = filterOwned(balances, email, effectiveMode);
  const kpis = computeKpis(fHealth, fRenewals, fBalances);

  const attention = fHealth.filter(h => h.status !== 'ok');
  const dueSoon = fRenewals; // already soonest-first from the backend
  const nothing = attention.length === 0 && dueSoon.length === 0;

  return (
    <section className="pulse">
      <div className="pulse-head">
        <h2 className="pulse-title">Client pulse <InfoTooltip text={PULSE_TIP} /></h2>
        {!restricted && (
          <div className="pulse-toggle" role="group" aria-label="Which clients to show">
            <button
              type="button"
              className={mode === 'mine' ? 'is-active' : ''}
              aria-pressed={mode === 'mine'}
              onClick={() => choose('mine')}
            >My clients</button>
            <button
              type="button"
              className={mode === 'all' ? 'is-active' : ''}
              aria-pressed={mode === 'all'}
              onClick={() => choose('all')}
            >All clients</button>
          </div>
        )}
      </div>

      <div className="pulse-kpis">
        <a className="pulse-kpi pulse-kpi-link" href="#pulse-attention">
          <span className="pulse-kpi-label">Clients negative <InfoTooltip text={KPI_TIPS.negative} align="left" /></span>
          <span className="pulse-kpi-value is-neg">{kpis.negative}</span>
        </a>
        <a className="pulse-kpi pulse-kpi-link" href="#pulse-attention">
          <span className="pulse-kpi-label">Running low &lt; 60d <InfoTooltip text={KPI_TIPS.low} /></span>
          <span className="pulse-kpi-value is-low">{kpis.low}</span>
        </a>
        <a className="pulse-kpi pulse-kpi-link" href="#pulse-renewals">
          <span className="pulse-kpi-label">Renewals in 30d <InfoTooltip text={KPI_TIPS.renewals30} /></span>
          <span className="pulse-kpi-value is-accent">{kpis.renewals30}</span>
        </a>
        <Link className="pulse-kpi pulse-kpi-link" href="/reports/balances">
          <span className="pulse-kpi-label">This-year $ <InfoTooltip text={KPI_TIPS.cyDollars} /></span>
          <span className="pulse-kpi-value">{dollars(kpis.cyValue)}</span>
        </Link>
        <Link className="pulse-kpi pulse-kpi-link" href="/reports/balances">
          <span className="pulse-kpi-label">This-year credits <InfoTooltip text={KPI_TIPS.cyCredits} align="right" /></span>
          <span className="pulse-kpi-value">{creditsFmt(kpis.cyCredits)} cr</span>
        </Link>
      </div>

      {mode === 'mine' && nothing ? (
        <p className="muted pulse-empty">
          No clients assigned to you need attention.{' '}
          <button type="button" className="linklike" onClick={() => choose('all')}>See all clients</button>.
        </p>
      ) : (
        <div className="pulse-cards">
          <div className="panel pulse-panel" id="pulse-attention">
            <div className="pulse-panel-head">
              <h3>Needs attention <InfoTooltip text={ATTENTION_TIP} /></h3>
              <Link href="/reports/health" className="pulse-viewall">Balance health →</Link>
            </div>
            {attention.length ? (
              <div className="table-scroll">
                <table className="report compact">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th className="num">Credits</th>
                      <th className="num">Dollars</th>
                      <th className="num">Runs out</th>
                      <th className="num">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attention.slice(0, CAP).map(h => {
                      const runOut = h.creditsRunOutOn || h.dollarsRunOutOn;
                      return (
                        <tr key={h.client.id}>
                          <td><Link href={`/reports/transactions?client_id=${h.client.id}`}>{h.client.name}</Link></td>
                          <td className={`num${h.credits < 0 ? ' neg' : ''}`}>{creditsFmt(h.credits)}</td>
                          <td className={`num${h.dollars < 0 ? ' neg' : ''}`}>{dollars(h.dollars)}</td>
                          <td className="num muted">{h.status === 'negative' ? '—' : runOut ? isoDate(new Date(runOut)) : '—'}</td>
                          <td className="num">{statusChip(h.status)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">Nothing needs attention. Nice.</p>
            )}
          </div>

          <div className="panel pulse-panel" id="pulse-renewals">
            <div className="pulse-panel-head">
              <h3>Renewals due <InfoTooltip text={RENEWALS_TIP} /></h3>
              <Link href="/reports/renewals" className="pulse-viewall">Renewal radar →</Link>
            </div>
            {dueSoon.length ? (
              <div className="table-scroll">
                <table className="report compact">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Contract</th>
                      <th className="num">Date</th>
                      <th className="num">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueSoon.slice(0, CAP).map(r => (
                      <tr key={r.contractId}>
                        <td><Link href={`/reports/transactions?client_id=${r.client.id}`}>{r.client.name}</Link></td>
                        <td className="muted">{r.contractName}</td>
                        <td className="num">{isoDate(r.renewalOn)}</td>
                        <td className="num"><span className={`pulse-chip${r.daysUntil <= 30 ? ' is-accent' : ''}`}>{r.daysUntil}d</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No upcoming renewals.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
